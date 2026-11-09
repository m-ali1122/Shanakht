"""Lazy wrapper around the fine-tuned pak-name-matcher sentence-transformer
(copied from TaxNet). Falls back to char n-gram cosine if the model or
sentence-transformers is unavailable, so the service never hard-fails."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np

MODEL_DIR = Path(os.getenv("RESOLVER_MODEL_DIR",
                           Path(__file__).resolve().parent / "models" / "pak-name-matcher-v1"))
_lock = Lock()
_model = None
_failed = False


def model():
    global _model, _failed
    if _model is not None or _failed or os.getenv("RESOLVER_DISABLE_EMBED") == "1":
        return _model
    with _lock:
        if _model is None and not _failed:
            try:
                from sentence_transformers import SentenceTransformer
                _model = SentenceTransformer(str(MODEL_DIR), device="cpu")
            except Exception as exc:  # pragma: no cover
                print(f"[resolver] embedding model unavailable: {exc}")
                _failed = True
    return _model


def available() -> bool:
    return model() is not None


@lru_cache(maxsize=50_000)
def _vec(text: str):
    m = model()
    return m.encode([text], normalize_embeddings=True, show_progress_bar=False)[0]


def encode(texts: list[str]) -> np.ndarray | None:
    m = model()
    if m is None:
        return None
    uniq = list(dict.fromkeys(texts))
    vecs = m.encode(uniq, batch_size=128, normalize_embeddings=True,
                    show_progress_bar=False)
    lookup = dict(zip(uniq, vecs))
    return np.array([lookup[t] for t in texts])


def _ngrams(s: str, n: int = 3) -> dict:
    s = f"  {s.lower()} "
    out: dict = {}
    for i in range(len(s) - n + 1):
        g = s[i:i + n]
        out[g] = out.get(g, 0) + 1
    return out


def ngram_cosine(a: str, b: str) -> float:
    ga, gb = _ngrams(a), _ngrams(b)
    num = sum(v * gb.get(k, 0) for k, v in ga.items())
    den = (sum(v * v for v in ga.values()) ** 0.5) * (sum(v * v for v in gb.values()) ** 0.5)
    return float(num / den) if den else 0.0


def similarity(a: str, b: str) -> float:
    """Cosine similarity of two name strings (embedding, else n-gram)."""
    if not a or not b:
        return 0.0
    if model() is None:
        return ngram_cosine(a, b)
    return float(np.clip(np.dot(_vec(a), _vec(b)), 0.0, 1.0))
