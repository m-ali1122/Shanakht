"""Shanakht agent service (port 8103). The web UI talks only to this service."""
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

import config  # noqa: E402
from gateway.routes import router as gateway_router  # noqa: E402
from integrity.routes import router as integrity_router  # noqa: E402

import case_agent, demo_reset, graph_routes, payee, voice  # noqa: E402


@asynccontextmanager
async def lifespan(_app):
    demo_reset.start_snapshot_thread()
    yield


app = FastAPI(title="Shanakht agent", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(gateway_router)
app.include_router(integrity_router)
for _r in (payee.router, case_agent.router, voice.router, graph_routes.router, demo_reset.router):
    app.include_router(_r)


@app.get("/health")
def health():
    from chain_client import get_chain
    return {"ok": True, "service": "agent", "demo_offline": config.DEMO_OFFLINE,
            "chain": get_chain().available(), "llm": {"provider": config.LLM_PROVIDER, "model": config.LLM_MODEL}}
