#!/usr/bin/env node
/* Run the narrator against a health.db and print the brief as plain text.
 *
 * The same rules the page uses, with no browser in the way, so the generator
 * can be diffed and tested. Usage:
 *
 *   node tools/narrate.js [path/to/health.db] [--sql]
 *
 * --sql also prints the query behind each message, which is the terminal
 * equivalent of the page's "show the rows" control.
 */
"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const Narrator = require("../narrator.js");

const args = process.argv.slice(2);
const showSql = args.includes("--sql");
const dbPath = args.find(a => !a.startsWith("--"))
  || path.join(__dirname, "..", "demo", "health.db");

const db = new DatabaseSync(dbPath, { readOnly: true });
const query = (sql) => db.prepare(sql).all();

const contract = (() => {
  try {
    const r = query("SELECT value FROM meta WHERE key = 'contract'");
    return r.length ? String(r[0].value) : null;
  } catch { return null; }
})();

/* The same refusal the page makes, for the same reason: a brief generated
 * against the wrong contract would read as complete while silently dropping
 * whatever that contract added. */
const BUILT_AGAINST_CONTRACT = "29";
if (contract !== BUILT_AGAINST_CONTRACT) {
  console.error(
    `refused: this narrator was built against contract ${BUILT_AGAINST_CONTRACT}, ` +
    `and ${dbPath} reports ${contract ?? "no contract at all"}.`);
  process.exit(2);
}

/* Strip the markup the page needs and the terminal does not. Quotes survive as
 * quotes because the narrator uses <q> exactly where it is reproducing the
 * engine's own words, and losing that distinction in the text rendering would
 * lose the only signal that a sentence is not the narrator's. */
const text = (html) => html
  .replace(/<q>/g, '"').replace(/<\/q>/g, '"')
  .replace(/<span class="chron">/g, "\n")  // the chronology block opens
  .replace(/<\/span><br\s*\/?>/g, "\n\n")  // and closes, before prose resumes
  .replace(/<br\s*\/?>/g, "\n")            // its own lines in between
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function wrap(s, width = 78, indent = "  ") {
  // Wrap each hard line separately, so line structure the narrator asked for
  // survives. Continuation lines hang, which is what makes a chronology read
  // as a chronology in a terminal.
  if (s.includes("\n"))
    return s.split("\n").map((ln, i) =>
      wrap(ln, width, i === 0 ? indent : indent + "  ")).join("\n");
  const out = [];
  let line = "";
  for (const w of s.split(/\s+/)) {
    if (line && (line + " " + w).length > width - indent.length) {
      out.push(indent + line); line = w;
    } else line = line ? line + " " + w : w;
  }
  if (line) out.push(indent + line);
  return out.join("\n");
}

/* Page order: the brief, then each chart's own note, then the record band.
 * Chart sections carry no title on the page, because the chart heading is
 * their title. In a terminal there is no chart, so they borrow one. */
const CHART_TITLE = {
  "c-weight": "On the weight chart",
  "c-heat": "On the daily-steps heatmap",
  "c-verd": "On the goal-attainment verdicts",
  "c-resolution": "On where two sources disagreed",
};

const mounts = Narrator.generate(query);
const order = ["brief", ...Object.keys(CHART_TITLE), "record"];

console.log(`\nvitai lens brief  (${path.basename(dbPath)}, contract ${contract})`);
for (const mount of order) {
  for (const s of mounts[mount] || []) {
    const title = s.title || CHART_TITLE[mount] || mount;
    console.log(`\n${title.toUpperCase()}`);
    console.log("-".repeat(title.length));
    for (const m of s.messages) {
      console.log(wrap(text(m.text)));
      if (showSql && m.sql) console.log(wrap(m.sql, 78, "      | "));
      console.log("");
    }
  }
}
db.close();
