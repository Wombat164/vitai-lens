# What vitai-lens is, and the one rule

vitai-lens is the **conformance client** for [vitai](https://github.com/Wombat164/vitai): a barebones, open-source reader that proves the engine's read model is consumable by someone who is not the flagship app.

It is not a stats product. It is the demonstration that vitai did the hard work, and that a client can be thin.

## The rule

**The lens may not compute.**

Every number on screen comes from a table in `health.db`. No averages, no rates, no totals, no percentages, no re-bucketing, no classification. If a value is on screen, a `SELECT` returned it.

That is the entire discipline, and everything else follows from it.

## Why the rule is the point

A client that computes cannot prove anything about the engine, because it is answering its own questions. The moment the lens derives a rolling mean, that mean is the lens's claim about the athlete, not vitai's, and the athlete has no way to tell the two apart.

Worse, a computing client hides engine gaps. If the lens can quietly average some rows when the engine will not, nobody discovers that the engine has no opinion. The gap gets papered over in every consumer independently, each one slightly differently.

So the rule inverts that:

> **If the lens cannot render something without deriving it, that is an issue against vitai, not code in the lens.**

The lens's inability to answer a question is a *finding*. It is the most useful thing this repo produces. The founding README said a separate consumer keeps the engine honest, because if the lens needs a schema change then so would any game or third-party dashboard. That was correct, and the first audit of this repo proved it by finding four rules and a contract the engine now emits. The lens found them by falling into them, which is the cheapest way to find anything.

## What follows from the rule

**Contract gate.** The lens declares the contract it was built against and refuses to render on a mismatch, loudly. A client that renders sixty per cent of the truth and looks complete is worse than one that will not start. Silent partial success is the failure mode this whole project exists to avoid.

**Provenance reaches the screen.** A modelled value and a measured one may not be the same ink. A photo-estimated weight and a scale reading are different facts, and a UI that flattens them has turned a claim about the engine's arithmetic into a claim about the athlete's body.

**Absence renders as absence.** Never a dash, never a zero, never an empty cell, never a gap in a chart. "Nothing recorded", "computed and declined", and "not applicable" are three different statements and must read as three different things.

**A refusal renders as a refusal, with its reason.** The engine goes to the trouble of saying *why* it will not answer. A client that collapses every reason into one grey square has thrown away the distinction the engine paid for.

**Ordinal quantities are not rendered as cardinals.** Where the engine will vouch for the ordering and not the magnitude, the lens may not print a bare number with a unit and expect the reader to discount it. Readers do not discount.

**A chart is a picture of rows that were cited, never a second source.** An answer may carry a `view`, and a view names an INDEX into the queries that answer already cited - not a query of its own. So everything drawn is also listed under "show the rows this came from", and there is no figure on screen whose origin the reader cannot reach in one click. A chart able to issue its own `SELECT` would be an uncitable source of numbers on a page whose entire claim is that no such thing exists.

The one arithmetic a view is allowed is presentational geometry: a bar's height and an axis maximum. Nobody reads a number off those, and they are checkable against the axis printed beside them. **This is the line that rules pie charts out** - a slice's angle is a share of a total nobody printed, so the geometry itself is a computed percentage. A stacked bar answers the same question and keeps the axis. See `docs/visual-language.md`.

## The narrator, and the one exception

The lens generates English (`narrator.js`). Prose is where a client is most tempted to compute, because a sentence can smuggle a judgment in a way a chart cannot, so the rule is stated narrowly rather than waived:

> **The narrator may state what the engine stated, and may state how many times the engine stated it. It may not derive a new quantity from the values in the rows.**

Counting is a property of the query, so `COUNT(*)` is allowed. `AVG(kg)` is not, because that is a health judgment, and health judgments belong to the engine where they can be tested. Where the engine has already produced text - `gates.escalation`, `verdicts.reason` - the narrator reproduces it verbatim and never paraphrases, which is the discipline `safety.py` applies when it emits hardcoded escalation strings rather than letting a model phrase them.

**Where a sentence sits is part of what it says.** The brief opens with goals and the arc through them, because that is what a person came to find out. A narrative about a measurement belongs under the chart that shows that measurement, so the sentence and the picture are on screen together - a paragraph about unlogged days sitting hundreds of pixels above the heatmap that draws them made the reader hold one in their head while scrolling to the other. Only what is genuinely record-wide stays in a closing band, because putting it under any one chart would imply a scope it does not have.

Every generated sentence carries the SQL that produced it, and the page renders that as a control which runs the query for real. This is enforced mechanically: `tools/test_narrator.js` extracts every number from every sentence and fails if it cannot be found in the rows that sentence cites. It has already caught the narrator summing group counts into a total, and printing a figure from a second query the citation did not cover. Both read as perfectly honest prose.

**It is not a language model, and that is a decision rather than a limitation.** A model under 10 MB that emits fluent English is available off the shelf; `docs/prior-art.md` sets out the lineage this technique comes from and why the model was rejected. The short version is that a language model cannot be constructed so as to be *unable* to state a number that is not in the record, cannot offer the trace control because no query produced its sentence, and produces exactly the artifact this project exists to prevent: a confident, plausible, unfalsifiable sentence about someone's body.

## Two kinds of number, in two inks

Every figure on the page came out of a table, and they did not all get there the same way:

- **Recorded** (teal, bold) - a value that entered the record from a source. A scale said 75.9, the athlete declared a target of 30, a watch reported 142 bpm. Something observed it.
- **Derived** (amber, bold) - a value computed from other values. 44.6% is not a thing anybody measured; it is arithmetic over a target and a count. So is `counted`, and so is every `COUNT(*)` this client runs.

A reader who cannot tell them apart will grant a derivation the standing of an observation, and a derivation inherits every assumption in its inputs. The colours are the typographic form of the rule the whole client runs on, and there is a key at the top of the brief so they are a stated convention rather than decoration to be inferred.

**Counts made by this client are marked derived, including the ones the rule permits.** "The narrator may state how many times the engine stated it" makes counting legal; it does not make a count an observation.

**Units take the colour and not the weight**, and use the symbol where one exists - `km`, `kg`, `%`, `bpm`, `min`, `h`. The number is the figure and the unit is a label on it; bolding both gives the unit a weight it has not earned. A symbol binds to its number (`45%`), a word does not (`13.38 km`).

The inks are NOT the chart series colours. `#0ea5a0` is 3.0:1 on white, which is fine for a 3px dot and fails as text, so the number inks are a darkened pair at 5.5:1 and 5.0:1, with a light pair for dark mode.

Tables are left alone. The distinction earns its noise where the two kinds sit in one sentence; in the resolution table every value is a recorded one, so colouring them all would say nothing and cost legibility.

### A third channel, not a third colour

Colour answers *where did this number come from*. A second question - *how much does it claim* - goes on a different channel, because stacking two questions onto one channel is how a legible page becomes a cacophony.

So a **dotted underline** marks a magnitude the engine will not vouch for, and it composes with either ink. It covers two cases that are the same claim:

- **modelled** - the record says the engine computed the field rather than observing it. 2.8 km off a crosstrainer console looks exactly like 2.8 km measured, and this is the only distinction on the page that is genuinely invisible in prose.
- **ordinal** - the engine vouches for the ordering and not the size. The table already marked these; it is now the same mark rather than a second dotted underline meaning the same thing somewhere else.

### What is deliberately NOT given ink

**Subjective values.** Mood, pain and RPE are a different quantity from anything measured of the athlete (G75), and the lens rendered none of them at all until now. But prose already distinguishes "an RPE of 4" from "4 km", and a reader who does not know what RPE is will not be helped by a colour. They are surfaced and named in words instead - *"his own account of the day"* - and the answer says the engine declares no scale for them, because it does not.

**Intervals.** An interval is its own marking: rendering `76.4 (75.9-76.9)` says more than any decoration could, and rendering a bare number with a badge meaning "there was an interval" would be strictly worse.

**Contested values.** Every value the resolution table adjudicated could be marked, which in practice means marking most of the record. That surface has its own card, where the comparison can be shown rather than gestured at.

**Per-number provenance.** Where a number came from is already answered in the weight chart's marks, the tooltips, and the resolution table. Repeating it in prose would need a third and fourth ink for a question that has three homes already.

The test for adding a mark: **does confusing the two lead a reader to a wrong conclusion about their own body?** Recorded against derived passes it. Modelled against measured passes it. The rest do not, and a page that marks everything has marked nothing.

## Answering questions, and the three it will not answer

`ask.js` takes a typed question and answers it in prose. It runs on the same rule as the narrator, with the same trace control, and it is deliberately built to look like the chat box everyone already knows - because the point is that it looks like one and behaves differently at the edges.

### Selection is not computation

The rule was first written as "may not derive a new quantity", and that was stricter than it needed to be. Four test athletes each asked for a longest run, a heaviest weigh-in, a hardest session; each got a session count back.

`MAX` picks a row. The number it returns already exists in the record and nobody computed it. `SUM` and `AVG` produce a number that appears in no row, and that is the line. "The latest weigh-in" was always allowed, and selecting the largest is the same operation with a different `ORDER BY`.

The grounding test already encoded the better rule - *every number in an answer must be findable in the rows the answer cites* - which `MAX` passes automatically and `SUM` cannot. The prose rule was brought into line with the test rather than the other way round.

### A dropped qualifier is a miss, and a miss must be visible

The worst defect the athletes found was not a wrong number or a refusal. It was **a confident paragraph about a different question**: "how many runs did I do in June" returned every run since April, "how much did I walk last week" answered about the whole record, and nothing flagged either.

Intents scored on keywords alone, so the qualifier that made the question a different question was never looked at. Qualifiers - time windows, superlatives, comparisons, aggregates - are now extracted separately, each intent declares which it can honour, and **an intent that cannot honour a qualifier present in the question refuses instead of answering the question it can handle**.

That is the difference between "it misses visibly" being a claim and being true.

It maps a question onto a **fixed set of parameterised queries** and refuses anything that does not map. No SQL is ever built from user text. That refusal is not a limitation to be engineered away later; it is the property that makes the answers worth reading, and it follows PRECISE (2003), which found that characterising the tractable subset and declining the rest is what made an NL database interface trustworthy.

Three classes are refused **by name**, before any matching happens, however well their words fit an intent:

- **judgments** - is this good, should they, is it enough. A record reader that graded a plan would be inventing an opinion and lending it the record's authority.
- **predictions** - what will they weigh, how long until. The record holds what happened. A projection would be arithmetic done in the client and attributed to the engine.
- **causes** - why, because, what made. G74: a causal attribution is a claim someone makes, never something derived from a coincidence in the data.

The veto exists because two questions got past the first version and answered fluently: *"is this a good training plan"* returned a session-type breakdown, and *"what will they weigh next month"* returned the current reading. Both answered a different question than the one asked, from a keyword classifier with no model in it. **Confabulation is not a property of neural networks. It is a property of any system that produces output for an input it has not understood** - and the only defence is a boundary it will not cross rather than an intention to be careful.

## What this repo is not

- **Not a second copy of loadline's stats pane.** Loadline is the product; this is the proof. If the two ever disagree about a number, exactly one of them computed it, and that one is wrong.
- **Not a place to be clever.** Charts here are plain on purpose. A chart that flatters the data is a chart that has an opinion.
- **Not feature-complete, ever.** The lens shows what the engine offers. Its blank spaces are the roadmap, and they belong to vitai.

## For anyone reading this to build their own client

Start here. The contract is `health.db`, the rules above are what honest consumption looks like, and every place this repo says "the engine does not emit this" is a place you would have had to invent something. Do not invent it. File it.
