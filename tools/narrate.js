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
const BUILT_AGAINST_CONTRACT = "25";
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
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function wrap(s, width = 78, indent = "  ") {
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

const sections = Narrator.generate(query);
console.log(`\nvitai lens brief  (${path.basename(dbPath)}, contract ${contract})`);
for (const s of sections) {
  console.log(`\n${s.title.toUpperCase()}`);
  console.log("-".repeat(s.title.length));
  for (const m of s.messages) {
    console.log(wrap(text(m.text)));
    if (showSql && m.sql) console.log(wrap(m.sql, 78, "      | "));
    console.log("");
  }
}
db.close();
