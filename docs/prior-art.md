# Prior art for the narrator

The lens turns a vitai read model into English. This document records what that
technique is called, who established it, and why the obvious modern alternative
(ship a small language model) was considered and rejected on grounds specific to
this project rather than on grounds of taste.

## Verification status

Cite with care. This session had no web-search budget left, so the table below
separates what was checked against a primary source from what is recalled and
should be verified before it is repeated as a claim in public material.

| Claim | Status |
|---|---|
| TinyStories: sub-10M-parameter models, fluent multi-paragraph English | **verified** against the arXiv abstract (2305.07759) |
| TinyStories vocabulary is that of a 3-4 year old, data synthesised by GPT-3.5/4 | **verified**, same source |
| The Reiter and Dale NLG pipeline and its stage names | recalled, high confidence |
| BabyTalk / BT-45 / BT-Nurse, neonatal intensive care, Aberdeen | recalled, high confidence on existence and domain |
| The specific BT-45 evaluation result vs graphics | **recalled, low confidence** - do not quote a number |
| SumTime marine forecasts, deployed commercially | recalled, medium confidence |
| ELIZA, Weizenbaum 1966, and the ELIZA effect | recalled, high confidence |

## The technique has a name: data-to-text generation

Turning structured numeric records into prose is a established subfield, not an
improvisation. The reference architecture is the pipeline set out in Reiter and
Dale's *Building Natural Language Generation Systems* (2000), which decomposes
the problem into four stages that this narrator implements under their own
names:

1. **Content determination** - decide which facts are worth saying at all. Most
   of the record is not worth a sentence; this stage is where that judgment is
   made and where it can be reviewed.
2. **Document planning** - order and group the selected facts.
3. **Microplanning** - aggregate related facts into single sentences, choose
   words, choose how to refer to things already mentioned.
4. **Surface realisation** - produce grammatical text: agreement, plurals,
   list punctuation.

The stages matter here because they put the *editorial* decisions (stage 1) in a
different place from the *wording* decisions (stages 3 and 4). A reviewer who
wants to know whether the narrator is being honest reads stage 1, which is a
list of rules over rows, and never has to read a template.

### The clinical lineage is the relevant one

Data-to-text has a specific track record in exactly this situation: a dense
stream of physiological numbers that a human must act on. The BabyTalk project
at the University of Aberdeen (Reiter, Portet, Hunter, Sripada, Gatt and
colleagues) built systems that generated textual summaries of neonatal
intensive care data for clinicians - BT-45 for a 45-minute window, and BT-Nurse
for nursing shift handover. The point of citing it is not that this lens is a
medical device, which it emphatically is not, but that the *shape* of the
problem is old and was solved with templates over a structured record, under
clinical review, rather than with a generative model.

SumTime, from the same group, generated marine weather forecasts from numerical
weather-prediction output and reached commercial deployment. It is worth
knowing because it establishes the economic point: a well-built template system
over good data is not a prototype stage on the way to something better.

### The playful branch

Grammar-based generation also has a large practical literature outside academia
- Tracery (Kate Compton) is the best-known, a tiny grammar expander that powers
a great many generative-text bots. It is cited here because it is the honest
ancestor of the "advanced text generator" framing: expansion over a grammar,
with data substituted in. What this narrator adds to Tracery is that the
substituted data must come from a row, and the row is named.

## Why not a real model under 10 MB

This was a genuine question and the answer is not "too hard". It is feasible.
TinyStories (Eldan and Li, arXiv 2305.07759) demonstrates models **below 10
million parameters** - a few megabytes once quantised, comfortably inside the
budget - that produce, in the authors' description, fluent and consistent
multi-paragraph stories with almost perfect grammar. Karpathy's `llama2.c`
distributes such models and runs them in a browser via WebAssembly. A 10 MB
model that emits fluent English is available off the shelf.

It was rejected for three reasons, in increasing order of seriousness.

**It cannot be trained on the data.** TinyStories models are fluent *because*
their world is small: the training corpus uses the vocabulary of a three or
four year old. There is no such corpus for this domain, and building one would
mean synthesising health prose from a large model, which imports that model's
judgments into a tool whose entire claim is that it makes none.

**It cannot be grounded.** A language model samples tokens from a distribution
conditioned on context. There is no construction that makes it *unable* to
state a number that is not in the record. Every mitigation - constrained
decoding, retrieval, prompting - reduces the rate and none reduces it to zero.
A template that interpolates `row.counted` either finds a row or produces no
sentence.

**Fluency is read as authority, and that is the failure this project exists to
prevent.** This is Weizenbaum's finding, not a new worry. ELIZA (1966) did
pattern substitution with no model of anything, and users attributed
understanding and confided in it; Weizenbaum spent the rest of his career
alarmed by how little was required. A model that says *"your recovery is
trending nicely, keep it up"* over a record containing no such finding has
produced the most dangerous artifact this repository could ship: a confident,
plausible, medically-flavoured, unfalsifiable sentence about a person's body,
generated by a component that is constitutionally incapable of knowing whether
it is true.

The lens already refuses to render against the wrong contract, on the reasoning
that a client showing sixty per cent of the truth while looking complete is a
lie with a chart on it. A generative model in this position is the same defect
in a more persuasive medium.

## The rule this yields

The narrator's constraint is narrower than "no computation", because pure
prohibition would leave it unable to say anything:

> The narrator may state what the engine stated, and may state **how many
> times** the engine stated it. It may not derive a new quantity from the
> values in the rows.

So counting the days on which the engine recorded a source conflict is allowed,
because that is a property of the query. Averaging the weights in those rows is
not, because that is a health judgment, and health judgments belong to the
engine where they can be tested. Where the engine has already produced text -
`gates.escalation`, `verdicts.reason` - the narrator quotes it verbatim rather
than paraphrasing, which is the same discipline `safety.py` applies when it
emits hardcoded escalation strings rather than letting a model phrase them.

## References

- Reiter, E. and Dale, R. (2000). *Building Natural Language Generation
  Systems*. Cambridge University Press.
- Gatt, A. and Reiter, E. (2009). SimpleNLG: A realisation engine for practical
  applications. *ENLG 2009*.
- Portet, F., Reiter, E., Gatt, A., Hunter, J., Sripada, S., Freer, Y. and
  Sykes, C. (2009). Automatic generation of textual summaries from neonatal
  intensive care data. *Artificial Intelligence* 173(7-8).
- Hunter, J. et al. (2012). BT-Nurse: computer generation of natural language
  shift summaries from complex heterogeneous medical data. *Artificial
  Intelligence in Medicine*.
- Sripada, S., Reiter, E. and Davy, I. (2003). SumTime-Mousam: Configurable
  marine weather forecast generator. *Expert Update* 6(3).
- Weizenbaum, J. (1966). ELIZA - a computer program for the study of natural
  language communication between man and machine. *CACM* 9(1).
- Eldan, R. and Li, Y. (2023). TinyStories: How small can language models be
  and still speak coherent English? arXiv:2305.07759.
- Compton, K. Tracery: an author-focused generative text tool.
