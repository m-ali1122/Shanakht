# Shanakht (شناخت): build spec, prompts and pitch

> See also docs/CONTRACTS.md — it pins ports, IDs, fixtures and API shapes and overrides anything ambiguous here.

Identity resolution for Pakistani remittances: a pre-send payee check, a cross-bank identity graph, an investigating agent, Urdu and English voice queries, and a ledger for audit and a consortium mule registry.

This is a **demo mock-up**. Everything runs on synthetic data and simulated banks. It is one screen, built to be recorded and presented. Nothing here touches real customer data, real bank APIs or real bank branding.

---

## 1. What the demo must prove

| Claim | Moment on screen |
|---|---|
| Account numbers do not solve the name problem | S3: a valid account number with one wrong digit would have paid a stranger; the name check stops it |
| Our engine understands Pakistani names | S2 and S4: "Mohd Ali s/o Rehmat" vs "MUHAMMAD ALI"; "Imraan Akram" vs "RAJA IMRAN AKRAM", resolved through the Urdu name on the KYC record "راجہ عمران اکرم" |
| The graph sees what strings cannot | S5: one remitter, five beneficiaries across three banks, one shared phone |
| Banks can cooperate without sharing customer data | S5 end: fingerprints published; a different bank gets an instant registry hit |
| The evidence an agent used can be proven unedited | S5: "9 of 9 evidence items verified"; press T to tamper with one node; it turns red and drops out of the agent's context |
| Customer data never reaches the model | Any scenario: the "What the model saw" toggle shows the tokenized payload; the top bar reads "Identifiers sent to model: 0" |
| Humans stay in control, and decisions are auditable | Every agent action waits for Approve; every approval lands on the ledger strip with a hash |

Voice (S6) runs throughout as the analyst's way of asking the graph questions.

---

## 2. Architecture

```
                 ┌──────────────────────── apps/web (Next.js, one screen) ────────────────────────┐
                 │ Transfer panel │ Identity graph (Cytoscape) │ Case agent panel │ Ledger strip   │
                 │ Mic (voice)    │ Scenario stepper           │ Approve / Reject │ Registry hits  │
                 └───────┬────────────────┬──────────────────────────┬──────────────────┬──────────┘
                         │ REST/SSE       │                          │                  │
        ┌────────────────▼──┐   ┌─────────▼─────────┐   ┌────────────▼─────────┐  ┌─────▼──────────┐
        │ services/banks    │   │ services/resolver │   │ services/agent       │  │ chain/         │
        │ 4 simulated banks │   │ name parser +     │   │ payee-check agent    │  │ Hardhat node   │
        │ title-fetch APIs  │   │ TaxNet ER core    │   │ case agent           │  │ DecisionLog    │
        │ different formats │   │ reason codes      │   │ text-to-Cypher +     │  │ MuleRegistry   │
        │ per bank          │   │                   │   │ self-repair          │  │                │
        └─────────┬─────────┘   └─────────┬─────────┘   │ voice: STT + intent  │  └─────▲──────────┘
                  │                       │             │ privacy gateway ──► model adapter (cloud | onshore | self-hosted)
                  │                       │             └──────────┬───────────┘        │
                  └───────────────────────┴────────► Neo4j ◄───────┘    anchor/publish ─┘
                                            (host bank graph + opaque
                                             consortium fingerprint nodes)
```

Key design decisions:

- **Each simulated bank keeps its own data.** The host bank's graph has full detail for its own customers. Records from other banks appear only as **opaque fingerprint nodes** (keyed hashes of phone, device and CNIC).
- **Reason codes are deterministic.** The resolver emits reason codes from features (TITLE_DROPPED, PATRONYMIC_DROPPED, VARIANT_SPELLING, SCRIPT_CONVERTED, TOKEN_ORDER, INITIAL_EXPANDED). The LLM may phrase them in Urdu or English but never invents them.
- **Fingerprints are keyed, not plain hashes.** HMAC-SHA256 with a consortium key held by the registry operator; the demo simulates that key in an env var.
- **The agent only reasons over verified context.** The graph is snapshotted in epochs: every node and edge is hashed into a Merkle tree, and only the root is committed on-chain. Partner banks sign each fingerprint batch; unsigned writes are rejected at ingest. Before any graph fact enters the LLM's context, its Merkle proof is checked against the latest committed root; facts that fail are excluded and flagged. Decisions anchor the graph root and evidence hashes.
  - **What this proves:** integrity, provenance and history.
  - **What it doesn't:** backups prevent loss; encryption and access control protect confidentiality; nothing on-chain proves a fact is true.
- **Customer data never reaches the LLM.**
  - **Pseudonymization gateway.** Every model call passes through it. Names, CNICs, IBANs, phones and fingerprints become stable tokens (PERSON_n, ACCT_n, PHONE_n, FP_n). The mapping vault stays inside the bank, and outputs are re-identified locally. A final pattern check blocks any call that still contains a raw identifier.
  - **Planner and executor split.** The model sees only the schema, tokens and abstract case features (counts, shapes, time gaps). It decides what to query; local code runs the queries; row values never go to the model.
  - **Placeholders in questions.** Voice and typed questions are tokenized before the model sees them. Cypher uses parameters ($PERSON_1) that the bank fills in locally.
  - **Plug-and-play provider.** One setting switches between a cloud model, an onshore deployment and a self-hosted open-weights model behind the same interface.
  - **Egress log.** The hash of every outbound payload goes into the decision record and is anchored with the graph root.
- **Offline-safe demo mode.** `DEMO_OFFLINE=1` serves cached LLM, STT and chain responses for the six scenarios.

Stack:

- Web: Next.js (App Router), TypeScript, Tailwind, Cytoscape.js with the fcose layout, Framer Motion (sparingly).
- Resolver: Python, FastAPI. The ER core is ported from TaxNet: phonetic blocking, fine-tuned sentence-transformer, IDF-weighted Jaccard, logistic-regression fusion, clique-cover clustering.
- Agent: Python, FastAPI with server-sent events; the LLM provider sits behind one adapter (any OpenAI-compatible endpoint), and every call goes through the pseudonymization gateway.
- Speech-to-text: local faster-whisper large-v3 by default, Urdu and English; Whisper API only as explicit fallback. Browser Web Speech API is the fallback; pre-recorded clips are the last resort.
- Text-to-speech (optional): browser speechSynthesis for English answers; Urdu answers shown as Nastaliq text.
- Graph: Neo4j 5 (Docker).
- Ledger: Hardhat local node, Solidity contracts `GraphRootLog`, `DecisionLog` and `MuleRegistry`, ethers v6. Merkle trees built off-chain in Python (sorted-pair SHA-256, OpenZeppelin-compatible). A built-in mini explorer drawer shows blocks.
- Orchestration: docker-compose for neo4j, chain, banks, resolver and agent.

---

## 3. Repo layout

```
shanakht/
  apps/web/                    Next.js single screen
    app/page.tsx
    components/                TransferPanel, GraphCanvas, CasePanel, LedgerStrip, MicButton, ScenarioStepper, BankChips
    lib/api.ts, lib/sse.ts, lib/tokens.ts
    styles/tokens.css
  services/banks/              FastAPI; 4 simulated banks on one server
  services/resolver/           FastAPI; name parser + ER core (TaxNet port)
  services/agent/              FastAPI; payee-check, case agent, text-to-Cypher, voice
  chain/                       Hardhat; contracts, deploy, scripts
  data/
    generator/                 synthetic data generator (Python)
    out/                       generated JSON/CSV
    neo4j/                     import Cypher
  demo/
    scenarios.json             six scripted scenarios
    audio/                     pre-recorded voice clips (Urdu and English)
    cache/                     cached responses for DEMO_OFFLINE
  docker-compose.yml
  .env.example
  README.md
```

TaxNet source (for porting): `D:\4th Sem\Projects\hackathon_cust\backend` (er/, asr/, graph/, llm/, models/pak-name-matcher-v1).

---

## 4. Synthetic data specification

### 4.1 Banks (fictional; no real bank names or branding)

| Code | Display name | Role | Title format quirk |
|---|---|---|---|
| MRGL | Margalla Bank | Host bank (the one running Shanakht) | UPPERCASE, no titles, max 35 chars |
| RAVI | Ravi Commercial Bank | Partner | UPPERCASE, A to Z only (punctuation and hyphens stripped) |
| CHNB | Chenab Bank | Partner | UPPERCASE; English spelling was chosen by the customer at account opening from an older Urdu-only CNIC, so it often differs from how relatives abroad spell it |
| INDS | Indus Microfinance | Partner (wallet-heavy) | Title Case, truncates at 24 chars, uses initials ("M. Ali") (assumed; not documented) |

Urdu enters the demo only through the Urdu name on the KYC record (the CNIC carries the name in both English and Urdu), never as a title-fetch result.

Exchange houses (fictional): Gulf Bridge Exchange (AE), Thames Remit (UK), Najd Transfer (SA), Hudson Remit (US).

Never put any real bank's logo or name in the UI.

### 4.2 Volume

- About 3,000 customers per bank, with about 8% of people holding accounts at two or more banks.
- About 600 overseas remitters.
- About 20,000 transfers over 6 months.
- Three planted mule rings (one is scripted in S5; two are left for voice queries to discover).
- Seed fixed at `20261111`.

### 4.3 Identifiers (clearly synthetic)

- **CNIC:** 13 digits formatted `9XXXX-XXXXXXX-X`. The leading 9 marks synthetic data. Store as `cnic_syn`.
- **IBAN:** `PK` + 2 digits + bank code + 16 digits, e.g. `PK36RAVI0000123456789012`. Check digits need not be valid; add `synthetic: true`.
- **Phone:** `03XX-XXXXXXX`, from a reserved pool; ring members share one.
- **Device ID:** UUIDv4; ring members share one or two.

### 4.4 Name generation

Structure: `[title?] given_name [middle?] [family_name?] [s/o|d/o|w/o father_name?]`

- **Given (male):** Muhammad, Ahmad, Ali, Imran, Usman, Bilal, Faisal, Tariq, Zulfiqar, Abdul Rehman, Hamza, Hassan, Hussain, Shahid, Asif, Kamran, Naveed, Waqas, Adeel, Farhan
- **Given (female):** Ayesha, Fatima, Zainab, Maryam, Sana, Rabia, Hira, Nimra, Saima, Shazia, Amna, Iqra, Mehwish, Sadia
- **Family names and titles:** Raja, Chaudhry, Malik, Sheikh, Syed, Mian, Khan, Butt, Qureshi, Awan, Siddiqui, Abbasi, Rajput, Bhatti, Mughal
- **Fathers:** male given list plus Rehmat, Nawaz, Akram, Aslam, Bashir, Ghulam Rasool, Mehmood, Yousaf

Variant rules (apply 0 to 3 per record):

| Canonical | Variants |
|---|---|
| Muhammad | Mohammad, Muhammed, Mohd, Muhd, M., Mohammed |
| Ahmad | Ahmed |
| Hussain | Hussein, Husain, Hussan |
| Abdul Rehman | Abdur Rahman, Abd-ul-Rehman, A. Rehman, Abdulrehman |
| Zulfiqar | Zulfikar, Zulfiquar |
| Chaudhry | Ch., Chaudhary, Choudhry, Chaudri |
| Qureshi | Quraishi, Qureishi |
| Ayesha | Aisha, Aysha, Ayisha |
| Fatima | Fatma, Fatimah |
| Mehmood | Mahmood, Mehmud |
| Yousaf | Yousuf, Yusuf |

Other perturbations: drop or add the title (Raja, Ch., Syed); drop the patronymic; swap token order; typo one character (5%); upper or lower case; collapse spaces ("Abdulrehman").

Scripts:

- **Urdu script** on every KYC record as `urdu_name` (mirroring the CNIC), e.g. راجہ عمران اکرم and محمد علی. Titles stay in Roman script.
- **Shahmukhi** for a small subset, with Punjabi letters (ݨ, ڑ) in names like "Rehmat" or "Ghulam Rasool".
- Hand-checked mapping table of about 60 names (Urdu ↔ Roman canonical) in `data/generator/script_map.json`.

### 4.5 Neo4j schema

```
(:Bank {code, name})
(:Account {iban, bank, title_raw, title_script})
(:Record {rid, bank, raw_name, urdu_name, script, cnic_syn, phone, device})        // one per bank customer record
(:Person {pid, canonical_name})                                         // resolved entity
(:Remitter {rmid, name, country})
(:ExchangeHouse {code, name, country})
(:Transfer {tid, amount_pkr, amount_fx, currency, ts, typed_name, band})
(:Phone {h}) (:Device {h})                                              // h = HMAC fingerprint
(:Fingerprint {fp, kind, bank})                                         // opaque, from partner banks
(:Decision {did, hash, band, action, approver, ts, tx})

(Record)-[:HOLDS]->(Account)-[:AT]->(Bank)
(Record)-[:RESOLVES_TO {score}]->(Person)
(Record)-[:USES_PHONE]->(Phone)   (Record)-[:USES_DEVICE]->(Device)
(Remitter)-[:SENT]->(Transfer)-[:TO]->(Account)
(Transfer)-[:VIA]->(ExchangeHouse)
(Phone|Device)-[:SAME_AS]->(Fingerprint)                                // cross-bank link without raw data
(Decision)-[:ABOUT]->(Transfer|Person)
```

The host bank (MRGL) has full `Record` nodes for its own customers. Other banks contribute only `Fingerprint` nodes plus account-level transfer edges that the host can see as receiving bank. The graph canvas draws fingerprint nodes hollow.

---

## 5. The six scripted scenarios

Stored in `demo/scenarios.json`. Stepper moves through them; keys 1 to 6 jump directly. Fixed IDs in docs/CONTRACTS.md.

**S1: Clean match** — Thames Remit; sender "Kamran Butt"; typed "Ayesha Siddiqui"; IBAN at MRGL. Title "AYESHA SIDDIQUI". MATCH; payment proceeds; ledger logs an auto-pass.

**S2: Close match (core moment)** — Gulf Bridge Exchange; sender "Rehmat Ali" (father); typed "Mohd Ali s/o Rehmat"; IBAN at RAVI. Title "MUHAMMAD ALI". CLOSE MATCH with chips INITIAL_EXPANDED / VARIANT_SPELLING (Mohd → Muhammad), PATRONYMIC_DROPPED (s/o Rehmat); score 0.91. Case agent finds 7 prior transfers from same remitter to same IBAN over 5 months; recommends "Proceed". Analyst approves; decision block appears on the ledger.

**S3: Valid account number, wrong person** — Najd Transfer; typed "Zainab Bibi"; IBAN at MRGL with one transposed digit. Title "TARIQ MEHMOOD". NO MATCH; payment held before sending. Banner: "Account exists. Name does not belong to it. This payment would have reached a stranger."

**S4: Urdu as the anchor between two English spellings** — Hudson Remit; typed "Imraan Akram"; IBAN at CHNB. Title "RAJA IMRAN AKRAM". Engine pulls the Urdu KYC name "راجہ عمران اکرم" and shows both Roman spellings mapping to it. CLOSE MATCH with SCRIPT_CONVERTED, VARIANT_SPELLING (Imraan → Imran), TITLE_DROPPED (Raja); score 0.88. Panel shows typed name, title and Urdu name stacked.

**S5: Mule ring across banks** — Remitter "Faisal Nawaz" (AE) sends to 5 beneficiaries: 2 at MRGL, 2 at RAVI, 1 at INDS. Names vary ("Usman Ghani", "M. Usman", "Bilal Ahmed", "Bilal Ahmad", "Hamza Khan"), all share one phone fingerprint, two share a device fingerprint.
- Graph: motif detector highlights the star with shared phone and device; partner-bank nodes hollow.
- Case agent runs 3 to 4 Cypher queries live, one fails and self-repairs; writes the case: 5 beneficiaries, 3 banks, 1 phone, PKR totals, timing (within 48 hours); recommends "Hold pending review; publish fingerprints to consortium registry".
- Analyst approves: `DecisionLog.anchor` called; `MuleRegistry.publish` for phone and device fingerprints.
- Integrity moment: "9 of 9 evidence items verified against epoch N". Presenter presses T, editing one beneficiary node directly in Neo4j. Re-verify: that item turns red ("changed after epoch N"), removed from the agent's context, agent re-runs and notes the excluded fact.
- Multi-bank moment: a new incoming transfer arrives at INDS to a sixth account using the same device. INDS chip flashes "registry hit"; hit appears on the ledger strip.

**S6: Voice queries**
- Urdu (Roman Urdu speech): "Faisal Nawaz ne pichle mahine kitne logon ko paise bheje?" → Answer (Nastaliq): "پچھلے مہینے پانچ افراد، تین بینکوں میں۔" Graph highlights those nodes.
- English: "Show every account that shares a phone with Usman Ghani."
- English: "Which remitters sent to more than three banks this quarter?" Finds one of the unscripted rings.

---

## 6. The single screen

### 6.1 Canvas

Record at **1440 × 900**; must hold at 1280 × 800.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Shanakht شناخت     ①②③④⑤⑥  scenario title             MRGL ● RAVI ● CHNB ● INDS ● Registry ●  mic │  56px top bar
├──────────────────┬───────────────────────────────────────────────────┬─────────────────────────┤
│ INCOMING TRANSFER│                                                   │ CASE                    │
│ Gulf Bridge (AE) │                                                   │ step log (streaming)    │
│ Sender           │            IDENTITY GRAPH                         │  ▸ run_cypher … ok      │
│ Typed name       │            (Cytoscape, fcose)                     │  ▸ run_cypher … error   │
│ IBAN · Bank      │                                                   │  ▸ repaired … ok        │
│ Amount           │                                                   │ Narrative               │
│ [Run payee check]│                                                   │ Evidence (node refs)    │
│ RESULT BAND      │                                                   │ Recommended action      │
│ CLOSE MATCH 0.91 │                                                   │ [Approve] [Reject]      │
│ token alignment  │                                                   │                         │
│ reason chips     │                                                   │                         │
├──────────────────┴───────────────────────────────────────────────────┴─────────────────────────┤
│ LEDGER  #1042 0x3a9c… CLOSE·approved·analyst-02 │ #1043 … │ REGISTRY HIT · INDS · device fp 7be1… │  112px strip
└──────────────────────────────────────────────────────────────────────────────────────────────┘
   left 340px                      center flex                              right 400px
```

Mic is a drawn Lucide icon; no emoji anywhere in the UI.

### 6.2 Design tokens

```css
:root {
  --paper:      #F4EFE6;
  --surface:    #FBF8F2;
  --ink:        #1E1A16;
  --ink-2:      #4A433B;
  --muted:      #8A8074;
  --rule:       #DDD3C4;
  --accent:     #2F5D50;
  --match:      #3D6B4F;
  --close:      #B8892B;
  --nomatch:    #B5543C;
  --bank-mrgl:  #2F5D50;
  --bank-ravi:  #6B5B8C;
  --bank-chnb:  #3E6E8E;
  --bank-inds:  #8C6A3E;
  --radius:     6px;
}
```

Typography: headings and wordmark Newsreader 500; body IBM Plex Sans 13–15px; hashes/Cypher/IBANs IBM Plex Mono 12px; Urdu/Shahmukhi Noto Nastaliq Urdu, line-height ≥ 2.0.

Rules:
- No gradients, glassmorphism, glow, drop shadows (use 1px `--rule` borders), emoji, or confetti.
- Section labels uppercase 11px, letter-spacing 0.08em, `--muted`.
- Result band: full-width block in band colour at 12% tint, 3px left rule in band colour; MATCH / CLOSE MATCH / NO MATCH in Newsreader 28px.
- Token alignment: typed tokens top row, title tokens bottom row, thin connecting lines; dropped tokens struck through in `--muted`; variants joined with dotted line labelled with reason code.
- Graph: Person filled circles; Accounts rounded squares with ring in bank colour; Remitters diamonds; Phone/device small hexagons; partner fingerprints hollow dashed; edges 1px `--rule`; highlighted paths 2px `--accent`; ring members a single soft pulse.
- Motion: 150–200ms ease-out; case log streams line by line; new ledger blocks slide in from the right.
- Mic: idle outline circle; listening filled `--accent` with thin level meter; transcript under the top bar in the spoken language.

### 6.3 Demo director controls (hidden)

| Key | Action |
|---|---|
| `1`–`6` | Jump to scenario |
| `Space` | Run next step in current scenario |
| `V` | Start/stop mic |
| `Shift+V` | Play pre-recorded clip for current voice query |
| `T` | Tamper: edit one evidence node in Neo4j, then re-verify |
| `R` | Reset all state (graph, ledger, registry) to seed |
| `O` | Toggle offline mode indicator |

---

## 7. Build prompts (in order: P0, P1, P2, P3, P4, P5, P6, P6b, P6c, then P7+)

P6c (privacy gateway) must exist before any prompt that calls a model (P7, P8, P9). "The model"/"the LLM" always means a call through the P6c gateway.

### P0: Scaffold
Monorepo: Next.js (App Router, TS, Tailwind) in apps/web; three FastAPI services in services/banks, services/resolver, services/agent, each with pyproject and /health; Hardhat project in chain/; data/ and demo/. docker-compose: neo4j:5 (auth from env, APOC), hardhat node 8545, services on 8101 (banks), 8102 (resolver), 8103 (agent). Web runs outside compose on 3000. .env.example: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, PSEUDO_VAULT_KEY, STT_PROVIDER (faster_whisper | whisper_api | browser; default faster_whisper), STT_API_KEY, CONSORTIUM_HMAC_KEY, CHAIN_RPC=http://localhost:8545, DEMO_OFFLINE=0, SEED=20261111. Root Makefile: make up, make seed (generate data + load neo4j + deploy contracts), make dev, make reset.

### P1: Synthetic data generator
In data/generator, deterministic Python generator (seed from env SEED) producing section 4.
- Four banks ~3,000 records each; ~8% of people at two or more banks. Apply each bank's title quirk exactly.
- Names from lists and variant rules in 4.4; each perturbation a separate unit-testable function. Ground-truth person_id on every record (evaluation only).
- urdu_name on every customer record using data/generator/script_map.json (~60 hand-checked names: canonical Roman, Urdu, Shahmukhi where different). Titles always Roman; Urdu never in title-fetch.
- Synthetic identifiers as 4.3; every record `synthetic: true`.
- ~600 remitters across four exchange houses; ~20,000 transfers over 6 months, monthly rhythm (spikes before Eid and at month start).
- Three mule rings: Ring A scripted S5; Rings B and C unscripted (4 and 6 beneficiaries, 2 and 3 banks).
- Scripted scenario entities with fixed IDs.
- Outputs to data/out/: banks.json, records.jsonl, accounts.jsonl, remitters.jsonl, exchange_houses.json, transfers.jsonl, ground_truth.jsonl.
- Print summary table.

### P2: Neo4j loader and fingerprints
In data/neo4j, Python loader building schema 4.5 from data/out.
- MRGL host: full Record nodes only for MRGL.
- RAVI, CHNB, INDS: Account and Bank nodes, and per record Fingerprint nodes for phone, device, cnic = HMAC-SHA256(CONSORTIUM_HMAC_KEY, normalized), hex, first 16 displayed. Never store their raw names, phones, devices, CNICs.
- MRGL records: compute same fingerprints, link (Phone|Device)-[:SAME_AS]->(Fingerprint) on match.
Indexes on Account.iban, Record.rid, Fingerprint.fp, Remitter.rmid, Transfer.tid. `make seed-graph`. data/neo4j/motifs.cypher: star-ring motif — one remitter, ≥3 beneficiary accounts, linked through ≥1 shared phone/device fingerprint, transfers within 72 hours; return ring as path list.

### P3: Name parser
services/resolver/pk_names.py. Input raw name (Roman, Urdu, Shahmukhi). Output ParsedName: script, titles[], given[], family[], patronymic {relation: s/o|d/o|w/o, name} | null, tokens_canonical[], transformations[].
- Detect script by Unicode block; Urdu/Shahmukhi → canonical Roman via script_map.json first, then char-level fallback.
- Titles: Raja, Ch., Chaudhry and variants, Syed, Mian, Malik, Sheikh, Rana, Hafiz, Dr., Engr.
- Relation markers: s/o, d/o, w/o, S/O, son of, bint, bin, Urdu ولد and بنت. Everything after is patronymic.
- Canonicalize variants (table 4.4); expand initials when unambiguous within comparison pair.
- Lowercase, strip punctuation, normalize whitespace/hyphens.
Tests: every variant row; "Mohd Ali s/o Rehmat" ~ "MUHAMMAD ALI"; "Imran Akram" ~ "راجہ عمران اکرم"; "Ch. Zulfikar" ~ "Chaudhry Zulfiqar"; "Abdulrehman" ~ "Abdur Rahman"; "M. Usman" ~ "Usman Ghani" (close only with supporting evidence, not by name alone).

### P4: Resolution engine (port TaxNet) and reason codes
Port TaxNet ER core into services/resolver/er_core/: phonetic blocking, sentence-transformer similarity, IDF-weighted Jaccard, logistic-regression fusion, clique-cover clustering. Features from ParsedName: tokens_canonical, given and family separately, patronymic agreement, title presence, script.
1. POST /compare {typed_name, title_raw} → {band: MATCH|CLOSE|NO_MATCH, score, reasons: [code], alignment: [{typed_token, title_token|null, relation: exact|variant|initial|transliterated|dropped|extra}]}. MATCH ≥ 0.95, CLOSE 0.75–0.95, else NO_MATCH; configurable. Codes: VARIANT_SPELLING, INITIAL_EXPANDED, TITLE_DROPPED, TITLE_ADDED, PATRONYMIC_DROPPED, SCRIPT_CONVERTED, TOKEN_ORDER, TYPO_1CHAR, SURNAME_MISSING, DIFFERENT_PERSON.
2. POST /resolve-batch {records} → clusters with person_ids.
Eval script: /resolve-batch on all MRGL records, pairwise P/R/F1 vs ground_truth.jsonl. Print real numbers.

### P5: Simulated banks and title fetch
services/banks, one FastAPI server, /banks/{code}/...:
- GET title-fetch?iban= → {iban, title, bank_code, status: FOUND|NOT_FOUND}, bank quirk applied, 120–300 ms latency.
- POST incoming → {registry_check: HIT|CLEAR, fingerprint}; computes beneficiary phone/device fingerprints and calls MuleRegistry.isFlagged.
- GET status → {online: true, last_registry_sync}.
Single adapter interface `TitleFetchClient` in services/agent.

### P6: Ledger contracts
chain/: Solidity 0.8.x + Hardhat deploy.
GraphRootLog: event Committed(uint64 indexed epoch, bytes32 root, uint32 nodeCount, uint32 edgeCount, uint64 ts); commit(epoch, root, nodeCount, edgeCount) onlyOperator, epochs strictly increase; rootOf(epoch); latest() → (epoch, root); verifyLeaf(epoch, leaf, proof) via OpenZeppelin MerkleProof.
DecisionLog: event Anchored(uint256 indexed id, bytes32 decisionHash, bytes32 modelVersion, bytes32 graphRoot, uint64 epoch, uint8 band, uint8 action, bytes32 approverHash, uint64 ts); anchor(...) returns id, require graphRoot == GraphRootLog.rootOf(epoch); get(id). Decision hash = SHA-256 over canonical JSON {transfer_id, typed_name_hash, title_hash, score, reasons, model_version, agent_case_hash, evidence_leaf_hashes, egress_payload_hashes, graph_root, epoch, action, approver_id, ts}. Never raw identifiers on-chain.
MuleRegistry: mapping(bytes32 => Entry{uint8 kind, uint8 publisherBank, uint64 ts, bool active}); publish(fp, kind, bankId) onlyMember; revoke(fp) onlyPublisher; isFlagged(fp) → (bool, uint8, uint64); membership set by deployer for 4 bank IDs.
chain/scripts/explorer.ts serves GET /blocks?limit=20 (Anchored and Published events with tx hashes). Unit tests for publish, revoke, isFlagged, anchor.

### P6b: Evidence integrity service
services/agent/integrity/:
1. Signed ingest: Ed25519 keypair per bank (env). Partner fingerprint batches signed JSON {bank, batch_id, fingerprints[], ts}; loader verifies before writing; reject unsigned/unknown. Store batch_id and signer on Fingerprint nodes.
2. Leaf hashing: SHA-256 over canonical JSON {kind, id, label, properties sorted, signer}. PII on host records hashed inside leaf. Leaves in SQLite keyed by element id.
3. POST /integrity/commit: sorted-pair SHA-256 Merkle tree, GraphRootLog.commit, store tree. Auto after seed and after each approved decision. <2 s for ~100k leaves.
4. POST /integrity/prove {element_ids} → per id: current leaf, stored leaf, proof, status verified|changed|missing; uses on-chain root.
5. Verified-context gate wraps run_cypher: changed/missing rows removed; model gets "N facts excluded: changed after epoch E."; integrity step emitted to UI.
6. POST /integrity/tamper {element_id} (DEMO_MODE=1 only): edits one property in Neo4j without touching leaf table.
Tests: commit-then-prove passes; tampered node fails; unsigned batch rejected; anchor reverts on root mismatch.

### P6c: Privacy gateway and model adapter
services/agent/gateway/. No LLM call except through it.
1. Adapter `complete(messages, tools?, json_schema?)` over OpenAI-compatible endpoint (LLM_BASE_URL, LLM_MODEL).
2. Pseudonymizer: names → PERSON_n (variants of one person share token, via resolver parser); IBANs → ACCT_n; CNICs → CNIC_n; phones → PHONE_n; devices/fingerprints → DEV_n / FP_n; banks/exchange houses keep codes. Encrypted vault (SQLite, PSEUDO_VAULT_KEY) per case. Re-identify outputs locally.
3. Outbound check: scan for CNIC, IBAN, PK phone, Urdu-script names, and every raw vault value; block, log, emit "blocked: identifier detected".
4. Egress log: SHA-256 of payload, provider, model, ts, token count. GET /gateway/egress?case_id=. Hashes go into decision hash.
5. Counter: raw identifiers sent (always 0) and tokens substituted, for top bar.
Tests: planted CNIC blocked; round-trip; two spellings same token; egress hashes match.

### P7: Payee-check agent
POST /payee-check {exchange_house, remitter_id, typed_name, iban, amount} SSE steps: title_fetch; compare; history (prior transfers remitter→IBAN count and date range); decision (MATCH auto-proceed; CLOSE open case; NO_MATCH hold with S3 banner); phrase (PAYEE_EXPLAIN, EN+UR, template fallback). Each step {step, status, data, ms}. Final event has everything for result band and alignment. DEMO_OFFLINE reads demo/cache/payee-<scenario>.json.

### P8: Case agent with text-to-Cypher and self-repair
POST /case {trigger: {type: close_match|ring_alert, ref_ids}} SSE. CASE_AGENT and TEXT_TO_CYPHER prompts.
Tools: run_cypher (read-only; reject CREATE, MERGE, DELETE, SET, REMOVE, DROP, LOAD, CALL dbms; force LIMIT 200; 3 s timeout); get_registry_status(fp); propose_action(action, rationale).
Rules: ≤6 tool calls; ≤2 repairs per query, both attempts emitted; output validates CASE_OUTPUT (retry once); evidence must cite node IDs seen in tool results; planner/executor split (model gets tokenized aggregates only); all calls via gateway; all run_cypher results via verified-context gate; final case carries epoch, root, leaf hashes.
POST /case/{id}/approve {approver_id}: re-prove evidence (refuse if changed), compute decision hash, DecisionLog.anchor, MuleRegistry.publish for hold_and_publish; return tx hashes. /case/{id}/reject.
Never inject fake errors; record genuine failed-then-repaired runs into demo/cache.

### P9: Voice queries
POST /voice (multipart audio) and POST /voice/text {text}.
1. STT per STT_PROVIDER (faster_whisper large-v3 local default; whisper_api; browser).
1b. Tokenize transcript through gateway; Cypher uses parameters bound locally.
2. Language/script detection (Roman Urdu keyword list + LLM).
3. TEXT_TO_CYPHER with read-only guard and self-repair.
4. VOICE_ANSWER: 1–2 sentences in spoken language/script (Urdu → Nastaliq); highlight_ids.
5. Return {transcript, language, cypher_attempts[], rows, answer, highlight_ids}.
Record clips in demo/audio; cache responses demo/cache/voice-*.json.

### P10: The single screen
apps/web/app/page.tsx per section 6. Tailwind + CSS vars in styles/tokens.css; Google Fonts Newsreader, IBM Plex Sans, IBM Plex Mono, Noto Nastaliq Urdu; Lucide icons.
- TopBar: wordmark + Nastaliq "شناخت"; ScenarioStepper; BankChips (flash once on registry hit); MicButton with level meter; transcript line; counter "Identifiers sent to model: 0 · tokens substituted: N" (Plex Mono, muted).
- TransferPanel: exchange house, sender, typed name, IBAN with bank chip, amount (PKR + source currency), Run payee check; ResultBand with SVG token alignment and reason chips.
- GraphCanvas: Cytoscape + fcose; styles per 6.2; highlight API by node IDs; one soft pulse.
- CasePanel: streaming step log (Plex Mono Cypher; failed in --nomatch, repaired in --match); integrity line ("9 of 9 evidence items verified · epoch 214 · block 1043") with Re-verify; per-item check or "changed after epoch N"; narrative; "What the model saw" toggle (tokenized payloads + SHA-256 from /gateway/egress); evidence list with clickable node refs; recommended action; Approve/Reject.
- LedgerStrip: blocks (id, short hash, band, action, approver, time) sliding in; registry hits distinct; click opens MiniExplorer drawer.
Zustand single store (R resets). Drive stepper from demo/scenarios.json. Pixel-tidy at 1440×900; holds at 1280×800.

### P11: Demo director and offline mode
Director keys per 6.3. NEXT_PUBLIC_DEMO_OFFLINE=1 serves all six scenarios from demo/cache/*.json with recorded timing, including egress payloads/hashes. `make record-cache`. UI identical online/offline; tiny offline dot only when O toggled. T tampers first cited evidence node then re-verifies (offline: cached tamper run). R resets Neo4j writes, leaf table, chain (evm_snapshot/revert), registry, UI.

### P12: Polish pass
8px grid; text ≥12px except 11px uppercase chips; Nastaliq line-height ≥2.0 never clipped; no layout shift while streaming; graph never re-layouts on highlight; visible focus; WCAG AA contrast. Remove decoration that carries no information. Run all six scenarios online and offline.

---

## 8. Agent and model prompts (runtime)

### PAYEE_EXPLAIN

```
You explain a name check result to a remittance operations analyst in Pakistan. You receive: typed_name, title_raw, band, score, reasons (codes) and alignment. Write one sentence in English and one in Urdu (Nastaliq script). Use only the reasons given; do not add any. Plain words, no hedging, no exclamation marks.

Codes: VARIANT_SPELLING, INITIAL_EXPANDED, TITLE_DROPPED, TITLE_ADDED, PATRONYMIC_DROPPED, SCRIPT_CONVERTED, TOKEN_ORDER, TYPO_1CHAR, SURNAME_MISSING, DIFFERENT_PERSON.

Names and identifiers arrive as tokens (PERSON_n, ACCT_n). Use them exactly as given; they are replaced with real values after you answer.

Return JSON: {"en": "...", "ur": "..."}
```

### CASE_AGENT (system)

```
You are a case investigator for a Pakistani bank's remittance operations team. You never act on your own; you gather evidence and recommend, and a human analyst approves or rejects.

You have read-only access to an identity graph through run_cypher, plus get_registry_status and propose_action. Records from partner banks appear only as Fingerprint nodes; you cannot see their names or raw identifiers, and you must not speculate about them.

Method:
1. State what triggered the case in one line.
2. Gather the minimum evidence needed: transfer history, shared phone or device fingerprints, timing, number of banks involved, registry status.
3. If a query fails, read the error and fix the query. Do not guess results.
4. Stop after at most 6 tool calls.
5. Recommend exactly one action: proceed, hold, or hold_and_publish (hold and publish the ring's fingerprints to the consortium registry). Use hold_and_publish only when at least three beneficiaries are linked by a shared fingerprint and the transfer timing is clustered.

Every evidence item must cite node IDs that appeared in your tool results. If evidence is thin, say so and recommend hold, not proceed. Keep the narrative under 90 words. No speculation about anyone's intent; describe patterns only. "hold" means holding this payment for review; never recommend freezing or blocking an account, which requires legal authority and verification under SBP instructions.

All identifiers reach you as tokens (PERSON_n, ACCT_n, CNIC_n, PHONE_n, DEV_n, FP_n), and query results arrive tokenized and aggregated. Use tokens as given, pass them as query parameters, and never ask for or guess real values.

Output must match CASE_OUTPUT.
```

### CASE_OUTPUT (JSON schema)

```json
{
  "type": "object",
  "required": ["trigger", "narrative", "evidence", "risk", "recommended_action", "confidence"],
  "properties": {
    "trigger": {"type": "string"},
    "narrative": {"type": "string", "maxLength": 700},
    "narrative_ur": {"type": "string"},
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["claim", "node_ids"],
        "properties": {"claim": {"type": "string"}, "node_ids": {"type": "array", "items": {"type": "string"}}}
      }
    },
    "risk": {"enum": ["low", "medium", "high"]},
    "recommended_action": {"enum": ["proceed", "hold", "hold_and_publish"]},
    "fingerprints_to_publish": {"type": "array", "items": {"type": "string"}},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "open_questions": {"type": "array", "items": {"type": "string"}}
  }
}
```

### TEXT_TO_CYPHER

```
Translate the question into a single read-only Cypher query for Neo4j 5.

Schema:
[section 4.5 verbatim]

Rules:
- Read-only: MATCH, OPTIONAL MATCH, WHERE, WITH, RETURN, ORDER BY, LIMIT, UNWIND, aggregation. Never CREATE, MERGE, SET, DELETE, REMOVE, LOAD, or CALL dbms.
- Always end with LIMIT (200 maximum).
- Match names through Person.canonical_name or Record.raw_name using toLower and CONTAINS, because spellings vary. For partner banks you can only reach Fingerprint nodes.
- Dates: Transfer.ts is ISO-8601; "last month" means the previous calendar month relative to {today}.
- Return node IDs (pid, rid, iban, rmid, fp) alongside any values so the UI can highlight them.
- Output only the query, no commentary.

If you receive an error from a previous attempt, fix that specific error and output only the corrected query.

Question: {question}
```

### VOICE_ANSWER

```
You receive a user question (transcribed speech), its language (ur or en), and the rows returned by a graph query. Answer in one or two short sentences in the same language. For Urdu, write in Nastaliq script even if the speech was transcribed in Roman Urdu. State numbers plainly. If the rows are empty, say no records were found; do not guess.

Names and identifiers arrive as tokens; keep them as tokens in your answer, and they will be replaced with real values for display.

Return JSON: {"answer": "...", "highlight_ids": [...]}
```
