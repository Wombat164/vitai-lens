/* Ask: a natural-language interface to the read model.
 *
 * It behaves like asking a language model a question about the athlete, and it
 * is not one. Free text goes in, prose comes out, and every answer carries the
 * query that produced it. What it will not do is answer a question it did not
 * understand - it says so, and says what it can answer instead. That is the
 * difference the whole page exists to make: a model that misreads a question
 * still produces a fluent paragraph, and a fluent paragraph about someone's
 * body is indistinguishable from a correct one until you check.
 *
 * ## Prior art
 *
 * Natural-language interfaces to databases are older than the relational model
 * itself. BASEBALL (Green et al., 1961) answered questions about a season's
 * games; LUNAR (Woods, 1973) let geologists query the Apollo sample database in
 * English and answered around three quarters of what was asked of it at a
 * conference, unrehearsed; CHAT-80 (Warren and Pereira, 1982) mapped English to
 * logic over a geography database and is still the textbook example. PRECISE
 * (Popescu et al., 2003) made the useful move for this file: rather than trying
 * to parse arbitrary English, it identified the subset of questions that map
 * unambiguously onto database elements, and REFUSED the rest instead of
 * guessing - "semantically tractable" is their term, and refusing the remainder
 * is what made the answers trustworthy.
 *
 * That is the design here, with the same trade deliberately made. The pipeline
 * is intent classification and slot filling over a closed schema, and the
 * intent selects a PARAMETERISED query. No SQL is ever built from user text.
 * Answers are realised through the same four-stage NLG the brief uses.
 *
 * ## What it may say
 *
 * The narrator's rule, unchanged: it may state what the engine stated, and how
 * many times the engine stated it, and may not derive a new quantity from the
 * values. So "how many runs" is a COUNT and allowed; "how far did I run in
 * total" is a SUM over values and is NOT, and is answered from the engine's own
 * weekly figures or refused. A question this page cannot answer without
 * computing is a finding about the engine, not a gap to paper over - which is
 * exactly what the lens is for.
 */
"use strict";

const Ask = (() => {

  const N = Narrator._internal;      // listify, plural, num, count, quantity

  const esc = (s) => String(s).replace(/[&<>]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // Handlers interpolate a count or a title at position zero often enough that
  // leaving this to each one guarantees one of them forgets.
  const cap = (s) => s.replace(/^(<[^>]+>)*[a-z]/,
    m => m.slice(0, -1) + m.slice(-1).toUpperCase());

  /* ---- the lexicon ------------------------------------------------------
   * Words to schema. Kept as data rather than buried in regexes so that what
   * this thing understands is a list somebody can read and extend, and so the
   * answer to "why didn't it get that" is a lookup rather than an autopsy. */

  const METRIC_WORDS = {
    weight: "kg", kg: "kg", weigh: "kg", scale: "kg", mass: "kg",
    step: "steps", steps: "steps", walking: "steps",
    run: "distance_km", running: "distance_km", ran: "distance_km",
    distance: "distance_km", km: "distance_km", mileage: "distance_km",
    sleep: "sleep_h", slept: "sleep_h",
    calorie: "kcal_in", calories: "kcal_in", kcal: "kcal_in", eat: "kcal_in",
    eating: "kcal_in", ate: "kcal_in", intake: "kcal_in",
    protein: "protein_g",
    rhr: "rhr", "resting": "rhr", pulse: "rhr",
    active: "active_min", minutes: "active_min",
    heart: "avg_hr", hr: "avg_hr", bpm: "avg_hr",
  };

  const SESSION_WORDS = {
    run: "run", runs: "run", running: "run", ran: "run", jog: "run",
    walk: "walk", walks: "walk", walking: "walk", walked: "walk",
    ride: "cycle", cycling: "cycle", bike: "cycle", cycle: "cycle",
    swim: "swim", swimming: "swim", swam: "swim",
    strength: "strength", gym: "strength", lift: "strength", lifting: "strength",
    row: "row", rowing: "row", erg: "row",
  };

  const STOP = new Set(("a an the my me i is are was were do does did of on in "
    + "at for to how what when much many any some have has had been about "
    + "and or so that this it its am pm please tell show give").split(" "));

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s:_-]/g, " ")
    .replace(/\s+/g, " ").trim();

  /* ---- slot filling ----------------------------------------------------- */

  function slots(q) {
    const words = norm(q).split(" ").filter(w => w && !STOP.has(w));
    const out = { words, metric: null, sessionType: null, date: null,
                  goal: null, wantsList: false };
    for (const w of words) {
      if (!out.metric && METRIC_WORDS[w]) out.metric = METRIC_WORDS[w];
      if (!out.sessionType && SESSION_WORDS[w]) out.sessionType = SESSION_WORDS[w];
    }
    const d = norm(q).match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (d) out.date = d[1];
    if (/\b(list|all|every|which|show me)\b/.test(norm(q))) out.wantsList = true;
    return out;
  }

  /* Goal slugs and titles come from the database, not from a hardcoded list,
   * so a record with different goals is askable about ITS goals. */
  function matchGoal(q, query) {
    const gs = query("SELECT slug, title FROM goal_progress");
    const n = norm(q);
    let best = null, bestScore = 0;
    for (const g of gs) {
      // The slug is the goal's NAME and counts for more than words that happen
      // to appear in its title. "the running goal" means the goal called
      // `running`, not the one whose title contains the word running - which is
      // how this first matched "Enjoy running again" against a 30 km target.
      const slugWords = norm(g.slug).split(" ").filter(w => w.length > 2);
      const titleWords = norm(g.title || "").split(" ")
        .filter(w => w.length > 3 && !STOP.has(w));
      const hits = slugWords.filter(w => n.includes(w)).length * 3
                 + titleWords.filter(w => n.includes(w)).length;
      if (hits > bestScore) { bestScore = hits; best = g; }
    }
    return bestScore > 0 ? best : null;
  }

  /* ---- the record's own "now" ------------------------------------------
   * "Lately" means lately for the ATHLETE, and this record ends in 2030. A
   * page that silently used the reader's clock would answer "nothing in the
   * last week" about a record that is four years old, which is true and
   * useless. The horizon is stated in the answers that depend on it. */
  function horizon(query) {
    const r = query("SELECT MAX(date) AS last FROM daily");
    return r.length ? r[0].last : null;
  }

  /* ---- intents ----------------------------------------------------------
   * Each scores itself against the question. The highest score above a floor
   * wins; nothing above the floor is a refusal, not a guess. Scores are small
   * integers on purpose - this is a keyword classifier and pretending
   * otherwise with weights would only make it harder to predict. */

  const INTENTS = [];
  const intent = (id, score, run) => INTENTS.push({ id, score, run });

  const has = (q, ...words) => words.some(w => new RegExp(`\\b${w}`).test(q));

  intent("help", (q) => has(q, "what can you", "help", "which questions",
                            "what do you know", "capabilities") ? 9 : 0,
    () => ({
      text: "I answer from the tables in this database and nothing else. Things " +
            "I can do: <em>what do they weigh</em>, <em>how are their goals " +
            "going</em>, <em>how many runs</em>, <em>what happened on " +
            "2030-06-16</em>, <em>where did the weight come from</em>, " +
            "<em>did any sources disagree</em>, <em>are they restricted from " +
            "anything</em>, <em>which days are missing</em>. " +
            "Ask in your own words. If I do not understand, I will say so " +
            "rather than produce something that reads like an answer.",
      sql: null,
    }));

  intent("gate", (q) => has(q, "gated", "restrict", "allowed", "can they",
                            "can i", "injur", "safe", "hurt", "pain") ? 6 : 0,
    (q, s, query) => {
      const sql = "SELECT date, slug, restricts, reason, severity, status, " +
                  "precondition, escalation FROM gates WHERE status <> 'cleared'";
      const rs = query(sql);
      if (!rs.length) {
        return { text: "Nothing is gated. The engine has no open restriction " +
                       "on this record right now, which is a statement about " +
                       "what it was told, not a clearance.", sql };
      }
      const g = rs[0];
      return {
        text: `Yes: <strong>${esc(g.restricts)}</strong> work is gated, from ` +
              `${esc(g.date)}. The engine's own words, not a paraphrase: ` +
              `<q>${esc(g.escalation)}</q> The condition it set is ` +
              `<code>${esc(g.precondition)}</code> and it currently reads ` +
              `<code>${esc(g.status)}</code>.`,
        sql,
      };
    });

  intent("weight", (q, s) => (s.metric === "kg" ? 5 : 0) +
    (has(q, "weigh", "weight", "heavy", "kg") ? 2 : 0),
    (q, s, query) => {
      const sql = "SELECT date, kg, origin, source, capture FROM weight " +
                  "WHERE kg IS NOT NULL ORDER BY date DESC LIMIT 1";
      const r = query(sql)[0];
      if (!r) return { text: "The record holds no weigh-ins.", sql };
      // The LATEST value, not a trend. A trend would be a quantity computed
      // here, and the engine does not emit one - so the honest answer names
      // the reading and its date and stops.
      return {
        text: `The last weigh-in is <strong>${N.num(r.kg, 1)} kg</strong> on ` +
              `${esc(r.date)}` +
              (r.origin ? `, origin <code>${esc(r.origin)}</code>.`
                        : `, with no origin recorded - the value is real, its ` +
                          `custody is not written down.`) +
              ` I am not going to tell you whether that is up or down: a trend ` +
              `is a quantity, this page does not compute quantities, and the ` +
              `engine does not emit one. The chart above shows every reading.`,
        sql,
      };
    });

  intent("goals", (q, s) => has(q, "goal", "target", "on track", "progress",
                                "doing", "aim") ? 5 : 0,
    (q, s, query) => {
      const g = matchGoal(q, query);
      if (g) {
        const sql = "SELECT slug, title, metric, period, target, counted, " +
                    "progress_pct, breach, lifecycle_status, achievement_status, " +
                    "verification, tracker FROM goal_progress WHERE slug = " +
                    `'${g.slug.replace(/'/g, "''")}'`;
        const r = query(sql)[0];
        if (r.target === null) {
          return {
            text: `<em>${esc(r.title)}</em> carries no number. ` +
                  (r.verification === "external"
                    ? `It is settled somewhere this engine cannot see` +
                      (r.tracker ? ` (${esc(r.tracker)})` : "") +
                      `, so there is a figure and it is not in here.`
                    : `It is true when they say it is, and nothing here can ` +
                      `score it. That is not a gap.`),
            sql,
          };
        }
        return {
          text: `<em>${esc(r.title)}</em>: ` +
                `${N.quantity(r.counted, r.target, r.metric, r.period)}, ` +
                `${N.num(r.progress_pct, 0)} per cent. The engine marks it ` +
                `<code>${esc(r.achievement_status || r.lifecycle_status)}</code>` +
                (r.breach ? `, and it is under the line.` : `.`),
          sql,
        };
      }
      const sql = "SELECT slug, title, target, progress_pct, breach, " +
                  "lifecycle_status, achievement_status FROM goal_progress " +
                  "ORDER BY (breach IS NULL), progress_pct";
      const rs = query(sql);
      if (!rs.length) return { text: "No goals are declared.", sql };
      const under = rs.filter(r => r.breach);
      const parts = rs.map(r => `<em>${esc(r.title)}</em>` +
        (r.progress_pct !== null ? ` (${N.num(r.progress_pct, 0)} per cent)`
                                 : " (no number)"));
      return {
        text: `${N.count(rs.length)} goals: ` + N.listify(parts) + ". " +
              (under.length
                ? `${cap(N.count(under.length))} ${N.plural(under.length, "is", "are")} ` +
                  `under the line. `
                : `None is under its line. `) +
              `Ask about one by name for the detail.`,
        sql,
      };
    });

  intent("sessions", (q, s) => (s.sessionType ? 4 : 0) +
    (has(q, "session", "train", "workout", "often", "times") ? 3 : 0),
    (q, s, query) => {
      if (s.sessionType) {
        const t = s.sessionType.replace(/'/g, "''");
        const sql = `SELECT type, COUNT(*) AS n, MIN(date) AS first, ` +
                    `MAX(date) AS last FROM sessions WHERE type = '${t}' ` +
                    `GROUP BY type`;
        const r = query(sql)[0];
        if (!r) {
          return { text: `The record holds no <code>${esc(s.sessionType)}</code> ` +
                         `sessions at all. That is an absence in the record, ` +
                         `not a statement that none happened.`, sql };
        }
        return {
          text: `${N.count(r.n)} <code>${esc(r.type)}</code> ` +
                `${N.plural(r.n, "session")}, from ${esc(r.first)} to ` +
                `${esc(r.last)}. I can count them because counting rows is a ` +
                `property of the query; I will not total the distance, because ` +
                `that would be a quantity computed here rather than one the ` +
                `engine stands behind.`,
          sql,
        };
      }
      const sql = "SELECT type, COUNT(*) AS n FROM sessions GROUP BY type " +
                  "ORDER BY n DESC";
      const rs = query(sql);
      return {
        text: `The record holds ` +
              N.listify(rs.map(r => `${N.num(r.n)} <code>${esc(r.type)}</code>`)) +
              `, by the engine's own session types.`,
        sql,
      };
    });

  intent("on-date", (q, s) => s.date ? 8 : 0,
    (q, s, query) => {
      const d = s.date.replace(/'/g, "''");
      const sql = `SELECT date, steps, sleep_h, rhr, kcal_in, active_min, ` +
                  `coverage, note FROM daily WHERE date = '${d}'`;
      const sesSql = `SELECT type, distance_km, duration_s, avg_hr FROM ` +
                     `sessions WHERE date = '${d}'`;
      // BOTH queries are cited. This answer draws on two tables, and citing
      // only the first left the session distance traceable to nothing - the
      // same defect the brief's grounding test caught there, arriving here.
      const cite = [sql, sesSql];
      const day = query(sql)[0];
      const ses = query(sesSql);
      if (!day && !ses.length) {
        return {
          text: `Nothing is recorded for ${esc(s.date)}. The record does not ` +
                `say the day was empty; it says nobody wrote anything down, ` +
                `and those are different facts.`,
          sql: cite,
        };
      }
      const bits = [];
      if (day) {
        for (const [k, label, dp] of [["steps", "steps", 0],
                                      ["sleep_h", "hours of sleep", 1],
                                      ["rhr", "bpm resting", 0],
                                      ["active_min", "active minutes", 0]]) {
          if (day[k] !== null && day[k] !== undefined)
            bits.push(`${N.num(day[k], dp)} ${label}`);
        }
      }
      const sessions = ses.map(x => `a <code>${esc(x.type)}</code>` +
        (x.distance_km !== null ? ` of ${N.num(x.distance_km, 2)} km` : ""));
      return {
        text: `On ${esc(s.date)}: ` +
              (bits.length ? N.listify(bits) : "no daily figures") +
              (sessions.length ? `. Sessions: ${N.listify(sessions)}.` : ".") +
              (day && day.coverage
                ? ` The day is marked <code>${esc(day.coverage)}</code>.`
                : ` The day carries no coverage marking, which the engine keeps ` +
                  `distinct from a day marked empty.`),
        sql: cite,
      };
    });

  intent("provenance", (q, s) => has(q, "provenance", "come from", "came from",
                                     "source", "trust", "where did", "origin",
                                     "reliable") ? 6 : 0,
    (q, s, query) => {
      const sql = "SELECT trust, COUNT(*) AS n, SUM(COUNT(*)) OVER () AS total " +
                  "FROM provenance GROUP BY trust ORDER BY n DESC";
      const rs = query(sql);
      if (!rs.length) return { text: "The record carries no provenance rows.", sql };
      return {
        text: `Across ${N.num(rs[0].total)} record-days: ` +
              N.listify(rs.map(r => `<code>${esc(r.trust)}</code> ${N.num(r.n)}`)) +
              `. ` + (rs[0].trust === "unknown-transit"
                ? `The largest group is the one where the number arrived and the ` +
                  `path it took did not. Not wrong - unaccompanied, and that ` +
                  `cannot be recovered after the fact.`
                : ``),
        sql,
      };
    });

  // Scores 7, above provenance's 6, because these words are unambiguous while
  // "source" is not: "did any sources disagree" contains a trigger for both,
  // and on a tie the earlier intent won and answered the wrong question
  // fluently - the exact failure this design exists to avoid.
  intent("conflicts", (q, s) => has(q, "disagree", "conflict", "contradict",
                                    "differ", "mismatch", "argue") ? 7 : 0,
    (q, s, query) => {
      const sql = "SELECT date, dataset, field, chosen_source, chosen_value, " +
                  "over_source, over_value, independent, compares FROM resolution " +
                  "WHERE disagreed = 1 ORDER BY date";
      const rs = query(sql);
      if (!rs.length) {
        return { text: "No two sources disagreed anywhere in this record.", sql };
      }
      const weak = rs.filter(r => !r.independent).length;
      return {
        text: `${N.count(rs.length)} ${N.plural(rs.length, "time")}, over ` +
              N.listify([...new Set(rs.map(r => `<code>${esc(r.field)}</code>`))]) +
              `. The engine kept a winner each time and did not throw the loser ` +
              `away.` + (weak
                ? ` ${cap(N.count(weak))} of those were between sources it does not ` +
                  `consider independent, where agreement checks the copying and ` +
                  `not the measurement.`
                : ``),
        sql,
      };
    });

  intent("coverage", (q, s) => has(q, "missing", "gap", "unlogged", "logged",
                                   "record", "coverage", "blank") ? 4 : 0,
    (q, s, query) => {
      const sql = "SELECT COUNT(*) AS logged, MIN(date) AS a, MAX(date) AS b, " +
                  "SUM(CASE WHEN coverage IS NULL THEN 1 ELSE 0 END) AS blank, " +
                  "SUM(CASE WHEN coverage = 'partial' THEN 1 ELSE 0 END) AS partial " +
                  "FROM daily";
      const r = query(sql)[0];
      return {
        text: `The record runs ${esc(r.a)} to ${esc(r.b)}, ${N.num(r.logged)} ` +
              `days. ${N.num(r.blank)} carry no coverage marking and ` +
              `${N.num(r.partial)} are marked <code>partial</code>. I am not ` +
              `going to ask why. The days somebody stops writing things down ` +
              `are frequently the ones worth knowing about, and a tool that ` +
              `demands an explanation is one they stop opening.`,
        sql,
      };
    });

  intent("verdicts", (q, s) => has(q, "verdict", "on target", "behind",
                                   "ahead", "grade", "score", "week") ? 4 : 0,
    (q, s, query) => {
      const sql = "SELECT verdict, COUNT(*) AS n, SUM(COUNT(*)) OVER () AS total " +
                  "FROM verdicts GROUP BY verdict ORDER BY n DESC";
      const rs = query(sql);
      if (!rs.length) return { text: "The engine emitted no weekly verdicts.", sql };
      const by = Object.fromEntries(rs.map(r => [r.verdict, r.n]));
      return {
        text: `Over ${N.num(rs[0].total)} weekly checks: ` +
              N.listify(rs.map(r => `<code>${esc(r.verdict)}</code> ${N.num(r.n)}`)) +
              `.` + (by.no_data
                ? ` The ${N.count(by.no_data)} <code>no_data</code> weeks are not ` +
                  `misses - the engine declines to score a week it cannot see.`
                : ``),
        sql,
      };
    });

  /* ---- vetoes ------------------------------------------------------------
   * A question can contain a keyword this thing recognises and still be asking
   * for something it must not supply. Two got through and both were caught by
   * the test rather than by reading the code:
   *
   *   "is this a good training plan"   -> matched `sessions` on "train" and
   *                                       answered with a session breakdown
   *   "what will they weigh next month" -> matched `weight` on "weigh" and
   *                                       answered with the current reading
   *
   * Both answered a DIFFERENT question fluently, which is the failure mode
   * this whole design exists to avoid, arriving from a keyword classifier
   * rather than from a model. The veto runs first and its refusals are typed,
   * because "I cannot evaluate your plan" is a far more useful thing to be
   * told than "I did not understand".
   *
   * These are not gaps to be filled later. A record reader that graded plans
   * would be making a claim about training, and one that projected a weight
   * forward would be making a claim about a body - neither is in the record,
   * and G74 already says a cause is a claim rather than an observation. */
  const VETOES = [
    {
      id: "judgment",
      test: (q) => has(q, "good", "bad", "better", "worse", "should", "ought",
                       "advice", "advise", "recommend", "suggest", "optimal",
                       "healthy", "enough", "too much", "too little", "right",
                       "wrong", "improve", "fix"),
      text: "That asks for a judgment, and I do not make them. I read a record " +
            "and report what is in it; whether a plan is good, whether a number " +
            "is enough, what someone ought to do next - none of that is in this " +
            "database, and answering anyway would be inventing an opinion and " +
            "dressing it in the record's authority. Ask me what the record says " +
            "and decide the rest yourself.",
    },
    {
      id: "prediction",
      test: (q) => has(q, "will", "predict", "forecast", "expect", "going to",
                       "next week", "next month", "next year", "future",
                       "by when", "how long until"),
      text: "That asks about the future, and this record only holds what has " +
            "already happened. There is no projection in here to report, and " +
            "producing one would be arithmetic performed by this page and then " +
            "attributed to the engine. If the engine ever emits a projection, " +
            "it will have a row and I will read it out.",
    },
    {
      id: "causation",
      test: (q) => has(q, "why", "because", "cause", "reason for", "due to",
                       "explain why", "what made"),
      text: "That asks why, and the record holds what, not why. A cause is a " +
            "claim - the engine treats causal attribution as something to be " +
            "asserted by a person and recorded, never derived from a " +
            "coincidence in the data. I can tell you what happened around the " +
            "same time, if you ask me what happened on a date.",
    },
  ];

  /* ---- the driver -------------------------------------------------------
   * Score every intent, take the best, refuse below the floor. The floor is
   * the whole design: PRECISE's finding was that refusing what does not map
   * cleanly is what makes the rest worth trusting. */

  const FLOOR = 3;

  function answer(question, query) {
    const q = norm(question);
    if (!q) return null;
    const s = slots(question);
    // Veto first: a question asking for a judgment, a prediction or a cause is
    // refused however well its words happen to match an intent.
    for (const v of VETOES) {
      if (v.test(q)) {
        return { kind: "refusal", refusal: v.id, text: v.text, sql: null,
                 matched: null };
      }
    }
    let best = null, bestScore = 0;
    for (const it of INTENTS) {
      let sc = 0;
      try { sc = it.score(q, s, query) || 0; } catch { sc = 0; }
      if (sc > bestScore) { bestScore = sc; best = it; }
    }
    if (!best || bestScore < FLOOR) {
      return {
        kind: "refusal",
        text: "I did not understand that well enough to answer it, and I am " +
              "not going to produce something that reads like an answer anyway. " +
              "This is a keyword classifier over a fixed schema, not a language " +
              "model: when it misses, it misses visibly. Ask <em>what can you " +
              "answer</em> for the list, or try naming a metric - weight, steps, " +
              "sleep, runs, goals - or a date like <code>2030-06-16</code>.",
        sql: null,
        matched: null,
      };
    }
    let out;
    try {
      out = best.run(q, s, query);
    } catch (err) {
      return {
        kind: "broken",
        text: `The handler for <code>${esc(best.id)}</code> failed against this ` +
              `database: <code>${esc(err && err.message || err)}</code>. That is ` +
              `a defect here, not an answer.`,
        sql: null, matched: best.id,
      };
    }
    return { kind: "answer", matched: best.id, score: bestScore, ...out,
             text: cap(out.text) };
  }

  return { answer, INTENTS, _internal: { slots, norm, horizon, matchGoal } };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Ask;
