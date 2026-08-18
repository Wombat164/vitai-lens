#!/usr/bin/env node
/* Contract 51's absence pair, and why this file exists at all.
 *
 *   node tools/test_absence.js
 *
 * RULES.md is explicit that "'Nothing recorded', 'computed and declined', and
 * 'not applicable' are three different statements and must read as three
 * different things", and that a client collapsing every reason into one grey
 * square "has thrown away the distinction the engine paid for". Until contract
 * 51 an observation row could not state a reason, so one string WAS the whole
 * truth. Now it can, and this checks the lens says the difference.
 *
 * WHY THIS IS A UNIT TEST AND NOT A DEMO ASSERTION, which is the finding worth
 * carrying: `examples/demo` in the engine repo contains ZERO rows with an
 * `absent_reason`, across weight, daily and sessions. So the conformance job
 * can rebuild the demo at contract 53, this client can render nothing new, and
 * every test passes - the exact "silent partial success" RULES.md names as the
 * failure mode the project exists to avoid.
 *
 * A fixture that does not exercise a feature cannot prove a client handles it.
 * Filed against the engine; until it lands, these rows are synthetic and are
 * clearly marked as such rather than pretending the demo covers this.
 */
"use strict";

let failed = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`ok    ${name}`); return; }
  failed += 1;
  console.log(`FAIL  ${name}${detail ? "\n      " + detail : ""}`);
}

/* The two functions under test, REQUIRED rather than reimplemented.
 *
 * This file used to carry its own copy of both, "lifted from index.html",
 * with a test further down that read the page and failed if the two had
 * drifted. That was guarding a real risk: the page and this file could
 * disagree and every job would stay green. But a copy checked for drift is a
 * weaker arrangement than no copy, and it had the specific weakness that these
 * tests exercised the copy - so they proved things about code the page does
 * not run.
 *
 * Both now live in `ask.js`, which the page loads above its own script and
 * reads them from. These tests exercise the real ones. What survives of the
 * old drift check is the half that still means something: that the page has
 * not gone back to declaring its own.
 */
global.Narrator = require("../narrator.js");
const Ask = require("../ask.js");
const ABSENT_REASON_WORDS = Ask.ABSENT_REASON_WORDS;
const absentReasonFor = Ask.absentReasonFor;

/* ---- the distinction the engine paid for ------------------------------- */

ok("every declared reason renders as its own words",
   new Set(Object.values(ABSENT_REASON_WORDS)).size
     === Object.keys(ABSENT_REASON_WORDS).length,
   "two reasons share a phrase, which is the collapse RULES.md forbids");

ok("a reason renders instead of the generic phrase",
   absentReasonFor({ absent_fields: "kcal", absent_reason: "asked-unknown" },
                   "kcal") === "asked, and does not know");

ok("AN ABSENCE WITH NO REASON IS STILL PLAIN",
   absentReasonFor({ absent_fields: null, absent_reason: null }, "kcal")
     === null,
   "an unexplained absence must not borrow an explanation");

/* The scoping test, and it is the one that matters most. Contract 51 made this
 * two fields rather than one parsed string precisely so a reason cannot float
 * free of the value it explains. A reason naming `kcal` says nothing about
 * `steps`, and rendering it there would attach an explanation to the wrong
 * hole. */
ok("A REASON DOES NOT LEAK TO A FIELD IT DOES NOT NAME",
   absentReasonFor({ absent_fields: "kcal", absent_reason: "asked-unknown" },
                   "steps") === null);

ok("a reason naming several fields covers each of them",
   absentReasonFor({ absent_fields: "steps,distance_km",
                     absent_reason: "unable-to-obtain" }, "distance_km")
     === "attempted, nothing came back");

/* An engine that learns a seventh reason must not have it silently flattened
 * back into "not recorded" - that would hide the fact the engine grew, which
 * is the one thing a conformance client exists to notice. */
ok("AN UNRECOGNISED REASON RENDERS ITSELF",
   absentReasonFor({ absent_fields: "kg", absent_reason: "some-future-code" },
                   "kg") === "some-future-code");

/* ---- the page has not grown its own copy back --------------------------- */

const fs = require("fs");
const path = require("path");
const page = fs.readFileSync(
  path.join(__dirname, "..", "index.html"), "utf8");

/* WHAT IS LEFT TO CHECK, now that there is one definition. Not that two copies
 * agree - there is only one - but that the page still READS it. A future edit
 * that pastes the vocabulary back into index.html would restore the drift this
 * change removed, and it would do so silently, because every assertion above
 * would still pass against `ask.js`. */
ok("the page reads the vocabulary rather than declaring one",
   page.includes("Ask.ABSENT_REASON_WORDS")
     && page.includes("Ask.absentReasonFor")
     && !/const ABSENT_REASON_WORDS = \{/.test(page),
   "index.html declares its own copy again");

/* ---- and now the fixture answers back ----------------------------------
 *
 * This block used to print a note saying the engine's demo carried ZERO rows
 * with a stated absence, so nothing above was exercised end to end and this
 * client could render the feature wrongly with every job green. It was filed
 * against the engine's demo corpus and it LANDED: vitai #427 put every
 * published code into the artifact clients read, and #430 gave the demo its
 * first stated absences.
 *
 * So the note becomes assertions, which is what it asked for. What they check
 * is deliberately not "the demo has N rows" - that would break every time the
 * corpus grows, which is the lesson `test_ask.js` already carries in its own
 * comment. They check PROPERTIES: that the feature is exercised at all, that
 * every code the demo actually uses is one this client can say, and that a
 * reason found in the record scopes to the field it names.
 */

const { DatabaseSync } = require("node:sqlite");
const DB = path.join(__dirname, "..", "demo", "health.db");
const TABLES = ["weight", "daily", "sessions"];

let db = null;
try {
  db = new DatabaseSync(DB, { readOnly: true });
} catch (e) {
  ok("the demo can be read", false, e.message);
}

if (db) {
  const rows = [];
  for (const t of TABLES) {
    for (const r of db.prepare(
      `select absent_fields, absent_reason from ${t} ` +
      "where absent_reason is not null").all()) rows.push({ table: t, ...r });
  }

  /* THE FIXTURE MUST EXERCISE THE FEATURE. Zero is the state that made every
   * assertion above theatre, and it is the one worth failing on rather than
   * noting: a client whose absence handling is only ever tested against rows
   * it invented itself has not been tested against the engine. */
  ok("the demo carries stated absences at all",
     rows.length > 0,
     "zero rows with an absent_reason: nothing above is exercised end to end, "
     + "and this client could render the feature wrongly with every job green");

  /* Not "all six codes appear" - which code an engine chooses to demonstrate
   * is the engine's business, and asserting the set here would make this file
   * fail when vitai edits its corpus for reasons of its own. What must hold is
   * that whatever it DOES use, this client has words for. */
  const unknown = [...new Set(rows.map((r) => r.absent_reason))]
    .filter((code) => !(code in ABSENT_REASON_WORDS));
  ok("every reason the demo uses is one this client can say",
     unknown.length === 0,
     unknown.length
       ? `the engine emits ${unknown.join(", ")} and this client has no words `
         + "for it, so it renders as its own code - correct behaviour, and a "
         + "sign the vocabulary is behind the engine"
       : "");

  /* The scoping property, checked against real rows rather than composed
   * ones. Every row in the record that states a reason must render it for a
   * field it names, and must not render it for one it does not. */
  const leaked = rows.filter((r) => {
    const named = String(r.absent_fields || "").split(",")
      .map((f) => f.trim()).filter(Boolean);
    if (!named.length) return true;
    const rendersNamed = named.every((f) => absentReasonFor(r, f) !== null);
    return !rendersNamed || absentReasonFor(r, "a_field_no_row_names") !== null;
  });
  ok("every stated absence in the record scopes to the fields it names",
     leaked.length === 0,
     leaked.length ? JSON.stringify(leaked[0]) : "");

  console.log(`note  ${rows.length} stated absence(s) across `
              + `${TABLES.join(", ")}, using `
              + `${new Set(rows.map((r) => r.absent_reason)).size} of `
              + `${Object.keys(ABSENT_REASON_WORDS).length} known reasons.`);
}

process.exit(failed ? 1 : 0);
