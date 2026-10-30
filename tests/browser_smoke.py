"""Functional and frame-pacing checks against the actual single-file game."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import os

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_port}/"

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            args=["--no-sandbox"],
        )
        for label, viewport, dpr in [
            ("desktop", {"width": 1280, "height": 800}, 2),
            ("mobile", {"width": 390, "height": 844}, 3),
        ]:
            context = browser.new_context(viewport=viewport, device_scale_factor=dpr,
                                          is_mobile=label == "mobile", has_touch=label == "mobile")
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            # Styling and play must work with no external CDN or font access.
            page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
            assert page.goto(url, wait_until="networkidle").status == 200
            assert page.title().startswith("Orbit & Echo")
            assert page.locator('script[src*="tailwind"]').count() == 0
            assert page.locator("#shopModal").is_hidden()
            assert page.locator("#startPlayBtn").is_visible()
            for menu in ("Tutorial", "Shop", "Missions"):
                page.locator(f"#open{menu}Btn").click()
                assert page.locator(f"#{menu.lower()}Modal").is_visible()
                page.locator(f"#close{menu}Btn").click()
                assert page.locator(f"#{menu.lower()}Modal").is_hidden()
            page.locator("#startPlayBtn").click()
            assert page.evaluate("gameState") == "PLAYING"
            page.wait_for_function("score > 1")
            assert page.evaluate("Number.isFinite(player.x) && Number.isFinite(player.y)")
            run_id = page.evaluate("runId")
            page.keyboard.down("Space")
            assert page.evaluate("isHolding")
            page.keyboard.up("Space")
            assert not page.evaluate("isHolding")
            assert page.evaluate("runId") == run_id, "Space must not activate the focused Play button again"
            if label == "mobile":
                touch = context.new_cdp_session(page)
                touch.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 195, "y": 400}]})
                assert page.evaluate("isHolding")
                touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                assert not page.evaluate("isHolding")
            page.evaluate("triggerGameOver()")
            page.wait_for_function("gameState === 'GAMEOVER'")
            page.locator("#restartBtn").click()
            assert page.evaluate("gameState") == "PLAYING"
            page.reload(wait_until="networkidle")
            assert page.evaluate("bestScore") > 0
            pixel_count = page.evaluate("canvas.width * canvas.height")
            assert pixel_count < 2404000, pixel_count
            assert page.evaluate("pilotArt.lyra.portrait === loadGameImage(window.LYRA_ICON_ART)")
            assert page.evaluate("pilotArt.lyra.cutin === loadGameImage(window.LYRA_EMBEDDED_ART)")
            assert not errors, errors
            print(f"PASS {label}: offline styles, menus, controls, play, restart, persistence, canvas budget")
            page.screenshot(path=f"/tmp/orbit-{label}.png")
            context.close()

        # Drive the real loop with synthetic RAF timestamps, independent of host speed.
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(url) else route.abort())
        page.add_init_script("window.requestAnimationFrame = () => 1;")
        page.goto(url, wait_until="networkidle")
        counts = page.evaluate("""() => {
            const counts = {};
            for (const hz of [60, 90, 120, 144, 165]) {
                gameState = 'MENU'; frameCount = 0; lastTime = 0;
                for (let i = 1; i <= hz * 2; i++) gameLoop(i * 1000 / hz);
                counts[hz] = frameCount;
            }
            return counts;
        }""")
        assert all(118 <= count <= 121 for count in counts.values()), counts
        print("PASS frame pacing (two simulated seconds):", counts)
        page.evaluate("""() => {
            isHolding = true; mgKeys.Space = true;
            document.dispatchEvent(new Event('visibilitychange'));
        }""")
        assert page.evaluate("!isHolding && !mgKeys.Space")
        before = page.evaluate("frameCount")
        page.evaluate("gameLoop(lastTime + 10000)")
        assert page.evaluate("frameCount") == before + 1, "Stall must not replay a physics backlog"
        print("PASS focus reset and bounded recovery after a long stall")
        page.wait_for_function("LYRA_SKILL_ART.every(image => image.complete && image.naturalWidth > 0)")
        page.evaluate("""() => {
            startGame(); mp = MP_MAX; activateHyperNova();
            if (!cutin) throw new Error('Nova cinematic did not start');
            for (let i = 0; i < 8; i++) gameLoop(lastTime + FRAME_MS + 0.01);
        }""")
        for kind in ("strike", "breaker", "invaders"):
            page.evaluate("""kind => {
                startGame();
                const gate = gates[0]; gate.game = MINIGAMES.find(game => game.id === kind);
                startMinigame(gate); mg.t = MG_INTRO_FRAMES;
                for (let i = 0; i < 8; i++) gameLoop(lastTime + FRAME_MS + 0.01);
                if (!mg || mg.phase !== 'play') throw new Error('Minigame did not advance');
            }""", kind)
        assert not errors, errors
        print("PASS decoded Lyra cinematic and all three minigames without JavaScript errors")
        browser.close()
finally:
    server.shutdown()
    server.server_close()
