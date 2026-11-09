# Shared contracts (all workers MUST follow)

## Runtime
- Python: shared venv at repo root `.venv` (Python 3.13, --system-site-packages; torch, faster-whisper preinstalled). Run with `.venv/Scripts/python.exe`. Services run natively in dev; Dockerfiles optional.
- Docker only for neo4j:5 (bolt 7687, http 7474, auth neo4j/shanakht2026, APOC). Hardhat node on 8545 runs natively via npm.
- Ports: banks 8101, resolver 8102, agent 8103, chain explorer 8104, web 3000.
- The web UI talks ONLY to the agent service (8103), which proxies banks/resolver/explorer. CORS open for localhost:3000.
- LLM: OpenAI-compatible; default LLM_BASE_URL=https://api.groq.com/openai/v1, LLM_MODEL=llama-3.3-70b-versatile.

## IDs and codes
- Banks: MRGL=1, RAVI=2, CHNB=3, INDS=4. Exchange houses: GULF (Gulf Bridge Exchange, AE), THMS (Thames Remit, UK), NAJD (Najd Transfer, SA), HUDS (Hudson Remit, US).
- On-chain enums: band MATCH=1 CLOSE=2 NO_MATCH=3; action auto_pass=0 proceed=1 hold=2 hold_and_publish=3; kind phone=1 device=2 cnic=3.
- Fingerprint = HMAC-SHA256(CONSORTIUM_HMAC_KEY, normalized) hex (64 chars; bytes32 on chain = 0x+hex; UI shows first 16). Normalize: phone digits only; cnic digits only; device lowercase uuid.
- Chain deploy writes `chain/deployments/localhost.json` {GraphRootLog, DecisionLog, MuleRegistry: address, abi}. Deployer (hardhat acct 0) = operator; hardhat accts 1-4 = banks 1-4.

## Scripted scenario fixtures (generator MUST create exactly these; demo/scenarios.json references them)
- S1: remitter RM-S1 "Kamran Butt" via THMS; typed "Ayesha Siddiqui"; IBAN PK36MRGL0000000000010001; title "AYESHA SIDDIQUI"; record R-MRGL-S1.
- S2: remitter RM-S2 "Rehmat Ali" via GULF; typed "Mohd Ali s/o Rehmat"; IBAN PK36RAVI0000000000020001; title "MUHAMMAD ALI"; 7 prior transfers RM-S2 -> this IBAN over 5 months.
- S3: remitter RM-S3 via NAJD; typed "Zainab Bibi"; intended IBAN PK36MRGL0000000000030012 (Zainab Bibi, R-MRGL-S3-Z); typed IBAN PK36MRGL0000000000030021 (transposed) whose title is "TARIQ MEHMOOD" (R-MRGL-S3-T).
- S4: remitter RM-S4 via HUDS; typed "Imraan Akram"; IBAN PK36CHNB0000000000040001; title "RAJA IMRAN AKRAM"; KYC urdu_name "راجہ عمران اکرم" (served by banks service GET /banks/CHNB/kyc-name?iban=, never in title-fetch).
- S5: remitter RM-S5 "Faisal Nawaz" (AE) via GULF -> five beneficiaries, transfers within 48h, all share phone 0300-5550505:
  - PK36MRGL0000000000050001 "Usman Ghani" (R-MRGL-S5-1)
  - PK36MRGL0000000000050002 "M. Usman" (R-MRGL-S5-2)
  - PK36RAVI0000000000050003 "Bilal Ahmed"
  - PK36RAVI0000000000050004 "Bilal Ahmad"
  - PK36INDS0000000000050005 "Hamza Khan"
  - Bilal Ahmed and Hamza Khan share device 5e5e5e5e-0000-4000-8000-000000000005.
  - Later incoming (registry-hit moment): PK36INDS0000000000050006 "Hamza Kh." same device.
- Rings B/C: remitters RM-RB (4 beneficiaries, 2 banks), RM-RC (6 beneficiaries, 3 banks), unscripted names.
- Seed 20261111.

## Service APIs
- resolver 8102: POST /parse {name} -> ParsedName; POST /compare {typed_name, title_raw, urdu_name?} -> {band, score, reasons[], alignment[]}; POST /resolve-batch {records[]} -> {clusters}.
- banks 8101: GET /banks/{code}/title-fetch?iban= ; GET /banks/{code}/kyc-name?iban= -> {urdu_name}; POST /banks/{code}/incoming ; GET /banks/{code}/status.
- agent 8103: SSE events are `data: {"step","status","data","ms"}` lines; final event step="final". Endpoints per spec P6b/P6c/P7/P8/P9 plus GET /graph/scenario/{sid} (cytoscape elements), GET /ledger/blocks.
