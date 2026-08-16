#!/usr/bin/env node
/* Tests for the narrator, and one of them is the reason it is not a model.
 *
 *   node tools/test_narrator.js
 *
 * The interesting test is GROUNDING: every number that appears in a generated
 * sentence must be findable in the rows that sentence cites. That is a
 * mechanical check of the claim the whole design rests on, and it is a test
 * that could not be written at all for a generative model, because there would
 * be no cited rows to check against. It is run here on the demo, so it also
 * fails when a rule starts interpolating something it computed itself.
 */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const Narrator = require("../narrator.js");

const DB = path.join(__dirname, "..", "demo", "health.db");
const db = new DatabaseSync(DB, { readOnly: true });
const query = (sql) => db.prepare(sql).all();

let failed = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failed++;
  console.log(`  FAIL ${name}${detail ? "\n         " + detail : ""}`);
}

/* A LINE BREAK IS WHITESPACE, and dropping it fabricates numbers.
 *
 * This removed every tag alike, so two chronology lines joined by `<br>` came
 * back welded: "...on 2030-06-27" followed by "2030-06-27 ..." stripped to
 * "...2030-06-272030-06-27...", and the tokeniser below read 272030 out of the
 * seam. That number is in no row, so grounding reported it - correctly, on the
 * text it was given, about a string that appears on no screen. The reader sees
 * two lines.
 *
 * A false positive here is worse than it looks: this test is the mechanical
 * proof behind the whole design, and one that cries wolf at a rule doing
 * nothing wrong teaches the next reader to discount it. Only `<br>` is
 * treated this way; the rest are inline and welding them is correct. */
const strip = (html) => html
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const mounts = Narrator.generate(query);
const sections = Object.values(mounts).flat();
const messages = sections.flatMap(s => s.messages);

console.log(`\nnarrator: ${messages.length} messages, ${sections.length} sections, ` +
            `mounted at ${Object.keys(mounts).join(", ")}\n`);

/* ---- it produced something at all ------------------------------------- */
ok("generates messages", messages.length > 0);
ok("no rule crashed", !messages.some(m => m.tone === "broken"),
   messages.filter(m => m.tone === "broken").map(m => strip(m.text)).join("\n         "));

/* ---- every citation is a real, runnable query -------------------------- */
for (const m of messages) {
  if (!m.sql) continue;
  let rows = null, err = null;
  try { rows = query(m.sql); } catch (e) { err = e.message; }
  ok(`${m.rule}: citation runs`, err === null, err);
  ok(`${m.rule}: citation returns rows`, rows && rows.length > 0);
}

/* ---- GROUNDING --------------------------------------------------------- */
/* Build everything the cited rows could honestly support: the stored values,
 * their absolute values (a negative days_to_deadline is spoken as a positive
 * number of days ago), the row count, and the size of every group within the
 * result - because "how many times the engine said it" is expressly allowed.
 * Anything in the prose that is not in that set was invented.              */
function grounds(rows) {
  const nums = new Set(), strs = new Set();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  for (const r of rows) {
    for (const c of cols) {
      const v = r[c];
      if (v === null || v === undefined) continue;
      if (typeof v === "number" || typeof v === "bigint") {
        const n = Number(v);
        nums.add(n); nums.add(Math.abs(n));
      } else strs.add(String(v));
    }
  }
  nums.add(rows.length);
  for (const c of cols) {                       // group sizes, and subset sizes
    const tally = new Map();
    for (const r of rows) {
      const k = String(r[c]);
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    for (const n of tally.values()) nums.add(n);
    // a rule may also count the rows NOT in a group ("2 of those were not
    // independent" is stated as its complement in some sentences)
    for (const n of tally.values()) nums.add(rows.length - n);
  }
  return { nums, strs };
}

function supported(token, g) {
  const n = Number(token.replace(/,/g, ""));
  if (!Number.isFinite(n)) return true;
  for (const h of g.nums) {
    if (h === n) return true;
    for (const dp of [0, 1, 2]) {
      if (Number(h.toFixed(dp)) === n) return true;
    }
  }
  // dates and identifiers live in strings: 2030-05-15 is three tokens
  for (const s of g.strs) if (s.includes(token)) return true;
  return false;
}

for (const m of messages) {
  if (!m.sql) continue;
  const g = grounds(query(m.sql));
  const text = strip(m.text);
  // Grouped thousands only, so a trailing comma in prose is punctuation and
  // not part of the number. "2030-05-15," must tokenise as 15, never "15,".
  const tokens = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || [];
  const orphans = tokens.filter(t => !supported(t, g));
  ok(`${m.rule}: every number traces to a cited row`, orphans.length === 0,
     orphans.length ? `unsupported: ${orphans.join(", ")}\n         in: ${text.slice(0, 160)}` : "");
}

/* ---- verbatim engine text is not paraphrased --------------------------- */
/* Where the engine wrote the words, the narrator must reproduce them. If a
 * future edit starts summarising an escalation, this catches it.          */
const gate = query("SELECT escalation FROM gates WHERE status <> 'cleared'");
if (gate.length) {
  const gateMsg = messages.find(m => m.rule === "open-gate");
  ok("engine escalation text is reproduced verbatim",
     gateMsg && strip(gateMsg.text).includes(gate[0].escalation.replace(/\s+/g, " ").trim()));
}

/* ---- crossings: two kinds, two sentences (contract 47) ------------------ */
/* The defect this guards is not a wrong number. It is a TRUE number placed in
 * a sentence that inverts its meaning.
 *
 * Both crossing kinds carry `previous_value` and `previous_date`. On a
 * personal first they name the record the reading beat. On a round number they
 * name the last reading ALREADY ON THE SIDE just arrived at, which can sit
 * further from the level than the reading taken immediately before - so
 * printed as "(was X)" a crossing DOWNWARD reads as a gain.
 *
 * GROUNDING CANNOT CATCH THIS, which is why these tests exist separately: X is
 * in the cited rows, so the sentence is perfectly grounded and perfectly
 * wrong. A test over the rendered text is the only thing that sees it.       */
const crossings = Narrator.RULES.find(r => r.id === "crossings");
const chron = (html) => html.split("<br>").filter(l => l.includes('class="when"'));

ok("crossings: rule exists", !!crossings);

/* Absence is absence: a record with fewer than two weight readings has no
 * crossings, and that renders as nothing - not an error, and not an empty box
 * implying a failure to look. */
ok("crossings: silent on a record with none",
   crossings.run(() => []).length === 0);

/* THE REGRESSION THAT MATTERS, on a synthetic row so it holds whatever the
 * demo later becomes. 79.4 is the last reading already below 80; the fact
 * being reported is that the series is back under 80 since that date. */
const trap = [{ date: "2030-04-13", kind: "round_number", metric: "kg",
                value: 80, direction: "down",
                previous_value: 79.4, previous_date: "2030-04-10" }];
const trapLine = strip(chron(crossings.run(() => trap)[0].text)[0]);
ok("crossings: a round number never prints previous_value as a former weight",
   !trapLine.includes("79.4"), trapLine);
ok("crossings: a round number names the date it was last on this side",
   trapLine.includes("since 2030-04-10"), trapLine);

/* A null previous_date is the STRONGER claim, not a missing value: the level
 * was never reached from that side before. */
const firstEver = [{ date: "2030-04-09", kind: "round_number", metric: "kg",
                     value: 80, direction: "down",
                     previous_value: null, previous_date: null }];
const firstLine = strip(chron(crossings.run(() => firstEver)[0].text)[0]);
ok("crossings: a null previous_date reads as a first, never as 'since null'",
   firstLine.includes("for the first time in this record")
   && !/\bsince\b/.test(firstLine), firstLine);

/* The other half of the distinction: the same two columns, said the other way
 * round, and here naming the value IS correct. */
const beat = [{ date: "2030-06-30", kind: "personal_first", metric: "kg",
                value: 75.5, direction: "down",
                previous_value: 75.8, previous_date: "2030-06-27" }];
const beatLine = strip(chron(crossings.run(() => beat)[0].text)[0]);
ok("crossings: a personal first does name the reading it beat",
   beatLine.includes("75.8") && beatLine.includes("beating"), beatLine);

/* And the same discipline held against the real demo rows. */
const crossRows = query("SELECT date, kind, metric, value, direction, " +
                        "previous_value, previous_date FROM crossings");
if (crossRows.length) {
  const msg = messages.find(m => m.rule === "crossings");
  ok("crossings: the demo produced a message", !!msg);
  const lines = msg ? chron(msg.text) : [];
  ok("crossings: every row reaches the page",
     lines.length === crossRows.length,
     `${lines.length} lines for ${crossRows.length} rows`);
  ok("crossings: every line names its kind",
     lines.length > 0 &&
     lines.every(l => /<code>(round_number|personal_first|band)<\/code>/.test(l)));

  for (const r of crossRows) {
    // Only where the two differ. Where the rung and the previous reading are
    // the same number, the number belongs on the line as the rung.
    if (r.kind !== "round_number") continue;
    if (r.previous_value === null || r.previous_value === r.value) continue;
    // Matched on the leading date span: a later row's `previous_date` can be
    // this row's date, so a bare includes() finds the wrong line.
    const line = lines.find(l => l.includes(`class="when">${r.date}</span>`) &&
                                 l.includes("<code>round_number</code>"));
    ok(`crossings: ${r.date} round number omits its previous_value`,
       !!line && !strip(line).includes(String(r.previous_value)),
       line ? strip(line) : "no line found");
  }

  // Newest first, read off the rendered order rather than trusted from the
  // ORDER BY that produced it.
  const dates = lines.map(l => (/(\d{4}-\d{2}-\d{2})/.exec(strip(l)) || [])[1]);
  ok("crossings: rendered newest first",
     dates.every((d, i) => i === 0 || (dates[i - 1] && d && dates[i - 1] >= d)),
     dates.join(" "));
}

/* ---- the band kind, and the rule that governs it (contract 48) ---------- */
/* "The engine may compute the ratio and state the boundary as a boundary. It
 * may never name the band." That ruling binds this client too, and this is the
 * one place in this repo where a well-meant sentence is a real harm rather
 * than an imprecision: docs/medical-boundary.md makes a bound stated as a
 * bound class (a) and safe, and a category name class (c) and a violation.
 *
 * THE WORD LIST BELOW IS AUTHORED HERE ON PURPOSE, not imported from the
 * engine's `boundary_gate.py` and not copied from the engine's own test.
 * Sharing one list would mean sharing exactly one blind spot: a word nobody
 * thought of passes every check that exists. It is deliberately broader than
 * it needs to be, because a false positive here costs a rewritten sentence and
 * a false negative ships a category word to a reader.
 *
 * The demo cannot exercise this. `examples/demo` carries no `height_cm`, so
 * no BMI can be computed and the engine mints no band rows for it - checked,
 * not assumed. So the kind is driven synthetically here AND the whole rendered
 * output is scanned regardless, so that the scan starts working the day a
 * demo with a height arrives.                                                */
const CATEGORY_WORDS = [
  "underweight", "overweight", "obese", "obesity", "morbidly",
  "healthy weight", "healthy range", "healthy bmi", "unhealthy",
  "normal weight", "normal range", "normal bmi", "abnormal",
  "ideal weight", "ideal range", "target weight range",
  "classification", "classified as", "category", "categorised", "categorized",
  "at risk", "high risk", "low risk", "danger", "dangerous",
];
const CATEGORY_RE = new RegExp(
  "\\b(?:" + CATEGORY_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                           .join("|") + ")\\b", "i");

const bandRow = (over) => Object.assign({
  date: "2030-05-05", kind: "band", metric: "bmi", value: 25,
  direction: "down", previous_value: null, previous_date: "2030-02-02",
}, over || {});

const bandOut = crossings.run(() => [bandRow()]);
const bandLine = strip(chron(bandOut[0].text)[0]);

ok("crossings: a band states the boundary as a boundary",
   bandLine.includes("first bmi below 25 since 2030-02-02"), bandLine);

/* A band is NOT a personal first. Before this branch existed it fell through
 * to that sentence and would have read "bmi low of 25, beating ..." - a claim
 * about the athlete's own reading that no row makes. */
ok("crossings: a band is never rendered as a personal first",
   !bandLine.includes("beating") && !/\bbmi (low|high) of\b/.test(bandLine),
   bandLine);

/* A band's `value` is the boundary and never the athlete's ratio, so nothing
 * on the line may be presented as their own figure. */
ok("crossings: a band with no previous_date takes the first-time sentence",
   strip(chron(crossings.run(() => [bandRow({ previous_date: null })])[0].text)[0])
     .includes("bmi below 25 for the first time in this record"));

/* THE RULE, over every byte this rule can emit for every kind - not just the
 * band line. A category word smuggled into the surrounding prose would be the
 * same violation in a place the line-level checks do not look. */
const everyKind = crossings.run(() => [
  bandRow(),
  bandRow({ date: "2030-05-06", value: 30, direction: "up",
            previous_value: 29.1, previous_date: "2030-01-01" }),
  { date: "2030-05-07", kind: "round_number", metric: "kg", value: 80,
    direction: "down", previous_value: 79.4, previous_date: "2030-04-10" },
  { date: "2030-05-08", kind: "personal_first", metric: "kg", value: 75.5,
    direction: "down", previous_value: 75.8, previous_date: "2030-04-11" },
]);
const everyKindText = everyKind.map(m => strip(m.text)).join(" ");
ok("crossings: no category word anywhere in the rendered output",
   !CATEGORY_RE.test(everyKindText),
   (CATEGORY_RE.exec(everyKindText) || [])[0]);

/* And over the real demo output too, so this keeps working without anyone
 * remembering to extend it. */
{
  const msg = messages.find(m => m.rule === "crossings");
  const all = messages.filter(m => m.rule === "crossings")
                      .map(m => strip(m.text)).join(" ");
  ok("crossings: no category word in the demo's rendered output",
     !msg || !CATEGORY_RE.test(all), (CATEGORY_RE.exec(all) || [])[0]);
}

/* ---- an unknown kind refuses rather than mis-renders -------------------- */
/* THE DURABLE HALF. This rule shipped with everything that was not a round
 * number falling through to the personal-first sentence, so contract 48's
 * `band` would have been rendered as a reading of the athlete's body. Contract
 * 49 may add a fourth kind. The requirement is not that this page knows it -
 * it cannot - but that it says so instead of guessing.                       */
const unknown = crossings.run(() => [
  { date: "2030-07-01", kind: "trajectory_shift", metric: "kg", value: 74,
    direction: "down", previous_value: 75.1, previous_date: "2030-06-20" },
]);
const unknownText = unknown.map(m => strip(m.text)).join(" ");
const unknownLine = strip(chron(unknown[0].text)[0]);

ok("unknown kind: the row does not vanish",
   unknownLine.includes("2030-07-01"), unknownLine);
ok("unknown kind: the row is named by its own kind",
   unknownText.includes("trajectory_shift"), unknownText.slice(0, 200));
ok("unknown kind: it is not claimed as a personal first",
   !unknownLine.includes("beating") && !/\b(low|high) of\b/.test(unknownLine),
   unknownLine);
ok("unknown kind: it is not claimed as a boundary crossing",
   !/\b(below|above)\b/.test(unknownLine), unknownLine);
ok("unknown kind: the refusal says what it is refusing to do",
   /no sentence for this kind/.test(unknownLine), unknownLine);
/* Loud, not buried: a second message so a reader scanning the page sees the
 * client fell behind rather than finding one odd line in a list of 26. */
ok("unknown kind: raises a separate message rather than only a list line",
   unknown.length === 2 && unknown[1].tone === "watch",
   `${unknown.length} messages, tones ${unknown.map(m => m.tone).join(",")}`);
/* The engine's known kinds must NOT trip the refusal, or the control is a
 * tripwire across the doorway. */
ok("unknown kind: the three known kinds never trip it",
   !/no sentence for this kind/.test(everyKindText)
   && everyKind.length === 1,
   `${everyKind.length} messages`);

/* ---- observed_days: state the fraction, grade nothing (contract 39) ------
 *
 * The defect is invisible rather than wrong. `window_days` is the denominator
 * a reader assumes and `observed_days` is the numerator nobody had, so a
 * weekly average built from two logged days rendered exactly like one built
 * from seven. This corpus publishes eleven such rows.
 *
 * The second assertion matters as much as the first. The engine ships NO
 * threshold here on purpose - "the engine reports the fraction and lets the
 * reader judge" - so a client that called a thin window sparse, poor or
 * unreliable would be inventing the cutoff the engine refused to invent.     */
const observed = Narrator.RULES.find(r => r.id === "observed-days");
ok("observed-days: rule exists", !!observed);

/* Silent when every window is fully observed. Absence of the finding is not
 * the same as a finding of completeness, and a sentence on every deck would
 * be a sentence nobody reads. */
ok("observed-days: silent when nothing is partly observed",
   observed.run(() => []).length === 0);

{
  const partial = [{ metric: "easy_hr", window_days: 7, observed_days: 2,
                     n: 7, total: 11 },
                   { metric: "easy_hr", window_days: 7, observed_days: 3,
                     n: 4, total: 11 }];
  const t = strip(observed.run(() => partial)[0].text);

  ok("observed-days: states the numerator and the denominator",
     /\b2 of 7 days\b/.test(t) && /\b3 of 7 days\b/.test(t), t.slice(0, 120));
  ok("observed-days: names the metric it is about",
     /easy_hr/.test(t), t.slice(0, 120));
  /* The total is the engine's window function, not a sum taken here - it must
   * appear, and grounding above proves it traces to a cited row. */
  ok("observed-days: reports the total the query returned",
     /\b11\b/.test(t), t.slice(0, 90));

  const GRADING = /\b(sparse|insufficient|unreliable|untrustworthy|poor|weak|inadequate|too few|not enough|worrying|concerning|bad)\b/i;
  ok("observed-days: grades nothing", !GRADING.test(t),
     (GRADING.exec(t) || [])[0]);

  // And the same over what the demo really renders.
  const live = messages.find(m => m.rule === "observed-days");
  ok("observed-days: the demo produced it", !!live);
  ok("observed-days: the live text grades nothing",
     !live || !GRADING.test(strip(live.text)),
     live ? (GRADING.exec(strip(live.text)) || [])[0] : "");
}

/* ---- capabilities: state them, never apply them (contract 44) ------------
 *
 * This is the first table this page reads that QUALIFIES other numbers rather
 * than reporting its own, and the discipline is the whole point: a capability
 * is keyed on `origin`, so it reaches a value only where that value named its
 * instrument. Silence resolves to `unknown` by the engine's own rule, not to a
 * default, so dimming or discounting a figure whose row named no origin would
 * be this page making a join the engine declined to make.                    */
const caps = Narrator.RULES.find(r => r.id === "capabilities");
ok("capabilities: rule exists", !!caps);
ok("capabilities: silent on a record that declares none",
   caps.run(() => []).length === 0);

{
  const rows = query("SELECT origin, measures, competence, construct, basis, " +
                     "condition, note FROM capabilities");
  if (rows.length) {
    const msg = messages.find(m => m.rule === "capabilities");
    ok("capabilities: the demo produced it", !!msg);
    const t = msg ? strip(msg.text) : "";

    // Every declaration reaches the page, under the engine's own words.
    for (const r of rows) {
      ok(`capabilities: ${r.origin}/${r.measures} is reported`,
         t.includes(r.measures) && t.includes(r.competence),
         t.slice(0, 140));
    }
    /* A PROXY MUST CARRY ITS CONSTRUCT. Contract 44 requires one beside a
     * proxy precisely because "proxy" alone does not say proxy for WHAT, and
     * that construct is what settled the `pulse` question. */
    for (const r of rows.filter(r => r.construct)) {
      ok(`capabilities: the construct travels with the proxy`,
         t.includes(r.construct), t.slice(0, 160));
    }
    /* A CONDITION MUST TRAVEL TOO: a competence quoted without its condition
     * is a stronger claim than the record made. */
    for (const r of rows.filter(r => r.condition)) {
      ok(`capabilities: the condition travels with the competence`,
         t.includes(r.condition), t.slice(0, 160));
    }
    // And it states rather than applies: no grading of anything.
    ok("capabilities: applies nothing to the figures on the page",
       !/\b(unreliable|discount|ignore|do not trust|untrustworthy|invalid)\b/i.test(t),
       t.slice(0, 140));
  }
}

/* ---- no message is empty or unterminated ------------------------------- */
for (const m of messages) {
  const t = strip(m.text).trim();
  ok(`${m.rule}: reads as a sentence`, t.length > 20 && /[.!?]$/.test(t),
     t.slice(-60));
}

db.close();
console.log(failed ? `\n${failed} failing\n` : "\nall passing\n");
process.exit(failed ? 1 : 0);
