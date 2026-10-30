"""Exercise automatic submissions in the real game UI with a controlled API."""
from pathlib import Path
import json
import re
from playwright.sync_api import sync_playwright

html = (Path(__file__).resolve().parents[1] / 'index.html').read_text()
pages_url = 'https://eedmond95.github.io/Orbit-and-Echo/'
api_url = re.search(r"const LEADERBOARD_API = '([^']+)';", html).group(1)
assert api_url == 'https://orbit-and-echo.netlify.app/api/leaderboard'


class Game:
    def __init__(self, browser, origin=pages_url, *, configured=True, hold_first=False, fail_first=False):
        self.origin = origin
        self.configured = configured
        self.hold_first = hold_first
        self.fail_first = fail_first
        self.calls = []
        self.posts = []
        self.held = []
        self.rows = []
        self.errors = []
        self.context = browser.new_context()
        self.context.route('**/*', self.route)
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(origin, wait_until='networkidle')

    def save(self, payload):
        existing = next((row for row in self.rows if row['id'] == payload['runId']), None)
        if existing is None:
            self.rows.append({'id': payload['runId'], **payload})
        elif payload['score'] >= existing['score']:
            existing.update(payload)
        self.rows.sort(key=lambda item: -item['score'])
        return {'id': payload['runId'], 'top': self.rows[:50]}

    def reply(self, route, payload):
        route.fulfill(status=201, headers={'Access-Control-Allow-Origin': '*'},
                      content_type='application/json', body=json.dumps(self.save(payload)))

    def route(self, route):
        req = route.request
        if req.url == self.origin:
            content = html if self.configured else html.replace(f"const LEADERBOARD_API = '{api_url}';", "const LEADERBOARD_API = '';")
            return route.fulfill(status=200, content_type='text/html', body=content)
        if req.url == api_url:
            self.calls.append((req.method, req.url))
            if req.method == 'POST':
                payload = req.post_data_json
                self.posts.append(payload)
                if self.hold_first and len(self.posts) == 1:
                    self.held.append((route, payload))
                    return
                if self.fail_first and len(self.posts) == 1:
                    self.save(payload)  # Server saved it, but the reply was lost.
                    return route.abort('failed')
                return self.reply(route, payload)
            return route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'},
                                 content_type='application/json', body=json.dumps(self.rows[:50]))
        if req.url.endswith('/api/leaderboard'):
            self.calls.append((req.method, req.url))
            return route.fulfill(status=404, content_type='text/html', body='<h1>Static host</h1>')
        return route.abort()

    def start(self, name=None):
        if name is not None:
            self.page.evaluate("name => localStorage.setItem('orbit_echo_name', name)", name)
        self.page.locator('#startPlayBtn').click()

    def end(self, score=4321, level=2):
        return self.page.evaluate("""args => {
            score = args.score; level = args.level; lives = 1; triggerGameOver();
            return scoreSubmission.runId;
        }""", {'score': score, 'level': level})

    def saved(self):
        self.page.wait_for_function("scoreSubmission && scoreSubmission.status === 'saved'")

    def close(self):
        assert not self.errors, self.errors
        self.context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for origin in [pages_url, 'https://orbit-and-echo.netlify.app/', 'https://static.example/Orbit-and-Echo/']:
        game = Game(browser, origin)
        game.start('Pages Pilot')
        run_id = game.end()
        game.saved()
        assert game.posts == [{'name': 'Pages Pilot', 'score': 4321, 'level': 2, 'runId': run_id}]
        game.page.locator('#playerNameInput').wait_for(state='visible')
        assert game.page.locator('#playerNameInput').input_value() == 'Pages Pilot'
        # Repeated clicks and repeated game-over signals must not create another post.
        game.page.evaluate('() => { triggerGameOver(); submitScore(); submitScore(); }')
        game.page.evaluate('scoreSubmission.queue')
        assert len(game.posts) == 1
        game.page.locator('#gameOverLeaderboardBtn').click()
        game.page.locator('#leaderboardList').get_by_text('Pages Pilot (YOU)', exact=True).wait_for()
        assert all(url == api_url for method, url in game.calls if method == 'POST')
        if '.github.io/' in origin:
            assert all(url == api_url for _, url in game.calls)
        game.close()
    print('PASS GitHub Pages, Netlify, and static hosts: automatic submission, saved names, ranking, no duplicate posts')

    game = Game(browser)
    game.start()
    run_id = game.end(0)
    game.saved()
    generated = game.posts[0]['name']
    assert re.fullmatch(r'[A-Za-z]+-\d{4}', generated), generated
    assert len(generated) <= 20
    assert game.page.evaluate("localStorage.getItem('orbit_echo_name')") == generated
    assert game.posts[0]['score'] == 0
    game.page.locator('#playerNameInput').fill('Chosen Pilot')
    game.page.locator('#submitScoreBtn').click()
    game.page.wait_for_function("scoreSubmission.status === 'saved' && scoreSubmission.savedName === 'Chosen Pilot'")
    assert len(game.rows) == 1 and game.rows[0]['id'] == run_id
    assert game.rows[0]['name'] == 'Chosen Pilot'
    game.page.locator('#restartBtn').click()
    game.end(99)
    game.saved()
    assert game.posts[-1]['name'] == 'Chosen Pilot'
    assert game.posts[-1]['runId'] != run_id
    game.close()
    print('PASS zero-point runs, generated fallback names, editing the same entry, and remembered names on the next run')

    game = Game(browser, hold_first=True)
    game.start()
    with game.page.expect_request(lambda req: req.url == api_url and req.method == 'POST'):
        game.end()
    game.page.locator('#playerNameInput').fill('Late Callsign')
    game.page.locator('#submitScoreBtn').click()
    game.page.evaluate('() => { submitScore(); submitScore(); }')
    assert len(game.posts) == 1, game.posts
    route, payload = game.held.pop()
    game.reply(route, payload)
    game.page.wait_for_function("scoreSubmission.status === 'saved' && scoreSubmission.savedName === 'Late Callsign'")
    assert len(game.posts) == 2 and len(game.rows) == 1
    assert game.rows[0]['name'] == 'Late Callsign'
    game.close()
    print('PASS name changes while auto-save is pending are serialized and deduplicated')

    game = Game(browser, hold_first=True)
    game.start('Fast Pilot')
    with game.page.expect_request(lambda req: req.url == api_url and req.method == 'POST'):
        old_id = game.end(4321, 4)
    game.page.evaluate('window.finishedRecord = scoreSubmission; startGame(); invulnTimer = 10000;')
    new_id = game.page.evaluate('runId')
    route, payload = game.held.pop()
    game.reply(route, payload)
    game.page.wait_for_function("finishedRecord.status === 'saved'")
    game.page.wait_for_timeout(650)  # Exercise the old game-over display timeout.
    assert payload['runId'] == old_id and payload['score'] == 4321 and payload['level'] == 4
    assert new_id != old_id
    assert game.page.evaluate('gameState') == 'PLAYING'
    assert game.page.evaluate('scoreSubmission') is None
    assert game.page.locator('#gameOverMenu').is_hidden()
    game.close()
    print('PASS quick restart preserves the finished-run payload and ignores stale UI responses/timers')

    game = Game(browser)
    game.start('Revived Pilot')
    old_id = game.end(100)
    game.saved()
    game.page.evaluate('reviveRun()')
    assert game.end(500, 3) == old_id
    game.saved()
    assert len(game.posts) == 2 and len(game.rows) == 1
    assert game.rows[0]['score'] == 500
    game.close()
    print('PASS revived runs update the original leaderboard entry with the final score')

    game = Game(browser, fail_first=True)
    game.start('Retry Pilot')
    game.end()
    game.page.wait_for_function("scoreSubmission.status === 'failed'")
    game.page.locator('#submitScoreBtn').click()
    game.saved()
    assert len(game.posts) == 2 and len(game.rows) == 1
    assert game.posts[0]['runId'] == game.posts[1]['runId']
    game.close()
    print('PASS a lost save response can be retried without creating another leaderboard row')

    game = Game(browser, configured=False)
    game.page.locator('#openLeaderboardBtn').click()
    game.page.locator('#leaderboardList').get_by_text('ONLINE LEADERBOARD NOT AVAILABLE YET', exact=True).wait_for()
    assert not game.posts
    game.close()
    browser.close()
    print('PASS unconfigured hosting does not falsely report a successful save')
