"""Exercise the real game UI at a GitHub Pages origin with a controlled API."""
from pathlib import Path
import json

from playwright.sync_api import sync_playwright

html = (Path(__file__).resolve().parents[1] / 'index.html').read_text()
pages_url = 'https://eedmond95.github.io/Orbit-and-Echo/'
api_url = 'https://resplendent-blancmange-2a8773.netlify.app/api/leaderboard'
entries = [{'id': 1, 'name': 'Existing Pilot', 'score': 1000, 'level': 1}]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])

    def scenario(origin, *, submit_first=False, fail_post=False):
        context = browser.new_context()
        calls = []
        errors = []

        def route_request(route):
            req = route.request
            if req.url == origin:
                return route.fulfill(status=200, content_type='text/html', body=html)
            if req.url == api_url:
                calls.append((req.method, req.url))
                headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
                if req.method == 'POST':
                    if fail_post:
                        return route.abort('failed')
                    payload = req.post_data_json
                    assert payload['name'] == 'Pages Pilot'
                    assert payload['score'] == 4321
                    assert payload['runId']
                    entry = {'id': len(entries) + 1, **payload}
                    entries.append(entry)
                    entries.sort(key=lambda item: -item['score'])
                    return route.fulfill(status=201, headers=headers,
                                         body=json.dumps({'id': entry['id'], 'top': entries}))
                return route.fulfill(status=200, headers=headers, body=json.dumps(entries))
            if req.url.endswith('/api/leaderboard'):
                calls.append((req.method, req.url))
                return route.fulfill(status=404, content_type='text/html', body='<h1>Static host</h1>')
            return route.abort()

        context.route('**/*', route_request)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin, wait_until='networkidle')
        if not submit_first:
            page.locator('#openLeaderboardBtn').click()
            page.locator('#leaderboardList').get_by_text('Existing Pilot', exact=True).wait_for()
            page.locator('#closeLeaderboardBtn').click()
        page.locator('#startPlayBtn').click()
        page.evaluate('score = 4321; lives = 1; triggerGameOver()')
        page.locator('#playerNameInput').fill('Pages Pilot')
        page.locator('#submitScoreBtn').click()
        if fail_post:
            page.wait_for_function("!document.getElementById('submitScoreBtn').disabled")
            assert 'Could not submit' in page.locator('#submitScoreMsg').inner_text()
        else:
            page.wait_for_function("document.getElementById('submitScoreBtn').innerText.includes('SENT')")
            page.locator('#gameOverLeaderboardBtn').click()
            page.locator('#leaderboardList').get_by_text('Pages Pilot (YOU)', exact=True).wait_for()
        posts = [url for method, url in calls if method == 'POST']
        assert posts == [api_url], posts
        if '.github.io/' in origin:
            assert all(url == api_url for _, url in calls), calls
        assert not errors, errors
        context.close()

    scenario(pages_url)
    print('PASS GitHub Pages: shared leaderboard loads, score submits, rank displays via external API')
    # A separate browser context sees the shared entries, not localStorage data.
    scenario(pages_url, submit_first=True)
    print('PASS fresh browser context can submit before opening the leaderboard')
    scenario('https://static.example/Orbit-and-Echo/', submit_first=True)
    print('PASS custom static host: GET discovers API; POST never targets the static host')
    scenario(pages_url, fail_post=True)
    print('PASS lost submission response: one POST only, retry UI restored, no automatic duplicates')
    browser.close()
