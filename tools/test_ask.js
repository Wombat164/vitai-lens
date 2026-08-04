#!/usr/bin/env node
/* Tests for the ask box.
 *
 *   node tools/test_ask.js
 *
 * Three properties matter, in this order.
 *
 * GROUNDING - every number in an answer must be findable in the rows that
 * answer cites. Same check the brief gets, for the same reason: an answer
 * typed into a box is not a lesser claim than one the page volunteered.
 *
 * REFUSAL - questions outside the schema must be refused, not answered. This
 * is the property that distinguishes the thing from a language model, and it
 * is the one that rots first, because every new intent widens the net.
 *
 * NO SQL FROM USER TEXT - the only values that reach a query are a date
 * matched by regex, a session type from a fixed map, and a goal slug read out
 * of the database. Adversarial input must not change the shape of a query.
 */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
global.Narrator = require("../narrator.js");
const Ask = require("../ask.js");

const db = new DatabaseSync(path.join(__dirname, "..", "demo", "health.db"),
                            { readOnly: true });
const query = (sql) => db.prepare(sql).all();

let failed = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failed++;
  console.log(`  FAIL ${name}${detail ? "\n         " + detail : ""}`);
}

const strip = (h) => h.replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/* ---- every intent is reachable ---------------------------------------- */
const CANONICAL = {
  help: "what can you answer",
  gate: "are they restricted from anything",
  weight: "what do they weigh",
  goals: "how are the goals going",
  sessions: "how many runs are there",
  "on-date": "what happened on 2030-06-16",
  provenance: "where did the numbers come from",
  conflicts: "did any sources disagree",
  coverage: "which days are missing",
  verdicts: "how did the weeks score",
  extremum: "what is my longest run",
  "daily-metric": "how did i sleep",
  checks: "did i pass the hop test",
  injuries: "what injuries do i have",
  "plan-changes": "did i change my plan and why",
  corrections: "has anything been corrected",
  modelled: "what is modelled rather than measured",
  route: "what route do i run",
  weather: "what was the weather like",
  "best-effort": "what is my best 10k",
};

console.log("\nask\n");
for (const [id, q] of Object.entries(CANONICAL)) {
  const a = Ask.answer(q, query);
  ok(`"${q}" -> ${id}`, a.kind === "answer" && a.matched === id,
     `got ${a.kind}${a.matched ? " " + a.matched : ""}`);
}

const reachable = new Set(Object.keys(CANONICAL));
for (const it of Ask.INTENTS) {
  ok(`intent ${it.id} has a canonical question`, reachable.has(it.id),
     "an intent nobody can reach is dead weight");
}

/* ---- refusal ----------------------------------------------------------- */
const NONSENSE = [
  "what is the airspeed velocity of an unladen swallow",
  "should they take creatine",
  "is this a good training plan",
  "what will they weigh next month",
  "why are they tired",
  "",
];
for (const q of NONSENSE) {
  const a = Ask.answer(q, query);
  ok(`refuses: "${q || "(empty)"}"`, a === null || a.kind === "refusal",
     a && a.kind === "answer" ? `answered via ${a.matched}: ${strip(a.text).slice(0, 80)}` : "");
}

/* ---- qualifiers refuse rather than answering the un-qualified question --
 * Every one of these returned a confident paragraph about a DIFFERENT
 * question before the guard existed, which is the failure the whole design
 * claims to prevent. */
const QUALIFIED = [
  "how many runs did i do in june",
  "how much did i walk last week",
  "what is my average weekly mileage",
  "how does june compare to may",
  "how many steps did i do last week",
];
for (const q of QUALIFIED) {
  const a = Ask.answer(q, query);
  ok(`qualifier refused: "${q}"`, a.kind === "refusal",
     a.kind === "answer" ? `answered via ${a.matched}: ${strip(a.text).slice(0, 70)}` : "");
}

/* ---- grounding --------------------------------------------------------- */
function grounds(rows) {
  const nums = new Set(), strs = new Set();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  for (const r of rows) for (const c of cols) {
    const v = r[c];
    if (v === null || v === undefined) continue;
    if (typeof v === "number" || typeof v === "bigint") {
      nums.add(Number(v)); nums.add(Math.abs(Number(v)));
    } else strs.add(String(v));
  }
  nums.add(rows.length);
  for (const c of cols) {
    const tally = new Map();
    for (const r of rows) {
      const k = String(r[c]); tally.set(k, (tally.get(k) || 0) + 1);
    }
    for (const n of tally.values()) { nums.add(n); nums.add(rows.length - n); }
  }
  return { nums, strs };
}

function supported(tok, g) {
  const n = Number(tok.replace(/,/g, ""));
  if (!Number.isFinite(n)) return true;
  for (const h of g.nums) {
    if (h === n) return true;
    for (const dp of [0, 1, 2]) if (Number(h.toFixed(dp)) === n) return true;
  }
  for (const s of g.strs) if (s.includes(tok)) return true;
  return false;
}

const GROUND_QS = [...Object.values(CANONICAL),
                   "how is the running goal doing", "how many walks",
                   "what happened on 2030-06-09", "how is the steps goal",
                   "what is the heaviest weigh-in", "hows my mood been",
                   "fastest 5k", "best marathon",
                   "what is my hardest session", "can i run today"];
for (const q of GROUND_QS) {
  const a = Ask.answer(q, query);
  if (!a || a.kind !== "answer" || !a.sql) continue;
  // Grounds are computed PER QUERY and unioned, not over the concatenated
  // rows. `grounds` reads its columns from the first row, so a flat list of
  // rows from two different tables silently examined only the first table's
  // columns - which is how a session distance read as unsupported while its
  // query was cited perfectly well.
  const g = { nums: new Set(), strs: new Set() };
  for (const q of (Array.isArray(a.sql) ? a.sql : [a.sql])) {
    const one = grounds(query(q));
    for (const n of one.nums) g.nums.add(n);
    for (const t of one.strs) g.strs.add(t);
  }
  const text = strip(a.text);
  // A DURATION IS A NOTATION, NOT A DERIVATION. "60:09" is the stored 3609.4
  // seconds written differently - the same number, a different unit - so it
  // is checked as a whole against the seconds in the rows rather than as the
  // two orphan integers 60 and 09. Splitting it first was the checker being
  // stricter than the rule it enforces.
  let rest = text;
  const clockOk = [];
  for (const m of text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []) {
    const parts = m.split(":").map(Number);
    const secs = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
    // Supported if some stored value rounds to it at whole-second precision.
    const ok = [...g.nums].some(h => Math.abs(h - secs) < 1);
    if (ok) { clockOk.push(m); rest = rest.split(m).join(" "); }
  }
  // A DISTANCE IN KILOMETRES IS THE SAME NUMBER AS ONE IN METRES. "10k"
  // against a stored `distance_m` of 10000 is a unit, not a derivation - the
  // same class as the clock notation above. Checked before the orphan scan so
  // the "10" never reaches it alone.
  for (const m of rest.match(/\b\d+(?:\.\d+)?\s*k(?:m)?\b/gi) || []) {
    const n = parseFloat(m);
    if ([...g.nums].some(h => Math.abs(h - n * 1000) < 1 || Math.abs(h - n) < 1e-9)) {
      rest = rest.split(m).join(" ");
    }
  }
  const orphans = (rest.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || [])
    .filter(t => !supported(t, g));
  ok(`grounded: "${q}"`, orphans.length === 0,
     orphans.length ? `unsupported: ${orphans.join(", ")}\n         ${text.slice(0, 150)}`
                    : "");
}

/* ---- adversarial input -------------------------------------------------
 * The payloads use block-comment syntax and a double hyphen with no trailing
 * space, so they stay valid SQL injections while the house style gate - which
 * bans the double-hyphen-with-spaces prose separator - keeps its rule intact.
 * Weakening a gate to accommodate a test is the wrong trade: the gate is cheap
 * and the payloads do not need that particular spelling.
 *
 * (Writing the block-comment characters out inside this comment closed it
 * early and broke the file, which is its own small lesson about escaping.) */
const HOSTILE = [
  "how is the '; DROP TABLE weight; --x goal doing",
  "what happened on 2030-06-16'; DELETE FROM daily WHERE '1'='1",
  "how many run' UNION SELECT * FROM sqlite_master /* */ sessions",
  "goals \" OR 1=1 --x",
  "weight'); ATTACH DATABASE '/tmp/x.db' AS x; --x",
];
for (const q of HOSTILE) {
  let a, threw = null;
  try { a = Ask.answer(q, query); } catch (e) { threw = e.message; }
  ok(`survives: ${q.slice(0, 42)}...`, threw === null && a && a.kind !== "broken",
     threw || (a && a.kind === "broken" ? strip(a.text).slice(0, 90) : ""));
}
// and the tables are all still there
const tables = query("SELECT name FROM sqlite_master WHERE type='table'").length;
ok(`the database still has its tables (${tables})`, tables > 20);

/* ---- an answer that cites must cite something that runs ---------------- */
for (const q of Object.values(CANONICAL)) {
  const a = Ask.answer(q, query);
  if (!a || !a.sql) continue;
  let err = null;
  try { for (const q of (Array.isArray(a.sql) ? a.sql : [a.sql])) query(q); }
  catch (e) { err = e.message; }
  ok(`citation runs: "${q}"`, err === null, err);
}

db.close();
console.log(failed ? `\n${failed} failing\n` : "\nall passing\n");
process.exit(failed ? 1 : 0);
