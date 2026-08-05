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

## Status

**Done** (2026-08-05): the three routing fixes below, all of Phase 2, Phase
3.2, and Phase 3.3 - which turned out to be a false positive hiding a real
bug, recorded in its own section.

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
meant, rather than running the winner. *Repro: "how many sessions have I
logged" routes to `coverage`.*

**1.2 An answerer that receives a slot it cannot honour must refuse, not
ignore.** The qualifier guard already does this for windows, superlatives and
comparisons. Extend it: if the question named a metric, a session type, an
origin or a goal and the answer does not use it, that is a miss and a miss is a
refusal. *Repro: "how many of my runs are self reported" returns all 28 runs
with the filter silently dropped.*

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
