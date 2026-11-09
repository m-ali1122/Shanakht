"""Shanakht resolver service (port 8102).

Run: .venv/Scripts/python.exe -m uvicorn main:app --port 8102  (from services/resolver)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import compare as cmp
import embed
from er_core.pipeline import resolve_batch
from pk_names import parse

app = FastAPI(title="Shanakht resolver", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


class ParseReq(BaseModel):
    name: str


class CompareReq(BaseModel):
    typed_name: str
    title_raw: str
    urdu_name: str | None = None


class BatchReq(BaseModel):
    records: list[dict]


@app.on_event("startup")
def _warm():
    if os.getenv("RESOLVER_DISABLE_EMBED") != "1":
        embed.similarity("muhammad ali", "mohd ali")  # load model once


@app.get("/health")
def health():
    return {"ok": True, "service": "resolver", "embedding_model": embed.available(),
            "thresholds": {"match": cmp.MATCH_T, "close": cmp.CLOSE_T}}


@app.post("/parse")
def parse_name(req: ParseReq):
    return parse(req.name).to_dict()


@app.post("/compare")
def compare(req: CompareReq):
    return cmp.compare(req.typed_name, req.title_raw, req.urdu_name)


@app.post("/resolve-batch")
def batch(req: BatchReq):
    return resolve_batch(req.records)
