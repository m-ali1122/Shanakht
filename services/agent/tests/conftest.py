import os
import sys
import tempfile
from pathlib import Path

# Isolated state dir and an unreachable resolver so tests are hermetic.
os.environ["AGENT_STATE_DIR"] = tempfile.mkdtemp(prefix="shanakht-agent-test-")
os.environ["RESOLVER_URL"] = "http://127.0.0.1:9"
os.environ["PSEUDO_VAULT_KEY"] = "test-vault-key"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
