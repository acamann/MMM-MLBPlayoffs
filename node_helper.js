/* MMM-MLBPlayoffs node helper
 *
 * Owns polling of the official MLB Stats API and all postseason
 * parsing. The front-end communicates only through socket notifications:
 *   INIT {season, updateInterval, liveInterval}
 * and receives:
 *   MLB_DATA  {season, updatedAt, anyGameLive, series: [...]}
 *   MLB_ERROR human-readable error string
 */

const NodeHelper = require('node_helper');

// Round order + the gameType codes the Stats API uses for postseason.
const ROUNDS = [
	{gameType: 'F', title: 'Wild Card Series'},
	{gameType: 'D', title: 'Division Series'},
	{gameType: 'L', title: 'Championship Series'},
	{gameType: 'W', title: 'World Series'}
];

module.exports = NodeHelper.create({
	start() {
		console.log(`Starting node helper: ${this.name}`);
		this.updateTimer = null;
		this.config = null;
		this.anyGameLive = false;
	},

	socketNotificationReceived(notification, payload) {
		if (notification === 'INIT') {
			this.config = payload || {};
			this._update();
		}
	},

	// Self-rescheduling timer rather than a fixed interval: while any game is
	// live we poll at liveInterval, otherwise we back off to updateInterval.
	_scheduleNext() {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
		}
		const c = this.config || {};
		const live = Number(c.liveInterval) > 0 ? Number(c.liveInterval) : 15 * 60 * 1000;
		const idle = Number(c.updateInterval) > 0 ? Number(c.updateInterval) : 60 * 60 * 1000;
		const next = this.anyGameLive ? live : idle;
		this.updateTimer = setTimeout(() => this._update(), next);
	},

	async _update() {
		const season = this.config.season || new Date().getFullYear();
		const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&gameType=F,D,L,W&hydrate=team`;

		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`MLB API HTTP ${response.status}`);
			}
			const data = await response.json();
			// _buildBracket sets anyGameLive for the next interval decision.
			const series = this._buildBracket(data);
			this.sendSocketNotification('MLB_DATA', {
				season,
				updatedAt: new Date().toISOString(),
				anyGameLive: this.anyGameLive,
				series
			});
		} catch (err) {
			const message = `MMM-MLBPlayoffs: failed to load playoff schedule — ${err.message || err}`;
			console.error(message);
			this.sendSocketNotification('MLB_ERROR', message);
		}

		this._scheduleNext();
	},

	stop() {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
			this.updateTimer = null;
		}
	},

	// Collapse the flat game list into one entry per playoff series.
	_buildBracket(data) {
		const games = [];
		(data.dates || []).forEach(d => (d.games || []).forEach(g => games.push(g)));

		const byKey = new Map();

		games.forEach(g => {
			const away = g.teams && g.teams.away;
			const home = g.teams && g.teams.home;
			if (!away || !home || !away.team || !home.team) {
				return;
			}

			const ids = [away.team.id, home.team.id].sort((a, b) => a - b);
			const key = `${g.gameType}|${ids.join('-')}`;

			if (!byKey.has(key)) {
				byKey.set(key, {
					gameType: g.gameType,
					description: g.seriesDescription || '',
					gamesInSeries: g.gamesInSeries || 0,
					league: this._seriesLeague(away.team, home.team),
					teams: new Map(),
					games: []
				});
			}

			const series = byKey.get(key);
			series.games.push(g);

			[away, home].forEach(side => {
				if (!series.teams.has(side.team.id)) {
					series.teams.set(side.team.id, {
						id: side.team.id,
						name: side.team.teamName || side.team.name, // e.g. "Brewers"
						fullName: side.team.name,
						abbr: side.team.abbreviation,
						leagueName: side.team.league && side.team.league.name,
						wins: 0
					});
				}
			});
		});

		const seriesList = [];

		byKey.forEach(series => {
			series.games.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

			let liveGame = null;
			let lastFinal = null;

			series.games.forEach(g => {
				const state = g.status && g.status.abstractGameState;

				if (state === 'Final') {
					const winner = (g.teams.home.isWinner && g.teams.home) || (g.teams.away.isWinner && g.teams.away);
					if (winner && series.teams.has(winner.team.id)) {
						series.teams.get(winner.team.id).wins += 1;
					}
					lastFinal = g;
				} else if (state === 'Live') {
					liveGame = g;
				}
			});

			const teams = [...series.teams.values()].sort((a, b) => b.wins - a.wins);
			const winsNeeded = Math.floor((series.gamesInSeries || 1) / 2) + 1;
			const topWins = teams.length ? teams[0].wins : 0;
			const completed = topWins >= winsNeeded;

			const upcoming = series.games
				.filter(g => g.status && g.status.abstractGameState !== 'Final')
				.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate))[0] || null;

			const roundIndex = ROUNDS.findIndex(r => r.gameType === series.gameType);

			seriesList.push({
				key: series.gameType + '|' + teams.map(t => t.id).sort((a, b) => a - b).join('-'),
				roundIndex,
				description: series.description,
				league: series.league,
				gamesInSeries: series.gamesInSeries,
				winsNeeded,
				teams,
				completed,
				upcomingGame: upcoming
					? {
						date: upcoming.gameDate,
						timeTBD: !!(upcoming.status && upcoming.status.startTimeTBD),
						number: upcoming.seriesGameNumber,
						away: upcoming.teams.away.team.abbreviation,
						home: upcoming.teams.home.team.abbreviation,
						live: !!liveGame || (upcoming.status && upcoming.status.abstractGameState === 'Live'),
						state: upcoming.status && upcoming.status.detailedState
					}
					: null,
				lastFinal: lastFinal
					? {
						date: lastFinal.gameDate,
						number: lastFinal.seriesGameNumber,
						away: lastFinal.teams.away.team.abbreviation,
						home: lastFinal.teams.home.team.abbreviation,
						awayScore: lastFinal.teams.away.score,
						homeScore: lastFinal.teams.home.score
					}
					: null,
				games: series.games.map(g => ({
					number: g.seriesGameNumber,
					date: g.gameDate,
					// The API's placeholder date (07:33Z) is not a real first pitch.
					timeTBD: !!(g.status && g.status.startTimeTBD),
					state: g.status && g.status.abstractGameState,
					away: g.teams.away.team.abbreviation,
					home: g.teams.home.team.abbreviation,
					awayScore: g.teams.away.score,
					homeScore: g.teams.home.score
				}))
			});
		});

		seriesList.sort((a, b) => {
			if (a.roundIndex !== b.roundIndex) {
				return a.roundIndex - b.roundIndex;
			}
			if (a.league !== b.league) {
				return a.league === 'AL' ? -1 : 1;
			}
			return a.description.localeCompare(b.description);
		});

		// Drop placeholder "Lower Seed / Higher Seed" entries until the real
		// teams are known (later rounds get scheduled before matchups are set).
		const real = seriesList.filter(s =>
			s.teams.every(t => !/(Lower|Higher) Seed/.test(t.fullName || t.name))
		);

		// A series is in progress once any of its games has started (live) or
		// once some but not all of its games are final. isGameLive is the
		// narrower case: a game is being played right now.
		real.forEach(s => {
			const games = s.games || [];
			const played = games.filter(g => g.state === 'Final').length;
			s.isGameLive = games.some(g => g.state === 'Live');
			s.isInProgress = s.isGameLive || (!s.completed && played > 0);
		});

		this.anyGameLive = real.some(s => s.isGameLive);

		return real;
	},

	_seriesLeague(teamA, teamB) {
		const leagueA = teamA.league && teamA.league.name;
		const leagueB = teamB.league && teamB.league.name;
		if (leagueA === 'American League' && leagueB === 'American League') {
			return 'AL';
		}
		if (leagueA === 'National League' && leagueB === 'National League') {
			return 'NL';
		}
		return 'MLB';
	}
});
