# Console v3 — light, tabbed, unboxed

Supersedes the visual parts of `CONSOLE_V2.md` (its backend API, data shapes and store flows still hold).
The pitch page (`app/page.tsx`, `components/pitch/*`, `app/pitch.css`) is done — nobody touches it.

## What the user rejected in v2
- Dark mode. → **Light mode.**
- "Boxy" UI: rounded bordered cards everywhere, stacked side columns, panels inside panels. This is the strongest
  "made by Claude" tell. → **No cards.** No `rounded-xl border bg-surface p-4` containers, no drop shadows, no
  boxed stat tiles, no pill-everything. Structure comes from **whitespace, alignment, type scale and the occasional
  1px hairline** (`border-rule`) between regions. Radius ≤ 4px and only on interactive controls (buttons, inputs,
  chips). A screen should read like a well-set document / instrument, not a dashboard of widgets.
- A left icon rail. → **Clear text tabs across the top.**
- 3D "spaceship" graph with camera flying. → **2D graph** you pan/zoom like a map and drag nodes in.

## Layout
- Top bar (one line, ~52px): wordmark `Shanakht` left; **tabs**: `Check` · `Investigate` · `Graph` · `Ledger`
  (underline indicator on the active tab, keyboard `G` then C/I/G/L still works); right side: status in plain text —
  "0 raw IDs sent to model", partner banks (small coloured dots + code; red on registry hit), offline marker, mic.
- Content area below fills the rest. Each tab has ONE main object, full width. Secondary detail opens in a
  right-side **slide-over drawer** (overlays, closes with Esc / ✕) instead of a permanent third column.
- Demo bar at the bottom stays (case N of 6 · title · step dots · one primary button "Space"), restyled flat.

## Tabs
### Check (was Inbound) — the animated pipeline
- Case picker: a single horizontal row of the six cases as text tabs/segmented control under the top bar
  (name + small status glyph), not a boxed queue column.
- Main: **the check pipeline**, horizontal, left→right, as a connected line of stages:
  `Received → Title fetched → Names parsed → Tokens aligned → History checked → Decision → Explained`.
  A small marker travels along the line as the real SSE events arrive (store already streams them); each stage
  lights up (cobalt) when reached, shows its live timing, and **reveals its real output beneath it** (the typed name,
  the account title + bank, the parsed tokens, the alignment with plain labels and Urdu anchor, history facts, the
  verdict word + score, the explanation). Pending stages are muted outlines. The verdict stage is the visual peak
  (larger type, status colour). Respect reduced motion.
- Case 5 uses the ring variant (`Scan → Shared phone/device → Accounts → Banks → Ring alert`), case 6 the voice
  variant (`Heard → Transcribed → Graph query → Answer`), same component.
- After a decision that warrants it: one clear action "Open investigation →".

### Investigate
- Main: the case graph (2D, same Graph2D component) full width.
- Agent work as a compact **pipeline too** (Plan → Graph queries → Model calls → Evidence → Recommendation) along the
  top or bottom edge; click a step → highlight what it touched.
- Evidence + recommendation + Approve/Reject in a right drawer that is open by default on this tab but is a drawer
  (unboxed list, hairlines), collapsible.

### Graph — the knowledge graph is the hero
- Canvas fills the whole content area; a **Fullscreen** toggle (button + `F`; uses the Fullscreen API) hides the top
  bar and demo bar entirely.
- **2D** with `react-force-graph-2d` (installed): pan by dragging the background, wheel/pinch zoom, drag nodes,
  click node/link → drawer with details and "why this link exists" (existing `/graph/edge` provenance),
  hover → small label. Zoom-to-fit button, zoom-dependent labels (labels appear as you zoom in), colours by kind
  (default) / bank / case. Clean: thin links, small nodes, no glow/particles/bloom.
- **Querying and filtering directly on the canvas**: one search/query field floating top-left (Find / Ask /
  Patterns as a small mode switch), and a row of **filter chips** under it (kinds, banks, relationship types,
  min resolver score, case neighbourhoods) — toggling a chip filters instantly; active filters are visible and
  removable (×). A results count ("312 of 2,502 entities") in plain text. Non-matching nodes fade rather than vanish
  where that helps orientation. "Expand neighbours", "Path to…", "Focus" from the drawer.
- Legend as a tiny plain-text key bottom-left, collapsible.

### Ledger (was Audit)
- The chain as a horizontal line of blocks drawn as simple marks on a rule (not cards); click → detail in drawer.
- Evidence integrity and the mule registry as plain typeset lists below, hairline-separated.

## Visual tokens (SHELL flips them)
Light: `--bg #FFFFFF`, `--surface #FFFFFF`, `--surface-2 #F5F6F8` (only for hover/selected rows and inputs),
`--fg #0B0E1A`, `--fg-2 #3A4058`, `--muted #6B7190`, `--rule #E6E8EE`, main cobalt `#3452FF` (`--main-ink #2A41D6`
for text), `--main-soft #EEF1FF`. Lime accent `#B8F04A` is fill-only (focus halo / current stage marker), never text.
Status inks readable on white (match `#087A54`, close `#9A5B00`, nomatch `#C22E33`). Geist, 14px base, mono only
for identifiers. Follow HCI basics: visible system status, one primary action per screen, recognition over recall
(shortcuts shown inline), consistent placement, generous hit targets, AA contrast, Esc closes overlays.

## Ownership
- **GRAPH**: `components/graph/*` (replace `Graph3D` with `Graph2D`; restyle Inspector→drawer, QueryBar, Filters→chips,
  Legend), `components/views/GraphView.tsx`, `components/views/InvestigateView.tsx`, `lib/graph*.ts`, `lib/palette.ts`.
  Remove `react-force-graph-3d`/three usage from the console (pitch page keeps three.js).
- **SHELL**: `styles/tokens.css`, `app/globals.css`, `app/console/page.tsx`, `components/shell/*` (top bar + tabs,
  demo bar, drawer primitive `components/shell/Drawer.tsx` that GRAPH may import, pipeline component
  `components/shell/Pipeline.tsx` that GRAPH may import for the agent pipeline), `components/views/InboundView.tsx`
  (can rename the tab label to Check; keep the file), `components/views/AuditView.tsx` (tab label Ledger),
  `lib/store.ts` (view ids may stay `inbound|investigate|graph|audit`; labels change), `lib/guide.ts`.
- SHELL creates `Drawer.tsx` and `Pipeline.tsx` FIRST (within its first few minutes) with a documented props API
  at the top of each file, so GRAPH can import them; until they exist GRAPH uses a local fallback.
