# Shanakht pitch video: voice script

Runtime about 1:30. The visuals stay exactly as they are; only the voice changes.
Each line fits its scene at a quick, natural pace (about 3 words a second).

## How to record (one voice note)

1. Read all 8 lines below **in order, in one recording**.
2. **Pause about 2 seconds between scenes** (count "one, two" in your head). Keep pauses *inside* a scene short (under half a second), so the splitter only cuts at scene breaks.
3. Quiet room, phone or laptop mic 15–20 cm from your mouth. Any format works (m4a, mp3, wav).
4. Save it as `docs/video/voice_note.m4a` (or any name) and run:

```
.venv\Scripts\python.exe scripts\make_pitch_video.py --skip-record --voice-note docs\video\voice_note.m4a
```

It cuts your note into 8 pieces at the 7 longest pauses, saves them to `docs/video/my_voice/`, fits each scene's footage
to your timing and writes `docs/video/shanakht_pitch.mp4`. If a line runs long, that scene just holds its last frame.
If a piece is cut in the wrong place, re-record just that scene as `docs/video/my_voice/sceneN.wav` and run with
`--voice-dir docs\video\my_voice` instead.

---

## Scene 1 · Pitch page, the 3D scroll · about 12 s
> Remittances to Pakistan fail on names. Spellings drift, initials expand, Urdu becomes Roman. Shanakht is an **entity resolution system** that tells a spelling difference from the wrong person, before the money moves.

## Scene 2 · Inbound, case 1 · about 7 s
> A transfer arrives. Shanakht pulls the account title from the bank and resolves it against the typed name. Clean match.

## Scene 3 · Inbound, case 2, the name crossing · about 13 s
> Case two. Mohd Ali, son of Rehmat, against Muhammad Ali. A **fine-tuned name model** aligns every token, even through the **Urdu script**, and returns a close match with **reason codes**.

## Scene 4 · Inbound, case 3, stopped · about 10 s
> Case three. A valid account number, but a different person. No name in common, so Shanakht stops the transfer before it lands, and says why.

## Scene 5 · Case 5 ring alert → Investigate, the 3D case graph · about 20 s
> Case five opens as a ring alert. One sender, five accounts, three banks. An **agentic AI investigator** queries the **knowledge graph**, and every claim cites evidence. A **pseudonymization gateway** means the model only sees tokens. Names and account numbers never leave the bank.

## Scene 6 · Graph, the grand knowledge graph · about 22 s
> Underneath is a **shared knowledge graph** across four banks, seventy thousand entities. Partner banks contribute only **HMAC-keyed fingerprints**, never raw customer data. Click any link and it explains why it exists. **Pattern detectors** surface what a person would miss, like one device behind accounts at different banks.

## Scene 7 · Audit, the chain · about 11 s
> Every decision is anchored **on-chain**. The evidence is committed as a **Merkle root**, so editing one fact later breaks verification. Flagged mule accounts go to a **consortium registry** that every bank can check.

## Scene 8 · Pitch page hero · about 4 s
> Shanakht. Entity resolution for remittances. Know who gets the money before it moves.

---

### Buzzwords covered (all true to the build)
| Term | Where | What it refers to in the product |
|---|---|---|
| Entity resolution system | 1, 8 | resolver service: Pakistani name parser and matcher |
| Fine-tuned name model | 3 | `pak-name-matcher-v1` embedding model |
| Reason codes | 3 | resolver output (short form, patronymic dropped, script converted…) |
| Agentic AI investigator | 5 | case agent: text-to-Cypher over the graph, evidence-cited findings |
| Pseudonymization gateway | 5 | privacy gateway; the model sees PERSON_n / ACCT_n tokens only |
| Shared knowledge graph | 5, 6 | Neo4j cross-bank identity graph, ~70k nodes |
| HMAC-keyed fingerprints | 6 | partner banks share signed keyed hashes, not raw data |
| On-chain / Merkle root | 7 | GraphRootLog + DecisionLog contracts; evidence leaves under a committed root |
| Consortium (mule) registry | 7 | MuleRegistry contract checked on incoming transfers |
