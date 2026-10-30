# Orbit & Echo

A standalone HTML canvas game. Serve this directory with Python:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

The game, Lyra artwork, and utility CSS are included in `index.html`. No build or
package installation is needed to play. Google Fonts load optionally; system fonts
remain available when offline. Nova's external SVG artwork is not included in this
checkout.

## Shared leaderboard: one-time setup

Current API: `https://orbit-and-echo.netlify.app/api/leaderboard`. The GitHub Pages
game is configured to use this site. The steps below document how to recreate or
replace the deployment.

GitHub Pages hosts the game, but it cannot run the shared score service. The backend
in this repository runs on Netlify and uses **Netlify Blobs**, which is configured
by the hosting platform. No database, SQL migration, or manually created API key is
needed for a new deployment. Storage belongs to the Netlify site and survives
subsequent deployments of that same site. Only the top 50 runs are retained.

1. Sign in to [Netlify](https://app.netlify.com/) using your own account.
2. Choose **Add new project → Import an existing project → GitHub** and select
   `eedmond95/Orbit-and-Echo`, branch `main`.
3. Deploy using the included `netlify.toml`. There is no build command; the publish
   directory is `.` and the functions directory is `netlify/functions`. Netlify
   installs the npm dependencies automatically. No environment variables are needed.
4. Open `https://YOUR-SITE.netlify.app/api/leaderboard`. It should return `[]` for
   an empty leaderboard, or a JSON array of ranked scores.
5. Set `LEADERBOARD_API` in `index.html` to that full HTTPS API URL and push the
   change to GitHub. You can instead give the assistant your public Netlify site URL
   and ask it to make this change. Do not share passwords, access tokens, or keys.

Your game link remains `https://eedmond95.github.io/Orbit-and-Echo/`. The GitHub
Pages version sends score requests to the configured Netlify backend. Playing on
Netlify itself automatically uses its own API. Before setup, the GitHub Pages game
shows an unavailable state and does not send scores to an obsolete service.

At game over, the game automatically posts the finished score with the player's
saved callsign. New players receive a generated callsign such as `NeonComet-1842`;
they do not need to enter a name or press Submit. The game-over screen lets them
change their callsign using **SAVE NAME**, which updates that same leaderboard
entry and remembers the choice for future runs. Even zero-point runs are submitted.
If saving fails, the game displays **RETRY** rather than claiming success.

The API handles cross-origin preflight, validates submissions, and ranks scores.
Conditional storage updates prevent concurrent submissions from overwriting each
other. Repeating a run's UUID does not duplicate its entry in the top 50. Callsign changes
update the same entry, and a revived run's higher final score replaces its earlier
score. Delayed lower scores cannot overwrite higher scores. The browser serializes
requests for the same run; a failed save can be retried with its original UUID.

For an existing deployment with a configured `NETLIFY_DB_URL`, the previous database
adapter remains available and keeps using that database. The legacy schema and
migration files are retained for compatibility; new users do not need them.

Run `npm ci` and `npm test` for the API/storage tests. They use isolated storage
fixtures and do not establish that a public Netlify deployment works. The score cap
and input validation do not provide server-authoritative anti-cheat protection.

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
