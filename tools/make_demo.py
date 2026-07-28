#!/usr/bin/env python3
"""Generate demo/health.db through the REAL vitai engine (synthetic athlete).

Deterministic (seeded) so the demo is reproducible; ~12 weeks of plausible
data: a weight cut 80 -> ~77, runs with an easy-HR story, gym sessions,
steps/sleep/rhr dailies, a few inferences. Requires `pip install -e` of the
vitai repo. Never put real data here.
"""

from __future__ import annotations

import json
import random
import shutil
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

from vitai.api import Vitai
from vitai.cli import main as vitai_main

HERE = Path(__file__).resolve().parent.parent
END = date(2030, 6, 30)
DAYS = 84
rng = random.Random(42)


def jl(path: Path, rows: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n",
                    encoding="utf-8", newline="\n")


def build() -> None:
    tmp = Path(tempfile.mkdtemp())
    root = tmp / "demo-athlete"
    vitai_main(["init", str(root)])
    (root / "vitai.toml").write_text(
        "[targets]\nphases = [[80.0, 76.0, 0.35], [76.0, 74.0, 0.25]]\n"
        "[tripwires]\neasy_hr_cap = 152\nrhr_baseline = 51\nsteps_floor = 9000\n"
        "sleep_floor_h = 7.0\npain_gate = 3\n", encoding="utf-8")

    start = END - timedelta(days=DAYS - 1)
    weight, daily, sessions = [], [], []
    kg = 80.2
    for i in range(DAYS):
        d = (start + timedelta(days=i)).isoformat()
        dow = (start + timedelta(days=i)).weekday()
        kg -= 0.05 * (0.7 + 0.6 * rng.random())          # ~0.24-0.45 kg/wk
        wobble = rng.gauss(0, 0.25)
        if rng.random() < 0.8:
            weight.append({"date": d, "kg": round(kg + wobble, 1),
                           "source": "scale", "note": None})
        steps = int(rng.gauss(11500 if dow < 5 else 8300, 2100))
        sleep = round(rng.gauss(7.3, 0.7), 1)
        daily.append({"date": d, "steps": max(2500, steps),
                      "distance_km": round(max(2.5, steps) * 0.00075, 1),
                      "active_min": int(max(60, rng.gauss(300, 70))),
                      "kcal_out": int(rng.gauss(2850, 220)),
                      "kcal_in": int(rng.gauss(2150, 260)),
                      "protein_g": int(rng.gauss(145, 25)),
                      "sleep_h": max(4.5, sleep),
                      "rhr": int(rng.gauss(51, 2.2)),
                      "hip_pain": rng.choice([0] * 10 + [1, 1, 2]),
                      "alcohol": rng.random() < 0.12, "note": None})
        if dow in (1, 3):                                 # Tue/Thu runs
            hard = rng.random() < 0.3
            km = round(rng.gauss(6.5 if not hard else 5.0, 1.0), 2)
            sessions.append({"date": d, "type": "run", "distance_km": max(3.0, km),
                             "duration_s": int(km * rng.gauss(390, 25)),
                             "avg_hr": int(rng.gauss(166 if hard else 147, 5)),
                             "max_hr": None, "cadence": int(rng.gauss(168, 4)),
                             "kcal": int(km * 61), "location": None,
                             "rpe": 7 if hard else 4, "note": None})
        if dow in (5, 6) and rng.random() < 0.8:          # weekend gym
            sessions.append({"date": d, "type": rng.choice(["gym_a", "gym_b"]),
                             "distance_km": None,
                             "duration_s": int(rng.gauss(3300, 400)),
                             "avg_hr": None, "max_hr": None, "cadence": None,
                             "kcal": None, "location": None,
                             "rpe": rng.choice([5, 6]), "note": None})
    inferences = [
        {"date": (END - timedelta(days=9)).isoformat(), "kind": "pattern",
         "statement": "Easy-run heart rate drifts over the cap in weeks where average sleep is under 7h.",
         "confidence": 0.7, "model": "demo-model",
         "evidence": "sessions+daily, weeks of 2030-05-20 and 2030-06-03", "note": None},
        {"date": (END - timedelta(days=2)).isoformat(), "kind": "observation",
         "statement": "Weekend step counts run about 3k below weekdays; the floor is carried by commute days.",
         "confidence": 0.85, "model": "demo-model",
         "evidence": "daily.steps by weekday, full range", "note": None},
    ]
    jl(root / "data" / "weight.jsonl", weight)
    jl(root / "data" / "daily.jsonl", daily)
    jl(root / "data" / "sessions.jsonl", sessions)
    jl(root / "data" / "inferences.jsonl", inferences)

    db = Vitai(root).build(today=END)
    out = HERE / "demo" / "health.db"
    shutil.copy(db, out)
    print(f"demo db: {out} ({out.stat().st_size} bytes) "
          f"[{len(weight)}w/{len(daily)}d/{len(sessions)}s]")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(build())
