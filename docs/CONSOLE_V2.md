# Console v2 — design + contract

Shared brief for the console rebuild. Three workstreams build against this file in parallel:
**BACKEND** (graph explore API), **GRAPH** (3D graph, Investigate + Graph views), **SHELL** (frame, Inbound + Audit views, theme, demo bar).

## Why the old console failed
Generic three-pane dashboard: every case looked like the same cards, the graph was a 2D Cytoscape hairball nobody could
interrogate, edges had no meaning, and the layout said "admin panel" rather than "remittance desk". Rule for v2:
**every screen has one hero object that only Shanakht would have**, and every pixel either is that object, acts on it,
or explains it. No KPI tiles, no stat-card grids, no placeholder paragraphs, no decorative eyebrow labels, no emoji.

## Who uses it, what they do
An ops analyst at the host bank (Margalla, MRGL) watching inbound remittances. Four jobs, four workspaces in a slim
left rail (icon + short word, keyboard `G` then key, and also clickable):

| Rail | Hero object | Job |
|---|---|---|
| **Inbound** | *The name crossing* | Is the typed payee the account holder? |
| **Investigate** | *The case graph* (3D) | Why is this held / is this a ring? Approve or reject. |
| **Graph** | *The grand knowledge graph* (3D) | Explore, query and filter the whole cross-bank identity graph. |
| **Audit** | *The chain* | Are decisions anchored, is the evidence intact, what does the registry hold? |

### Inbound
- Left column: the **inbound queue**, one row per demo transfer (the six scenarios, from `lib/scenarios.ts`), each showing
  sender → typed payee, amount, corridor, and a status glyph (pending / checking / pass / hold / stop). Selecting a row =
  selecting the scenario (same as keys 1–6).
- Centre (hero): **the name crossing**. Typed name (as sent abroad) on top, account title (from the bank) below, tokens
  laid out as columns with alignment lines between them (reuse/redo `TokenAlignment`), each line labelled in plain words
  (short form, spelling, script, dropped). Urdu anchor (Nastaliq) shown where it resolves both. The verdict lands as a
  large stamp on the crossing (Match / Close match / No match / Ring alert) with score, and plain-language reasons.
- Right: the **check route**: vertical path of the pipeline steps (title lookup, compare, history, decision, explain) with
  live timings, then the outcome action: “Open investigation” (jumps to Investigate) when a case is warranted.
- Case 6 (voice): the crossing area becomes the **ask** surface (mic + transcript + answer rows).

### Investigate
- Hero: 3D case graph (neighbourhood of the scenario) filling the centre.
- Left: **agent trail** — the case agent's steps as a narrative timeline (human names: Graph query, Model call, ...),
  each step clickable → highlights the nodes/edges it touched. Privacy counter (raw IDs to model / masked) lives here.
- Right: **evidence + decision** — agent summary, evidence rows (click → camera flies to that node/edge), integrity
  status, recommendation with risk, Approve / Reject.

### Graph (grand knowledge graph)
- Full-bleed 3D graph of a large sample of the identity graph (≈2–3k nodes) with all six scenario neighbourhoods
  included and tagged.
- Top: **query bar** with three modes: *Find* (entity search: name, IBAN, record id, phone/device hash), *Ask* (natural
  language via existing `POST /voice/text`, matched names highlighted), *Patterns* (canned detectors, see API).
- Left (collapsible): **filters** — entity kinds, banks, relationship types, min resolver score, hide partner
  fingerprints, “only scenario neighbourhoods”, colour-by (kind | bank | scenario). Live counts next to each.
- Right drawer: **inspector**. Node: kind, label, bank, privacy-safe properties, degree by relationship, scenarios it is
  in, integrity status; buttons *Expand neighbours*, *Focus*, *Path to…*. Edge: **why this link exists** — title,
  cause sentence, origin (which bank file / signed fingerprint / resolver / transfer history), evidence key-values,
  resolver reasons for RESOLVES_TO, transfers list for SENT, committed-in-Merkle-root flag.
- Every node AND every link is clickable. Hover shows a minimal label. Click node → camera flies to it.

### Audit
- Hero: **the chain** — blocks laid out left→right (graph-root commits, decisions, registry hits), newest highlighted;
  click a block → its detail (tx, epoch, root, decision, case). Integrity panel: verify / tamper (T) / re-verify,
  showing which evidence leaf broke. Mule registry entries list.

### Demo bar (all workspaces)
Thin bar at the bottom: “Case N of 6 · title”, step dots, the one primary next-step button (Space), shortcuts help (?).
Moving through steps auto-switches workspace (check → Inbound, open case → Investigate, registry → Audit). Keyboard:
1–6, Space, V/Shift+V, T, R, O must keep working exactly as today (logic in `lib/store.ts`).

## Visual system
- Console is **dark** (same family as the pitch page). SHELL flips the semantic tokens in `styles/tokens.css`
  (`--bg --surface --surface-2 --fg --fg-2 --muted --rule`, status `*-ink` variants made readable on dark) — everything
  else must use these semantic tokens, never hard-coded light colours.
- Brand: main cobalt `#3452FF` (actions, selection), accent lime `#B8F04A` (focus halo, the one thing to look at).
  Status: match green, close amber, no-match/ring red. Banks: MRGL cobalt-ish, RAVI violet, CHNB cyan, INDS amber.
- Type: Geist / Geist Mono; Nastaliq for Urdu. 13–15px body, mono only for identifiers.
- 3D palette lives in `lib/palette.ts` (GRAPH creates it; plain hex values mirroring the tokens) so three.js can use it.

## Graph data shape (frontend)
```ts
type GNode = { id: string; label: string; kind: "remitter"|"account"|"record"|"person"|"phone"|"device"|"fingerprint"|"decision";
  bank?: string|null; hollow?: boolean; tampered?: boolean; focus?: boolean; scenarios?: string[]; degree?: number; fpKind?: string };
type GLink = { id: string; source: string; target: string; rel: string; label?: string|null; score?: number; count?: number };
type GData = { nodes: GNode[]; links: GLink[] };
```
Existing `/graph/scenario/{sid}` and `/graph/neighborhood` return Cytoscape `{nodes:[{data}],edges:[{data}]}`; GRAPH
writes an adapter. New endpoints below return `GData`-shaped `{nodes, links}` directly.

## Backend API (BACKEND implements in `services/agent/graph_explore.py`, router registered in `main.py`)
All read-only, no LLM calls, deterministic. Node ids = the existing UI ids (`ui_id`: rmid / iban / rid / pid /
`ph:<h>` / `dv:<h>` / `fp:<fp>` / did). Privacy: for partner-bank (non-MRGL) Account/Record nodes never return raw
names/titles — only bank, hashed/opaque id, fingerprints.

| Method | Path | Returns |
|---|---|---|
| GET | `/graph/grand?limit=2500` | `{nodes, links, stats:{total_nodes,total_edges,shown_nodes,shown_edges,by_kind,by_rel,by_bank}}`. All six scenario neighbourhoods (depth 2, nodes tagged `scenarios:["S5",...]`) + deterministic sample (seeded) of Person clusters (person → records → accounts/phones/devices/fingerprints, + SENT from remitters) until `limit`. Transfers collapsed into `SENT` links with `count`. RESOLVES_TO links carry `score`. Bank/ExchangeHouse hubs excluded. Cached in memory after first build. |
| GET | `/graph/node/{id}` | `{id, kind, label, bank, props:{...privacy-safe}, degree:{REL:n}, scenarios:[...], integrity:{eid, committed:bool, tampered:bool}}` |
| GET | `/graph/edge?rel=&source=&target=` | `{rel, source, target, title, cause, origin, evidence:[{k,v}], score?, reasons?:[{code,text}], transfers?:[{tid,amount_pkr,amount_fx,currency,date,house}], committed:bool}` — see provenance table |
| GET | `/graph/search?q=&limit=20` | `{results:[{id,label,kind,bank,match}]}` — case-insensitive contains on Remitter.name, Record.raw_name/urdu_name (host bank only), Person.canonical_name; exact/prefix on iban, rid, rmid, pid, phone/device/fingerprint hash |
| GET | `/graph/expand?id=&depth=1` | `{nodes, links}` neighbourhood of one node in GData shape |
| GET | `/graph/patterns` | `{patterns:[{key,title,description}]}` |
| GET | `/graph/pattern/{key}` | `{key,title,description, nodes, links, matches:[[ids...]...], count}` |
| GET | `/graph/path?source=&target=&max=6` | `{nodes, links}` shortest path (skip hubs) |

Provenance (`/graph/edge`), plain language, from DB facts:
| rel | title | cause / origin |
|---|---|---|
| HOLDS | Record holds account | KYC record at {bank} lists this account. Origin: {bank} KYC file |
| USES_PHONE / USES_DEVICE | Shared phone / device | KYC record registered this phone/device (keyed hash). Origin: {bank} KYC file. Evidence: how many records/banks share it |
| RESOLVES_TO | Same person | Resolver matched record name to person, score. Reasons via resolver `POST /compare` (raw_name vs canonical) → reason codes + plain text |
| HAS_FP | Partner fingerprint | {bank} contributed a signed HMAC fingerprint (kind). Origin: partner bank, signed |
| SAME_AS | Fingerprint match | Host-bank phone/device hash equals partner fingerprint → same phone/device across banks |
| SENT | Transfers | N transfers from remitter to account, list (date, amount, exchange house). Origin: transfer history |
| other | rel name humanised | generic |

Patterns (canned Cypher, parameter-free): `shared-phone` (phone on ≥3 records across ≥2 banks), `shared-device`,
`fan-in` (account receiving from ≥4 remitters), `cross-bank-person` (person with records at ≥3 banks),
`partner-hit` (host phone/device SAME_AS a partner fingerprint). Cap each to a drawable size (≤400 nodes).

Offline (`DEMO_OFFLINE=1`): grand, patterns list, each pattern, search, node and edge answer from `demo/cache/`
recordings when present (extend `scripts/record_cache.py` to record grand + patterns), and fall back to template
provenance built from the cached grand graph for node/edge details not recorded. Never touch Neo4j offline.

## File ownership
- BACKEND: `services/agent/graph_explore.py`, `services/agent/main.py` (router include only), `services/agent/tests/test_graph_explore.py`, `scripts/record_cache.py`.
- GRAPH: `components/graph/*` (Graph3D, Inspector, QueryBar, Filters, Legend), `components/views/InvestigateView.tsx`,
  `components/views/GraphView.tsx`, `lib/graphApi.ts`, `lib/graphStore.ts` (its own zustand store), `lib/palette.ts`,
  `lib/graphAdapt.ts`. May read `lib/store.ts` but not edit it. Retires `components/GraphCanvas.tsx` and `components/CasePanel.tsx` (logic moves into InvestigateView).
- SHELL: `app/console/page.tsx`, `components/shell/*` (Rail, DemoBar, StatusBar…), `components/views/InboundView.tsx`,
  `components/views/AuditView.tsx`, `styles/tokens.css` (console token flip), `app/globals.css`, `lib/store.ts`
  (add `view` state + auto-switching only; flows unchanged), `lib/guide.ts`, and the remaining old components
  (TopBar, GuideStrip, TransferPanel, TokenAlignment, LedgerStrip, TranscriptLine, MicButton, Director) to reuse or retire.
- Nobody touches `app/page.tsx` or `components/pitch/*`.

Views are default exports with no props, reading state from stores. The shell imports
`@/components/views/{Inbound,Investigate,Graph,Audit}View`.
