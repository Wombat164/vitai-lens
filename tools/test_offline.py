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
            browser.close()
    finally:
        srv.shutdown()

    print(f"\n{failed} failing\n" if failed else "\nall passing\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
