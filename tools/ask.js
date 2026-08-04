#!/usr/bin/env node
/* Ask the demo record a question from a terminal.
 *
 *   node tools/ask.js "what do they weigh"
 *   node tools/ask.js            # runs a spread of questions, for eyeballing
 */
"use strict";
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
global.Narrator = require("../narrator.js");
const Ask = require("../ask.js");

const db = new DatabaseSync(path.join(__dirname, "..", "demo", "health.db"),
                            { readOnly: true });
const query = (sql) => db.prepare(sql).all();

const strip = (h) => h.replace(/<q>/g, '"').replace(/<\/q>/g, '"')
  .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function wrap(s, w = 76, ind = "    ") {
  const out = []; let line = "";
  for (const word of s.split(/\s+/)) {
    if (line && (line + " " + word).length > w - ind.length) { out.push(ind + line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) out.push(ind + line);
  return out.join("\n");
}

const QUESTIONS = process.argv.slice(2).length ? [process.argv.slice(2).join(" ")] : [
  "what can you answer?",
  "how much do they weigh?",
  "how are the goals going?",
  "how is the running goal doing?",
  "how many runs are there?",
  "what happened on 2030-06-16?",
  "where did the numbers come from?",
  "did any sources disagree?",
  "are they restricted from anything?",
  "which days are missing?",
  "how did the weeks score?",
  "what is the airspeed velocity of an unladen swallow?",
];

for (const q of QUESTIONS) {
  const a = Ask.answer(q, query);
  const tag = a.kind === "answer" ? a.matched : a.kind.toUpperCase();
  console.log(`\n  > ${q}`);
  console.log(`    [${tag}]`);
  console.log(wrap(strip(a.text)));
}
db.close();
console.log();
