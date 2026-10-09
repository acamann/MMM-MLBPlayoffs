/* MMM-MLB
 * MagicMirror² module — shows the current MLB postseason bracket
 * with up-to-date series standings (e.g. "Brewers lead 2-0").
 *
 * Data comes from the helper's fetch of the official MLB Stats API,
 * refreshed on a slow interval (default: every 3 hours).
 */

// eslint-disable-next-line no-undef
Module.register('MMM-MLB', {
	defaults: {
		view: 'bracket', // reserved for future 'standings' view
		season: new Date().getFullYear(),
		updateInterval: 3 * 60 * 60 * 1000, // 3 hours
		animationSpeed: 0
	},

	start() {
		this.loaded = false;
		this.error = null;
		this.series = [];
		this.updatedAt = null;

		this.sendSocketNotification('INIT', {
			season: this.config.season,
			updateInterval: this.config.updateInterval
		});
	},

	getStyles() {
		return ['MMM-MLB.css'];
	},

	getDom() {
		const wrapper = document.createElement('div');
		wrapper.className = 'mlb';

		const title = document.createElement('div');
		title.className = 'mlb-title';
		title.textContent = `MLB Playoffs ${this.config.season}`;
		wrapper.append(title);

		if (this.error) {
			const error = document.createElement('div');
			error.className = 'mlb-error';
			error.textContent = this.error;
			wrapper.append(error);
		}

		if (!this.loaded) {
			const loading = document.createElement('div');
			loading.className = 'mlb-status';
			loading.textContent = 'Loading …';
			wrapper.append(loading);
			return wrapper;
		}

		if (!this.series.length) {
			const empty = document.createElement('div');
			empty.className = 'mlb-status';
			empty.textContent = 'No playoff series scheduled yet.';
			wrapper.append(empty);
			return wrapper;
		}

		const bracket = document.createElement('div');
		bracket.className = 'mlb-bracket';

		bracket.append(this._buildSide('AL'));
		bracket.append(this._buildWorldSeries());
		bracket.append(this._buildSide('NL'));

		wrapper.append(bracket);

		if (this.updatedAt) {
			const footer = document.createElement('div');
			footer.className = 'mlb-updated';
			footer.textContent = `Updated ${new Date(this.updatedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}`;
			wrapper.append(footer);
		}

		return wrapper;
	},

	socketNotificationReceived(notification, payload) {
		if (notification === 'MLB_DATA') {
			this.error = null;
			this.loaded = true;
			this.series = payload.series || [];
			this.updatedAt = payload.updatedAt;
			this.updateDom(this.config.animationSpeed);
		} else if (notification === 'MLB_ERROR') {
			this.error = payload;
			this.loaded = true;
			this.updateDom(this.config.animationSpeed);
		}
	},

	_buildSide(league) {
		const side = document.createElement('div');
		side.className = `mlb-side mlb-${league.toLowerCase()}`;

		const sideSeries = this.series.filter(s => s.league === league);
		// WC (round 0) → Division (1) → LCS (2); columns left-to-right for AL,
		// mirrored for NL via CSS (row-reverse).
		const roundLabels = ['Wild Card', 'Division', 'LCS'];

		roundLabels.forEach((label, roundIndex) => {
			const col = document.createElement('div');
			col.className = 'mlb-col';

			const head = document.createElement('div');
			head.className = 'mlb-col-header';
			head.textContent = label;
			col.append(head);

			const inRound = sideSeries.filter(s => s.roundIndex === roundIndex);
			if (inRound.length) {
				inRound.forEach(s => col.append(this._buildSeriesCard(s)));
			} else {
				col.append(this._buildTbdCard());
			}

			side.append(col);
		});

		return side;
	},

	_buildWorldSeries() {
		const center = document.createElement('div');
		center.className = 'mlb-center';

		const head = document.createElement('div');
		head.className = 'mlb-col-header';
		head.textContent = 'World Series';
		center.append(head);

		const ws = this.series.find(s => s.league === 'MLB');
		if (ws) {
			center.append(this._buildSeriesCard(ws));
		} else {
			center.append(this._buildTbdCard());
		}

		return center;
	},

	_buildTbdCard() {
		const card = document.createElement('div');
		card.className = 'mlb-series mlb-tbd';
		const status = document.createElement('div');
		status.className = 'mlb-series-status';
		status.textContent = 'TBD';
		card.append(status);
		return card;
	},

	_buildSeriesCard(series) {
		const card = document.createElement('div');
		card.className = 'mlb-series';

		series.teams.forEach((team, i) => {
			const row = document.createElement('div');
			row.className = 'mlb-team';
			if (series.completed && i === 0) {
				row.classList.add('winner');
			}
			if (series.completed && i === 1) {
				row.classList.add('eliminated');
			}

			const name = document.createElement('span');
			name.className = 'mlb-team-name';
			name.textContent = team.name;
			row.append(name);

			const wins = document.createElement('span');
			wins.className = 'mlb-team-wins';
			wins.textContent = team.wins;
			row.append(wins);

			card.append(row);
		});

		const statusText = this._seriesStatus(series);
		const [standing, nextGame] = statusText.split(' · ');

		// A finished series says it in the winner's row (bold + blue), so the
		// status line would just repeat it.
		if (standing) {
			const status = document.createElement('div');
			status.className = 'mlb-series-status';
			status.textContent = standing;
			card.append(status);
		}

		if (nextGame) {
			const next = document.createElement('div');
			// Before tip-off the game line IS the status, so it takes the accent color.
			next.className = standing ? 'mlb-series-next' : 'mlb-series-status';
			next.textContent = nextGame;
			card.append(next);
		}

		if (Array.isArray(series.games) && series.games.length) {
			const log = document.createElement('div');
			log.className = 'mlb-game-log';
			series.games.forEach(g => log.append(this._buildGameLine(g)));
			card.append(log);
		}

		return card;
	},

	_buildGameLine(g) {
		const line = document.createElement('div');
		line.className = 'mlb-game-line';

		if (g.state === 'Final') {
			line.textContent = `G${g.number}  ${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}`;
		} else if (g.state === 'Live') {
			line.textContent = `G${g.number}  ${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}  LIVE`;
			line.classList.add('live');
		} else {
			const when = new Date(g.date);
			const day = when.toLocaleDateString([], {month: 'numeric', day: 'numeric'});
			const time = when.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
			line.textContent = `G${g.number}  ${day} ${time}`;
			line.classList.add('upcoming');
		}

		return line;
	},

	_seriesStatus(series) {
		const [a, b] = series.teams;
		if (!a || !b) {
			return '';
		}

		if (series.completed) {
			// The winner is already called out by its blue/bold row.
			return '';
		}

		let standing;
		if (a.wins === 0 && b.wins === 0) {
			// Nothing to report yet — the upcoming game line carries the status.
			standing = '';
		} else if (a.wins === b.wins) {
			standing = `Series tied ${a.wins}-${b.wins}`;
		} else {
			standing = `${a.name} lead ${a.wins}-${b.wins}`;
		}

		if (!series.upcomingGame) {
			return standing;
		}

		const g = series.upcomingGame;
		const game = g.live
			? `Game ${g.number} LIVE`
			: `Game ${g.number} ${this._formatGameDate(g.date)}`;

		// The two parts are joined with a " · " separator that getDom() splits on.
		return standing ? `${standing} · ${game}` : game;
	},

	_formatGameDate(iso) {
		const when = new Date(iso);
		const day = when.toLocaleDateString([], {weekday: 'short'});
		const time = when.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
		return `${day} ${time}`;
	}
});
