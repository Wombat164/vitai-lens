# Roadmap: wiring in the synthetic athletes' findings

Three synthetic athletes used the ask box for half an hour each on 2026-08-05:
a **sceptic** who wanted provenance for every number, an **injured returner**
who wanted to know what she was allowed to do, and a **goal-driven** runner who
wanted a scoreboard. They produced 25 findings between them.

Every finding below was **reproduced by hand** before it was written down. A
roadmap of unverified reports is a wish list, and the reproducing question is
recorded with each item so nobody has to rediscover the phrasing.

## The diagnosis, and it is one thing

Sorting the findings by symptom gives two piles, and both are the same defect:

**(A) Silent substitution.** A confident, well-formed answer to a question
nobody asked. `on-date` returns step count for "how far did I run on
2030-06-24". `weight` returns the same sentence whatever you ask it. `conflicts`
returns byte-identical output for heart rate and for sleep. A streak question
returns a single-week snapshot.

**(B) Keyword misfire.** A word fires a rule meant for its other meaning.
"doesn't that **mean** I'm healed" refused as a request for an average. "how
many **total** sessions" refused as arithmetic. "my **record**" parsed as a
superlative. "am I restricted from anything **right now**" refused as a
judgement, while the same question without those two words answers correctly.

**The root cause is the same for both: the router matches keywords and has no
way to say "I am not sure which question this is."**

That is worth stating precisely, because it is this repo's own rule with one
word changed. The lens refuses to **compute** a figure it cannot ground. It
does not refuse to **guess which question** was asked, and a guess there
produces something indistinguishable from an answer. Athlete 1 put it better
than the design did:

> A tool built entirely around "never claim what the engine didn't emit" should
> apply that same discipline to intent-matching itself: when it isn't sure
> which metric or which goal a loosely-phrased question means, it should say so
> and ask.

Every phase below is that sentence, applied somewhere.

## Phase 0: follow the engine (standing, always first)

Added 2026-08-15, because this document was missing the one kind of work this
client exists to do. Everything below is about ANSWERING WELL; this is about
being the instrument, and where the two compete this wins.

The rule: **the canary is only worth having if its next red means something.**
A conformance client that goes red when the engine moves is working. One that
has been red since Thursday is furniture, and a reader has correctly learned to
scroll past it. Catching up is therefore not maintenance to be fitted around
features - here it IS the feature.

- **Follow 47** - DONE 2026-08-15. Pin moved 46 to 47, demo rebuilt, suites
  green. The canary had been red three consecutive mornings (13th, 14th, 15th)
  against an engine that moved on the 12th, which is what prompted this
  section existing at all.
- **Render `crossings`** - DONE 2026-08-16 (contract 47), and the `band` kind
  plus an unknown-kind refusal followed at 48. Round-number, personal-first and
  band milestones read from the weight series, goal-independent - so unlike
  every other progress figure here, they say something on a record with no goal
  declared.
- **Run the contract-38 subtraction** - RUN 2026-08-16, and it is **not a
  subtraction**. Nothing is deleted. See "What the subtraction actually found"
  below.
- **Close or rescope issue #4** - DONE 2026-08-16. Rescoped rather than closed:
  the twelve-contract gap is gone, and what remains under it is real.
- **Re-measure Phase 4.1's coverage numbers before building on them** -
  MEASURED 2026-08-16, below. Not acted on.

### What the subtraction actually found

The item assumed the engine publishes `units` and `aliases` in a form this
client can consume, so the local tables could be deleted. Measured against the
engine at contract 48, all three premises fail, and the third fails hardest.

**The read model does not carry them.** `health.db` has 40 tables and none is
`units` or `aliases`. They are returned by `vitai.api.field_types()`, a PYTHON
function. This client is a browser reading a SQLite file through sql.js and has
no Python at runtime, so there is nothing here to read. Adopting them at all
would need a generated artifact, built through the engine the way `demo/`
already is, so the `conformance` job would catch it going stale. That is a
build-step proposal, not a deletion.

**The unit map is a different fact from the engine's units.** The engine
publishes `{label, ucum}`: a word and an authoritative code. This client prints
a display SYMBOL, which is neither. Eleven of the twelve local entries have an
engine entry, and two of those disagree in a way that would be visible on
screen:

| field | lens prints | engine `ucum` | engine `label` |
|---|---|---|---|
| `rhr`, `avg_hr` | `bpm` | `/min` | beats per minute |
| `steps` | `steps` | `{steps}` | steps |

`/min` and `{steps}` are correct UCUM and wrong on a page. The remaining nine
happen to coincide with the UCUM code. `external` is a local sentinel meaning
"this quantity has no unit" and has no engine entry at all. **So the display
symbol is a third thing the engine does not publish**, and that gap is worth an
issue upstream rather than a deletion here.

**The alias map is a union with a conflict, not a superset.** Of 32 local
entries, 12 are published by the engine and 20 are not. In the other direction
the engine publishes 22 aliases this client does not have. The two lists are
built for different matchers: the engine's are phrases ("how far", "how much
sleep", "resting heart rate", "step count"), this client's are single tokens,
because its tokeniser splits on whitespace and drops stopwords before matching.

One is not a gap but a **disagreement**: the engine maps `pulse` to `avg_hr`,
and this client maps it to `rhr`. Two clients answering "what was my pulse"
would return different metrics, and neither is marked as a guess. That is a
routing defect and is listed with the Phase 1 work rather than fixed in
passing.

### Phase 4.1 coverage, re-measured 2026-08-16

Measured against `demo/health.db` at contract 48. The old figures were "17 of
35 tables read by no surface, 100 of 433 columns null".

| | old | now |
|---|---|---|
| tables | 35 | **40** |
| read by no surface | 17 | **20** |
| columns | 433 | **577** |
| wholly null in the demo | 100 | **144** |

The null figure splits, and the halves are different facts. **38** of the 144
are columns of the four tables the demo leaves EMPTY (`artifacts`,
`escalations`, `protocols`, `regimes`) - null because there are no rows, which
says nothing about the column. The other **106** are genuinely unfilled columns
in the 539 columns of populated tables.

"Read by no surface" counts a table with no `FROM` or `JOIN` naming it in
`narrator.js`, `ask.js`, `index.html` or `tools/narrate.js`: `artifacts`,
`capabilities`, `comparability`, `conservation`, `context`, `contributions`,
`emissions`, `escalations`, `events`, `inferences`, `instruments`, `journal`,
`justifications`, `measurements`, `plans`, `protocols`, `regimes`,
`retractions`, `sets`, `thresholds`.

Recorded so the next person builds on a denominator that is true.

**One of the twenty is now read: `capabilities`.** It was taken first because
it is the only one on the list that QUALIFIES other numbers rather than
reporting its own, and because this client's own audit of the word `pulse`
turned on one of its rows - a statement that decides a question about the
record belongs where a reader can see it. It is stated and never applied: a
capability is keyed on `origin`, the rows it would qualify here name none, and
inventing that join is exactly what the engine's `unknown` rule forbids.

**The other nineteen stay open, and not as a sweep.** Each wants the same
question asked of it: does this table qualify or contradict something already
on the page, or is it only absent? A table that merely has no surface is a
blank space, and RULES.md is explicit that blank spaces are the roadmap rather
than a backlog to burn down.

## Status

**Done** (2026-08-05): the three routing fixes below, all of Phase 2, Phase
3.2, and Phase 3.3 - which turned out to be a false positive hiding a real
bug, recorded in its own section. **2026-08-15**: Phase 0's catch-up to 47.
**2026-08-16**: Phase 0 clears - 48 followed, `crossings` rendered with all
three kinds and an unknown-kind refusal, the contract-38 subtraction run and
answered, issue #4 rescoped, Phase 4.1 re-measured.

**Open**: Phase 1, Phase 2.5 (the `versus` half) and 2.6, Phase 3.1, 3.4,
3.5, 3.6 and 3.7, and all of Phase 4. **The engine track is filed.**

### The three routing fixes

All three found by the athletes:

- **A goal title is not a request for its dataset.** `session-weeks` matched
  `a week`, and a goal here is titled "Build to 30 km a week, injury-free", so
  asking how it was going returned a raw weekly dump instead of 77%.
- **Goal words are matched as words, not substrings.** "Enjoy running AGAIN"
  matched "how did I do AGAINST my step goal", won outright, and the tool said
  nothing could score it about a goal scored at 85% one row away.
- **A tie is not a match.** Three goal titles end in "a week", so one shared
  word picked whichever came first. An indecisive match now lists every goal
  with its figure.

All three are mutation-tested.

## Phase 1: let the router refuse

The spine. Most of pile (A) disappears here, and the rest gets cheaper.

**1.1 An indecisive intent match says so.** Generalise what `matchGoal` now
does for goals to intent selection itself: when the top-scoring intent is not
decisively ahead, the honest answer names the readings and asks which was
meant, rather than running the winner.

*Old repro, RETIRED 2026-08-16: "how many sessions have I logged" routed to
`coverage`. It no longer does - `sessions` takes it 6 to 4, settled by one of
the three routing fixes. Recorded as retired rather than deleted, so nobody
re-reports it.*

***Current repro, derived against contract 48:* "how is my weight goal"**
returns the latest weigh-in - "The last weigh-in is 75.5 kg on 2030-06-30" -
rather than the goal's progress. There IS a goal slugged `weight`, titled "Down
to 78 kg, unhurried", and `matchGoal` resolves it from that exact question.
`weight` beats `goals` 7 to 6. The same sentence about steps answers correctly,
because `steps` is a weaker metric word than `weight` is - so one question
shape gives two different kinds of answer depending on which metric it names.

### What the margin rule should be, and the measurement says: none

Measured over the 56 questions the suite answers, at contract 48.

**Half of all answers have no rival at all.** 28 are SOLE matches - exactly one
intent scores above zero - so there is no margin to threshold and no rule of
this shape can reach them. The winning scores there run 4 to 10; none sits at
the floor.

**Of the 28 contested answers, the margins are:**

| margin | answers | all correct? |
|---|---|---|
| 1 | 12 | yes |
| 2 | 5 | yes |
| 3 | 1 | yes |
| 4 | 10 | yes |

**A "must be N ahead" rule is not a badly-chosen threshold. It has no signal
at all.** Every margin-1 answer in the corpus routes correctly - `conflicts`
over `provenance`, `injuries` over `gate`, `weight` over `provenance`,
`extremum` over `weight`, `goals` over `daily-metric`. Requiring a margin of 2
would refuse twelve correct answers and catch zero wrong ones.

There is a structural reason, and it is worth recording because it will hold
after the numbers move. The three routing fixes made decisive words decisive,
so where two intents now finish close, they are close because they are two
routes to the SAME subject. Where two intents point at genuinely different
subjects, they land on an EXACT tie - `goals` against `daily-metric`, both 5,
on "how am I doing on steps" - and the tie rule already refuses that.

**So 1.1 needs no threshold, and the one case that still reproduces is not a
margin problem.** "How is my weight goal" names a goal, `matchGoal` resolves
it, and the winning intent does not honour goals. That is Phase 1.2's shape -
a slot the answerer cannot honour - with `goal` as the slot. The margin of 1 is
incidental to it.

Recommendation: **do not add a margin threshold.** Declare `goal` as a slot in
the 1.2 pass, and 1.1 closes with it. If a later corpus produces a near-tie
that routes wrongly and carries no unhonoured slot, reopen this with that case
attached rather than with a number.

**1.2 An answerer that receives a slot it cannot honour must refuse, not
ignore.** The qualifier guard already does this for windows, superlatives and
comparisons. Extend it: if the question named a metric, a session type, an
origin or a goal and the answer does not use it, that is a miss and a miss is a
refusal.

*`origin` DONE 2026-08-16. Repro was "how many of my runs are self reported",
which returned every run with the filter silently dropped; it now refuses and
names the filter it could not honour. Origin is declared per intent rather than
vetoed before scoring, because `weight` genuinely honours it. The run count in
the original report was 28 and is 26 on the current demo - the defect was the
dropped filter, not the figure.*

*Remaining: `metric`, `sessionType` and `goal`, one declaration pass per
intent. **`goal` is the one to do first** - it is what 1.1's surviving repro
turns out to need.*

## Phase 2: stop the keyword misfires

**2.1 DONE. `mean` as a verb is not an average.** *Repro: "pain is 0 now, doesnt that
mean im healed" and "no I mean specifically the weight measurements" both
refuse with the arithmetic boilerplate.* Decide it syntactically - "that mean",
"I mean", "does X mean" are verbs; "the mean", "mean of" are nouns.

**2.2 DONE. `total` next to a countable noun is a count, and counting is legal.**
*Repro: "how many total sessions have I logged" refuses; the rule that counting
rows is permitted is stated in RULES.md and demonstrated one question later.*

**2.3 DONE. "most recent" is a selection, not an aggregate.** *Repro: "whats my most
recent run" refuses as a superlative; "whats my longest run" answers, and its
own text says selecting the largest is allowed. Selecting the latest is the
same operation.* Fixing this also gives the record its most basic query: what
did I just do.

**2.4 DONE. "right now" must not turn a supported question into a refusal.** *Repro:
"am I restricted from anything right now" refuses as a judgement; without those
two words it answers correctly, and the help text lists it as supported.* The
record's own horizon is the answer to "now" - the same reasoning `session-weeks`
uses for "last week".

**2.5 The refusal text must match the reason.** *Repro: "runs self reported
versus tracked by device" is refused with the wording for comparing two time
PERIODS.* A refusal that misstates why it refused is worse than a terse one,
because the reader corrects the wrong thing.

*(Half of this landed 2026-08-05: the window refusal hardcoded "let it read as
your week" whatever the qualifier was, so asking about June was refused with a
sentence about a week. It names the window given now. The `versus` case is
still open.)*

**2.6 Counting inside a date window is OURS, and the lens is over-refusing.**
*Repro: "how many runs did I do in June" refuses, saying the answer "is not one
that scopes".*

**This was mis-filed as an engine gap in the first draft of this document**,
carried over from athlete 3's own classification without being checked. It is
wrong, and the correction matters because it moves an item from "wait for the
engine" to "a `WHERE` clause":

- `RULES.md` states it outright: *"Counting is a property of the query, so
  `COUNT(*)` is allowed."*
- A date range is `WHERE date BETWEEN ... AND ...`, which is selection.
- The answer on the current demo is **12**, reachable today with no engine
  change at all.

The line, stated precisely so the next reader does not have to re-derive it:

| question | operation | whose job |
|---|---|---|
| how many runs in June | `WHERE` + `COUNT` | **the lens.** Both permitted |
| how far did I run in June | `WHERE` + `SUM` | the engine. A total is not ours |

So a window is not inherently unhonourable - it depends entirely on what is
being asked *of* the window. The current guard treats every window the same
because no intent could scope at all when it was written; `session-weeks` was
the first that could, and this is the second.

## Phase 3: intents that ignore their own parameters

**3.1 `weight` answers the question asked.** *Repro: "how many weigh ins came
from the scale" returns "the last weigh-in is 75.9 kg", as does every other
weight question.* It is a fixed template wearing an answer's clothes.

**3.2 DONE. `conflicts` filters by the metric named.** *Repro: heart-rate and sleep
disagreement questions return byte-identical output, listing fields that
include neither.*

**3.3 WITHDRAWN as reported, and it found something else.** The finding was
that `on-date` never surfaces sessions. **It does** - there was simply no
session on the date the tester picked, and they inferred one existed because
the sessions *range* spanned it. Verifying before building is what caught it.

What verifying found instead was real: the answer claimed *"for which it
declares no scale"* unconditionally, and contract 26 had made that false - the
demo carries `nrs-0-10` on the very rows the sentence denied. A stale claim
ABOUT the record is worse than a missing one, because a reader cannot tell it
from a live fact. Fixed, along with three answers that slipped into the third
person about the reader's own record.

**3.4 A streak question refuses instead of substituting.** *Repro: "how many
weeks in a row have I been on target for steps" returns the latest single-week
snapshot with no indication it is not a streak.* The engine emits no streak;
saying so is the correct answer and is Phase 1.2's shape.

**3.5 Voice and formatting.** `on-date` slips into the third person ("he
reported mood 9") where the rest of the page addresses the reader directly; the
help answer and the plan-changes answer run sentences together without a space.
Cosmetic, and on a page whose pitch is precision they undercut the pitch.

## Phase 4: the lens as an auditor of the engine

New capability rather than repair. The lens exists to keep the engine honest,
and it currently does that only when a human happens to ask the right question.

**4.1 A coverage surface: what this client cannot see.** Measured on the
current demo: **17 of 35 tables (49%) are read by no lens surface at all**,
including `justifications` (1691 rows) and `contributions` (196). **100 of 433
columns (23%) are entirely null.** This is the engine's own
specified-and-never-written check computed from the consumer side, and it needs
nothing the rule forbids - `COUNT` and `pragma` are selection.

**4.2 A refusal ledger.** Every refusal, with its reason, accumulated. The
repo's thesis is that a refusal is a finding against vitai; today a finding
only exists if someone happens to ask. This makes the findings list generate
itself - it is what three athletes were paid to do by hand.

**4.3 Contract diff instead of a bare wall.** The gate says "built against 27,
database says 28" and stops. It could say which tables and columns are new,
which turns a refusal into the report a client author actually needs.

**4.4 Two-database compare.** Point the lens at two builds of one record and
diff them. That tests the engine's central promise - a build is a function of
the record - from outside, which is the one thing vitai's own suite cannot do.

## The engine track: FILED 2026-08-05

Every item was checked against the built read model before filing, and that
check moved four of them. Consolidated into three new issues and two comments
rather than thirteen, because several were one question:

| filed | covers |
|---|---|
| [vitai#273](https://github.com/Wombat164/vitai/issues/273) | a level goal is not an accumulation goal. "Down to 78 kg" scores as a floor, counts nothing, reports no progress |
| [vitai#274](https://github.com/Wombat164/vitai/issues/274) | the demo cannot exhibit two shipped contracts: every goal is `floor`, no week is empty |
| [vitai#275](https://github.com/Wombat164/vitai/issues/275) | a gate restricts one word, so "may I walk" and "may I run" get the same answer |
| comment on [#209](https://github.com/Wombat164/vitai/issues/209) | the scoreboard cluster: deltas, windowed totals, averages, streaks. That issue already owns the question |
| comment on [#262](https://github.com/Wombat164/vitai/issues/262) | forward projection. Already its subject |

### What the check changed

**Two items were OURS, not the engine's.** Both were filed by the athletes as
engine gaps with the honest caveat that they could not tell from outside. The
read model settles it:

- **Nutrition is reachable.** `daily` carries `kcal_in`, `protein_g`, `fat_g`,
  `carb_g`, `fibre_g`, `sugar_g` and `sodium_mg`, and `meals` has rows. The
  engine surfaces nutrition; **this client has no intent for it.** Added as
  Phase 3.6 below.
- **Medical entries carry provenance.** `medical` has `source`,
  `provider_type`, `device` and `recorded_at`, so "who recorded the achilles
  entry" is answerable and nothing asks it. Added as Phase 3.7 below.

**One was a duplicate**: forward projection is #262's whole subject.

**One was mis-classified by me** and is corrected in 2.6 above: counting inside
a date window is a `WHERE` clause and belongs here, not upstream.

### Confirmed absent, and worth knowing together

`streaks`, `baselines`, `features`, `forecasts`, `energy_audit` and
`source_reliability` are all listed in `docs/model.md` under artifact kind 2
and none exists in the read model. They are designed and unbuilt. #209's
"figures every consumer wants that no table offers" is a longer list than the
four tiles it was raised for.

## Phase 3.6: nutrition has no intent

*Repro: "how much protein did I eat on 2030-06-16" returns the day summary
with no nutrition figure; "protein" alone is unrecognised.* The columns are
there. This is a missing question, not a missing table.

## Phase 3.7: medical provenance has no intent

*Repro: "who recorded this, was it a doctor" returns coverage statistics.*
`medical.source` and `medical.provider_type` answer it.

## Sequencing

Phase 1 first, because it is the root cause and it makes Phases 2 and 3 smaller
- several of those items become instances of "the router was not sure and said
so" rather than separate repairs.

Phase 3.3 (`on-date` and sessions) is the exception and should be pulled
forward: it is self-contained, it is the single most damaging gap for a real
reader, and it does not depend on Phase 1.

Phase 4 is new capability and can run in parallel with any of it; 4.1 is the
one with a measured payoff already.

The engine track is not sequenced here - it belongs to vitai's own work order.

## Changelog

- 2026-08-05 - written, from three synthetic athlete sessions. Every finding
  reproduced by hand first; three routing fixes already landed.
