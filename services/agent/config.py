"""Agent service configuration. Reads the repo-root .env."""
import os
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parent
ROOT_DIR = AGENT_DIR.parents[1]
load_dotenv(ROOT_DIR / ".env")

STATE_DIR = Path(os.getenv("AGENT_STATE_DIR", AGENT_DIR / "state"))
STATE_DIR.mkdir(parents=True, exist_ok=True)

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "shanakht2026")

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")

PSEUDO_VAULT_KEY = os.getenv("PSEUDO_VAULT_KEY", "dev-vault-key")
CONSORTIUM_HMAC_KEY = os.getenv("CONSORTIUM_HMAC_KEY", "dev-consortium-key")

CHAIN_RPC = os.getenv("CHAIN_RPC", "http://localhost:8545")
DEPLOYMENTS_FILE = Path(os.getenv("DEPLOYMENTS_FILE", ROOT_DIR / "chain" / "deployments" / "localhost.json"))
EXPLORER_URL = os.getenv("EXPLORER_URL", "http://localhost:8104")

BANKS_URL = os.getenv("BANKS_URL", "http://localhost:8101")
RESOLVER_URL = os.getenv("RESOLVER_URL", "http://localhost:8102")
SCRIPT_MAP = ROOT_DIR / "data" / "generator" / "script_map.json"

DEMO_OFFLINE = os.getenv("DEMO_OFFLINE", "0") == "1"
DEMO_MODE = os.getenv("DEMO_MODE", "1") == "1"
SEED = int(os.getenv("SEED", "20261111"))

BANK_IDS = {"MRGL": 1, "RAVI": 2, "CHNB": 3, "INDS": 4}
BANDS = {"MATCH": 1, "CLOSE": 2, "NO_MATCH": 3}
ACTIONS = {"auto_pass": 0, "proceed": 1, "hold": 2, "hold_and_publish": 3}
KINDS = {"phone": 1, "device": 2, "cnic": 3}

DEMO_RECORD = os.getenv("DEMO_RECORD", "1") == "1"
STT_PROVIDER = os.getenv("STT_PROVIDER", "faster_whisper")
STT_MODEL = os.getenv("STT_MODEL", "small")
STT_DEVICE = os.getenv("STT_DEVICE", "cpu")
STT_COMPUTE = os.getenv("STT_COMPUTE", "int8")
HOST_BANK = "MRGL"
TODAY = os.getenv("DEMO_TODAY", "2026-11-09")
