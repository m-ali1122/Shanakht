// Builds docs/demo/Shanakht_Demo_Runbook.docx from the script below and the
// screenshots in docs/demo/screens/<name>.png. Run: node build_runbook.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, ShadingType, BorderStyle, LevelFormat,
  PageBreak, Footer, PageNumber, TableOfContents,
} = require("docx");

const SCREENS = path.join(__dirname, "screens");
const OUT = path.join(__dirname, "Shanakht_Demo_Runbook.docx");

// ---------- palette (matches the app's tokens) ----------
const C = {
  ink: "1E1A16", ink2: "4A433B", muted: "675E54", rule: "DDD3C4",
  accent: "2F5D50", paper: "F4EFE6", surface: "FBF8F2",
  doFill: "E6EEEA", sayFill: "F6EEDC", seeFill: "EEF0F4", warnFill: "F7E6E1",
};
const FONT = "Calibri";
const MONO = "Consolas";
const PAGE_W = 11906, MARGIN = 1080, BODY_W = PAGE_W - 2 * MARGIN; // A4, 0.75" margins

// ---------- helpers ----------
const t = (text, o = {}) => new TextRun({ text, font: o.mono ? MONO : FONT, size: o.size || 21, bold: o.bold, italics: o.italic, color: o.color || C.ink });
const p = (runs, o = {}) => new Paragraph({ children: Array.isArray(runs) ? runs : [typeof runs === "string" ? t(runs) : runs], spacing: { after: o.after ?? 100, before: o.before ?? 0, line: 276 }, alignment: o.align, keepNext: o.keepNext });
const h1 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s)] });
const h2 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(s)] });
const h3 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(s)] });
const bullet = (runs, level = 0) => new Paragraph({ numbering: { reference: "bullets", level }, children: Array.isArray(runs) ? runs : [t(runs)], spacing: { after: 60 } });
const num = (runs) => new Paragraph({ numbering: { reference: "steps", level: 0 }, children: Array.isArray(runs) ? runs : [t(runs)], spacing: { after: 60 } });
const key = (k) => new TextRun({ text: ` ${k} `, font: MONO, size: 20, bold: true, color: "FFFFFF", shading: { type: ShadingType.CLEAR, fill: C.accent, color: "auto" } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const border = { style: BorderStyle.SINGLE, size: 4, color: C.rule };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(children, width, fill, o = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA }, borders,
    shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
    margins: { top: 90, bottom: 90, left: 140, right: 140 },
    verticalAlign: o.vAlign,
    children: Array.isArray(children) ? children : [children],
  });
}

// A cue card: rows of [LABEL, content paragraphs]
const LABEL_W = 1500;
function cue(rows) {
  const fills = { DO: C.doFill, SAY: C.sayFill, "POINT AT": C.seeFill, "YOU SEE": C.seeFill, "IF IT GOES WRONG": C.warnFill, NOTE: C.surface };
  return new Table({
    width: { size: BODY_W, type: WidthType.DXA },
    columnWidths: [LABEL_W, BODY_W - LABEL_W],
    rows: rows.map(([label, content]) => new TableRow({
      cantSplit: true,
      children: [
        cell(p([t(label, { bold: true, size: 18, color: C.ink2 })], { after: 0 }), LABEL_W, fills[label] || C.surface),
        cell(content.map((c) => (c instanceof Paragraph ? c : p(c, { after: 60 }))), BODY_W - LABEL_W, fills[label] === C.sayFill ? "FFFDF7" : undefined),
      ],
    })),
  });
}
const say = (s) => p([t("\u201C" + s + "\u201D", { italic: true, size: 22 })], { after: 60 });

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: "png", data: b };
  // JPEG: scan for SOF0/SOF2
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xc0 || m === 0xc2) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), type: "jpg", data: b };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("unknown image " + file);
}
function shot(name, caption) {
  const file = ["png", "jpg", "jpeg"].map((e) => path.join(SCREENS, `${name}.${e}`)).find((f) => fs.existsSync(f));
  const out = [];
  if (file) {
    const img = pngSize(file);
    const w = 640, h = Math.round((img.h / img.w) * w);
    out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true,
      children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: w, height: h },
        altText: { title: caption, description: caption, name } })] }));
  } else {
    out.push(p([t(`[Screenshot missing: ${name}]`, { italic: true, color: "B5543C" })], { align: AlignmentType.CENTER }));
  }
  out.push(p([t(caption, { italic: true, size: 18, color: C.muted })], { align: AlignmentType.CENTER, after: 200 }));
  return out;
}

// ---------- content ----------
const body = [];

// Title page
body.push(
  new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ text: "Shanakht", font: "Georgia", size: 72, color: C.ink })] }),
  new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: "Demo runbook and presenter script", font: FONT, size: 32, color: C.ink2 })] }),
  p([t("Identity resolution for Pakistani remittances: pre-send payee check, cross-bank identity graph, investigating case agent, Urdu and English voice queries, and an on-chain audit ledger with a consortium mule registry.", { size: 22, color: C.ink2 })], { after: 360 }),
  p([t("What this document is for: ", { bold: true }), t("everything the presenter needs to run the full-feature demo, live or for the video. Every scene says what to press, what to say, what to point at and what should appear, with a screenshot of the expected screen.")]),
  p([t("Length: ", { bold: true }), t("the extended cut below runs about 7 to 8 minutes and shows every feature. Section 6 gives the shorter 90-second and 3-minute cuts as subsets of the same scenes.")]),
  p([t("Data: ", { bold: true }), t("everything on screen is synthetic. The four banks and four exchange houses are fictional. Say this once at the start.")], { after: 600 }),
  pageBreak(),
);

body.push(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }), pageBreak());

// 1. Before you start
body.push(h1("1. Before you start (10 minutes before)"));
body.push(p("Do these in order. Everything assumes the repository is at D:\\5th Sem\\Projects\\Shanakht."));
body.push(h2("1.1 Start the system"));
body.push(
  num([t("Start Docker Desktop and wait until it says it is running.")]),
  num([t("Open PowerShell in the repository folder and run: "), t(".\\scripts\\dev.ps1 up", { mono: true })]),
  num([t("Then run: "), t(".\\scripts\\dev.ps1 dev", { mono: true }), t(" (starts banks, resolver, agent, explorer and the web screen).")]),
  num([t("For the recorded video, use offline mode so nothing depends on Wi-Fi or the model's speed: stop the agent and start it with "), t("$env:DEMO_OFFLINE=1", { mono: true }), t(" set. Scenes then replay with their recorded timings. For a live pitch, leave it off.")]),
  num([t("Open "), t("http://localhost:3000", { mono: true }), t(" in Chrome.")]),
  num([t("Press "), key("R"), t(" once to reset everything to the seed state. Do this before every take.")]),
);
body.push(h2("1.2 Screen and recording setup"));
body.push(
  bullet("Record at 1440 \u00D7 900 (the layout also holds at 1280 \u00D7 800). Browser zoom 100%, full screen (F11) so no tabs or bookmarks show."),
  bullet("Turn on Do Not Disturb. Close Discord, WhatsApp and anything that pops up notifications."),
  bullet("Click once on an empty part of the page so it has keyboard focus. The director keys do nothing while the cursor is in a text box."),
  bullet("Microphone: test it once in Chrome. If the room is noisy, use Shift+V (pre-recorded clip) instead of speaking live."),
  bullet("Press O to check the offline indicator, then press O again to hide it. Only you should ever see it."),
);
body.push(h2("1.3 Pre-flight check (30 seconds)"));
body.push(cue([
  ["DO", [[key("1")], [t("Then "), key("R"), t(".")]]],
  ["YOU SEE", [[t("Top bar shows all five dots (MRGL, RAVI, CHNB, INDS, Registry). The counter reads "), t("Identifiers sent to model: 0", { mono: true }), t(". The ledger strip at the bottom is empty or shows only seed blocks.")]]],
  ["IF IT GOES WRONG", [[t("A grey or missing bank dot means that service is down: rerun "), t(".\\scripts\\dev.ps1 dev", { mono: true }), t(". A blank graph means Neo4j is not up: rerun "), t(".\\scripts\\dev.ps1 up", { mono: true }), t(" and refresh.")]]],
]));

body.push(pageBreak());

// 2. Controls
body.push(h1("2. Controls"));
body.push(p("Only the keyboard is used. Nothing needs to be clicked except Approve, the evidence links and the ledger blocks, which are optional."));
const ctlRows = [
  ["1 \u2013 6", "Jump to scenario S1 to S6 (loads the transfer and the graph; nothing runs yet)."],
  ["Space", "Run the next step of the current scenario. Each scenario has a fixed sequence (table below)."],
  ["V", "Start or stop the live microphone (S6)."],
  ["Shift+V", "Play the pre-recorded voice clip for the current voice question."],
  ["T", "Tamper: edit one evidence node directly in the graph database, then re-verify (S5)."],
  ["R", "Reset graph, ledger, registry and screen to the seed state."],
  ["O", "Show or hide the tiny offline indicator (presenter only)."],
];
const KW = 1600;
body.push(new Table({ width: { size: BODY_W, type: WidthType.DXA }, columnWidths: [KW, BODY_W - KW],
  rows: [new TableRow({ tableHeader: true, children: [cell(p([t("Key", { bold: true })], { after: 0 }), KW, C.paper), cell(p([t("What it does", { bold: true })], { after: 0 }), BODY_W - KW, C.paper)] }),
    ...ctlRows.map(([k, d]) => new TableRow({ children: [cell(p([t(k, { mono: true, bold: true })], { after: 0 }), KW), cell(p(d, { after: 0 }), BODY_W - KW)] }))] }));
body.push(h2("What Space does in each scenario"));
const seq = [
  ["S1", "Payee check (auto-pass)."],
  ["S2", "Payee check \u2192 case agent investigates \u2192 Approve."],
  ["S3", "Payee check (held)."],
  ["S4", "Payee check (Urdu anchor)."],
  ["S5", "Ring alert \u2192 case agent investigates \u2192 Approve (anchor + publish) \u2192 new incoming transfer at INDS (registry hit)."],
  ["S6", "Voice question 1 (Urdu) \u2192 question 2 \u2192 question 3."],
];
body.push(new Table({ width: { size: BODY_W, type: WidthType.DXA }, columnWidths: [KW, BODY_W - KW],
  rows: seq.map(([k, d]) => new TableRow({ children: [cell(p([t(k, { bold: true })], { after: 0 }), KW, C.surface), cell(p(d, { after: 0 }), BODY_W - KW)] })) }));
body.push(p(""), p([t("Approve can be pressed with Space (it is the next step) or by clicking the Approve button. Clicking looks more natural on video.", { color: C.ink2 })]));

body.push(pageBreak());

// 3. Screen tour
body.push(h1("3. The screen at a glance"));
body.push(...shot("01-overview", "The single screen, S1 loaded and idle."));
body.push(
  bullet([t("Top bar: ", { bold: true }), t("wordmark, scenario stepper (1\u20136), the five network dots (four banks plus the consortium registry), the privacy counter and the microphone.")]),
  bullet([t("Left \u2013 Incoming transfer: ", { bold: true }), t("exchange house, sender, the name the sender typed, IBAN and bank, amount. After the check: the result band, token alignment and reason chips.")]),
  bullet([t("Centre \u2013 Identity graph: ", { bold: true }), t("remitters (diamonds), accounts (rounded squares, ringed in the bank's colour), people (circles), phones and devices (hexagons). Hollow dashed nodes are partner-bank fingerprints: the host bank never sees partner customers' names.")]),
  bullet([t("Right \u2013 Case: ", { bold: true }), t("the agent's live step log (including the database queries it writes), the integrity line, the narrative, evidence, the recommended action and Approve / Reject.")]),
  bullet([t("Bottom \u2013 Ledger: ", { bold: true }), t("every decision, publish and graph-root commit as an on-chain block. Click any block to open the mini explorer.")]),
);

body.push(pageBreak());

// 4. Extended script
body.push(h1("4. The full-feature script (about 7\u20138 minutes)"));
body.push(p("Each scene: DO is what you press, SAY is the voiceover (speak it flat and unhurried; it is written to be read aloud), POINT AT is where to move the cursor while you speak, YOU SEE is what must appear before you move on."));

// Scene 0
body.push(h2("Scene 0 \u2013 Opening (25 s)"));
body.push(cue([
  ["DO", [[t("Start on S1, idle. Do not press anything yet.")]]],
  ["SAY", [say("Every year, Pakistanis abroad send home more than thirty billion dollars. A sender types a name and an account number at an exchange house. If the name does not match the account title, the payment stalls, gets returned, or worse, lands with the wrong person. This is Shanakht. Everything you will see runs on synthetic data and simulated banks.")]],
  ["POINT AT", [[t("Sweep slowly across the three panels, then rest on the left panel.")]]],
]));

// Scene 1
body.push(h2("Scene 1 \u2013 S1 Clean match: the baseline (30 s)"));
body.push(cue([
  ["DO", [[key("1"), t(" then "), key("Space")]]],
  ["SAY", [say("First, the normal case. Kamran in London sends money to Ayesha Siddiqui. Before anything moves, we fetch the account title from her bank and compare. It matches, so the payment proceeds automatically, and the decision is still written to the ledger.")]],
  ["POINT AT", [[t("The MATCH band, then the new block sliding into the ledger strip.")]]],
  ["YOU SEE", [[t("Green MATCH band, score 1.00, no reason chips. An \u201Cauto\u201D block appears on the ledger.")]]],
]));
body.push(...shot("02-s1-match", "S1: MATCH, auto-pass, anchored to the ledger."));

// Scene 2
body.push(h2("Scene 2 \u2013 S3 Valid account number, wrong person (40 s)"));
body.push(cue([
  ["DO", [[key("3"), t(" then "), key("Space")]]],
  ["SAY", [say("Now the case an account-number check can never catch. A sender in Riyadh types Zainab Bibi, and an account number with two digits swapped. The number is valid: the account exists. But the title belongs to Tariq Mehmood. Without this check, the money reaches a stranger. With it, the payment is held before it is sent.")]],
  ["POINT AT", [[t("The typed name, then the IBAN, then the red NO MATCH banner.")]]],
  ["YOU SEE", [[t("NO MATCH band with DIFFERENT_PERSON, and the banner: \u201CAccount exists. Name does not belong to it. This payment would have reached a stranger.\u201D")]]],
]));
body.push(...shot("03-s3-nomatch", "S3: the account exists, the name does not belong to it."));

// Scene 3
body.push(h2("Scene 3 \u2013 S2 Close match and the case agent (75 s)"));
body.push(cue([
  ["DO", [[key("2"), t(" then "), key("Space"), t(" (payee check).")]]],
  ["SAY", [say("Most mismatches are not fraud. Rehmat Ali in Dubai sends to his son and types Mohd Ali s slash o Rehmat. The bank's title says MUHAMMAD ALI. A plain string match fails. Our engine reads Pakistani names: Mohd is an abbreviation of Muhammad, and s slash o Rehmat is a patronymic the bank never stores. Close match, 0.91, and each reason is shown.")]],
  ["POINT AT", [[t("The token alignment lines: Mohd \u2194 MUHAMMAD (dotted, INITIAL_EXPANDED) and the struck-through \u201Cs/o Rehmat\u201D (PATRONYMIC_DROPPED). Then the reason chips.")]]],
  ["YOU SEE", [[t("Amber CLOSE MATCH band, score about 0.91, chips INITIAL_EXPANDED and PATRONYMIC_DROPPED, and a one-line explanation in English and Urdu.")]]],
]));
body.push(...shot("04-s2-close", "S2: CLOSE MATCH with token alignment and reason chips."));
body.push(cue([
  ["DO", [[key("Space"), t(" (case agent). Wait for the log to finish; live this takes up to a minute, offline it replays in seconds.")]]],
  ["SAY", [say("A close match opens a case. The case agent investigates on its own: it writes database queries against the identity graph, checks the history and looks for any ring pattern. Seven earlier transfers from the same father to the same account over five months, and no shared phones or devices with anyone suspicious. It recommends proceed. It cannot act by itself.")]],
  ["POINT AT", [[t("The step log as it streams (the monospace query lines), then the narrative and \u201CRecommended: proceed\u201D.")]]],
  ["YOU SEE", [[t("Step log with the agent's queries, the integrity line (all evidence items verified), a short narrative, and the recommendation proceed.")]]],
]));
body.push(...shot("05-s2-case", "S2: the case agent's investigation and recommendation."));
body.push(cue([
  ["DO", [[t("Click "), t("Approve", { bold: true }), t(" (or press "), key("Space"), t(").")]]],
  ["SAY", [say("Nothing happens until an analyst approves. The approval, the evidence and the exact graph state the agent used are anchored on-chain, so an auditor can check it later.")]],
  ["POINT AT", [[t("The new decision and commit blocks on the ledger strip.")]]],
  ["YOU SEE", [[t("A decision block (CLOSE \u00B7 proceed \u00B7 approved) and a graph-root commit block slide in.")]]],
]));
body.push(...shot("06-s2-approved", "S2: approval anchored on the ledger."));

// Scene 4
body.push(h2("Scene 4 \u2013 S4 Urdu as the anchor (40 s)"));
body.push(cue([
  ["DO", [[key("4"), t(" then "), key("Space")]]],
  ["SAY", [say("Here the sender in New York types Imraan Akram. The bank title is RAJA IMRAN AKRAM. Two English spellings of the same man, because older CNICs were in Urdu and people chose their own English spelling. His CNIC carries one Urdu name. We use it as the anchor between the two spellings: same person, title dropped, close match.")]],
  ["POINT AT", [[t("The three stacked lines: typed name, bank title and the Urdu KYC name in Nastaliq. Then the chips.")]]],
  ["YOU SEE", [[t("CLOSE MATCH about 0.88 with SCRIPT_CONVERTED, VARIANT_SPELLING and TITLE_DROPPED. The Urdu name \u0631\u0627\u062C\u06C1 \u0639\u0645\u0631\u0627\u0646 \u0627\u06A9\u0631\u0645 is shown in Nastaliq.")]]],
]));
body.push(...shot("07-s4-urdu", "S4: the Urdu name on the KYC record anchors two English spellings."));

// Scene 5
body.push(h2("Scene 5 \u2013 S5 Mule ring across three banks (about 3 minutes)"));
body.push(p("This is the centrepiece. Take it slowly; each beat shows a different feature."));
body.push(h3("5a. The ring appears"));
body.push(cue([
  ["DO", [[key("5"), t(" then "), key("Space"), t(" (ring alert).")]]],
  ["SAY", [say("Now the part no name check can see. Faisal Nawaz in the UAE sends money to five people at three different banks within two days. The names all look different: Usman Ghani, M. Usman, Bilal Ahmed, Bilal Ahmad, Hamza Khan. But they all share one phone, and two of them share one device.")]],
  ["POINT AT", [[t("The remitter diamond, then the five accounts, then the shared phone hexagon in the middle. Point out the hollow dashed nodes.")]]],
  ["YOU SEE", [[t("The ring highlighted with a single soft pulse; the alert reads five beneficiaries, three banks, one shared phone, one shared device.")]]],
]));
body.push(...shot("08-s5-ring", "S5: one remitter, five beneficiaries, three banks, one phone."));
body.push(cue([
  ["SAY", [say("The hollow nodes are the important part. Accounts at partner banks show up only as keyed fingerprints of a phone or device. We never see their customers' names or numbers, and they never see ours.")]],
]));
body.push(h3("5b. The case agent investigates"));
body.push(cue([
  ["DO", [[key("Space"), t(" (case agent). Let the log stream; do not talk over the first two lines.")]]],
  ["SAY", [say("The case agent takes over. It plans its own graph queries, runs them, and if a query fails it reads the error and repairs it. Then it writes up the case: five beneficiaries, three banks, one phone, the amounts, and transfers clustered within forty-eight hours. It recommends holding the payment and publishing the ring's fingerprints to the consortium registry.")]],
  ["POINT AT", [[t("The streaming query lines. If a failed query (red) is followed by a repaired one (green), point at both. Then the narrative, the evidence list and \u201Chold and publish\u201D.")]]],
  ["YOU SEE", [[t("Several queries, the integrity line \u201CN of N evidence items verified \u00B7 epoch \u2026 \u00B7 block \u2026\u201D, a narrative, evidence with clickable node links, and the recommendation hold_and_publish.")]]],
  ["NOTE", [[t("A failed-then-repaired query appears only when the model genuinely made a mistake; it is never staged. If the take has none, skip the word \u201Crepairs\u201D.")]]],
]));
body.push(...shot("09-s5-case", "S5: the case agent's queries, integrity line and recommendation."));
body.push(h3("5c. What the model saw (privacy)"));
body.push(cue([
  ["DO", [[t("Click the "), t("What the model saw", { bold: true }), t(" toggle in the case panel. Then point at the counter in the top bar. Click the toggle again to go back.")]]],
  ["SAY", [say("Banks cannot send customer data to a language model. So every call goes through a privacy gateway. This is exactly what the model saw: tokens like PERSON_1 and ACCT_3, the schema and counts. Never a name, an account number or a phone. The counter has stayed at zero identifiers sent the whole time, and every outgoing payload is hashed into the audit record.")]],
  ["POINT AT", [[t("The PERSON_n and ACCT_n tokens in the payload, the SHA-256 under each, then the top-bar counter.")]]],
  ["YOU SEE", [[t("The tokenized payloads with their hashes, and \u201CIdentifiers sent to model: 0\u201D.")]]],
]));
body.push(...shot("10-s5-model-saw", "S5: the exact tokenized payload sent to the model, with its hash."));
body.push(h3("5d. Tamper test (integrity)"));
body.push(cue([
  ["DO", [[t("Press "), key("T"), t(". Wait for the re-verification and the agent's re-run.")]]],
  ["SAY", [say("Every fact the agent used is checked against a graph root committed on-chain. Watch what happens if someone inside the bank edits the graph afterwards. I have just changed one beneficiary record directly in the database. It no longer matches the committed root, so it turns red, it is dropped from the agent's context, and the agent re-runs without it and says so.")]],
  ["POINT AT", [[t("The red item and \u201Cchanged after epoch N\u201D, then the agent's note about the excluded fact.")]]],
  ["YOU SEE", [[t("The integrity line drops by one (for example 17 of 18), one evidence item is red with \u201Cchanged after epoch N\u201D, and the case re-runs.")]]],
]));
body.push(...shot("11-s5-tamper", "S5: an edited fact fails verification and leaves the agent's context. (Captured from rehearsal mode; the live tamper produces the same panel.)"));
body.push(cue([
  ["NOTE", [[t("Approve refuses to anchor while any cited fact is changed. For a clean approval in the same take, press "), key("R"), t(", then "), key("5"), t(", and run the ring alert and the case again before approving. In the edited video you can cut straight from the tamper beat to the approval.")]]],
]));
body.push(h3("5e. Approve: anchor and publish"));
body.push(cue([
  ["DO", [[t("Click "), t("Approve", { bold: true }), t(" (or "), key("Space"), t("). Then click the newest ledger block to open the mini explorer; close it after a few seconds.")]]],
  ["SAY", [say("The analyst approves. The decision is anchored on-chain with the graph root and the hashes of every piece of evidence. And the ring's phone and device fingerprints are published to the shared mule registry. No names, no numbers: only keyed fingerprints.")]],
  ["POINT AT", [[t("The decision block, the two publish blocks, then the explorer drawer (transaction hash, event data).")]]],
  ["YOU SEE", [[t("Decision (hold_and_publish), two Published blocks (phone, device) and a commit block on the strip. The drawer shows the full event and its transaction hash.")]]],
]));
body.push(...shot("12-s5-approved", "S5: decision anchored, fingerprints published."));
body.push(...shot("13-s5-explorer", "S5: the mini explorer drawer for one block."));
body.push(h3("5f. Another bank is warned"));
body.push(cue([
  ["DO", [[key("Space"), t(" (new incoming transfer at INDS).")]]],
  ["SAY", [say("Minutes later, Indus Microfinance, a different bank, receives a transfer for a sixth account. It checks the registry. The device matches a published fingerprint, so it is warned instantly. Nobody shared a name or a phone number. This is how banks cooperate against mules without sharing customer data.")]],
  ["POINT AT", [[t("The INDS dot flashing \u201Cregistry hit\u201D in the top bar, then the REGISTRY HIT block on the ledger.")]]],
  ["YOU SEE", [[t("The INDS chip flashes once and reads registry hit; a REGISTRY HIT \u00B7 INDS \u00B7 device fp block appears on the ledger.")]]],
]));
body.push(...shot("14-s5-registry-hit", "S5: a different bank gets an instant registry hit on the device fingerprint."));

// Scene 6
body.push(h2("Scene 6 \u2013 S6 Ask the graph by voice (75 s)"));
body.push(cue([
  ["DO", [[key("6"), t(". Then either press "), key("V"), t(" and speak the question below, then press "), key("V"), t(" again; or press "), key("Shift+V"), t(" to play the recorded clip; or press "), key("Space"), t(" to send it as text.")]]],
  ["SAY", [say("Analysts can question the graph directly, in Urdu or English."), p([t("Then speak, in Roman Urdu: ", { bold: true }), t("Faisal Nawaz ne pichle mahine kitne logon ko paise bheje?", { italic: true })])]],
  ["POINT AT", [[t("The transcript under the top bar, then the Nastaliq answer, then the highlighted nodes.")]]],
  ["YOU SEE", [[t("Answer in Urdu: five people across three banks; the ring nodes highlight.")]]],
]));
body.push(...shot("15-s6-urdu", "S6: an Urdu question answered in Nastaliq, with the nodes highlighted."));
body.push(cue([
  ["DO", [[key("Space"), t(" (or speak it): "), t("Show every account that shares a phone with Usman Ghani.", { italic: true })]]],
  ["SAY", [say("Show every account that shares a phone with Usman Ghani.")]],
  ["YOU SEE", [[t("Four accounts: the other ring members at MRGL, RAVI and INDS, highlighted on the graph.")]]],
]));
body.push(...shot("16-s6-phone", "S6: accounts sharing a phone with Usman Ghani."));
body.push(cue([
  ["DO", [[key("Space"), t(" (or speak it): "), t("Which remitters sent to more than three banks this quarter?", { italic: true })]]],
  ["SAY", [say("And a question we never scripted. Which remitters sent to more than three banks this quarter? It finds a second ring we never showed you, so the answers are not canned.")]],
  ["YOU SEE", [[t("One remitter (Naveed Abbasi, RM-RC) across four banks.")]]],
]));
body.push(...shot("17-s6-ringc", "S6: the unscripted question finds a second ring."));

// Scene 7
body.push(h2("Scene 7 \u2013 Close (20 s)"));
body.push(cue([
  ["DO", [[t("Press "), key("1"), t(" to return to the clean screen, or stay on the S6 graph.")]]],
  ["SAY", [say("Shanakht. A payee check that understands Pakistani names, a graph that sees rings across banks, an agent that does the casework while humans decide, and a ledger that proves what it used. Identity for Pakistani remittances.")]],
]));

body.push(pageBreak());

// 5. Troubleshooting
body.push(h1("5. If something goes wrong"));
const trouble = [
  ["Keys do nothing", "Click an empty part of the page (not a text box) and try again. After a code reload, refresh the page once."],
  ["The case agent is slow (live mode)", "S5 can take 2\u20133 minutes live. Keep talking over the streaming log, or use offline mode for recordings."],
  ["\u201Cmodel unavailable\u201D in the step log", "The model hit a rate limit; a deterministic investigator with the same rules took over. The demo still works. Mention it only if asked."],
  ["Approve refuses after T", "Expected: the system will not anchor evidence that changed. Press R, then rerun the scenario."],
  ["No registry hit in 5f", "Approve was skipped or the decision was not hold_and_publish. Press R and run S5 again from the ring alert."],
  ["Graph is blank", "Neo4j is down: rerun .\\scripts\\dev.ps1 up and refresh."],
  ["Microphone does not pick up", "Use Shift+V (recorded clip) or Space (typed question). The answer is the same."],
  ["Anything else mid-take", "Press R, wait two seconds, start the scene again. In editing, cut at the scenario number key."],
];
const TW = 2900;
body.push(new Table({ width: { size: BODY_W, type: WidthType.DXA }, columnWidths: [TW, BODY_W - TW],
  rows: [new TableRow({ tableHeader: true, children: [cell(p([t("Symptom", { bold: true })], { after: 0 }), TW, C.paper), cell(p([t("Fix", { bold: true })], { after: 0 }), BODY_W - TW, C.paper)] }),
    ...trouble.map(([a, b]) => new TableRow({ cantSplit: true, children: [cell(p([t(a, { bold: true })], { after: 0 }), TW, C.warnFill), cell(p(b, { after: 0 }), BODY_W - TW)] }))] }));

// 6. Shorter cuts
body.push(h1("6. Shorter cuts"));
body.push(h2("90-second cut"));
body.push(p("S3 (Scene 2) \u2192 S2 payee check only (Scene 3, first card) \u2192 S4 (Scene 4) \u2192 S5: 5a, 5b, 5d, 5e, 5f \u2192 S6 Urdu question only \u2192 close. Shorten each SAY to its first two sentences."));
body.push(h2("3-minute cut (live pitch)"));
body.push(p("The 90-second cut plus: 5c (What the model saw and the counter), the S6 unscripted question (ring C), and 30 seconds of problem framing at the start."));

// 7. Recording checklist
body.push(h1("7. Recording checklist"));
[
  "Offline mode on; offline indicator hidden (O).",
  "R pressed before every take.",
  "1440 \u00D7 900, full screen, notifications off.",
  "Speak the Urdu question slowly and clearly, or use Shift+V.",
  "Burn captions into the final video; name it Shanakht_demo.mp4.",
  "Check the final video for any real bank name, logo or real-looking customer data. There should be none.",
].forEach((s) => body.push(bullet(s)));

// ---------- document ----------
const doc = new Document({
  creator: "Shanakht team",
  title: "Shanakht demo runbook",
  styles: {
    default: { document: { run: { font: FONT, size: 21, color: C.ink } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: "Georgia", size: 36, color: C.ink }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 26, bold: true, color: C.accent }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 22, bold: true, color: C.ink2 }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
                                      { level: 1, format: LevelFormat.BULLET, text: "\u2013", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } }] },
    { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
  ] },
  features: { updateFields: true },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1080, bottom: 1080, left: MARGIN, right: MARGIN } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "Shanakht demo runbook \u00B7 page ", size: 16, color: C.muted, font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.muted, font: FONT })] })] }) },
    children: body,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log("wrote", OUT); });
