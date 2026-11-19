# Shanakht (شناخت)

Identity resolution for Pakistani remittances: a pre-send payee name check, a cross-bank identity graph, an investigating case agent, Urdu and English voice queries, and an on-chain ledger for audit plus a consortium mule registry.

**This is a demo mock-up.** Everything runs on synthetic data and simulated, fictional banks (Margalla, Ravi Commercial, Chenab, Indus Microfinance). No real customer data, bank APIs or bank branding.

- Full build spec: [`docs/SPEC.md`](docs/SPEC.md)
- Shared ports, IDs and scenario fixtures: [`docs/CONTRACTS.md`](docs/CONTRACTS.md)

## Architecture

| Component | Path | Port | What it does |
|---|---|---|---|
| Web UI | `apps/web` | 3000 | Single screen (Next.js, Cytoscape). Talks only to the agent service. |
| Agent service | `services/agent` | 8103 | Payee check, case agent (text-to-Cypher with self-repair), voice, privacy gateway, evidence integrity, graph API, ledger proxy, demo reset/offline replay. |
| Resolver | `services/resolver` | 8102 | Pakistani name parser and entity-resolution core (ported from TaxNet), reason codes. |
| Banks | `services/banks` | 8101 | Four simulated banks: title fetch (per-bank format quirks), KYC Urdu name, incoming transfers with registry check. |
| Chain | `chain` | 8545 | Hardhat node: `GraphRootLog`, `DecisionLog`, `MuleRegistry`. |
| Explorer | `chain/scripts/explorer.ts` | 8104 | Recent on-chain events for the ledger strip. |
| Graph | Docker `neo4j:5` | 7687 | Host-bank graph plus opaque partner fingerprints. |

Privacy model: the host bank (MRGL) holds full records for its own customers; partner banks contribute only signed, HMAC-keyed fingerprints. Every model call goes through a pseudonymization gateway, so the model only ever sees tokens (PERSON_n, ACCT_n, ...). Only Merkle roots and keyed hashes go on-chain.

## Prerequisites

- Docker Desktop (for Neo4j)
- Node.js 22+ and npm
- Python 3.11+ (developed on 3.13)
- An OpenAI-compatible LLM endpoint (default: Groq `openai/gpt-oss-120b`)

## Setup (once)

```powershell
# Python environment
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install fastapi "uvicorn[standard]" neo4j sentence-transformers scikit-learn scipy metaphone pyphonetics unidecode web3 cryptography httpx sse-starlette openai jsonschema python-dotenv pytest python-multipart faster-whisper

# Fine-tuned name-embedding model (not in git: 466 MB). Copy it from the TaxNet project:
#   <TaxNet>/backend/models/pak-name-matcher-v1  ->  services/resolver/models/pak-name-matcher-v1

# Node dependencies
cd chain; npm install; cd ..
cd apps/web; npm install; cd ..

# Configuration
Copy-Item .env.example .env   # then set LLM_API_KEY (and keys/passwords as needed)
```

## Run

Windows (`scripts/dev.ps1`) and Make expose the same targets:

```powershell
.\scripts\dev.ps1 up      # Neo4j (Docker) + Hardhat node
.\scripts\dev.ps1 seed    # generate synthetic data, load Neo4j, deploy contracts, commit first graph root
.\scripts\dev.ps1 dev     # banks, resolver, agent, explorer, web
```

Open http://localhost:3000.

| Command | Purpose |
|---|---|
| `.\scripts\dev.ps1 reset` | Reset decisions, tampered facts, chain state and registry to seed (same as pressing R) |
| `.\scripts\dev.ps1 test` | Run the test suites |
| `.venv\Scripts\python.exe scripts\record_cache.py` | Re-record the offline demo cache from a live run |

### Offline demo mode

Set `DEMO_OFFLINE=1` for the agent service to replay every scenario from `demo/cache/` with the recorded step timings, without Neo4j, the chain or the LLM. Use this for recording the video.

## Demo controls

| Key | Action |
|---|---|
| `1` to `6` | Jump to scenario |
| `Space` | Run the next step in the current scenario |
| `V` / `Shift+V` | Start or stop the mic / play the pre-recorded clip |
| `T` | Tamper with one evidence node in Neo4j, then re-verify |
| `R` | Reset all state to seed |
| `O` | Toggle the offline indicator |

Scenarios: S1 clean match, S2 close match (patronymic and initial), S3 valid account number but wrong person, S4 Urdu name as the anchor between two spellings, S5 cross-bank mule ring (case agent, integrity check, registry hit), S6 voice queries.

## What is synthetic

- All people, names, CNICs (leading 9), IBANs, phones and devices are generated with seed `20261111`; every record carries `synthetic: true`.
- Banks and exchange houses are fictional.
- The title-fetch adapter mirrors the shape of an open-banking title-fetch API so it can be pointed at a real one without changing the engine.
- `demo/audio/` clips are synthetic text-to-speech placeholders unless replaced with a real recording.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest services/agent/tests services/resolver/tests services/banks/tests data/neo4j/tests data/generator/tests -q
cd chain; npx hardhat test
```
