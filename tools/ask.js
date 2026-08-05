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

/* BLOCK-LEVEL ELEMENTS BECOME NEWLINES, not nothing.
 *
 * `.chron` is `display: block` in the page, so a chronology renders as its own
 * indented line in the browser. Stripping the tag without replacing it ran the
 * sentences together - "kept a reason each time.2030-05-20 steps tightened" -
 * and a tester reading this CLI reported it as a formatting bug in the
 * PRODUCT. It was a bug in this inspector, and a misleading inspector produces
 * false findings, which cost more than the formatting would have. */
const strip = (h) => h.replace(/<q>/g, '"').replace(/<\/q>/g, '"')
  .replace(/<br\s*\/?>/g, "\n")
  .replace(/<(span|div|p)\b[^>]*class="[^"]*\b(chron|view)\b[^"]*"[^>]*>/g, "\n")
  .replace(/<\/(span|div|p)>\s*(?=<(span|div|p)\b[^>]*class="[^"]*chron)/g, "\n")
  .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/* Wraps each LINE, preserving the breaks the answer asked for.
 *
 * This split on all whitespace, so the newlines `strip` had just produced from
 * `<br>` were swallowed and four dated plan changes arrived as one paragraph.
 * The page renders them on separate lines; only this inspector ran them
 * together, and a tester reported it as a formatting bug in the product. */
function wrap(s, w = 76, ind = "    ") {
  const out = [];
  for (const para of String(s).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > w - ind.length) {
        out.push(ind + line); line = word;
      } else line = line ? line + " " + word : word;
    }
    if (line) out.push(ind + line);
  }
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
