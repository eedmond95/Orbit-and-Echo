# Orbit & Echo

A standalone HTML canvas game. Serve this directory with Python:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

The game, Lyra artwork, and utility CSS are included in `index.html`. No build or
package installation is needed to play. Google Fonts load optionally; system fonts
remain available when offline. Nova's external SVG artwork is not included in this
checkout.

## Shared leaderboard

GitHub Pages cannot run API functions or write scores to a database. The game uses
the existing public Netlify API at
`https://resplendent-blancmange-2a8773.netlify.app/api/leaderboard` when opened from
GitHub Pages or a local file. Other hosts first discover their own `/api/leaderboard`
using GET, then try the Netlify API. Score submissions are never automatically
retried against a second host, which avoids duplicate scores after a lost response.

The previously deleted Netlify function, database schema, original migration, and
locked dependencies are restored here. To deploy the backend, connect this repository's
`main` branch to the existing Netlify site, enable its Netlify Database integration,
and deploy with the included `netlify.toml`. Keep the existing database so old scores
remain available. The platform supplies `NETLIFY_DB_URL`; never put a database URL
or token in the HTML, repository, or GitHub Pages settings. For a new database, apply
the included initial migration through Netlify's database migration workflow. Do
not rerun the CREATE TABLE migration on an existing scores table.

The endpoint handles CORS preflight from GitHub Pages and returns the top 50 scores.
Run `npm ci` and `npm test` for the API contract tests. These tests use an isolated
in-memory store; they do not verify a deployed database. If the Netlify site is renamed,
update `LEADERBOARD_API` in `index.html` to its new HTTPS endpoint.

The score cap and input validation reject malformed submissions; they do not provide
server-authoritative anti-cheat protection for this client-side game.

When adding Tailwind utility classes, regenerate the bundled styles with
`python3 tools/build_styles.py`. This optional development step uses Node/npm to
run the pinned Tailwind 3.4.17 compiler. The HTML remains portable as a single file.

Run browser smoke tests with `python3 tests/browser_smoke.py`. Tests require
Python Playwright and Chromium (already installed in the cloud environment).
They start their own temporary local server, test desktop/mobile play with external
resources blocked, and simulate multiple display refresh rates to check frame pacing.
Run `python3 tests/leaderboard_browser.py` for GitHub Pages routing, submission,
ranking, static-host fallback, and failed-response UI checks using a controlled API.
Browser tests do not write scores to the production leaderboard.
