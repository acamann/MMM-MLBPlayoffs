# MMM-MLB

A [MagicMirror²](https://magicmirror.builders/) module that displays the **current
MLB postseason bracket with live series standings** — e.g. "Brewers lead 2-0",
"Series tied 1-1", "Dodgers win series 4-2" — plus a per-game log and the next
game time for every series.

The bracket renders as a two-sided tree (AL left, NL right, World Series in the
center) with round columns sized so the rounds line up across the bracket.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/acamann/MMM-MLBPlayoffs.git MMM-MLB
```

No dependencies to install — the module uses Node's built-in `fetch` (Node 18+).

## Configuration

Add to `config/config.js`:

```js
{
  module: 'MMM-MLB',
  position: 'fullscreen_below',
  config: {
    season: 2026,                       // MLB season year
    updateInterval: 60 * 60 * 1000,     // refresh hourly
    liveInterval: 15 * 60 * 1000,       // every 15 min while a game is in progress
    view: 'bracket',                    // only 'bracket' works for now
    animationSpeed: 0
  }
}
```

### Options

| Option | Description | Default |
| --- | --- | --- |
| `season` | MLB season year to display. | current year |
| `updateInterval` | Milliseconds between refreshes when no game is live. | `3600000` (1 hour) |
| `liveInterval` | Milliseconds between refreshes while any game is in progress. | `900000` (15 min) |
| `view` | Reserved for a future `standings` / `scores` view. | `'bracket'` |
| `animationSpeed` | DOM update animation in ms. `0` = instant. | `0` |

### Refresh behavior

The node helper polls the official MLB Stats API (no API key required) and
self-reschedules after each fetch: `liveInterval` while any game is live,
otherwise `updateInterval`. There is no polling during long off-hours beyond the
idle interval.

## Visual states

| State | Appearance |
| --- | --- |
| Series in progress, between games | Blue border |
| A game live right now | Red border |
| Series decided | No status line — the winner's row is bold and blue, loser dimmed |
| Series not started | The upcoming `Game N` line takes the blue accent |
| Undetermined matchup | Dashed card with `TBD` |

Unscheduled games carry a placeholder `07:33 UTC` timestamp from MLB's API;
that is rendered as `TBD` rather than a fake time.

## How it works

- Data comes from `https://statsapi.mlb.com/api/v1/schedule` filtered to
  postseason game types (`F,D,L,W`).
- The helper flattens the game list into one entry per series (same team pair +
  same game type), counts each team's wins from `Final` games, and derives
  `isInProgress` / `isGameLive` per series.
- The front-end talks to the helper only via socket notifications:
  `INIT` → `MLB_DATA` / `MLB_ERROR`.
- Dates and times are formatted by hand rather than via `toLocaleDateString`,
  so the display is `MM/DD` with 12-hour time regardless of the device's
  regional locale settings.

## License

MIT