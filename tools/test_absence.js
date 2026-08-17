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

/* The two functions under test, lifted from index.html.
 *
 * The lens is a single file served statically with no build step, so there is
 * nothing to import. Keeping these in step with the page is a real cost and it
 * is the reason the last test below exists: it reads index.html and fails if
 * the vocabulary here has drifted from the vocabulary there.
 */
const ABSENT_REASON_WORDS = {
  "not-performed": "not measured",
  "unable-to-obtain": "attempted, nothing came back",
  "error": "measured, and rejected",
  "asked-declined": "asked, and preferred not to say",
  "asked-unknown": "asked, and does not know",
  "not-applicable": "does not apply here",
};

function absentReasonFor(row, col) {
  const reason = row && row.absent_reason;
  if (!reason) return null;
  const named = String(row.absent_fields || "")
    .split(",").map((f) => f.trim()).filter(Boolean);
  if (!named.includes(col)) return null;
  return ABSENT_REASON_WORDS[reason] || reason;
}

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

/* ---- the copy stays in step with the page ------------------------------ */

const fs = require("fs");
const path = require("path");
const page = fs.readFileSync(
  path.join(__dirname, "..", "index.html"), "utf8");

ok("the page declares the same vocabulary this file tests",
   Object.keys(ABSENT_REASON_WORDS).every((k) => page.includes(`"${k}"`))
     && Object.values(ABSENT_REASON_WORDS).every((v) => page.includes(v)),
   "index.html and this test have drifted apart");

ok("the page scopes the reason to named fields",
   page.includes("absent_fields") && page.includes("named.includes(col)"),
   "the scoping guard is missing from the page");

/* ---- and the honest statement about the fixture ------------------------ */

const { DatabaseSync } = require("node:sqlite");
const DB = path.join(__dirname, "..", "demo", "health.db");
let stated = 0;
try {
  const db = new DatabaseSync(DB, { readOnly: true });
  for (const t of ["weight", "daily", "sessions"]) {
    stated += db.prepare(
      `select count(*) c from ${t} where absent_reason is not null`).get().c;
  }
} catch (e) {
  console.log(`note  could not read the demo: ${e.message}`);
}
console.log(
  `note  the demo carries ${stated} row(s) with a stated absence. ` +
  (stated === 0
    ? "ZERO means nothing above is exercised end to end, and this client "
      + "could render the feature wrongly with every job green. Filed "
      + "against the engine's demo corpus."
    : "The demo now exercises this; assert on it here and delete this note."));

process.exit(failed ? 1 : 0);
