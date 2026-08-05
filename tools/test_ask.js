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
  "session-weeks": "how many km a week do i run",
  nutrition: "how much protein did i eat",
  "medical-provenance": "who recorded the achilles entry",
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
/* "how much did i walk last week" WAS here, and moved to the grounded set when
 * contract 28 landed. It was not deleted to make a build green: the assertion
 * encoded a limitation rather than a rule. Nothing could scope to a period, so
 * every window was unhonourable and refusing was the honest answer. The engine
 * now emits a table whose grain IS the week, so scoping to one is a WHERE
 * clause rather than arithmetic, and refusing would be the engine's own answer
 * being withheld.
 *
 * The guard it was testing is still tested, twice over: "in june" is a window
 * no table here has, and "last week" on STEPS is a week window on a metric
 * sessions do not carry. Both still refuse. */
/* "how many runs did i do in june" was here too, and moved for the same
 * reason the walk question did: it asserted a limitation rather than a rule.
 * Counting inside a window is `WHERE` + `COUNT`, both of which RULES.md
 * permits, so refusing it was withholding an answer the database gives.
 *
 * The window guard is still tested by "last week" on STEPS - a daily metric,
 * whose answer cannot scope - and the comparison and average guards by the
 * two entries below them. */
const QUALIFIED = [
  "what is my average weekly mileage",
  "how does june compare to may",
  "how many steps did i do last week",
];
for (const q of QUALIFIED) {
  const a = Ask.answer(q, query);
  ok(`qualifier refused: "${q}"`, a.kind === "refusal",
     a.kind === "answer" ? `answered via ${a.matched}: ${strip(a.text).slice(0, 70)}` : "");
}

/* ---- keyword misfires, and the controls that prove the rule survived ----
 * Each pair is a word with two meanings. The first assertion is that the
 * common meaning no longer trips a rule written for the other; the second is
 * that the rule still fires when the word means what the rule is about.
 * Without the control, every one of these "fixes" could be a loosening. */
{
  const kind = (q) => Ask.answer(q, query).kind;
  const said = (q) => strip(Ask.answer(q, query).text || "");

  // `mean` as a verb. Refused as a request for an average.
  ok("'doesnt that mean' is not a request for an average",
     kind("pain is 0 now, doesnt that mean im healed") !== "refusal");
  ok("'no I mean' is not a request for an average",
     kind("no I mean specifically the weight measurements") !== "refusal");
  ok("CONTROL: a real mean is still refused",
     kind("whats the mean of my weight") === "refusal");
  ok("CONTROL: an average is still refused",
     kind("whats my average weight") === "refusal");

  // `total` as an adjective on a count. Counting rows is permitted.
  ok("'how many total' is a count, not arithmetic",
     kind("how many total sessions have I logged") !== "refusal");
  ok("CONTROL: a bare total is still refused",
     kind("what is my total distance") === "refusal");

  // `right now` is a time, not a value judgement.
  ok("'right now' does not trip the judgment veto",
     kind("am I restricted from anything right now") === "answer");
  ok("CONTROL: a judgment is still refused",
     kind("is this plan any good") === "refusal");
  ok("CONTROL: advice is still refused",
     kind("should I take creatine") === "refusal");

  // Selecting the newest row is the same operation as selecting the largest.
  ok("'most recent run' selects a row rather than refusing",
     /most recent run in the record is/i.test(said("whats my most recent run")),
     said("whats my most recent run").slice(0, 70));
  ok("'latest run' selects the same row",
     /2030-06-30/.test(said("whats my latest run")));
  ok("a date-ordered pick prints no NaN",
     !/nan/i.test(said("whats my most recent run")),
     said("whats my most recent run").slice(0, 70));
  ok("CONTROL: the largest is still selected by magnitude",
     /longest run in the record/i.test(said("what is my longest run")));
}

/* ---- a streak is refused, not substituted -------------------------------
 * "How many weeks in a row have I been on target for steps" returned the
 * latest single-week snapshot - 85% - with nothing saying it was not a
 * streak. A reader not watching closely takes that as the answer. */
{
  const a = (q) => Ask.answer(q, query);
  const t = (q) => strip(a(q).text || "");

  ok("a streak question refuses", a("how many weeks in a row have I been on target for steps").kind === "refusal");
  ok("and it gives the streak reason, not the ambiguity one",
     /nothing here can count one/.test(t("how many weeks in a row have I been on target for steps")),
     t("how many weeks in a row have I been on target for steps").slice(0, 80));
  ok("no substituted percentage appears in it",
     !/85|%/.test(t("how many weeks in a row have I been on target for steps")));
  ok("other streak phrasings refuse too",
     a("whats my longest streak").kind === "refusal" &&
     a("how many consecutive weeks on target").kind === "refusal");
  ok("CONTROL: a plain goals question still answers",
     a("how are the goals going").kind === "answer");
}

/* ---- the weight answer is not a fixed template --------------------------
 * Every weight question returned the same sentence about the latest reading,
 * including "how many weigh-ins came from the scale". A tester asked five
 * ways and got one reply - an answer wearing the clothes of a different one. */
{
  const t = (q) => strip(Ask.answer(q, query).text || "");

  ok("a scoped count is scoped",
     /26 from scale/.test(t("how many weigh ins came from the scale")),
     t("how many weigh ins came from the scale").slice(0, 70));
  ok("unknown origin counts the nulls, not the total",
     /32 of 60/.test(t("how many weigh-ins have unknown origin")),
     t("how many weigh-ins have unknown origin").slice(0, 70));
  ok("an unscoped count breaks down by the record's own origins",
     /60 weigh-ins, by origin/.test(t("how many weigh ins are there")),
     t("how many weigh ins are there").slice(0, 70));
  ok("CONTROL: the default is still the latest reading",
     /last weigh-in is/.test(t("what do they weigh")));
  ok("CONTROL: it still refuses to say up or down",
     /not going to tell you whether that is up or down/.test(t("what do they weigh")));

  // `norm` keeps hyphens for slugs and dates, so "weigh-ins" did not match
  // the metric word `weigh` while "weigh ins" did - the same question routing
  // two ways on a hyphen, and the hyphenated spelling is the commoner one.
  ok("a hyphenated word fills the same slot as the spaced one",
     t("how many weigh-ins have unknown origin") ===
     t("how many weigh ins have unknown origin"));
  ok("CONTROL: a hyphenated SLUG still resolves",
     /hop-test/.test(t("did I pass the hop-test")));
  ok("CONTROL: a date still resolves",
     /2030-06-16/.test(t("what happened on 2030-06-16")));
}

/* ---- counting inside a window is ours; totalling is not -----------------
 * The line these pin: `WHERE` + `COUNT` is selection and belongs here;
 * `WHERE` + `SUM` is a figure the engine has to stand behind. They look
 * identical until you ask what is being done to the window. */
{
  const t = (q) => strip(Ask.answer(q, query).text || "");
  const k = (q) => Ask.answer(q, query).kind;

  ok("a month scopes a count", /12 run sessions in june 2030/i.test(t("how many runs did i do in june")),
     t("how many runs did i do in june").slice(0, 70));
  ok("the year comes from the record, not the clock",
     /2030/.test(t("how many runs did i do in june")));
  ok("a month with no sessions of that type says so, scoped",
     /no swim session is recorded in june 2030/i.test(t("how many swims in june")),
     t("how many swims in june").slice(0, 70));
  ok("a window it cannot resolve is refused by name, not widened",
     /month or a year/.test(t("how many runs did i do lately")),
     t("how many runs did i do lately").slice(0, 70));
  ok("CONTROL: unscoped still counts the whole record",
     /28 run sessions/.test(t("how many runs did i do")));
  ok("CONTROL: a windowed TOTAL is still refused",
     k("what is my total distance in june") === "refusal");
  ok("plurals of every session type are recognised",
     !/did not understand/i.test(t("how many rides did I do")));
}

/* ---- Phase 1: the router refuses rather than guessing -------------------
 * Registration order was deciding what a question meant whenever two intents
 * tied. `matchGoal` already refused a tie for the same reason; this is that
 * rule one level up, applied to the choice of QUESTION rather than of row. */
{
  const a = (q) => Ask.answer(q, query);

  // A word that is decisive should beat one matched incidentally, or the tie
  // rule turns every loose question into a refusal.
  ok("the literal word 'goal' settles a goals question",
     a("how did I do against my step goal").matched === "goals");
  ok("the dataset noun settles a sessions question",
     a("how many sessions have I logged").matched === "sessions",
     `matched ${a("how many sessions have I logged").matched}`);
  ok("CONTROL: coverage still owns its own question",
     a("which days are missing").matched === "coverage");

  // `record` is a noun here far more often than a superlative, and it had no
  // EXTREMES entry at all - so it could only ever block a question.
  ok("'my record' is not a request for a personal best",
     a("has anything in my record been corrected").matched === "corrections",
     `matched ${a("has anything in my record been corrected").matched}`);
  ok("CONTROL: a real superlative still routes",
     a("what is my longest run").matched === "extremum");
  ok("CONTROL: a best effort still routes",
     a("what is my best 10k").matched === "best-effort");

  // The tie rule itself. Without this the rule is inert: every other
  // assertion here passes with it disabled, because the decisiveness fixes
  // resolve those cases before a tie can happen. "How am I doing on steps"
  // genuinely reads two ways - the steps GOAL at 85%, or the steps METRIC -
  // and nothing in the question chooses.
  {
    const amb = a("how am I doing on steps");
    ok("a genuine tie refuses instead of picking",
       amb.kind === "refusal", `got ${amb.kind} via ${amb.matched}`);
    ok("and it names both readings",
       /goals/.test(strip(amb.text)) && /daily-metric/.test(strip(amb.text)),
       strip(amb.text).slice(0, 90));
  }

  // The sceptic's phrasing of the correction question.
  ok("'silently overwrite' reaches the corrections answer",
     a("did the engine ever silently overwrite a value without telling me")
       .matched === "corrections");
}

/* ---- conflicts honours the metric it was asked about --------------------
 * Two questions naming different metrics returned byte-identical output,
 * listing fields that included neither. Quietly widening a question to the
 * whole record reads as an answer and is about something else. */
{
  const hr = strip(Ask.answer("did any sources disagree about my heart rate", query).text || "");
  const sleep = strip(Ask.answer("did any sources disagree about my sleep", query).text || "");
  const kcal = strip(Ask.answer("did any sources disagree about calories", query).text || "");
  ok("two different metrics do not get the same answer", hr !== sleep,
     hr.slice(0, 60));
  ok("a metric with a disagreement is scoped to it",
     /kcal_in/.test(kcal) && !/protein_g/.test(kcal), kcal.slice(0, 70));
  ok("a metric with none says so, and says what did disagree",
     /No two sources disagreed about/i.test(hr) && /did disagree over/i.test(hr),
     hr.slice(0, 80));
  ok("CONTROL: unscoped still reports the whole record",
     /18/.test(strip(Ask.answer("did any sources disagree", query).text || "")));
}

/* ---- on-date: a stale claim about the record is worse than a missing one -
 * This said "for which it declares no scale" unconditionally, and contract 26
 * had made it false: the demo carries `nrs-0-10` on the very rows it denied. */
{
  const t = strip(Ask.answer("what happened on 2030-06-30", query).text || "");
  ok("on-date does not deny a scale the record declares",
     !/declares no scale/i.test(t), t.slice(0, 100));
  ok("on-date names the declared scale",
     /nrs-0-10/.test(t), t.slice(0, 100));
  ok("on-date addresses the reader rather than a third party",
     !/\bhe reported\b|\bhis own\b/i.test(t), t.slice(0, 100));
}

/* ---- routing: the wrong row is worse than no row ------------------------
 * Three testers independently led with the same failure, and none of them
 * reported a wrong NUMBER. They reported a well-formed sentence about a
 * different goal, which is the answer shape this page has no defence against
 * unless the router refuses the way the arithmetic does.
 *
 * All three cases below produced a confident wrong answer before these tests
 * existed. */
{
  const goal = (q) => strip(Ask.answer(q, query).text || "");

  // "Enjoy running AGAIN" matched "how did I do AGAINST my step goal" on a
  // substring, won outright, and said nothing could score it - about a goal
  // scored at 85% one row away.
  ok("a goal word is matched as a word, not as a substring",
     /77k steps|steps a week/i.test(goal("how did I do against my step goal")),
     goal("how did I do against my step goal").slice(0, 80));

  // Three goal titles end in "a week", so one shared word picked whichever
  // came first. An indecisive match must list rather than guess.
  {
    const t = goal("whats my progress on the 30 km a week goal");
    ok("an indecisive goal match lists them instead of picking one",
       /goals:/i.test(t) && /Build to 30 km/i.test(t), t.slice(0, 80));
  }

  // A decisive match must still win, or the fix above would have turned every
  // goal question into a list.
  ok("a decisive goal match still answers about that goal",
     /Build to 30 km a week/i.test(goal("hows the running goal doing")),
     goal("hows the running goal doing").slice(0, 80));

  // The session-weeks intent shipped matching `a week`, which is inside the
  // title of the running goal, so asking how that goal was going returned a
  // raw weekly dump instead of 77%.
  ok("a goal-shaped question does not fall into the weekly-volume intent",
     Ask.answer("how am I doing on the 30 km a week goal", query).matched !== "session-weeks",
     `matched ${Ask.answer("how am I doing on the 30 km a week goal", query).matched}`);
}

/* ---- session-weeks: an empty result is scoped by whatever scoped it ------
 * Asked how much they walked last week, the first cut said the record held no
 * walk session AT ALL - true of that week, false of the record, and stated as
 * though it were the second. Grounding cannot catch it: both sentences are
 * made of numbers that came from rows. It needs an assertion about what the
 * answer CLAIMS, which is what this is.
 *
 * The demo's latest week holds runs and no walks, and earlier weeks hold
 * walks, so it exercises the distinction as long as that stays true - which
 * the second assertion checks rather than assumes. */
{
  const a = Ask.answer("how much did i walk last week", query);
  const text = strip(a.text || "");
  const walkWeeks = query(
    "SELECT COUNT(*) AS n FROM session_weeks WHERE type = 'walk' AND sessions > 0");
  ok("the demo still exercises the quiet-week case",
     Number(walkWeeks[0].n) > 0,
     "no walk weeks in the demo, so this pair of tests proves nothing");
  ok("a quiet week is not reported as an empty record",
     a.kind === "answer" && !/no walk session at all/i.test(text),
     `said: ${text.slice(0, 90)}`);
  ok("and it says when the activity last happened",
     a.kind === "answer" && /latest is in the week of/i.test(text),
     `said: ${text.slice(0, 90)}`);
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
                   "what is my hardest session", "can i run today",
                   /* session-weeks, all three branches: the scoped week, a
                    * scoped week the type is absent from, and the whole table
                    * with a null distance in it. */
                   "how far did i run last week",
                   "how much did i walk last week",
                   "how much did i train each week"];
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
