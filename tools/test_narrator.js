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

const strip = (html) => html
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

/* ---- no message is empty or unterminated ------------------------------- */
for (const m of messages) {
  const t = strip(m.text).trim();
  ok(`${m.rule}: reads as a sentence`, t.length > 20 && /[.!?]$/.test(t),
     t.slice(-60));
}

db.close();
console.log(failed ? `\n${failed} failing\n` : "\nall passing\n");
process.exit(failed ? 1 : 0);
