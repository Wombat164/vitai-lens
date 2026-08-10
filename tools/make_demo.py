#!/usr/bin/env python3
"""Build demo/health.db from vitai's own example athlete, through the real engine.

## Why this stopped generating its own athlete

It used to synthesise a separate 84-day athlete here, writing four datasets:
daily, sessions, weight and inferences. That was fine when the lens drew four
charts, and it quietly became the reason the lens looked thin. The engine grew
goals, gates, resolutions, milestones, events, claims and provenance; the demo
had none of them, so every feature added to the read model arrived in a client
with nothing to point it at. The goal narrative in particular rendered as
silence, because `goal_progress` was empty and no rule could fire.

`examples/demo` in the vitai repo is a strict superset - fifteen datasets
against four - and it is the fixture vitai's own tests run on, so it moves when
the contract moves and someone else notices when it breaks. Pointing at it
removes a second synthetic athlete that had to be maintained in parallel and
was always going to lag.

The build runs the engine, never a hand-written INSERT: a demo assembled by any
other route would prove only that the lens can read a database this repo made,
which is not the claim.

    python tools/make_demo.py [--vitai PATH]

Requires the vitai package importable (`pip install -e` the vitai repo).
Never put real data here.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import os
import tempfile
from pathlib import Path

from vitai.api import Vitai

HERE = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    # THE DEFAULT IS THE SIBLING CHECKOUT, NOT ONE MACHINE'S ABSOLUTE PATH.
    #
    # This defaulted to an absolute Windows path under one person's home
    # directory, in a PUBLIC repo. Two things wrong with it and the smaller one
    # is the privacy: an operator's username should not ship in an open-source
    # tool. The larger one is that the default worked for exactly one person,
    # so anybody else running the documented command got "no example athlete
    # at ..." naming a directory that has never existed on their machine.
    #
    # `../vitai` is the layout CI lays out and the one the README describes,
    # and `VITAI_PATH` covers a checkout kept somewhere else without editing
    # the file.
    ap.add_argument("--vitai", type=Path,
                    default=Path(os.environ.get("VITAI_PATH")
                                 or HERE.parent / "vitai"),
                    help="path to the vitai repo holding examples/demo "
                         "(default: ../vitai, or $VITAI_PATH)")
    args = ap.parse_args()

    src = args.vitai / "examples" / "demo"
    if not (src / "data").is_dir():
        print(f"no example athlete at {src}", file=sys.stderr)
        return 1

    # Built in a copy, so a stale `derived/` in the vitai checkout cannot be
    # mistaken for a fresh build and this never writes into that repo.
    tmp = Path(tempfile.mkdtemp())
    work = tmp / "demo"
    shutil.copytree(src, work, ignore=shutil.ignore_patterns("derived"))

    v = Vitai(work)
    report = v.validate()
    if report["problems"]:
        print("the example athlete does not validate:", file=sys.stderr)
        for p in report["problems"]:
            print("  " + p, file=sys.stderr)
        return 1
    v.build()

    out = HERE / "demo" / "health.db"
    out.parent.mkdir(exist_ok=True)
    shutil.copy(work / "derived" / "health.db", out)

    con = sqlite3.connect(f"file:{out.as_posix()}?mode=ro", uri=True)
    contract = con.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0]
    counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("daily", "sessions", "weight", "goal_progress",
                        "verdicts", "provenance", "resolution", "gates")}
    con.close()
    shutil.rmtree(tmp, ignore_errors=True)

    print(f"wrote {out} at contract {contract}")
    print("  " + ", ".join(f"{k} {n}" for k, n in counts.items()))
    print("\nIf the contract moved, update BUILT_AGAINST_CONTRACT in index.html "
          "and tools/narrate.js - the lens refuses to render on a mismatch, "
          "which is the whole point of it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
