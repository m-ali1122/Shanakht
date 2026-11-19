"""Capture the runbook screenshots by driving the real screen with the same
director keys a presenter uses. Uses the installed Chrome at 1440x900, 2x.

Prereqs: web on :3000 with the agent in offline replay mode (DEMO_OFFLINE=1),
and a mock-mode copy on :3001 (only for the tamper frame, which has no offline
recording yet).  Run: .venv/Scripts/python.exe docs/demo/capture_screens.py
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).parent / "screens"
OUT.mkdir(exist_ok=True)
MAIN = "http://localhost:3000/console?case=1"
MOCK = "http://localhost:3001/console?case=1"


def wait_text(page, text, timeout=60):
    page.wait_for_function("t => document.body.innerText.toLowerCase().includes(t.toLowerCase())", arg=text, timeout=timeout * 1000)


def key(page, k, pause=0.6):
    page.keyboard.press(k)
    time.sleep(pause)


def shot(page, name, settle=1.2):
    time.sleep(settle)
    page.mouse.move(1430, 450)  # park the cursor out of the way
    page.screenshot(path=str(OUT / f"{name}.png"))
    print("captured", name, flush=True)


def fresh(page, url):
    page.goto(url, wait_until="networkidle")
    time.sleep(2)
    # hide the Next.js dev-mode badge so it does not appear in the frames
    page.add_style_tag(content="nextjs-portal{display:none!important}")
    page.mouse.click(720, 30)  # focus the page (top bar, no control there)
    key(page, "r", 2.5)


def main(only=None):
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = ctx.new_page()
        want = lambda n: only is None or n in only

        fresh(page, MAIN)
        key(page, "1", 2)
        if want("01-overview"):
            shot(page, "01-overview")
        key(page, " "); wait_text(page, "MATCH"); shot(page, "02-s1-match", 2.5)

        key(page, "3", 2); key(page, " ")
        wait_text(page, "does not belong"); shot(page, "03-s3-nomatch", 2)

        key(page, "2", 2); key(page, " ")
        wait_text(page, "CLOSE"); shot(page, "04-s2-close", 2.5)
        key(page, " ")
        wait_text(page, "evidence items verified", 90); wait_text(page, "Recommended action", 90)
        shot(page, "05-s2-case", 2)
        page.get_by_role("button", name="Approve").click()
        wait_text(page, "Approved"); shot(page, "06-s2-approved", 3)

        key(page, "4", 2); key(page, " ")
        wait_text(page, "CLOSE"); shot(page, "07-s4-urdu", 2.5)

        key(page, "5", 2.5); key(page, " ")
        shot(page, "08-s5-ring", 3)
        key(page, " ")
        wait_text(page, "evidence items verified", 120); wait_text(page, "Recommended action", 120)
        shot(page, "09-s5-case", 2.5)
        page.get_by_role("button", name="What the model saw").click()
        shot(page, "10-s5-model-saw", 2)
        page.get_by_role("button", name="What the model saw").click()
        time.sleep(1)
        page.get_by_role("button", name="Approve").click()
        wait_text(page, "Approved"); shot(page, "12-s5-approved", 3.5)
        page.locator("button.slide-in").last.click()
        page.get_by_label("Block explorer").wait_for(timeout=10000)
        shot(page, "13-s5-explorer", 1.5)
        page.get_by_label("Close explorer").click()
        time.sleep(1)
        key(page, " ")
        wait_text(page, "registry hit", 60); shot(page, "14-s5-registry-hit", 1.2)

        key(page, "6", 2.5)
        for i, name in enumerate(["15-s6-urdu", "16-s6-phone", "17-s6-ringc"]):
            key(page, " ")
            time.sleep(7)
            shot(page, name, 1.5)

        # Tamper frame from the mock-mode copy (no offline recording of the
        # post-tamper re-run yet; mock mode replays the same sequence).
        fresh(page, MOCK)
        key(page, "5", 2.5); key(page, " ", 2); key(page, " ")
        wait_text(page, "evidence items verified", 120); time.sleep(2)
        key(page, "t")
        wait_text(page, "changed after", 60)
        shot(page, "11-s5-tamper", 4)

        key(page, "r", 1)
        browser.close()


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
