# The visual language, and how to port it

This is the design that came out of building the lens. It is written to be
reusable - loadline is the intended second consumer - so it separates the
principle from the lens-specific implementation.

## The principle: one question per channel

Every mark on a number answers a question. The failure mode is stacking two
questions onto one channel, because then a reader must decode before they can
read, and a page where nothing is legible at a glance is a page where
everything gets skimmed.

So: **one channel, one question.** Adding a distinction means finding a free
channel, not subdividing a used one.

| Channel | Question it answers | Values |
|---|---|---|
| Colour | Where did this number come from? | recorded, derived |
| Dotted underline | How much does the magnitude claim? | soft (modelled or ordinal), or nothing |
| Weight | Is this a figure or prose? | bold on figures |
| Words | Is this about the world or the person? | subjective values are named, not inked |
| Position | What is this narrative about? | measurement narrative sits under its chart |
| Badge | What kind of entity is this? | *see below* |
| Strikethrough | Was this discarded? | resolution losers |
| Muting | Is this absent, or agreed, or historical? | absence, agreements |

## The test for adding a mark

> Does confusing the two lead a reader to a wrong conclusion **about their own
> body**?

Recorded against derived passes: a derivation inherits every assumption in its
inputs, and a reader who reads it as an observation over-trusts it.

Modelled against measured passes: `2.8 km` off a crosstrainer console reads
exactly like `2.8 km` measured, and it is the only distinction that is
genuinely invisible in prose.

Most candidates fail the test, and the rejections matter as much as the
adoptions - a page that marks everything has marked nothing.

## The two inks

**Recorded** - a value that entered the record from a source. Something
observed it: a scale, a watch, the athlete's own statement.

**Derived** - a value computed from other values. A percentage, an aggregate,
a count. Including counts made by the client itself: "may state how many times
the engine stated it" makes counting legal, it does not make a count an
observation.

They are set in different ink because they sit in the same sentence. *"13.38 of
30 km a week, 45%"* is an engine aggregate, a target the athlete set, and a
percentage computed from both - three kinds of claim, three inks would be too
many, two plus a rule is right.

**Do not reuse chart series colours for text.** The lens's teal is 3.0:1 on
white, which is fine for a 3px dot and fails as text. Number inks are a
darkened pair at 5.5:1 and 5.0:1, with a light pair for dark mode.

**Units take the colour and not the weight**, and use the symbol where one
exists. The number is the figure; the unit is a label on it. A symbol binds to
its number (`45%`), a word does not (`13.38 km`).

## Badge versus code: an orthogonal that is easy to conflate

A monospace span and a badge look like stylistic alternatives and are not. They
name different things, and using one for both is a conflation the lens made
before it noticed:

- **`code` is a SCHEMA IDENTIFIER.** A column name, a slug, a precondition,
  a field the athlete could look up. `kcal_in`, `hop-test`, `running`.
  Monospace says "this is a name in the system", and the reader may go and find
  it.
- **A badge is a VALUE FROM A CLOSED VOCABULARY.** A status, a verdict, a
  verification method. `sustaining`, `on_target`, `attested`. It is one of a
  known small set, and the useful property is that a reader learns the set.

The rule that separates them: **could this string be looked up in the schema
(code), or is it one of the schema's permitted answers (badge)?**

Badges also want a second rule, or they metastasise: **a badge labels an
ENTITY, ink modifies a QUANTITY.** A goal is an entity and can carry a badge
saying how it is verified. A number is a quantity and takes ink. Nothing takes
both for the same reason.

## What was considered and rejected

**Subjective versus objective.** Real (G75), and the lens rendered no
subjective data at all until it was raised. But prose already distinguishes "an
RPE of 4" from "4 km", and a reader who does not know what RPE is will not be
helped by a colour. Surfaced in words instead.

> The adjacent finding said the engine declared no scale for `rpe`, `mood` or
> `pain`, so rendering "4 out of 10" would invent a denominator (vitai#246).
> **That is fixed at contract 26**: `rpe_scale`, `mood_scale` and `pain_scale`
> name a registry entry, and the value is validated against its range where one
> is declared. Absent still means unstated, and a reader still may not invent a
> denominator - but where the record declares one, the lens may now show it.
> Not yet done here.

**Pie charts.** Rejected on the rule rather than on taste. A pie encodes each
slice as a proportion of a total, so its geometry *is* a percentage, and a
percentage of values this page did not receive as a percentage is a number it
computed. Bar heights and an axis maximum are also arithmetic and are allowed,
which looks inconsistent until you ask what a reader takes off the screen: a
bar's height is read against a labelled axis that is on the page, and a slice's
angle is read as a share of a whole nobody printed. A stacked bar gives the
same comparison and keeps the axis. If the engine ever emits a share, a pie of
that share is fine, because then it is a column.

**Intervals.** An interval is its own marking. `76.4 (75.9-76.9)` says more
than any badge, and a badge meaning "there was an interval here" is strictly
worse than the interval.

**Contested values.** Every value the resolver adjudicated could be marked,
which in practice means most of the record. Gets its own surface instead, where
the comparison is shown rather than gestured at.

**Per-number provenance.** Already answered in three places - the chart's
marks, the tooltips, the resolution table. A fourth would need a third and
fourth ink for a question that is not going unanswered.

**Staleness.** Considered, and handled by always rendering the date rather than
by a mark. A number whose date is on screen is not silently stale. This one may
need revisiting in a live app, where "last weigh-in 75.9 kg" three months old
is a different claim from the same words yesterday.

## Two axes that are still open

**Coverage-weighted derivation.** A weekly aggregate over a week with three
unlogged days is weaker than the same figure over seven, and nothing says so.
This is the strongest unmarked axis: it fails the test in the dangerous
direction, because the reader concludes something about their body from a
number whose base they cannot see.

**Declared versus inferred.** `goal_progress` carries `scope`
(declared / inferred / undeclared) and `set_by`. A goal the engine proposed
from observed behaviour and one the athlete set are different objects, and
"how are your goals going" currently lists them together. A badge, not an ink -
it labels the entity.

## Porting to loadline

What transfers unchanged:

- The channel table and the one-question-per-channel rule.
- Recorded versus derived. Any client rendering this engine's output has the
  same two kinds of number and the same reason to separate them.
- Units as symbols, coloured, unbolded.
- Badge versus code.
- The test for adding a mark.

What does not transfer, and why:

- **Loadline MAY compute, and so it has a third class.** This entry has been
  wrong twice today and the history is worth keeping. It first said loadline
  may compute; I then "corrected" it after reading that repo's
  `determinism.md`, which forbade client arithmetic outright; the operator
  then pointed out that the prohibition is too strong - any value objectively
  derivable from the engine's facts should be permitted, or developers lose
  the freedom to build what their users need, and the ENGINE staying factual
  is what actually matters. That argument is right and `determinism.md` was
  revised on 2026-08-04.

  So loadline has **recorded, engine-derived and client-derived**, and the
  third needs its own treatment: a figure the client computed, inked like an
  engine one, has borrowed the record's authority for its own arithmetic. The
  lens still has only two, because a conformance client that computes cannot
  prove anything about the engine - that is a reason specific to the lens's
  job, not a general rule about clients, and stating it as one was the error.

  The line that replaces it: **would two honest clients computing this from
  the same rows disagree?** If they cannot, it is objective and a client may
  do it. If they could, it is a judgement, and it belongs to the engine or to
  nobody.
- **Contrast tokens are palette-specific.** The ratios are not: 4.5:1 minimum
  for a figure someone has to read, checked against the surface it sits on and
  not against the page background.
- **Staleness matters more in a live app.** See above.

## Changelog of this document

- 2026-08-04: written after the lens gained two inks, a soft-magnitude mark,
  and its first subjective rendering.
