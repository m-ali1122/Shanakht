"""Synthesize placeholder S6 voice clips with edge-tts (needs internet) and convert to 16 kHz mono wav with PyAV.
Usage: .venv/Scripts/python.exe scripts/make_audio.py"""
import asyncio
import json
import sys
from pathlib import Path

import av
import edge_tts

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo" / "audio"
VOICES = {"ur": "ur-PK-AsadNeural", "en": "en-GB-RyanNeural"}


def to_wav16k(src: Path, dst: Path):
    inp, out = av.open(str(src)), av.open(str(dst), "w", format="wav")
    st = out.add_stream("pcm_s16le", rate=16000, layout="mono")
    rs = av.AudioResampler(format="s16", layout="mono", rate=16000)
    for fr in inp.decode(audio=0):
        for f in rs.resample(fr):
            for p in st.encode(f):
                out.mux(p)
    for p in st.encode(None):
        out.mux(p)
    out.close(); inp.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sc = json.loads((ROOT / "demo" / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
    for s in sc:
        for q in s.get("voice_queries", []):
            stem = Path(q["audio"]).stem                  # v1-ur, v2-en, v3-en
            mp3 = OUT / f"{stem}.mp3"
            await edge_tts.Communicate(q["text"], VOICES[q["language"]]).save(str(mp3))
            to_wav16k(mp3, OUT / f"{stem}.wav")
            print(stem, "ok", (OUT / f"{stem}.wav").stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
