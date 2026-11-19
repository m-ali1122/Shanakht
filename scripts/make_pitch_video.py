"""Build the Shanakht product-demo pitch video from the live app.

Pipeline:
  1. record   one Playwright context per scene (1920x1080 video) into docs/video/raw/,
              with time marks for the moments worth keeping (docs/video/raw/marks.json)
  2. voice    edge-tts narration per scene into docs/video/voice/sceneN.mp3,
              or your own recordings via --voice-dir (scene1.wav ... scene8.wav, any ffmpeg-readable format)
  3. cut      each scene's kept clips are joined and fitted to the narration length
              (trimmed, or held on the last frame; never sped up), then concatenated and muxed
              -> docs/video/shanakht_pitch.mp4  (H.264 yuv420p, AAC, 1080p30, faststart)

Usage (from repo root, live stack on :3000):
  .venv\\Scripts\\python.exe scripts\\make_pitch_video.py                     # record + tts + render
  .venv\\Scripts\\python.exe scripts\\make_pitch_video.py --skip-record       # reuse raw footage
  .venv\\Scripts\\python.exe scripts\\make_pitch_video.py --skip-record --voice-dir docs/video/my_voice
  .venv\\Scripts\\python.exe scripts\\make_pitch_video.py --only 6            # re-record one scene
"""
import argparse
import asyncio
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "video"
RAW = OUT / "raw"
VOICE = OUT / "voice"
WORK = OUT / "work"
BASE = "http://localhost:3000"
W, H, FPS = 1920, 1080, 30
TTS_VOICE = "en-US-AndrewNeural"
LEAD, TAIL = 0.35, 0.45
LEAD_FOR = {1: 1.4}   # let the opening scroll breathe before the first line
MAX_SLOW = 1.4        # footage shorter than its line plays up to 1.4x slower  # silence before / after each scene's line

# Narration: keep in sync with docs/video/PITCH_SCRIPT.md
LINES = {
    1: "Remittances to Pakistan fail on names. Spellings drift, initials expand, Urdu becomes Roman. Shanakht is an entity resolution system that tells a spelling difference from the wrong person, before the money moves.",
    2: "A transfer arrives. Shanakht pulls the account title from the bank and resolves it against the typed name. Clean match.",
    3: "Case two. Mohd Ali, son of Rehmat, against Muhammad Ali. A fine-tuned name model aligns every token, even through the Urdu script, and returns a close match with reason codes.",
    4: "Case three. A valid account number, but a different person. No name in common, so Shanakht stops the transfer before it lands, and says why.",
    5: "Case five opens as a ring alert. One sender, five accounts, three banks. An agentic AI investigator queries the knowledge graph, and every claim cites evidence. A pseudonymization gateway means the model only sees tokens. Names and account numbers never leave the bank.",
    6: "Underneath is a shared knowledge graph across four banks, seventy thousand entities. Partner banks contribute only HMAC-keyed fingerprints, never raw customer data. Click any link and it explains why it exists. Pattern detectors surface what a person would miss, like one device behind accounts at different banks.",
    7: "Every decision is anchored on-chain. The evidence is committed as a Merkle root, so editing one fact later breaks verification. Flagged mule accounts go to a consortium registry that every bank can check.",
    8: "Shanakht. Entity resolution for remittances. Know who gets the money before it moves.",
}
SCENES = list(LINES)

CHROME_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
HIDE_CSS = "nextjs-portal{display:none!important} *{cursor:none!important}"


def log(*a):
    print(*a, flush=True)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        log(" ".join(map(str, cmd)))
        log(r.stderr[-3000:])
        raise SystemExit("ffmpeg failed")
    return r


def duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)])
    return float(r.stdout.strip())


def reset_demo():
    log("resetting demo state ...")
    req = urllib.request.Request(BASE + "/agent/demo/reset", method="POST")
    try:
        urllib.request.urlopen(req, timeout=120).read()
    except Exception as e:  # noqa: BLE001
        log("reset failed:", e)
    time.sleep(2)


# --------------------------------------------------------------------------- recording

class Rec:
    """One scene = one browser context = one video. Marks are seconds since the context opened."""

    def __init__(self, browser, n):
        self.n = n
        self.dir = RAW / f"scene{n}"
        shutil.rmtree(self.dir, ignore_errors=True)
        self.ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1,
                                       record_video_dir=str(self.dir), record_video_size={"width": W, "height": H})
        self.t0 = time.monotonic()
        self.page = self.ctx.new_page()
        self.clips = []
        self._open = None

    def now(self):
        return time.monotonic() - self.t0

    def start(self):
        self._open = self.now()

    def stop(self):
        self.clips.append([round(self._open, 2), round(self.now(), 2)])
        self._open = None

    def hold(self, s):
        time.sleep(s)

    def goto(self, url):
        p = self.page
        p.goto(BASE + url, wait_until="networkidle", timeout=90000)
        p.add_style_tag(content=HIDE_CSS)
        p.mouse.move(W - 4, H // 2)

    def text(self, t, timeout=120):
        self.page.wait_for_function("t => document.body.innerText.toLowerCase().includes(t.toLowerCase())", arg=t, timeout=timeout * 1000)

    def key(self, k, pause=0.5):
        self.page.keyboard.press(k)
        time.sleep(pause)

    def close(self):
        if self._open is not None:
            self.stop()
        video = self.page.video
        self.ctx.close()
        src = Path(video.path())
        dst = RAW / f"scene{self.n}.webm"
        shutil.move(str(src), dst)
        shutil.rmtree(self.dir, ignore_errors=True)
        return {"file": dst.name, "clips": self.clips}


def focus(r):
    r.page.mouse.click(W // 2, 12)
    r.page.mouse.move(W - 4, H // 2)


def scene1(r):  # pitch page, scroll the 3D story
    r.goto("/")
    time.sleep(4)
    r.start()
    r.hold(2.5)
    total = r.page.evaluate("document.documentElement.scrollHeight - innerHeight")
    target = min(total, H * 5.2)
    # in-page eased scroll (no per-frame round trips)
    r.page.evaluate("""([y, ms]) => new Promise(res => { const t0 = performance.now();
      const f = t => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
        window.scrollTo(0, y * e); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); })""", [target, 9000])
    r.hold(1.0)
    r.stop()


def console(r, case):
    r.goto(f"/console?view=inbound&case={case}")
    time.sleep(3)
    focus(r)


def scene2(r):  # case 1 clean match
    console(r, 1)
    r.start(); r.hold(1.2)
    r.key(" ")
    r.text("match", 60)
    r.hold(6)
    r.stop()


def scene3(r):  # case 2 close match
    console(r, 2)
    r.start(); r.hold(1.2)
    r.key(" ")
    r.text("close", 60)
    r.hold(12)
    r.stop()


def scene4(r):  # case 3 wrong person
    console(r, 3)
    r.start(); r.hold(1.2)
    r.key(" ")
    r.hold(1.8)
    r.stop()                # cut the wait for the verdict
    r.text("does not belong", 60)
    r.start(); r.hold(8); r.stop()


def approve_ready(r, timeout=180):
    r.page.wait_for_function(
        "() => [...document.querySelectorAll('button')].some(b => b.innerText.trim().startsWith('Approve') && !b.disabled)",
        timeout=timeout * 1000)


def scene5(r):  # case 5 ring -> investigate
    console(r, 5)
    r.start(); r.hold(1.0)
    r.key(" ")              # ring alert
    r.hold(5)
    r.stop()
    r.start()
    r.key(" ")              # open investigation (agent runs, live LLM)
    r.hold(5)               # keep the first trail steps arriving
    r.stop()
    approve_ready(r)
    time.sleep(2.5)         # camera settles
    r.start(); r.hold(5); r.stop()
    try:
        r.page.locator("button[title=\"What the model saw\"]").click(timeout=5000)
        r.start(); r.hold(6); r.stop()
        r.page.locator("button[title=\"What the model saw\"]").click(timeout=5000)
    except Exception as e:  # noqa: BLE001
        log("scene5: model-saw toggle not found:", e)
        r.start(); r.hold(5); r.stop()


def dismiss(r):
    try:
        d = r.page.get_by_role("button", name="Dismiss")
        if d.count():
            d.first.click(timeout=1000)
    except Exception:  # noqa: BLE001
        pass


def scene6(r):  # grand graph
    r.goto("/console?view=graph&case=5")
    r.page.wait_for_selector("canvas", timeout=90000)
    time.sleep(14)          # 2.5k-node layout settles
    dismiss(r)
    r.start(); r.hold(4)
    box = r.page.get_by_label("Find an entity")
    box.click()
    box.type("Usman Ghani", delay=70)
    try:
        r.page.locator("button:has-text('Usman Ghani')").first.wait_for(timeout=8000)
    except Exception:  # noqa: BLE001
        log("scene6: no search hits shown")
    r.hold(1.2)
    r.page.keyboard.press("Enter")
    r.page.mouse.move(W - 4, H // 2)
    r.hold(3.5)
    r.stop()
    try:
        btns = r.page.locator("section:has-text('Connections on screen') button")
        btns.first.wait_for(timeout=8000)
        r.start()
        btns.first.click()
        r.text("why this link exists", 15)
        r.page.mouse.move(W - 4, H // 2)
        r.hold(6)
        r.stop()
    except Exception as e:  # noqa: BLE001
        log("scene6: link inspector failed:", e)
    try:
        r.page.get_by_label("Close inspector").click(timeout=3000)
    except Exception:  # noqa: BLE001
        pass
    r.start()
    r.page.get_by_role("tab", name="Patterns").or_(r.page.get_by_role("button", name="Patterns")).first.click()
    r.hold(1.8)
    r.page.get_by_text("Shared device across banks").first.click()
    r.hold(0.6)
    r.stop()
    r.page.wait_for_function(r"() => /\d+ match(es)?/.test(document.body.innerText)", timeout=60000)
    r.start()
    r.hold(2.5)
    try:
        r.page.locator("li button:has(span.font-mono)").first.click(timeout=4000)
        r.hold(0.8)
        r.page.get_by_label("Close results").click(timeout=3000)
    except Exception as e:  # noqa: BLE001
        log("scene6: pattern match click failed:", e)
    r.page.mouse.move(W - 4, H // 2)
    r.hold(6)
    r.stop()


def scene7(r):  # audit: the chain and evidence integrity (no live tamper; it depends on a slow live approve)
    console(r, 1)
    r.key("g", 0.2); r.key("a", 3.5)
    dismiss(r)
    r.page.mouse.move(W - 4, H // 2)
    r.start(); r.hold(10); r.stop()


def scene8(r):  # close on the pitch hero
    r.goto("/")
    time.sleep(4)
    r.start(); r.hold(7); r.stop()


SCENE_FN = {1: scene1, 2: scene2, 3: scene3, 4: scene4, 5: scene5, 6: scene6, 7: scene7, 8: scene8}


def record(only, headed):
    from playwright.sync_api import sync_playwright
    RAW.mkdir(parents=True, exist_ok=True)
    mpath = RAW / "marks.json"
    marks = json.loads(mpath.read_text()) if mpath.exists() else {}
    reset_demo()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=not headed, args=CHROME_ARGS)
        for n in SCENES:
            if only and n not in only:
                continue
            log(f"recording scene {n} ...")
            r = Rec(browser, n)
            try:
                SCENE_FN[n](r)
            finally:
                marks[str(n)] = r.close()
            log("  clips:", marks[str(n)]["clips"])
            mpath.write_text(json.dumps(marks, indent=1))
        browser.close()
    reset_demo()


# --------------------------------------------------------------------------- voice

async def _tts(text, path):
    import edge_tts
    await edge_tts.Communicate(text, TTS_VOICE, rate="+0%").save(str(path))


def split_voice_note(note, out_dir, n_scenes=len(LINES)):
    """Cut one long recording into scene1..N.wav at its N-1 longest pauses (pause ~1.5 s between scenes)."""
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    det = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(note), "-af", "silencedetect=noise=-35dB:d=0.45",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", det)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", det)]
    total = duration(note)
    gaps = [(e - s0, s0, e) for s0, e in zip(starts, ends) if s0 > 0.3 and e < total - 0.3]
    if len(gaps) < n_scenes - 1:
        raise SystemExit(f"found only {len(gaps)} pauses; leave a clear ~1.5 s pause between scenes")
    cuts = sorted(sorted(gaps, reverse=True)[:n_scenes - 1], key=lambda g: g[1])
    bounds, prev = [], 0.0
    for _, s0, e in cuts:
        bounds.append((prev, s0)); prev = e
    bounds.append((prev, total))
    for i, (a0, b0) in enumerate(bounds, 1):
        run(["ffmpeg", "-y", "-v", "error", "-i", str(note), "-ss", f"{max(0, a0 - 0.08):.3f}", "-to", f"{b0 + 0.12:.3f}",
             "-af", "silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-40dB,areverse",
             "-ar", "48000", str(out_dir / f"scene{i}.wav")])
        log(f"voice note -> scene{i}: {b0 - a0:.2f}s")
    return out_dir


def voices(voice_dir):
    VOICE.mkdir(parents=True, exist_ok=True)
    out = {}
    for n in SCENES:
        if voice_dir:
            cands = sorted(Path(voice_dir).glob(f"scene{n}.*"))
            if not cands:
                raise SystemExit(f"missing scene{n}.* in {voice_dir}")
            out[n] = cands[0]
        else:
            path = VOICE / f"scene{n}.mp3"
            if not path.exists() or path.stat().st_mtime < Path(__file__).stat().st_mtime:
                log(f"tts scene {n}")
                asyncio.run(_tts(LINES[n], path))
            out[n] = path
    return out


# --------------------------------------------------------------------------- render

def render(voice_files, out_path):
    marks = json.loads((RAW / "marks.json").read_text())
    WORK.mkdir(parents=True, exist_ok=True)
    parts, report = [], []
    for n in SCENES:
        m = marks[str(n)]
        src = RAW / m["file"]
        vd = duration(voice_files[n])
        lead = LEAD_FOR.get(n, LEAD)
        need = lead + vd + TAIL
        clips = m["clips"]
        # proportionally trim clips if footage is longer than needed; otherwise hold the last frame
        total = sum(b - a for a, b in clips)
        fil, labels = [], []
        for i, (a, b) in enumerate(clips):
            fil.append(f"[0:v]trim=start={a}:end={b},setpts=PTS-STARTPTS,fps={FPS},scale={W}:{H},setsar=1[c{i}]")
            labels.append(f"[c{i}]")
        fil.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0[cat]")
        k = min(MAX_SLOW, max(1.0, need / total)) if total < need else 1.0  # slow short footage instead of freezing
        total *= k
        pad = max(0.0, need - total)
        fil.append(f"[cat]setpts={k:.4f}*PTS,tpad=stop_mode=clone:stop_duration={pad:.3f},trim=duration={need:.3f},setpts=PTS-STARTPTS,format=yuv420p[v]")
        delay = int(lead * 1000)
        fil.append(f"[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay={delay}|{delay},apad,atrim=duration={need:.3f}[a]")
        part = WORK / f"scene{n}.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-i", str(voice_files[n]),
             "-filter_complex", ";".join(fil), "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS),
             "-c:a", "aac", "-b:a", "160k", "-ar", "48000", str(part)])
        parts.append(part)
        report.append((n, round(need, 2), round(total, 2)))
        log(f"scene {n}: {need:.2f}s (footage {total:.2f}s{', held last frame' if pad > 0.05 else ''})")
    lst = WORK / "list.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c", "copy", "-movflags", "+faststart", str(out_path)])
    log(f"wrote {out_path} ({duration(out_path):.1f}s)")
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-record", action="store_true", help="reuse docs/video/raw footage")
    ap.add_argument("--only", type=int, nargs="*", help="record only these scenes")
    ap.add_argument("--voice-dir", help="folder with your own scene1..scene8 recordings")
    ap.add_argument("--voice-note", help="one long recording of the whole script; split at pauses into scenes")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--out", default=str(OUT / "shanakht_pitch.mp4"))
    a = ap.parse_args()
    if not a.skip_record:
        record(set(a.only or []), a.headed)
    if a.voice_note:
        a.voice_dir = str(split_voice_note(a.voice_note, OUT / "my_voice"))
    render(voices(a.voice_dir), Path(a.out))


if __name__ == "__main__":
    sys.exit(main())
