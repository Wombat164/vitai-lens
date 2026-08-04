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

## The narrator, and the one exception

The lens generates English (`narrator.js`). Prose is where a client is most tempted to compute, because a sentence can smuggle a judgment in a way a chart cannot, so the rule is stated narrowly rather than waived:

> **The narrator may state what the engine stated, and may state how many times the engine stated it. It may not derive a new quantity from the values in the rows.**

Counting is a property of the query, so `COUNT(*)` is allowed. `AVG(kg)` is not, because that is a health judgment, and health judgments belong to the engine where they can be tested. Where the engine has already produced text - `gates.escalation`, `verdicts.reason` - the narrator reproduces it verbatim and never paraphrases, which is the discipline `safety.py` applies when it emits hardcoded escalation strings rather than letting a model phrase them.

**Where a sentence sits is part of what it says.** The brief opens with goals and the arc through them, because that is what a person came to find out. A narrative about a measurement belongs under the chart that shows that measurement, so the sentence and the picture are on screen together - a paragraph about unlogged days sitting hundreds of pixels above the heatmap that draws them made the reader hold one in their head while scrolling to the other. Only what is genuinely record-wide stays in a closing band, because putting it under any one chart would imply a scope it does not have.

Every generated sentence carries the SQL that produced it, and the page renders that as a control which runs the query for real. This is enforced mechanically: `tools/test_narrator.js` extracts every number from every sentence and fails if it cannot be found in the rows that sentence cites. It has already caught the narrator summing group counts into a total, and printing a figure from a second query the citation did not cover. Both read as perfectly honest prose.

**It is not a language model, and that is a decision rather than a limitation.** A model under 10 MB that emits fluent English is available off the shelf; `docs/prior-art.md` sets out the lineage this technique comes from and why the model was rejected. The short version is that a language model cannot be constructed so as to be *unable* to state a number that is not in the record, cannot offer the trace control because no query produced its sentence, and produces exactly the artifact this project exists to prevent: a confident, plausible, unfalsifiable sentence about someone's body.

## Answering questions, and the three it will not answer

`ask.js` takes a typed question and answers it in prose. It runs on the same rule as the narrator, with the same trace control, and it is deliberately built to look like the chat box everyone already knows - because the point is that it looks like one and behaves differently at the edges.

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
