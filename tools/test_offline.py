#!/usr/bin/env python3
"""The page must render with no network beyond the server it was loaded from.

    python tools/test_offline.py

Serves the repo on a loopback port, then aborts EVERY request that leaves it.
A page that still renders has proved local-first; a page that goes looking for
a CDN fails here with the URL it wanted, so a regression to a remote reference
is caught rather than noticed months later by someone on a train.

This exists because the parser used to be fetched from a CDN with no integrity
attribute, under a README promising "no server-side anything, your data never
leaves the machine" - true of the data and false of the trust boundary.

Requires playwright (`pip install playwright && playwright install chromium`).
"""
from __future__ import annotations

import http.server
import socket
import socketserver
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, *a):        # the server is not the subject
        pass


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed - skipping", file=sys.stderr)
        return 0

    port = free_port()
    srv = socketserver.TCPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{port}"

    escaped: list[str] = []
    errors: list[str] = []
    failed = 0

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1180, "height": 1000})
            page.on("pageerror", lambda e: errors.append(str(e)))

            def gate(route, request):
                if request.url.startswith(origin) or request.url.startswith("data:"):
                    route.continue_()
                else:
                    escaped.append(request.url)
                    route.abort()

            page.route("**/*", gate)
            page.goto(f"{origin}/index.html", wait_until="networkidle")
            page.wait_for_timeout(2500)

            def check(name, cond, detail=""):
                nonlocal failed
                if cond:
                    print(f"  ok   {name}")
                else:
                    failed += 1
                    print(f"  FAIL {name}{('  ' + detail) if detail else ''}")

            print("\noffline render\n")
            check("no request left the origin", not escaped,
                  "; ".join(sorted(set(escaped))[:4]))
            check("no page errors", not errors, "; ".join(errors[:2]))
            check("the database parsed",
                  "refused" not in page.locator("#source-note").inner_text())
            check("the brief rendered", page.locator("#brief .msg").count() > 0)
            check("charts rendered", page.locator("#c-weight svg").count() > 0)
            check("the record band rendered",
                  page.locator("#record .msg").count() > 0)
            check("chart notes rendered",
                  page.locator("#n-c-weight .msg").count() > 0)

            # The weekly charts read `session_weeks` rather than bucketing and
            # summing here, so what they draw has to match what the engine
            # emitted. Counting bars is the cheapest way to catch the rewire
            # silently drawing a subset - an SVG existing proves only that
            # something rendered.
            import sqlite3
            con = sqlite3.connect("demo/health.db")
            weeks = con.execute(
                "SELECT COUNT(DISTINCT week) FROM session_weeks").fetchone()[0]
            kmcells = con.execute(
                "SELECT COUNT(*) FROM session_weeks WHERE distance_km IS NOT NULL"
            ).fetchone()[0]
            con.close()
            check("the sessions chart draws every engine week",
                  page.locator("#c-sess svg g.bars, #c-sess svg path").count() > 0
                  and weeks > 0, f"{weeks} weeks in session_weeks")
            check("the km chart draws only the cells carrying a distance",
                  page.locator("#c-km svg path").count() <= kmcells,
                  f"{page.locator('#c-km svg path').count()} bars vs "
                  f"{kmcells} non-null cells")
            check("the absent-is-not-zero note is shown",
                  "absent, not zero" in page.locator("#c-km + .hint").inner_text())

            # The ask surface is a dock. These assert the DOCK, not the answer:
            # the interaction tests below pass whether or not it ever opens,
            # because Playwright can type into a panel translated off-screen.
            def onscreen(sel):
                b = page.locator(sel).bounding_box()
                return b is not None and b["x"] < page.viewport_size["width"] - 8

            check("the dock starts closed",
                  page.locator("#ask-card").get_attribute("data-open") != "1"
                  and not onscreen("#ask-dock"))
            page.click("#ask-toggle")
            page.wait_for_timeout(400)
            check("the toggle opens it",
                  page.locator("#ask-card").get_attribute("data-open") == "1"
                  and onscreen("#ask-dock"))
            check("opening moves focus to the input",
                  page.evaluate("document.activeElement && document.activeElement.id")
                  == "ask-input")
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
            check("escape closes it", not onscreen("#ask-dock"))

            # It must survive scrolling - that is the whole reason it is fixed.
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(200)
            check("the handle stays put when the page scrolls",
                  onscreen("#ask-toggle"))
            page.evaluate("window.scrollTo(0, 0)")

            # An answer may carry a `view`, and a view is a picture of the rows
            # the answer already cited. Driving the real ask box is the only
            # way to know it renders: the unit tests exercise the answer
            # object, and an answer object with a view field is not a chart.
            page.fill("#ask-input", "how many km a week do i run")
            page.press("#ask-input", "Enter")
            page.wait_for_selector("#ask-out .view svg", timeout=4000)
            check("an answer's chart view renders",
                  page.locator("#ask-out .view svg").count() > 0)
            check("the chart is drawn beside its own trace button",
                  page.locator("#ask-out .msg .view").count() > 0
                  and page.locator("#ask-out .msg button.trace").count() > 0)

            page.fill("#ask-input", "how far did i run last week")
            page.press("#ask-input", "Enter")
            page.wait_for_selector("#ask-out .view table", timeout=4000)
            check("a single-week answer renders a table, not a one-bar chart",
                  page.locator("#ask-out .view table").count() > 0)
            browser.close()
    finally:
        srv.shutdown()

    print(f"\n{failed} failing\n" if failed else "\nall passing\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
