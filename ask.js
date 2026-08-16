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

  // The single place a value becomes part of a query. Only ever called with a
  // session type from a fixed map, a goal slug read out of the database, or a
  // date matched by regex - never with raw question text.
  const sqlStr = (v) => "'" + String(v).replace(/'/g, "''") + "'";

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
    // `pulse` is deliberately absent: it is ambiguous in this record and is
    // refused rather than mapped. See AMBIGUOUS_METRIC below.
    rhr: "rhr", "resting": "rhr",
    active: "active_min", minutes: "active_min",
    heart: "avg_hr", hr: "avg_hr", bpm: "avg_hr",
  };

  const SESSION_WORDS = {
    run: "run", runs: "run", running: "run", ran: "run", jog: "run",
    walk: "walk", walks: "walk", walking: "walk", walked: "walk",
    // Plurals, because "how many swims in June" is how the question gets
    // asked and `run` had them while the others did not - so the same
    // sentence answered for running and went unrecognised for swimming.
    ride: "cycle", rides: "cycle", cycling: "cycle", bike: "cycle",
    bikes: "cycle", cycle: "cycle", cycles: "cycle",
    swim: "swim", swims: "swim", swimming: "swim", swam: "swim",
    strength: "strength", gym: "strength", gyms: "strength",
    lift: "strength", lifts: "strength", lifting: "strength",
    row: "row", rows: "row", rowing: "row", erg: "row", ergs: "row",
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
    /* A HYPHENATED WORD IS ALSO ITS PARTS, for slot filling only.
     *
     * `norm` keeps hyphens on purpose - dates and slugs like `hop-test` and
     * `borg-cr10` need them - and the cost was that "weigh-ins" did not match
     * the metric word `weigh` while "weigh ins" did. The same question routed
     * two different ways depending on a hyphen, and the hyphenated spelling
     * is the commoner one.
     *
     * Split for the LOOKUP and never for the token, so slugs and dates are
     * untouched. */
    const forSlots = [];
    for (const w of words) {
      forSlots.push(w);
      if (w.includes("-")) forSlots.push(...w.split("-").filter(Boolean));
    }
    for (const w of forSlots) {
      if (!out.metric && METRIC_WORDS[w]) out.metric = METRIC_WORDS[w];
      if (!out.sessionType && SESSION_WORDS[w]) out.sessionType = SESSION_WORDS[w];
    }
    const d = norm(q).match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (d) out.date = d[1];
    if (/\b(list|all|every|which|show me)\b/.test(norm(q))) out.wantsList = true;
    return out;
  }

  /* ---- qualifiers -------------------------------------------------------
   *
   * The failure four test athletes found, over and over, was not a wrong
   * number and not a refusal. It was a CONFIDENT PARAGRAPH ABOUT A DIFFERENT
   * QUESTION. "how many runs did I do in June" returned every run from April
   * onward. "how much did I walk last week" answered about the whole record.
   * "what is my longest run" returned a session count. Every one read as an
   * answer, none was flagged, and RULES.md promises that when this thing
   * misses it misses visibly.
   *
   * The cause: intents scored on keywords alone. "runs" matched `sessions`
   * and "in June" was never looked at, so the qualifier that made the question
   * a different question was silently dropped.
   *
   * So qualifiers are extracted separately from intent, and an intent that
   * cannot honour a qualifier present in the question REFUSES rather than
   * answering the question it can handle. A dropped qualifier is a miss, and
   * a miss must be visible.
   */
  const MONTHS = ["january", "february", "march", "april", "may", "june",
                  "july", "august", "september", "october", "november",
                  "december"];

  const MONTH_RE = /\b(january|february|march|april|june|july|august|september|october|november|december)\b/;
  // `most recent` and `latest` lead the alternation deliberately: they must
  // win over the bare `most`, or "my most recent run" reads as a request for
  // a maximum and refuses instead of selecting the newest row.
  const SUPERLATIVE_RE = /\b(most recent|latest|newest|longest|shortest|biggest|largest|best|worst|hardest|easiest|fastest|slowest|heaviest|lightest|most|least|highest|lowest|peak)\b/;
  const COMPARISON_RE = /\b(compare|compared|versus|vs|better than|worse than|more than|less than)\b/;
  const AGGREGATE_RE = /\b(total|totals|altogether|average|averages|mean|sum|per week|typical)\b/;
  const RELATIVE = ["last week", "this week", "past week", "last month",
                    "this month", "last year", "this year", "yesterday",
                    "today", "recently", "lately", "so far", "last 7 days",
                    "last 30 days"];

  /* WHO OR WHAT OBSERVED THE ROW, as a qualifier (Phase 1.2).
   *
   * "How many of my runs are self reported" counted every run and dropped the
   * filter, so a question about a SUBSET was answered with the whole set and
   * nothing said so. That is pile (A) exactly: a well-formed, confident answer
   * to a question nobody asked.
   *
   * An origin phrase is a slot rather than a veto, because one intent really
   * does honour it - `weight` groups its rows by `origin` and answers "how
   * many weigh-ins came from the scale" correctly. So this cannot be refused
   * before scoring the way `comparison` and `streak` are; it has to be
   * declared per intent and checked against the winner. */
  const ORIGIN_RE = new RegExp("\\b(self[- ]report(ed)?|by device|" +
    "device[- ]measured|tracked by(?: (?:a |the |my )?[a-z]+)?|transcribed|" +
    "from (my|the) (watch|scale|app|phone|tracker)|" +
    "came from the (scale|watch|app)|unknown origin|no origin|" +
    "which (device|source)|what (device|source))\\b");

  /* A WORD THAT NAMES TWO MEASURES NAMES NEITHER.
   *
   * Found by this client's own audit: the engine publishes `pulse` as an alias
   * for `avg_hr`, and this client mapped it to `rhr`. Two clients answering
   * "what was my pulse" returned different metrics and neither said it had
   * chosen. That is the failure this repo exists to catch, and the resolution
   * is not to pick the other one.
   *
   * NEITHER MAPPING IS DEFENSIBLE AS AN ANSWER, and the record says so rather
   * than this comment asserting it:
   *
   *   `avg_hr` is a session average - heart rate while training, which is not
   *   what a person means by their pulse.
   *
   *   `rhr` is worse, because it looks right. The record carries a
   *   `capabilities` row declaring `rhr` a PROXY whose construct is "a daytime
   *   spot statistic, not the nightly minimum" (contract 44). And the rhr rows
   *   in this record name no `origin` at all, so no capability statement can
   *   be joined to them - which by the engine's own rule resolves to
   *   competence `unknown` rather than to a default.
   *
   * So the honest answer names both and picks neither. Refused before scoring,
   * like `comparison` and `streak`, because NO intent can honour a slot that
   * cannot be filled: the ambiguity is in the question, not in the answerer.
   *
   * A disambiguator removes it. "Resting pulse" is not ambiguous and still
   * answers, which is the control that stops this becoming a word ban. */
  const AMBIGUOUS_METRIC = {
    pulse: {
      disambiguators: /\b(resting|rest|overnight|nightly|session|training|workout|during|average|avg)\b/,
      candidates: [
        ["rhr", "the daily resting heart rate, which this record declares a " +
               "proxy for a daytime spot statistic rather than the nightly low"],
        ["avg_hr", "the average heart rate during a session, which is a " +
                   "training figure rather than a resting one"],
      ],
    },
  };

  function ambiguousMetric(q) {
    for (const word of Object.keys(AMBIGUOUS_METRIC)) {
      const spec = AMBIGUOUS_METRIC[word];
      if (!new RegExp("\\b" + word + "\\b").test(q)) continue;
      if (spec.disambiguators.test(q)) continue;
      return { word, candidates: spec.candidates };
    }
    return null;
  }

  function qualifiers(q) {
    const out = { window: null, superlative: null, comparison: false,
                  aggregate: null, streak: false, origin: null };
    const org = q.match(ORIGIN_RE);
    if (org) out.origin = org[1];
    /* A STREAK IS A FIFTH QUALIFIER, and nothing here can honour one.
     *
     * "How many weeks in a row have I been on target for steps" returned the
     * latest single-week snapshot - 85% - with no indication it was not a
     * streak. That is worse than a refusal: a reader who was not watching
     * would take 85% as the answer to a question about consecutive weeks.
     *
     * Counting consecutive rows means walking an ordered set and stopping at
     * the first break, which is a computation over the sequence rather than a
     * property of any row. `docs/model.md` lists `streaks` under artifact kind
     * 2 and the read model does not have it, so this is an engine gap and the
     * honest thing is to name it. */
    out.streak = /\b(in a row|consecutive|streak|straight|run of)\b/.test(q);
    for (const w of RELATIVE) {
      if (q.includes(w)) { out.window = w; break; }
    }
    // Regex LITERALS, not `new RegExp` over a template string. Written the
    // other way the `\b` and `\s` inside the template are consumed by the
    // string before the regex ever sees them - `\b` becomes a backspace
    // character - and every month silently stopped matching. Found by testing
    // "in June", not by reading it.
    if (!out.window) {
      const m = q.match(MONTH_RE);
      if (m) out.window = m[1];
      // "may" is a modal verb far more often than a month, and "may I run" is
      // not a question about May, so it needs a preposition in front of it.
      else if (/\b(in|during|for|across)\s+may\b/.test(q)) out.window = "may";
    }
    if (!out.window && /\bweek of\b/.test(q)) out.window = "a named week";
    const sup = q.match(SUPERLATIVE_RE);
    if (sup) out.superlative = sup[1];
    out.comparison = COMPARISON_RE.test(q);
    const agg = q.match(AGGREGATE_RE);
    if (agg) out.aggregate = agg[1];
    /* Two words in AGGREGATE_RE carry a second, commoner meaning, and both
     * produced a confident arithmetic refusal for a question containing no
     * arithmetic. Testers hit each of them within minutes.
     *
     * `mean` is a VERB far more often than a noun here. "doesn't that mean
     * I'm healed" and "no I mean the weight measurements" were both refused
     * with "your question asks for mean". As a noun it takes an article or an
     * `of`; as a verb it does not.
     *
     * `total` next to "how many" is an ADJECTIVE on a count, and counting
     * rows is explicitly permitted. "how many total sessions have I logged"
     * refused while "how many sessions" did not, which is the classifier
     * keying on a word rather than on the shape of the request. */
    if (out.aggregate === "mean" && !/\b(the|a)\s+mean\b|\bmean\s+of\b/.test(q))
      out.aggregate = null;
    if (/^(total|totals)$/.test(out.aggregate || "") && /\bhow many\b/.test(q))
      out.aggregate = null;
    /* THE THIRD WORD IN THIS SET TO CARRY A SECOND MEANING, and the one the
     * record itself uses: `per week` is a PERIOD DESCRIPTOR at least as often
     * as a request to average, because that is how the goals are named. "Walk
     * 77k steps a week" is a goal whose period IS a week, and the engine
     * already holds its standing in a row.
     *
     * So "how is the steps per week goal" refused with "adding up the values
     * is arithmetic the engine has not done", while "how is the steps goal"
     * answered 85% from `goal_progress`. Nothing was being added up; the
     * qualifier was describing the goal, not asking for a computation.
     *
     * NARROW ON PURPOSE. It takes the literal word `goal`, and it stands down
     * if any real aggregate word is also present - because "how many steps
     * per week do I average" IS asking for a mean this page will not compute,
     * and `per week` is the leftmost match in that string, so disarming it
     * unconditionally would let the refusal be skipped. */
    if (out.aggregate === "per week" && /\bgoals?\b/.test(q)
        && !/\b(total|totals|altogether|average|averages|sum|typical)\b/.test(q))
      out.aggregate = null;
    return out;
  }

  /* Goal slugs and titles come from the database, not from a hardcoded list,
   * so a record with different goals is askable about ITS goals. */
  function matchGoal(q, query) {
    const gs = query("SELECT slug, title FROM goal_progress");
    const n = norm(q);
    let best = null, bestScore = 0;
    const scores = [];
    const stem = (w) => w.replace(/s$/, "");
    const qWords = new Set(n.split(" ").filter(Boolean).map(stem));
    for (const g of gs) {
      // The slug is the goal's NAME and counts for more than words that happen
      // to appear in its title. "the running goal" means the goal called
      // `running`, not the one whose title contains the word running - which is
      // how this first matched "Enjoy running again" against a 30 km target.
      const slugWords = norm(g.slug).split(" ").filter(w => w.length > 2);
      const titleWords = norm(g.title || "").split(" ")
        .filter(w => w.length > 3 && !STOP.has(w));
      /* WORDS, NOT SUBSTRINGS.
       *
       * This matched with `n.includes(w)`, so a goal word counted whenever it
       * appeared anywhere inside the question - including inside a longer,
       * unrelated word. "Enjoy running AGAIN" matched the question "how did I
       * do AGAINST my step goal", won outright, and the tool reported the
       * wrong goal while saying "nothing here can score it" about a step goal
       * that is scored at 85% one row away. Signalling absence of data that is
       * present is the worst answer this page can give.
       *
       * Compared as words, with plurals folded so `steps` still meets "step".
       * Deliberately no prefix rule: a prefix match is what reintroduces
       * again/against. */
      const hits = slugWords.filter(w => qWords.has(stem(w))).length * 3
                 + titleWords.filter(w => qWords.has(stem(w))).length;
      scores.push({ g, hits });
      if (hits > bestScore) { bestScore = hits; best = g; }
    }
    /* A TIE IS NOT A MATCH.
     *
     * `bestScore > 0` meant one shared word picked a goal, and three of this
     * record's goal titles end in "a week" - so "the 30 km a week goal" scored
     * 1 against all three and the first one encountered won. Asked about
     * running, the tool confidently reported active minutes at 283%.
     *
     * Three separate testers led with this, and the reason it is the worst
     * class of bug here is that it does not look like one: the number is real,
     * the sentence is well formed, and nothing signals that it is about a
     * different goal. This page refuses to compute a figure it cannot ground;
     * refusing to GUESS WHICH ROW a loose question meant is the same
     * discipline applied to the router rather than to the arithmetic.
     *
     * An indecisive match falls through to the branch that lists every goal
     * with its own figure and invites naming one, which is honest and is also
     * more useful than a wrong pick. */
    const top = scores.filter(x => x.hits === bestScore);
    if (bestScore === 0 || top.length > 1) return null;
    return best;
  }

  /* ---- the record's own "now" ------------------------------------------
   * "Lately" means lately for the ATHLETE, and this record ends in 2030. A
   * page that silently used the reader's clock would answer "nothing in the
   * last week" about a record that is four years old, which is true and
   * useless. The horizon is stated in the answers that depend on it. */
  /* Resolve a named window to a date range, or null if this cannot.
   *
   * COUNTING INSIDE A WINDOW IS OURS. `RULES.md`: "counting is a property of
   * the query, so COUNT(*) is allowed", and a date range is a WHERE clause -
   * both selection. The guard refused every window alike because nothing
   * could scope when it was written, so "how many runs did I do in June"
   * refused a question the database answers with 12.
   *
   * TOTALLING inside a window is NOT ours and stays refused: `WHERE` + `SUM`
   * is a figure the engine has to stand behind. The two look identical until
   * you ask what is being done to the window.
   *
   * The YEAR comes from the record, never from the reader's clock. "June" in
   * a record that ends in 2030 means June 2030; resolving it against today
   * would scope to a year the record does not cover and answer zero. */
  function windowRange(win, query) {
    if (!win) return null;
    const last = horizon(query);
    if (!last) return null;
    const year = last.slice(0, 4);
    const mi = MONTHS.indexOf(String(win).toLowerCase());
    if (mi >= 0) {
      const mm = String(mi + 1).padStart(2, "0");
      const endDay = new Date(Date.UTC(+year, mi + 1, 0)).getUTCDate();
      return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${endDay}`,
               label: `${win} ${year}` };
    }
    if (win === "this year") return { from: `${year}-01-01`, to: `${year}-12-31`,
                                      label: year };
    return null;                       // not a window this can honour
  }

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
  // `handles` names the qualifiers an intent can honour. Anything not listed
  // is refused when present rather than dropped.
  const intent = (id, score, run, handles) =>
    INTENTS.push({ id, score, run, handles: handles || {} });

  const has = (q, ...words) => words.some(w => new RegExp(`\\b${w}`).test(q));

  intent("help", (q) => has(q, "what can you", "help", "which questions",
                            "what do you know", "capabilities") ? 9 : 0,
    () => ({
      text: "I answer from the tables in this database and nothing else." +
            "<span class=\"chron\">" +
            "<strong>the record</strong> what do they weigh, how did they " +
            "sleep, how has their mood been, what happened on 2030-06-16<br>" +
            "<strong>extremes</strong> longest run, hardest session, heaviest " +
            "weigh-in - picking a row out, which is allowed where a total is not<br>" +
            "<strong>best efforts</strong> best 10k, fastest 5k - a rolling " +
            "window inside a run, which a distance and a duration cannot answer<br>" +
            "<strong>food</strong> how much protein did I eat, what did I eat " +
            "on 2030-06-09 - the day figure is the engine's, the items are " +
            "listed and never added up<br>" +
            "<strong>weekly volume</strong> how many km a week do I run, how " +
            "much did I train each week, how far did I run last week - the " +
            "engine buckets and totals these, so they are rows rather than " +
            "arithmetic done here<br>" +
            "<strong>the plan</strong> how are the goals going, did I change " +
            "my plan and why, how did the weeks score<br>" +
            "<strong>where and when</strong> what route do I run, what was " +
            "the weather like, what happened on 2030-06-16<br>" +
            "<strong>safety</strong> am I restricted from anything, did I pass " +
            "the hop test, what injuries do I have<br>" +
            "<strong>the record about itself</strong> where did the numbers " +
            "come from, did any sources disagree, what is modelled rather than " +
            "measured, has anything been corrected, which days are missing" +
            "</span>" +
            "What I will not do: judge, predict, or explain why something " +
            "happened. I also will not scope an answer to a window I cannot " +
            "honour, or total anything up - and where I cannot, I say so " +
            "rather than answering a nearby question instead.",
      sql: null,
    }));

  intent("gate", (q) => has(q, "gated", "restrict", "allowed", "can they",
                            "can i", "injur", "safe", "hurt", "pain") ? 6 : 0,
    (q, s, query) => {
      const sql = "SELECT date, slug, restricts, reason, severity, status, " +
                  "precondition, escalation FROM gates WHERE status <> 'cleared'";
      /* THE LATEST ROW PER SLUG, not every unresolved row. `medical` is
       * effective-dated: the calf strain has an `active` row on 2030-04-17
       * and a `resolved` row on 2030-05-09, and taking all non-resolved rows
       * reported a restriction that had been lifted seven weeks earlier.
       * Warning someone off running because of a healed injury is a different
       * failure from missing a live one, and still a failure. */
      const medSql = "SELECT date, slug, kind, title, body_site, severity, " +
                     "status, restricts, onset_date FROM medical m " +
                     "WHERE date = (SELECT MAX(date) FROM medical " +
                     "WHERE slug = m.slug) " +
                     "AND restricts IS NOT NULL AND status <> 'resolved'";
      const rs = query(sql);
      const med = query(medSql);
      if (!rs.length && !med.length) {
        return {
          text: "No gate is open and no unresolved medical row carries a " +
                "restriction. That is a statement about what the engine was " +
                "told, not a clearance - and this page cannot clear anybody.",
          sql: [sql, medSql],
        };
      }
      /* NEVER OPEN WITH AN AFFIRMATIVE PARTICLE.
       *
       * This used to begin "Yes:" - written for "is anything gated", and read
       * by an athlete who asked "can I run today?". The content was right and
       * the first word inverted it, on the one question where a lexical
       * mislead is unaffordable. A restriction is now stated as a restriction,
       * in the first three words, whatever the question's grammar. */
      const parts = rs.map(g => {
        // The gate names a precondition; the check history for that
        // precondition is the thing the athlete needs and could not reach.
        // A run of passes with a failure inside it is not the same as a run
        // of passes, and only one of those is safe to act on.
        const cSql = "SELECT date, slug, result, value, note FROM checks " +
                     `WHERE slug = '${String(g.precondition).replace(/'/g, "''")}' ` +
                     "ORDER BY date DESC LIMIT 5";
        let checks = [];
        try { checks = query(cSql); } catch { checks = []; }
        const fails = checks.filter(c => c.result !== "pass");
        let t = `<strong>${esc(g.restricts)} work is gated</strong>, from ` +
                `${esc(g.date)}, severity <code>${esc(g.severity)}</code>. ` +
                `The engine's own words, not a paraphrase: ` +
                `<q>${esc(g.escalation)}</q> The condition it set is ` +
                `<code>${esc(g.precondition)}</code>, currently ` +
                `<code>${esc(g.status)}</code>.`;
        if (checks.length) {
          t += ` Recent <code>${esc(g.precondition)}</code> results: ` +
               N.listify(checks.map(c =>
                 `${esc(c.date)} <strong>${esc(c.result)}</strong>` +
                 (c.note ? ` (${esc(c.note)})` : ""))) + ".";
          if (fails.length) {
            t += ` <strong>Note the ${fails.length === 1 ? "failure" : "failures"}.</strong> ` +
                 `A run of passes with a failure inside it is not a run of ` +
                 `passes, and clearing this gate on today's result alone would ` +
                 `mean not knowing that.`;
          }
        }
        return { t, cSql };
      });
      let text = parts.map(x => x.t).join("<br>");
      if (rs.length > 1) {
        text = `${N.derCount(rs.length)} gates are open.<br>` + text;
      }
      if (med.length) {
        text += `<br>Separately, the medical record carries ` +
                `${N.derCount(med.length)} unresolved ` +
                `${N.plural(med.length, "entry", "entries")} with a ` +
                `restriction of ${N.listify(med.map(m =>
                  `<code>${esc(m.restricts)}</code> for ${esc(m.title)}` +
                  (m.onset_date ? `, onset ${esc(m.onset_date)}` : "")))}. ` +
                `Those are a different table from the gates and do not all ` +
                `produce one.`;
      }
      return { text, sql: [sql, medSql, ...parts.map(x => x.cSql)] };
    });

  intent("weight", (q, s) => (s.metric === "kg" ? 5 : 0) +
    (has(q, "weigh", "weight", "heavy", "kg") ? 2 : 0),
    (q, s, query) => {
      /* THIS WAS A FIXED TEMPLATE. Every weight question returned the same
       * sentence about the latest reading - "how many weigh-ins came from the
       * scale" included - which is an answer wearing the clothes of a
       * different one. A tester asked five ways and got one reply.
       *
       * Counting rows and filtering by a stored column are both selection, so
       * the count branch below needs nothing from the engine. The origin
       * vocabulary comes from the RECORD rather than a list here, so a record
       * with different sources is askable about its own. */
      if (/\bhow many\b/.test(q)) {
        const total = query("SELECT COUNT(*) AS n FROM weight")[0];
        const byOrigin = query(
          "SELECT origin, COUNT(*) AS n FROM weight GROUP BY origin ORDER BY n DESC");
        const cite = ["SELECT COUNT(*) AS n FROM weight",
                      "SELECT origin, COUNT(*) AS n FROM weight GROUP BY origin ORDER BY n DESC"];

        /* "unknown origin" is a question about the NULLs, and it is the one a
         * sceptic asks first. Answering it with the total would be the same
         * substitution this branch exists to remove. */
        if (/\bunknown\b|\bno origin\b|\bunrecorded\b|\bmissing\b/.test(q)) {
          const none = byOrigin.find(r => r.origin === null);
          return {
            text: `${N.derCount(none ? none.n : 0)} of ${N.der(total.n)} ` +
                  `weigh-ins name no origin at all. The value is real; its ` +
                  `custody is not written down, and those are different facts.`,
            sql: cite,
          };
        }

        /* An origin named in the question, matched against what the record
         * actually holds. `athlete+scale` is one origin and two tokens. */
        const named = byOrigin.filter(r => r.origin && String(r.origin)
          .split(/[^a-z0-9]+/i).some(tok => tok.length > 2 && has(q, tok)));
        if (named.length) {
          return {
            text: N.listify(named.map(r =>
              `${N.derCount(r.n)} from <code>${esc(r.origin)}</code>`)) +
              `, out of ${N.der(total.n)} weigh-ins in the record.`,
            sql: cite,
          };
        }
        return {
          text: `${N.derCount(total.n)} weigh-ins, by origin: ` +
                N.listify(byOrigin.map(r => r.origin
                  ? `${N.der(r.n)} <code>${esc(r.origin)}</code>`
                  : `${N.der(r.n)} with none recorded`)) +
                `. I can count them because counting rows is a property of the ` +
                `query; the origins are the engine's own words, not a grouping ` +
                `made here.`,
          sql: cite,
        };
      }

      const sql = "SELECT date, kg, origin, source, capture FROM weight " +
                  "WHERE kg IS NOT NULL ORDER BY date DESC LIMIT 1";
      const r = query(sql)[0];
      if (!r) return { text: "The record holds no weigh-ins.", sql };
      // The LATEST value, not a trend. A trend would be a quantity computed
      // here, and the engine does not emit one - so the honest answer names
      // the reading and its date and stops.
      return {
        text: `The last weigh-in is ${N.rec(r.kg, "kg", 1)} on ` +
              `${esc(r.date)}` +
              (r.origin ? `, origin <code>${esc(r.origin)}</code>.`
                        : `, with no origin recorded - the value is real, its ` +
                          `custody is not written down.`) +
              ` I am not going to tell you whether that is up or down: a trend ` +
              `is a quantity, this page does not compute quantities, and the ` +
              `engine does not emit one. The chart above shows every reading.`,
        sql,
      };
    }, { origin: true });

  /* The literal word `goal` is DECISIVE and the rest are suggestive. "how did
   * I do against my step goal" tied `goals` against `daily-metric`, because
   * `step` is a metric word and `doing` is a weak goals word - and a tie is
   * now a refusal, correctly, except that a human reading it has no doubt.
   * Saying which keyword actually settles the question is better than
   * loosening the tie rule to let a coin-flip through. */
  intent("goals", (q, s) =>
    has(q, "goal", "goals") ? 6
      : has(q, "target", "on track", "progress", "doing", "aim") ? 5 : 0,
    (q, s, query) => {
      const g = matchGoal(q, query);
      if (g) {
        const sql = "SELECT slug, title, metric, period, target, counted, " +
                    "observed, progress_pct, breach, lifecycle_status, " +
                    "achievement_status, verification, tracker " +
                    "FROM goal_progress WHERE slug = " +
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
        /* A LEVEL goal carries `observed` where a flow goal carries `counted`
         * (contract 30), and which side holds the number is the engine's own
         * way of saying which shape this is. Before this read it, "Down to 78
         * kg, unhurried" rendered as "no number" while `goal_progress` held
         * `observed` 75.5 against a 78 ceiling and marked the goal `achieved`.
         * That is worse than a refusal: the engine reached a verdict and the
         * page reported silence, so a reader concluded the record could not
         * say - which is the substitution this page exists to not do.
         *
         * RECORDED ink, not derived. `observed` is the latest weigh-in
         * transcribed, the same number the weight intent above prints with
         * `N.rec`; the engine SELECTED it rather than computing it, and
         * derived ink would claim arithmetic that did not happen. */
        const level = r.observed !== null && r.observed !== undefined;
        const unit = r.metric === "kg" ? "kg" : r.metric;
        const head = level
          ? `${N.rec(r.observed, unit, 1)} against a target of ` +
            `${N.rec(r.target, unit, 1)}`
          : `${N.quantity(r.counted, r.target, r.metric, r.period)}`;
        /* A PERCENTAGE IS NOT ALWAYS THERE, and printing `N.pct(null)` put the
         * word for an absent number where a figure belongs. A ceiling has no
         * percentage by design (#200): "83% of your calorie cap" reads as
         * praise for being 17% under it on one day and as nothing at all on
         * the day it is breached. The status is what the engine emits for
         * these, and it is the sentence's subject rather than a suffix. */
        const pct = r.progress_pct !== null && r.progress_pct !== undefined
          ? `, ${N.pct(r.progress_pct)}` : ``;
        /* OVER or UNDER, from the engine's own word. `breach` is `over` on a
         * ceiling and `under` on a floor, and this said "under the line"
         * for both - so a calorie cap exceeded by 270 kcal was reported as
         * falling short of it, which is the opposite fact. */
        const side = r.breach === "over" ? `, and it is over the line.`
          : r.breach ? `, and it is under the line.` : `.`;
        return {
          text: `<em>${esc(r.title)}</em>: ${head}${pct}. The engine marks it ` +
                `<code>${esc(r.achievement_status || r.lifecycle_status)}</code>` +
                side,
          sql,
        };
      }
      const sql = "SELECT slug, title, target, counted, observed, " +
                  "progress_pct, breach, lifecycle_status, achievement_status " +
                  "FROM goal_progress ORDER BY (breach IS NULL), progress_pct";
      const rs = query(sql);
      if (!rs.length) return { text: "No goals are declared.", sql };
      const under = rs.filter(r => r.breach);
      /* "NO NUMBER" MEANT THREE DIFFERENT THINGS and said them all the same
       * way: a goal nothing can score, a ceiling that has no percentage by
       * design, and a level goal the engine scored and this did not read.
       * Only the first is genuinely numberless. The other two had a verdict
       * in `achievement_status` - `achieved` on a weight goal that had been
       * met - and reporting them as silence is the page withholding what the
       * record said, not the record failing to say it.
       *
       * So the fallback is the engine's own status where there is one, and
       * "no number" only where the engine emitted neither. */
      const parts = rs.map(r => `<em>${esc(r.title)}</em>` +
        (r.progress_pct !== null ? ` (${N.pct(r.progress_pct)})`
          : r.achievement_status
            ? ` (<code>${esc(r.achievement_status)}</code>)`
            : " (no number)"));
      return {
        text: `${N.derCount(rs.length)} goals: ` + N.listify(parts) + ". " +
              (under.length
                ? `${cap(N.derCount(under.length))} ${N.plural(under.length, "is", "are")} ` +
                  `under the line. `
                : `None is under its line. `) +
              `Ask about one by name for the detail.`,
        sql,
      };
    });

  /* The dataset noun is DECISIVE, the rest are suggestive - the same
   * distinction the goals intent needed. "How many sessions have I logged"
   * lost to `coverage`, which scores on the word `logged`, and answered about
   * missing days instead of about sessions. */
  intent("sessions", (q, s) => (s.sessionType ? 4 : 0) +
    (has(q, "session", "sessions") ? 6
      : has(q, "train", "workout", "often", "times") ? 3 : 0),
    (q, s, query) => {
      /* This declares `window`, so it must refuse the windows it cannot
       * honour rather than silently widening to the whole record. A month and
       * a year resolve to a range; "lately" and "so far" do not. */
      const qual = qualifiers(q);
      const win = windowRange(qual.window, query);
      if (qual.window && !win) {
        return {
          text: `I can scope a count to a month or a year, and <em>` +
                `${esc(qual.window)}</em> is neither - so rather than quietly ` +
                `count the whole record and let it read as that period, I am ` +
                `stopping here.`,
          sql: null,
        };
      }
      const range = win
        ? ` AND date >= '${win.from}' AND date <= '${win.to}'`
        : "";
      const inWin = win ? ` in ${esc(win.label)}` : "";
      if (s.sessionType) {
        const t = s.sessionType.replace(/'/g, "''");
        const sql = `SELECT type, COUNT(*) AS n, MIN(date) AS first, ` +
                    `MAX(date) AS last FROM sessions WHERE type = '${t}'` +
                    range + ` GROUP BY type`;
        const r = query(sql)[0];
        if (!r && win) {
          return { text: `No <code>${esc(s.sessionType)}</code> session is ` +
                         `recorded${inWin}.`, sql };
        }
        if (!r) {
          return { text: `The record holds no <code>${esc(s.sessionType)}</code> ` +
                         `sessions at all. That is an absence in the record, ` +
                         `not a statement that none happened.`, sql };
        }
        return {
          text: `${N.derCount(r.n)} <code>${esc(r.type)}</code> ` +
                `${N.plural(r.n, "session")}${inWin}, from ${esc(r.first)} to ` +
                `${esc(r.last)}. I can count them because counting rows is a ` +
                `property of the query; I will not total the distance, because ` +
                `that would be a quantity computed here rather than one the ` +
                `engine stands behind.`,
          sql,
        };
      }
      const sql = "SELECT type, COUNT(*) AS n FROM sessions" +
                  (range ? " WHERE 1=1" + range : "") +
                  " GROUP BY type ORDER BY n DESC";
      const rs = query(sql);
      if (!rs.length) {
        return { text: `The record holds no sessions${inWin}.`, sql };
      }
      return {
        text: `The record holds ` +
              N.listify(rs.map(r => `${N.der(r.n)} <code>${esc(r.type)}</code>`)) +
              `${inWin}, by the engine's own session types.`,
        sql,
      };
    }, { window: true });

  intent("on-date", (q, s) => s.date ? 8 : 0,
    (q, s, query) => {
      const d = s.date.replace(/'/g, "''");
      const sql = `SELECT date, steps, sleep_h, rhr, kcal_in, kcal_out, ` +
                  `active_min, mood, mood_scale, pain, pain_scale, feel, ` +
                  `coverage, modelled, note ` +
                  `FROM daily WHERE date = '${d}'`;
      const sesSql = `SELECT type, distance_km, duration_s, avg_hr, rpe, ` +
                     `modelled FROM sessions WHERE date = '${d}'`;
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
        // Everything in `daily` was reported by a source, so these are all
        // recorded. Units take their symbol where one exists.
        // `modelled` names the field the engine computed rather than
        // observed, so the mark goes on exactly that field and not on its
        // neighbours - kcal_out is usually modelled and steps is not.
        const modelled = new Set(String(day.modelled || "").split(/[\s,]+/)
                                 .filter(Boolean));
        for (const [k, unit, dp, tail] of [["steps", "steps", 0, ""],
                                           ["sleep_h", "h", 1, " of sleep"],
                                           ["rhr", "bpm", 0, " resting"],
                                           ["active_min", "min", 0, " active"],
                                           ["kcal_out", "kcal", 0, " out"]]) {
          if (day[k] === null || day[k] === undefined) continue;
          const f = N.rec(day[k], unit, dp);
          bits.push((modelled.has(k)
            ? N.soft(f, "The record marks this field modelled: the engine " +
                        "computed it rather than observing it, so the " +
                        "magnitude is not one it vouches for.")
            : f) + tail);
        }
      }
      const sessions = ses.map(x => {
        const mod = new Set(String(x.modelled || "").split(/[\s,]+/).filter(Boolean));
        const km = x.distance_km === null ? "" : (() => {
          const f = N.rec(x.distance_km, "km", 2);
          return ` of ` + (mod.has("distance_km")
            ? N.soft(f, "Distance the engine modelled rather than measured - " +
                        "an ergometer's conversion, not a distance travelled.")
            : f);
        })();
        // RPE is the athlete's own judgment of effort, and the engine declares
        // no scale for it. Stated in words rather than given an ink of its
        // own: prose already distinguishes "an RPE of 4" from "4 km", and a
        // reader who does not know what RPE is will not be helped by a colour.
        const eff = x.rpe === null || x.rpe === undefined ? ""
          : `, effort ${N.rec(x.rpe)} by your own judgment`;
        return `a <code>${esc(x.type)}</code>${km}${eff}`;
      });
      // What the athlete said about the day, as against what was measured of
      // it. G75: subjective and objective are different quantities, and the
      // lens has been rendering none of the first kind at all.
      /* A DECLARED SCALE IS NAMED, and the blanket disclaimer is gone.
       *
       * This said "for which it declares no scale" unconditionally, and it
       * had stopped being true: contract 26 added `mood_scale` and
       * `pain_scale`, and this demo carries `nrs-0-10` on the very rows the
       * sentence was denying. A stale claim ABOUT the record is worse than a
       * missing one, because a reader has no way to tell it from a live fact.
       *
       * Where a scale is declared it is named. Where it is not, that is said
       * per value rather than as a blanket, because absent means unstated and
       * a reader must not invent a denominator either way. */
      const said = [], scaled = [], bare = [];
      if (day) {
        const subj = (label, value, scale) => {
          if (value === null || value === undefined) return;
          if (scale) { said.push(`${label} ${N.rec(value)}`); scaled.push(`${label} on <code>${esc(scale)}</code>`); }
          else { said.push(`${label} ${N.rec(value)}`); bare.push(label); }
        };
        subj("mood", day.mood, day.mood_scale);
        if (day.feel) said.push(`the day felt <em>${esc(day.feel)}</em>`);
        subj("pain", day.pain, day.pain_scale);
      }
      return {
        text: `On ${esc(s.date)}: ` +
              (bits.length ? N.listify(bits) : "no daily figures") +
              (sessions.length ? `. Sessions: ${N.listify(sessions)}.` : ".") +
              (said.length
                ? ` You reported ${N.listify(said)} - your own account of the ` +
                  `day, which the engine keeps as a different quantity from ` +
                  `anything measured of you.` +
                  (scaled.length ? ` It declares a scale for ${N.listify(scaled)}.` : ``) +
                  (bare.length
                    ? ` It declares none for ${N.listify(bare)}, so read ` +
                      `${bare.length > 1 ? "those" : "that"} as a bare number: ` +
                      `nothing here says what it is out of.`
                    : ``)
                : ``) +
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
        // NOT "record-days". This is the provenance table's row count across
        // several datasets - 193 rows over 84 days in the demo - and calling
        // them days inflated the record 2.3x while the coverage answer said
        // 84 in the same session. Honest numbers, invented noun.
        text: `Across ${N.der(rs[0].total, "provenance rows")} (one per dated ` +
              `row in each dataset, not one per day): ` +
              N.listify(rs.map(r => `<code>${esc(r.trust)}</code> ${N.der(r.n)}`)) +
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
      /* THE NAMED METRIC IS USED, and it is a WHERE clause rather than
       * anything computed. This ignored it: asking about heart-rate
       * disagreements and about sleep disagreements returned byte-identical
       * output, listing fields that included neither. An answer that quietly
       * widens the question to the whole record is the silent-substitution
       * shape - it reads as an answer and is about something else. */
      const scoped = s.metric ? " AND field = " + sqlStr(s.metric) : "";
      const sql = "SELECT date, dataset, field, chosen_source, chosen_value, " +
                  "over_source, over_value, independent, compares FROM resolution " +
                  "WHERE disagreed = 1" + scoped + " ORDER BY date";
      const rs = query(sql);
      if (!rs.length && s.metric) {
        /* "None for that field" and "none anywhere" are different facts, so
         * the second query is what lets this say which one it means. */
        const anySql = "SELECT DISTINCT field FROM resolution WHERE disagreed = 1";
        const any = query(anySql);
        return {
          text: `No two sources disagreed about <code>${esc(s.metric)}</code>.` +
                (any.length
                  ? ` They did disagree over ` +
                    N.listify(any.map(r => `<code>${esc(r.field)}</code>`)) +
                    `, so this is that field being uncontested rather than the ` +
                    `record holding no disagreements.`
                  : ``),
          sql: [sql, anySql],
        };
      }
      if (!rs.length) {
        return { text: "No two sources disagreed anywhere in this record.", sql };
      }
      const weak = rs.filter(r => !r.independent).length;
      return {
        text: `${N.derCount(rs.length)} ${N.plural(rs.length, "time")}, over ` +
              N.listify([...new Set(rs.map(r => `<code>${esc(r.field)}</code>`))]) +
              `. The engine kept a winner each time and did not throw the loser ` +
              `away.` + (weak
                ? ` ${cap(N.derCount(weak))} of those were between sources it does not ` +
                  `consider independent, where agreement checks the copying and ` +
                  `not the measurement.`
                : ``),
        sql,
      };
    });

  /* `record` is a NOUN here far more often than a coverage word - "my
   * record", "in the record" - and it was also in SUPERLATIVE_RE, where it
   * had no EXTREMES entry at all and so could only ever block a question,
   * never route one. "Has anything in my record been corrected" was refused
   * as a request for a superlative. Removed from both. */
  intent("coverage", (q, s) => has(q, "missing", "gap", "unlogged", "logged",
                                   "coverage", "blank") ? 4 : 0,
    (q, s, query) => {
      const sql = "SELECT COUNT(*) AS logged, MIN(date) AS a, MAX(date) AS b, " +
                  "SUM(CASE WHEN coverage IS NULL THEN 1 ELSE 0 END) AS blank, " +
                  "SUM(CASE WHEN coverage = 'partial' THEN 1 ELSE 0 END) AS partial " +
                  "FROM daily";
      const r = query(sql)[0];
      return {
        text: `The record runs ${esc(r.a)} to ${esc(r.b)}, ${N.der(r.logged, "days")}. ` +
              `${cap(N.der(r.blank))} carry no coverage marking and ` +
              `${N.der(r.partial)} are marked <code>partial</code>. I am not ` +
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
        text: `Over ${N.der(rs[0].total, "weekly checks")}: ` +
              N.listify(rs.map(r => `<code>${esc(r.verdict)}</code> ${N.der(r.n)}`)) +
              `.` + (by.no_data
                ? ` The ${N.derCount(by.no_data)} <code>no_data</code> weeks are not ` +
                  `misses - the engine declines to score a week it cannot see.`
                : ``),
        sql,
      };
    });

  /* ---- SELECTION IS NOT COMPUTATION -------------------------------------
   *
   * Four test athletes all asked for a longest run, a heaviest weight, a
   * hardest session, and all four got a session count back. The refusal was
   * on-rule as the rule was WRITTEN - "may not derive a new quantity" - and
   * the rule was stricter than it needed to be.
   *
   * MAX picks a row. The number it returns already exists in the record and
   * nobody computed it. SUM and AVG produce a number that appears in no row,
   * and that is the line. "The latest weigh-in" was always allowed and is the
   * same operation with a different ORDER BY.
   *
   * The grounding test already encoded the better rule: every number in an
   * answer must be findable in the rows the answer cites. MAX passes that
   * automatically; SUM cannot. The prose rule has been brought into line with
   * the test rather than the other way round.
   */
  const EXTREMES = {
    longest:  { t: "sessions", col: "distance_km", dir: "DESC", unit: "km", word: "longest" },
    shortest: { t: "sessions", col: "distance_km", dir: "ASC",  unit: "km", word: "shortest" },
    biggest:  { t: "sessions", col: "distance_km", dir: "DESC", unit: "km", word: "biggest" },
    largest:  { t: "sessions", col: "distance_km", dir: "DESC", unit: "km", word: "largest" },
    hardest:  { t: "sessions", col: "rpe", dir: "DESC", unit: null, word: "hardest by recorded effort" },
    easiest:  { t: "sessions", col: "rpe", dir: "ASC",  unit: null, word: "easiest by recorded effort" },
    /* SELECTING THE LATEST IS THE SAME OPERATION AS SELECTING THE LARGEST.
     * "what is my longest run" answered and "what is my most recent run"
     * refused as a superlative, which is the difference between a row picked
     * by magnitude and a row picked by date - no difference at all under the
     * rule. "What did I just do" is the most basic query a record reader owes
     * its reader, and it was the one it could not answer. */
    "most recent": { t: "sessions", col: "date", dir: "DESC", unit: null, word: "most recent" },
    latest:   { t: "sessions", col: "date", dir: "DESC", unit: null, word: "latest" },
    newest:   { t: "sessions", col: "date", dir: "DESC", unit: null, word: "newest" },
    heaviest: { t: "weight", col: "kg", dir: "DESC", unit: "kg", word: "heaviest" },
    lightest: { t: "weight", col: "kg", dir: "ASC",  unit: "kg", word: "lightest" },
  };

  intent("extremum", (q) => {
    const m = q.match(SUPERLATIVE_RE);
    return (m && EXTREMES[m[1]]) ? 8 : 0;
  }, (q, s, query) => {
    const e = EXTREMES[q.match(SUPERLATIVE_RE)[1]];
    const typeFilter = (e.t === "sessions" && s.sessionType)
      ? " AND type = " + sqlStr(s.sessionType) : "";
    const cols = e.t === "sessions"
      ? "date, type, distance_km, duration_s, avg_hr, rpe, note"
      : "date, kg, origin, source, note";
    const sql = "SELECT " + cols + " FROM " + e.t + " WHERE " + e.col +
                " IS NOT NULL" + typeFilter + " ORDER BY " + e.col + " " +
                e.dir + " LIMIT 1";
    const r = query(sql)[0];
    if (!r) {
      return { text: "No row in <code>" + esc(e.t) + "</code> carries a " +
                     "<code>" + esc(e.col) + "</code>, so there is nothing to " +
                     "pick from.", sql };
    }
    /* Ordering by DATE has no magnitude to print. Formatting the ordering
     * column as a quantity gave "at NaN" for the newest row, because the
     * column was a date - the row is the answer, and there is no figure. A
     * session says how far it went instead, which is the fact the reader
     * wanted from "what did I just do". */
    const byDate = e.col === "date";
    const val = byDate ? null : N.rec(r[e.col], e.unit, e.col === "distance_km" ? 2 : 1);
    const what = e.t === "sessions"
      ? "a <code>" + esc(r.type) + "</code> on " + esc(r.date)
      : "a weigh-in on " + esc(r.date);
    const tail = byDate
      ? (r.distance_km !== null && r.distance_km !== undefined
          ? ", " + N.rec(r.distance_km, "km", 2) + "."
          : ", which recorded no distance.")
      : ", at " + val + ".";
    return {
      text: "The " + esc(e.word) + (s.sessionType ? " " + esc(s.sessionType) : "") +
            " in the record is " + what + tail +
            (r.rpe !== null && r.rpe !== undefined && e.col !== "rpe"
              ? " Effort " + N.rec(r.rpe) + " by your own judgment." : "") +
            (r.note ? " The note reads <q>" + esc(r.note) + "</q>" : "") +
            " This is a row picked out, not a figure computed. Selecting the " +
            "largest is the same operation as selecting the latest, which is " +
            "why it is allowed where a total is not.",
      sql,
    };
  }, { superlative: true });

  /* One handler for the daily metrics nobody could reach. Sleep was named in
   * the help text as a thing to ask about, and asking about it refused - the
   * tool's own instruction failed. */
  const DAILY_METRIC = {
    sleep_h: { words: ["sleep", "slept", "sleeping"], unit: "h", dp: 1, label: "sleep" },
    rhr: { words: ["resting", "rhr"], unit: "bpm", dp: 0, label: "resting heart rate" },
    mood: { words: ["mood", "happy", "happiness"], unit: null, dp: 0, label: "mood" },
    pain: { words: ["pain", "sore", "hurts"], unit: null, dp: 0, label: "pain" },
    steps: { words: ["step", "steps"], unit: "steps", dp: 0, label: "steps" },
    active_min: { words: ["active minutes"], unit: "min", dp: 0, label: "active minutes" },
    kcal_in: { words: ["ate", "eating", "calories", "kcal", "intake"], unit: "kcal", dp: 0, label: "intake" },
  };

  function metricOf(q) {
    for (const col of Object.keys(DAILY_METRIC)) {
      const m = DAILY_METRIC[col];
      if (m.words.some(w => new RegExp("\\b" + w).test(q))) return [col, m];
    }
    return null;
  }

  intent("daily-metric", (q) => metricOf(q) ? 5 : 0, (q, s, query) => {
    const found = metricOf(q);
    const col = found[0], m = found[1];
    // Latest, lowest and highest are three row selections, which is what this
    // page may do. No mean and no trend: those belong to the engine.
    const sql = "SELECT date, " + col + " FROM daily WHERE " + col +
                " IS NOT NULL ORDER BY date DESC LIMIT 1";
    const loSql = "SELECT date, " + col + " FROM daily WHERE " + col +
                  " IS NOT NULL ORDER BY " + col + " ASC, date LIMIT 1";
    const hiSql = "SELECT date, " + col + " FROM daily WHERE " + col +
                  " IS NOT NULL ORDER BY " + col + " DESC, date LIMIT 1";
    const nSql = "SELECT COUNT(*) AS n FROM daily WHERE " + col + " IS NOT NULL";
    const last = query(sql)[0], lo = query(loSql)[0], hi = query(hiSql)[0],
          n = query(nSql)[0];
    if (!last) {
      return { text: "The record carries no <code>" + esc(col) + "</code>.", sql };
    }
    const f = (r) => N.rec(r[col], m.unit, m.dp);
    const subjective = col === "mood" || col === "pain";
    return {
      text: cap(esc(m.label)) + " is recorded on " + N.der(n.n, "days") +
            ". The last is " + f(last) + " on " + esc(last.date) +
            "; the lowest " + f(lo) + " on " + esc(lo.date) +
            " and the highest " + f(hi) + " on " + esc(hi.date) + ". " +
            (subjective
              ? "That is your own account rather than anything measured of you, " +
                "and the engine declares no scale for it, so the numbers order " +
                "but do not convert."
              : "Three rows, picked out. I will not average them: a mean is a " +
                "number that appears in no row, and the engine emits none. A " +
                 "client MAY compute one and show it as its own; this one will " +
                 "not, because a lens that computes hides what the engine " +
                 "does not emit."),
      sql: [sql, loSql, hiSql, nSql],
    };
  });

  /* The gate names a precondition. Its history was unreachable, and one of
   * the three results in this record is a failure. */
  intent("checks", (q) => has(q, "hop test", "hop-test", "check", "did i pass",
                              "precondition") ? 7 : 0,
    (q, s, query) => {
      const sql = "SELECT date, slug, result, value, note FROM checks " +
                  "ORDER BY date DESC";
      const rs = query(sql);
      if (!rs.length) return { text: "The record holds no checks.", sql };
      const fails = rs.filter(r => r.result !== "pass");
      return {
        text: N.derCount(rs.length) + " " + N.plural(rs.length, "check") +
              " recorded: " + N.listify(rs.map(r =>
                esc(r.date) + " <code>" + esc(r.slug) + "</code> <strong>" +
                esc(r.result) + "</strong>" +
                (r.note ? " (" + esc(r.note) + ")" : ""))) + ". " +
              (fails.length
                ? cap(N.derCount(fails.length)) + " did not pass. A later pass " +
                  "does not retract an earlier failure, and a gate cleared on " +
                  "today's result alone is cleared without knowing that."
                : "All passed."),
        sql,
      };
    });

  intent("injuries", (q) => has(q, "injur", "achilles", "calf", "ankle",
                                "knee", "strain", "physio", "medical",
                                "diagnos") ? 7 : 0,
    (q, s, query) => {
      const sql = "SELECT date, slug, kind, title, body_site, severity, " +
                  "status, restricts, onset_date FROM medical ORDER BY date";
      const curSql = "SELECT slug, title, body_site, severity, status, " +
                     "restricts, onset_date FROM medical m WHERE date = " +
                     "(SELECT MAX(date) FROM medical WHERE slug = m.slug)";
      const rs = query(sql), cur = query(curSql);
      if (!rs.length) return { text: "The medical record is empty.", sql };
      const open = cur.filter(r => r.status !== "resolved");
      return {
        text: "The medical record holds " + N.derCount(rs.length) + " entries " +
              "across " + N.derCount(cur.length) + " " +
              N.plural(cur.length, "issue") + ". Where each stands now: " +
              N.listify(cur.map(r =>
                "<em>" + esc(r.title) + "</em> (" + esc(r.body_site) +
                ", <strong>" + esc(r.status) + "</strong>" +
                (r.onset_date ? ", onset " + esc(r.onset_date) : "") +
                (r.restricts ? ", restricts <code>" + esc(r.restricts) + "</code>" : "") +
                ")")) + ". " +
              (open.length
                ? cap(N.derCount(open.length)) + " " +
                  N.plural(open.length, "is", "are") + " not resolved."
                : "None is open.") +
              " These are effective-dated: the latest row for an issue is where " +
              "it stands, and the earlier rows are its history rather than " +
              "separate problems.",
        sql: [sql, curSql],
      };
    });

  /* Answers "why did I change it" from a RECORDED reason. Scores above the
   * causation veto's trigger because that veto is about INFERRING a cause;
   * this is reading one the athlete wrote down. */
  intent("plan-changes", (q) => has(q, "change", "changed", "edit", "edited",
                                    "moved the", "adjust", "churn",
                                    "suspicious", "loosen", "tighten") ? 8 : 0,
    (q, s, query) => {
      const sql = "SELECT date, slug, kind, metric, before, after, direction, " +
                  "deadline_pushed, reason, set_by, suspicious, unexplained " +
                  "FROM plan_churn ORDER BY date";
      const rs = query(sql);
      if (!rs.length) return { text: "The plan has not been edited.", sql };
      const flagged = rs.filter(r => r.suspicious);
      const lines = rs.map(r =>
        "<span class=\"when\">" + esc(r.date) + "</span> " +
        (r.kind === "threshold"
          ? "the <code>" + esc(r.slug) + "</code> threshold"
          : "<em>" + esc(r.slug) + "</em>") + " " +
        (r.before !== null && r.after !== null && r.before !== r.after
          ? esc(r.direction) + " from " + N.rec(r.before) + " to " + N.rec(r.after)
          : (r.deadline_pushed ? "kept its target and moved its deadline"
                               : esc(r.direction))) +
        (r.reason ? ": <q>" + esc(r.reason) + "</q>" : ""));
      return {
        text: "The plan moved " + N.derCount(rs.length) + " " +
              N.plural(rs.length, "time") + ", and the record kept a reason " +
              "each time." +
              "<span class=\"chron\">" + lines.join("<br>") + "</span>" +
              (flagged.length
                ? "The engine flagged " + N.derCount(flagged.length) + " of " +
                  "those, a loosened threshold, which it flags on principle. " +
                  "It is a flag and not an accusation, and the reason given at " +
                  "the time is in the record above."
                : "None was flagged."),
        sql,
      };
    });

  /* `overwrite`, `changed` and `edited` are how a sceptic asks this, and the
   * sceptic is the reader this answer exists for. "Did the engine ever
   * silently overwrite a value without telling me" went unrecognised while
   * "has anything been corrected" answered - the same question, and the
   * unrecognised phrasing is the one carrying the worry. */
  intent("corrections", (q) => has(q, "correct", "supersede", "retract",
                                   "typo", "amend", "overwrite", "overwritten",
                                   "rewrite", "rewritten", "altered") ? 7 : 0,
    (q, s, query) => {
      const gSql = "SELECT date, slug, title, change_kind, reason FROM goals " +
                   "WHERE change_kind = 'correction'";
      const cSql = "SELECT claim_id, dataset, date, source, merged_into " +
                   "FROM claims WHERE merged_into IS NOT NULL";
      const g = query(gSql), c = query(cSql);
      if (!g.length && !c.length) {
        return { text: "Nothing in the record is marked a correction and no " +
                       "claim has been superseded.", sql: [gSql, cSql] };
      }
      let t = "";
      if (g.length) {
        t += N.derCount(g.length) + " policy " + N.plural(g.length, "line") +
             " " + N.plural(g.length, "is", "are") + " marked a correction: " +
             N.listify(g.map(r => "<em>" + esc(r.title || r.slug) + "</em>" +
               (r.reason ? " - <q>" + esc(r.reason) + "</q>" : ""))) + ". " +
             "A correction asserts the retired line was never a real intention, " +
             "so it is kept out of the plan-stability count on purpose. ";
      }
      if (c.length) {
        t += cap(N.derCount(c.length)) + " " + N.plural(c.length, "claim") +
             " " + N.plural(c.length, "was", "were") + " superseded by a later " +
             "one. The originals are still in the log.";
      }
      return { text: t, sql: [gSql, cSql] };
    });

  intent("modelled", (q) => has(q, "modelled", "modeled", "estimated",
                                "rather than measured", "computed rather") ? 7 : 0,
    (q, s, query) => {
      const dSql = "SELECT date, modelled FROM daily WHERE modelled IS NOT NULL";
      const sSql = "SELECT date, type, modelled FROM sessions WHERE modelled IS NOT NULL";
      const wSql = "SELECT date, modelled FROM weight WHERE modelled IS NOT NULL";
      const d = query(dSql), ss = query(sSql), w = query(wSql);
      const total = d.length + ss.length + w.length;
      if (!total) {
        return { text: "No row in this record is marked modelled. That means " +
                       "nothing declares itself computed rather than observed, " +
                       "not that everything was measured.",
                 sql: [dSql, sSql, wSql] };
      }
      const bits = [];
      if (d.length) bits.push("<code>daily</code> on " +
        N.listify(d.map(r => esc(r.date) + " (" + esc(r.modelled) + ")")));
      if (ss.length) bits.push("<code>sessions</code> on " +
        N.listify(ss.map(r => esc(r.date) + " (" + esc(r.modelled) + ")")));
      if (w.length) bits.push("<code>weight</code> on " +
        N.listify(w.map(r => esc(r.date) + " (" + esc(r.modelled) + ")")));
      return {
        text: N.derCount(total) + " " + N.plural(total, "row") + " " +
              N.plural(total, "declares", "declare") + " a modelled field: " + N.listify(bits) + ". The named field on those " +
              "rows was computed rather than observed, so the magnitude is not " +
              "one the engine vouches for. Everything else is unmarked, which " +
              "means nobody said, not that it was measured.",
        sql: [dSql, sSql, wSql],
      };
    });

  // NOT "where did": that is the provenance question ("where did the numbers
  // come from") and this intent stole it. A route question names a route, a
  // path or a loop; a bare "where" is about custody far more often.
  intent("route", (q) => has(q, "route", "which way", "what route", "path",
                             "loop", "circuit", "where do i run",
                             "where did i run") ? 7 : 0,
    (q, s, query) => {
      const sql = "SELECT route, COUNT(*) AS n, MIN(date) AS first, " +
                  "MAX(date) AS last FROM sessions WHERE route IS NOT NULL " +
                  "GROUP BY route ORDER BY n DESC";
      const tSql = "SELECT date, type, distance_km, route, track FROM sessions " +
                   "WHERE track IS NOT NULL ORDER BY date";
      const rs = query(sql), tr = query(tSql);
      if (!rs.length && !tr.length) {
        return { text: "No session names a route and none carries a track.",
                 sql: [sql, tSql] };
      }
      const unnamed = tr.filter(r => !r.route);
      return {
        text: (rs.length
          ? "The athlete has a name for " + N.derCount(rs.length) + " " +
            N.plural(rs.length, "route") + ": " + N.listify(rs.map(r =>
              "<em>" + esc(r.route) + "</em> on " + N.der(r.n) + " " +
              N.plural(r.n, "session") + " (" + esc(r.first) + " to " +
              esc(r.last) + ")")) + ". "
          : "") +
        N.derCount(tr.length) + " " + N.plural(tr.length, "session") + " " +
        N.plural(tr.length, "carries", "carry") + " a stored track. " +
        (unnamed.length
          ? "One of them has a track and NO route: a place the athlete has no " +
            "name for, recorded anyway. `route` is a name a person gave " +
            "somewhere; `track` is the data, and a record where every track " +
            "has a route has conflated them."
          : "Every track sits on a named route."),
        sql: [sql, tSql],
      };
    });

  intent("weather", (q) => has(q, "weather", "rain", "rained", "raining",
                               "wind", "windy", "dry", "wet", "cold", "hot",
                               "conditions") ? 7 : 0,
    (q, s, query) => {
      // SUM(COUNT(*)) OVER (), not rs.reduce. Adding the groups up in the
      // client makes a number that appears in no row - the same defect the
      // grounding test caught in the narrator's provenance rule, committed
      // again here by the same hand a few hours later.
      const sql = "SELECT weather, COUNT(*) AS n, SUM(COUNT(*)) OVER () AS total " +
                  "FROM sessions WHERE weather IS NOT NULL " +
                  "GROUP BY weather ORDER BY n DESC";
      const dSql = "SELECT date, type, distance_km, route, weather FROM sessions " +
                   "WHERE weather IS NOT NULL ORDER BY date DESC LIMIT 6";
      const rs = query(sql), recent = query(dSql);
      if (!rs.length) {
        return { text: "No session records the weather. That is an absence in " +
                       "the record, not a run of fine days.", sql };
      }
      return {
        text: N.der(rs[0].total) + " sessions record the weather: " +
              N.listify(rs.map(r => "<code>" + esc(r.weather) + "</code> " +
                N.der(r.n))) + ". Most recently " + N.listify(recent.slice(0, 3)
                .map(r => esc(r.date) + " <code>" + esc(r.weather) + "</code>" +
                  (r.route ? " on " + esc(r.route) : ""))) + ". " +
              "The engine stores what was written down, which is a word and " +
              "not a measurement - nobody read a thermometer.",
        sql: [sql, dSql],
      };
    });

  /* The question a runner asks first, and until contract 27 no client could
   * answer it. `sessions` holds a distance and a duration, so a 10.48 km run
   * and a 9.74 km run are comparable on neither; the answer lives inside the
   * track. The engine now persists it.
   *
   * Scores above `extremum`, because "best 10k" names a DISTANCE and that is
   * a different question from "longest run" - the superlative handler would
   * otherwise take it and answer about the longest session instead. */
  const EFFORT_DIST = [
    [/\b(?:10|ten)\s*k(?:m)?\b/, 10000, "10k"],
    [/\bhalf(?:\s*marathon)?\b/, 21097.5, "half marathon"],
    [/\bmarathon\b/, 42195, "marathon"],
    [/\b(?:5|five)\s*k(?:m)?\b/, 5000, "5k"],
    [/\b(?:1|one)\s*k(?:m)?\b|\bkilometre\b/, 1000, "1k"],
  ];

  intent("best-effort", (q) => {
    if (!has(q, "best", "fastest", "quickest", "pb", "personal best", "effort"))
      return 0;
    return EFFORT_DIST.some(([re]) => re.test(q)) ? 9 : 0;
  }, (q, s, query) => {
    const hit = EFFORT_DIST.find(([re]) => re.test(q));
    const d = hit[1], label = hit[2];
    const sql = "SELECT track, date, distance_m, seconds, start, basis " +
                "FROM best_efforts WHERE distance_m = " + d +
                " ORDER BY seconds LIMIT 1";
    const allSql = "SELECT COUNT(*) AS n FROM best_efforts WHERE distance_m = " + d;
    const r = query(sql)[0], all = query(allSql)[0];
    if (!r) {
      return {
        text: "No track in this record is long enough to hold a " +
              esc(label) + ", so there is no best one. That is the record " +
              "declining to answer rather than a zero: a run shorter than the " +
              "distance cannot contain it.",
        sql: [sql, allSql],
      };
    }
    const mins = Math.floor(r.seconds / 60), secs = r.seconds % 60;
    const paceS = r.seconds / (d / 1000);
    return {
      text: "The fastest " + esc(label) + " inside any run is " +
            "<b class=\"n n-derived\">" + mins + ":" +
            String(Math.round(secs)).padStart(2, "0") + "</b>, on " +
            esc(r.date) + ". " +
            "That is a rolling window, not a lap: it can start anywhere in the " +
            "run, which is why it answers a question a distance and a duration " +
            "cannot. " + N.derCount(all.n) + " " + N.plural(all.n, "track") + " " +
            N.plural(all.n, "is", "are") + " long enough to hold one. " +
            (r.basis === "device"
              ? "Measured against the watch's own cumulative distance, which is " +
                "an observation."
              : "Measured against the haversine sum the engine computes from " +
                "the coordinates, which is a derivation and not an observation - " +
                "GPS noise inflates path length, so this reads slightly faster " +
                "than a device-measured window would."),
      sql: [sql, allSql],
    };
  }, { superlative: true });

  /* Weekly training volume, from `session_weeks` (contract 28).
   *
   * THIS IS THE GAP THIS REPO FOUND, FILLED. Until now the honest answer to
   * "how many km a week do I run" was a refusal, and the refusal said why: "I
   * will not total the distance, because that would be a quantity computed
   * here rather than one the engine emitted". Every client hit that, and the
   * engine's own issue records that the conformance client got the totals
   * wrong twice before anyone noticed. The engine emits them now, so the lens
   * renders them and still computes nothing: every figure below is a column.
   *
   * FIRST INTENT TO DECLARE `window`. Nothing else here can scope to a period,
   * which is why "how far did I run last week" refused rather than answered. A
   * week is not a window this has to compute - it is the grain the table is
   * already in, so scoping to one is a WHERE clause. Anything coarser is not,
   * and is refused below rather than approximated.
   *
   * "Last week" means the last week THE RECORD knows about, not the last week
   * on a calendar. The engine settled that for builds (a build takes its
   * viewpoint from the record's own last date) and the same reasoning applies
   * to a reader: answering from today's date would silently report a stale
   * record as an empty week. */
  /* `session_weeks` carries what a SESSION has. A daily metric is a different
   * table and a different question, and the first cut of this took "how many
   * steps did i do last week" and answered about running - a wrong answer that
   * looked like a right one, which is the failure this whole page is built to
   * avoid. Caught by the test suite rather than by reading it back. */
  const SESSION_METRICS = new Set(["distance_km", "avg_hr"]);

  intent("session-weeks", (q, s) => {
    if (!/\b(per week|a week|each week|every week|weekly|last week|this week|past week)\b/.test(q))
      return 0;
    if (s.metric && !SESSION_METRICS.has(s.metric)) return 0;
    /* A GOAL TITLE IS NOT A REQUEST FOR ITS DATASET.
     *
     * "Build to 30 km a week, injury-free" is the name of a goal, and asking
     * how it is going matched `a week` here and took the question off the
     * goals intent - which had the answer, "23.12 of 30 km a week, 77%", and
     * lost to a raw weekly dump. A tester found it within an hour of this
     * intent shipping. The failure is not that the numbers were wrong; it is
     * that a confident answer to a different question is worse than a
     * refusal, which is the thing this whole page exists to avoid.
     *
     * So a question shaped like progress-against-a-goal defers, and the goals
     * intent below now recognises the phrasing that carried no keyword. */
    if (/\b(goal|target|on track|on-track|progress|how (?:am|are|is) (?:i|we|it|things) doing)\b/.test(q))
      return 0;
    return has(q, "far", "distance", "km", "kilometre", "kilometres", "mileage",
               "volume", "train", "trained", "training", "run", "ran", "ride",
               "session", "sessions", "how much", "how many", "swim", "walk")
      ? 8 : 0;
  }, (q, s, query) => {
    /* A window this table cannot honour. Refusing by name beats answering
     * about weeks and letting it read as a month. */
    if (/\b(month|months|year|years|quarter)\b/.test(q)) {
      return {
        text: "The engine buckets sessions by <b>week</b>, and nothing in the " +
              "read model buckets them by month or year. Rolling weeks up into " +
              "a longer period is arithmetic, and it would be mine rather than " +
              "the engine's - so this is a gap in vitai rather than something " +
              "to approximate here.",
        sql: null,
      };
    }

    const lastOnly = /\b(last week|this week|past week)\b/.test(q);
    const t = s.sessionType ? s.sessionType.replace(/'/g, "''") : null;
    const where = [];
    if (t) where.push("type = '" + t + "'");
    if (lastOnly) {
      where.push("week = (SELECT MAX(week) FROM session_weeks WHERE sessions > 0)");
    } else {
      where.push("sessions > 0");
    }
    const sql = "SELECT week, type, sessions, distance_km, duration_s " +
                "FROM session_weeks WHERE " + where.join(" AND ") +
                " ORDER BY week DESC, type" + (lastOnly ? "" : " LIMIT 12");
    const rs = query(sql);

    if (!rs.length) {
      /* "Not that week" and "not ever" are different facts, and the first cut
       * reported the second for the first: asked how far they walked last
       * week, it said the record held no walk at all, which was false. An
       * empty result is scoped by whatever the WHERE clause scoped. */
      const everSql = "SELECT MAX(week) AS w FROM session_weeks WHERE sessions > 0" +
                      (t ? " AND type = '" + t + "'" : "");
      const ever = query(everSql)[0];
      const label = t ? "<code>" + esc(t) + "</code> session" : "session";
      if (lastOnly && ever && ever.w) {
        const wkSql = "SELECT MAX(week) AS w FROM session_weeks WHERE sessions > 0";
        const wk = query(wkSql)[0];
        return {
          text: "The most recent week the record holds, " + esc(wk.w) + ", has " +
                "no " + label + ". The record does hold " + label + "s - the " +
                "latest is in the week of " + esc(ever.w) + " - so this is that " +
                "week being quiet, not the activity being absent.",
          sql: [sql, everSql, wkSql],
        };
      }
      return {
        text: "No week in this record holds a " + label + " at all.",
        sql: [sql, everSql],
      };
    }

    const line = (r) =>
      esc(r.week) + " <code>" + esc(r.type) + "</code> " +
      N.derCount(r.sessions) + " " + N.plural(r.sessions, "session") +
      (r.distance_km === null
        ? " (no distance recorded)"
        : ", " + N.der(r.distance_km, "km", 1));

    /* An empty week is a fact and the engine emits a row for it, so the
     * absence of a week from this list is never silence about that week. */
    const zeroSql = "SELECT COUNT(*) AS n FROM session_weeks WHERE sessions = 0" +
                    (t ? " AND type = '" + t + "'" : "");
    const zero = query(zeroSql)[0];

    return {
      text: (lastOnly
              ? "The most recent week the record holds, " + esc(rs[0].week) + ": "
              : "Per week, most recent first: ") +
            N.listify(rs.map(line)) + ". " +
            "Every figure there is a row in <code>session_weeks</code> - the " +
            "engine bucketed and totalled these, not this page. " +
            (rs.some(r => r.distance_km === null)
              ? "A missing distance is <b>absent, not zero</b>: strength work " +
                "records no distance, and summing that as zero would report a " +
                "training week as a week of no movement. "
              : "") +
            (zero && zero.n
              ? "The record also holds " + N.derCount(zero.n) + " " +
                N.plural(zero.n, "week") + " with no sessions. A week of zeros " +
                "means <b>the record holds nothing for it</b>, which is not the " +
                "same as the athlete having done nothing - telling those apart " +
                "needs coverage, not this table."
              : "") +
            (lastOnly
              ? " \"Last week\" here means the last week this record knows " +
                "about, not the last week on a calendar."
              : ""),
      sql: [sql, zeroSql],
      /* A VIEW IS A RENDERING OF THE CITED ROWS, NEVER A SECOND SOURCE.
       * `sql: 0` names which of the cited queries it draws, so a chart cannot
       * show a figure the answer did not also cite and the trace button did
       * not also run. One week is a table - a bar chart of a single bar is a
       * worse table - and several weeks are bars. */
      view: lastOnly
        ? { kind: "table", sql: 0 }
        : { kind: "bars", sql: 0, x: "week", y: "distance_km", by: "type",
            unit: "km" },
    };
  }, { window: true });

  /* Nutrition. THE COLUMNS WERE ALWAYS THERE and nothing asked for them.
   *
   * A tester could not reach protein or calories through any phrasing and had
   * to record it as "either the lens has no intent for it, or the engine never
   * surfaces nutrition - I cannot tell from outside". The read model settles
   * it: `daily` carries `kcal_in`, `protein_g` and four more macros, and
   * `meals` holds item-level rows. This is a missing question, not a missing
   * table.
   *
   * The day figure is the ENGINE'S, and the items are items. This does not add
   * the items up and present the result as the day - that would be a total,
   * and it would also be a second, quietly different number beside the one the
   * engine emitted. */
  intent("nutrition", (q, s) =>
    (s.date ? 4 : 0) +
    (has(q, "protein", "calorie", "calories", "kcal", "eat", "ate", "eating",
        "intake", "meal", "meals", "food", "macro", "macros", "carb", "carbs",
        "fat", "sugar", "fibre", "fiber", "sodium") ? 6 : 0),
    (q, s, query) => {
      const d = s.date ? s.date.replace(/'/g, "''") : null;
      const daySql = "SELECT date, kcal_in, protein_g, fat_g, carb_g, fibre_g, " +
                     "sugar_g, sodium_mg FROM daily WHERE " +
                     (d ? `date = '${d}'` : "kcal_in IS NOT NULL") +
                     " ORDER BY date DESC LIMIT 1";
      const mealSql = "SELECT date, meal, item, grams, kcal_100g, protein_100g, " +
                      "food_table FROM meals" + (d ? ` WHERE date = '${d}'` : "") +
                      " ORDER BY date DESC, meal LIMIT 25";
      const day = query(daySql)[0];
      /* Scope the items to the SAME DAY as the figure above them. Taking the
       * latest day WITH a total and the latest day WITH items independently
       * put a 30 June figure over a 9 June meal list and read as one day.
       * Two true halves make a false sentence. */
      const onDay = d || (day && day.date);
      const mealFinal = onDay
        ? "SELECT date, meal, item, grams, kcal_100g, protein_100g, food_table " +
          `FROM meals WHERE date = '${String(onDay).replace(/'/g, "''")}' ORDER BY meal LIMIT 25`
        : mealSql;
      const meals = query(mealFinal);
      const cite = [daySql, mealFinal];

      if (!day && !meals.length) {
        return {
          text: d ? `Nothing about food is recorded for ${esc(s.date)}.`
                  : `The record holds no nutrition figures.`,
          sql: cite,
        };
      }
      const bits = [];
      if (day) {
        for (const [k, unit, tail] of [["kcal_in", "kcal", " in"],
                                       ["protein_g", "g", " of protein"],
                                       ["carb_g", "g", " of carbohydrate"],
                                       ["fat_g", "g", " of fat"],
                                       ["fibre_g", "g", " of fibre"],
                                       ["sugar_g", "g", " of sugar"],
                                       ["sodium_mg", "mg", " of sodium"]]) {
          if (day[k] === null || day[k] === undefined) continue;
          bits.push(N.rec(day[k], unit, 0) + tail);
        }
      }
      const named = [...new Set(meals.map(m => m.item))].slice(0, 8);
      return {
        text: (bits.length
                ? `On ${esc(day.date)}: ` + N.listify(bits) + `. Those are the ` +
                  `engine's day figures.`
                : `No day total is recorded${d ? ` for ${esc(s.date)}` : ""}.`) +
              (named.length
                ? ` The itemised log for that day names ` +
                  N.listify(named.map(i => `<em>${esc(i)}</em>`)) +
                  `. I am not adding those up: the day figure above is the ` +
                  `engine's, and a second total computed here would be a ` +
                  `different number wearing the same name.`
                : ` Nothing is logged item by item, so the day figure is all ` +
                  `there is - which is a thinner record, not a smaller day.`),
        sql: cite,
      };
    });

  /* Who wrote a medical entry down. `medical` carries `source`,
   * `provider_type` and `device`, and nothing asked - so "who recorded this,
   * was it a doctor" returned coverage statistics.
   *
   * This reports WHAT THE RECORD SAYS and nothing else. Naming a provider type
   * the athlete stated is class (a), an observation about the record; drawing
   * any conclusion from it would not be. */
  intent("medical-provenance", (q, s) =>
    (has(q, "who", "recorded by", "wrote", "doctor", "clinician", "physio",
         "provider") ? 4 : 0) +
    (has(q, "injur", "achilles", "calf", "ankle", "pain", "medical", "entry",
         "diagnos") ? 4 : 0),
    (q, s, query) => {
      const sql = "SELECT date, slug, title, kind, source, provider_type, device " +
                  "FROM medical ORDER BY date";
      const rs = query(sql);
      if (!rs.length) return { text: "The record holds no medical entries.", sql };
      const byProv = rs.filter(r => r.provider_type);
      return {
        text: `${N.derCount(rs.length)} medical ${N.plural(rs.length, "entry", "entries")}, ` +
              `and every one names who it came from: ` +
              N.listify(rs.map(r => `${esc(r.date)} <em>${esc(r.title)}</em> from ` +
                `<code>${esc(r.source)}</code>` +
                (r.provider_type ? `, provider type <code>${esc(r.provider_type)}</code>`
                                 : ``))) + `. ` +
              (byProv.length
                ? `${cap(N.derCount(byProv.length))} names a provider type. That is ` +
                  `what the athlete stated, not a clinician writing into this ` +
                  `record - the source on every one of these is the athlete.`
                : `None names a provider type.`),
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
      // "is the scale reliable" was answered with a provenance histogram,
      // which reads as a reliability verdict. `reliable` is a scoring keyword
      // for that intent and was missing here, so the veto leaked on the most
      // natural phrasing a sceptic uses.
      // `right` means CORRECT here, and "right now" means at this moment. The
      // veto could not tell them apart, so "am I restricted from anything
      // right now" was refused as asking for a judgment while the same
      // question without those two words answered correctly - and the help
      // text lists it as supported. Strip the temporal sense before testing.
      test: (q) => has(q.replace(/\bright\s+(now|away|there|then)\b/g, " "),
                       "reliable", "unreliable", "accurate", "inaccurate",
                       "trustworthy", "good", "bad", "better", "worse",
                       "should", "ought",
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
      // EXEMPTION: a "why" about a PLAN EDIT is not asking the engine to infer
      // a cause, it is asking to read a reason the athlete wrote down at the
      // time. `plan_churn.reason` holds exactly that. Blocking "did I change
      // my goals and why" refused a retrieval and lectured about causality,
      // which two test athletes hit independently.
      test: (q) => has(q, "why", "because", "cause", "reason for", "due to",
                       "explain why", "what made") &&
                   !has(q, "change", "changed", "edit", "edited", "adjust",
                        "loosen", "tighten", "moved the", "correct", "plan",
                        "goal", "target", "threshold"),
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
    /* A qualifier NO intent can honour is checked before the intents are, so
     * the reader gets the reason that helps. "How many weeks in a row have I
     * been on target for steps" is genuinely ambiguous between the steps goal
     * and the steps metric, and saying so is true and useless: neither can
     * count a streak, so which one was meant does not matter. */
    /* Comparison joins streak here, and for the same reason: NO intent
     * declares `comparison`, so which one would have won is irrelevant. Left
     * until after scoring, "how does june compare to may" matched nothing
     * strongly enough and fell to the generic did-not-understand, which is
     * true and unhelpful when the real answer is that a difference is a
     * number this page may not produce. */
    if (qualifiers(q).comparison) {
      const periodic = qualifiers(q).window ||
        /\b(month|week|year|versus last|vs last)\b/.test(q);
      return {
        kind: "refusal",
        refusal: "comparison",
        text: periodic
          ? "That asks for a comparison of two periods, and <b>this</b> client " +
            "will not make one. A difference between two engine figures is " +
            "objectively derivable - the same rows give the same answer to " +
            "anyone - so a client MAY compute it, showing it as the client's " +
            "own number rather than the engine's. This one does not, on " +
            "purpose: it is the conformance client, and a lens that quietly " +
            "computes what the engine does not emit hides the gap from " +
            "everyone. The engine emits no period comparison, and that is the " +
            "thing worth knowing."
          : "That asks for a comparison, and I cannot make one. Setting two " +
            "groups against each other means deciding what counts as the " +
            "difference between them, and that decision would be mine rather " +
            "than the engine's. Counting each group is a different question " +
            "and one this page can answer - ask for the count and name the " +
            "group, and you will get both figures without a verdict attached.",
        sql: null,
        matched: null,
      };
    }
    /* Ambiguous metric word, refused here for the same reason as the two
     * below: no intent can honour it, so which one would have won is
     * irrelevant and scoring first would give the reader a true but useless
     * reason. */
    const amb = ambiguousMetric(q);
    if (amb) {
      return {
        kind: "refusal",
        refusal: "ambiguous-metric",
        text: `<em>${esc(amb.word)}</em> names two different measures in this ` +
              `record, and nothing in the question chooses between them: ` +
              N.listify(amb.candidates.map(
                ([f, why]) => `<code>${esc(f)}</code>, ${why}`)) + `. ` +
              `Picking one and answering confidently is the shape of mistake ` +
              `this page exists to avoid, so it is not picking. Ask for the ` +
              `resting heart rate or the session average by name and either ` +
              `will answer.`,
        sql: null,
        matched: null,
      };
    }
    if (qualifiers(q).streak) {
      return {
        kind: "refusal",
        refusal: "streak",
        text: "That asks for a streak, and <b>this</b> client will not count " +
              "one. Walking the rows in order and stopping at the first break " +
              "is objectively derivable - the same rows give the same answer " +
              "to anyone - so a client MAY do it and show it as its own " +
              "number. This one does not, because it is the conformance " +
              "client and a lens that computes what the engine does not emit " +
              "hides the gap. The engine emits no streak, and the nearest " +
              "figure it has - the latest period alone - is a different " +
              "answer wearing the right shape.",
        sql: null,
        matched: null,
      };
    }
    let best = null, bestScore = 0;
    const scored = [];
    for (const it of INTENTS) {
      let sc = 0;
      try { sc = it.score(q, s, query) || 0; } catch { sc = 0; }
      if (sc > 0) scored.push({ it, sc });
      if (sc > bestScore) { bestScore = sc; best = it; }
    }
    /* AN INDECISIVE MATCH IS NOT A MATCH.
     *
     * The winner was whichever intent happened to be registered first among
     * those tied at the top, which is registration order deciding what a
     * question means. Three testers hit the consequence and none of them
     * reported a wrong number: they reported a well-formed, confident answer
     * about something they had not asked, which is the one shape this page
     * has no defence against.
     *
     * `matchGoal` already refuses a tie for the same reason. This is that
     * rule applied one level up, to the choice of question rather than the
     * choice of row - and it is this repo's own discipline pointed at the
     * router. The page refuses to compute a figure it cannot ground; refusing
     * to GUESS WHICH QUESTION was asked is the same sentence. */
    const tied = scored.filter(x => x.sc === bestScore);
    if (best && bestScore >= FLOOR && tied.length > 1) {
      const names = tied.map(x => `<code>${esc(x.it.id)}</code>`);
      return {
        kind: "refusal",
        refusal: "ambiguous",
        text: `I can read that ${tied.length} ways - as ` + N.listify(names) +
              ` - and nothing in the question chooses between them. Rather than ` +
              `pick one and answer confidently about the wrong thing, I am ` +
              `stopping here. Naming a metric, a session type or a goal will ` +
              `settle it.`,
        sql: null,
        matched: null,
      };
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
    /* A qualifier the winner cannot honour is a miss, and a miss is a
     * refusal. Answering the un-qualified version of the question is the one
     * behaviour this design exists to prevent. */
    const qual = qualifiers(q);
    const h = best.handles || {};
    /* No `streak` branch here: it is handled before the intents are scored,
     * because no intent handles it and the ambiguity refusal would otherwise
     * win and give the reader a true but useless reason. */
    const blocked =
      (qual.window && !h.window
        /* Name the window the reader actually gave. This said "let it read as
         * your week" whatever the qualifier was, so asking about June was
         * refused with a sentence about a week - a refusal that misstates its
         * own reason, which sends the reader to correct the wrong thing. */
        ? { what: `the time window <em>${esc(qual.window)}</em>`,
            why: "I can count rows in a window, but this answer is not one " +
                 "that scopes - so rather than quietly report the whole " +
                 `record and let it read as ${esc(qual.window)}, I am ` +
                 "stopping here." }
      : qual.superlative && !h.superlative
        ? { what: `<em>${esc(qual.superlative)}</em>`,
            why: "Picking out the largest or the best means selecting a row, " +
                 "which this answer does not do. It would have given you a " +
                 "count or a total instead, which is not what you asked." }
      /* The reason has to match the comparison actually asked for. This
       * always said "comparing two PERIODS", so "runs self reported versus
       * tracked by device" - a comparison of categories, with no period in
       * it - was refused with a sentence about time. A refusal that misstates
       * its own reason sends the reader to correct the wrong thing, which is
       * worse than a terse one. */
      /* No `comparison` branch: handled before the intents, like `streak`,
       * because no intent declares it. */
      : qual.aggregate && !h.aggregate
        ? { what: `<em>${esc(qual.aggregate)}</em>`,
            why: "A total or an average is a number that appears in no row. " +
                 "Counting rows is fine and this page does it; adding up the " +
                 "values inside them is arithmetic the engine has not done " +
                 "and has not tested." }
      /* Phase 1.2, and the one that motivated the slot half of this guard.
       * Dropping a filter is worse than dropping a window: the answer is
       * about a strictly larger set than the question, and the figure looks
       * exactly like the one that was asked for. */
      : qual.origin && !h.origin
        ? { what: `a filter on where the rows came from (<em>${esc(qual.origin)}</em>)`,
            why: "This answer counts every row of its kind and cannot narrow " +
                 "them by who or what observed them. Answering anyway would " +
                 "hand you a figure for the whole set wearing the shape of " +
                 "the subset you asked about, and nothing in the sentence " +
                 "would tell you which one you were reading." }
      : null);
    if (blocked) {
      return {
        kind: "refusal", refusal: "qualifier", matched: best.id, sql: null,
        text: `Your question asks for ${blocked.what}, and I cannot honour ` +
              `that here. ${blocked.why}<br>` +
              `I did recognise the rest of it and would have answered as ` +
              `<code>${esc(best.id)}</code>. Ask it without the qualifier and ` +
              `you will get that answer, scoped to the whole record and ` +
              `labelled as such.`,
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
