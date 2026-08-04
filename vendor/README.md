# Vendored dependencies

## sql.js 1.13.0

- `sql-wasm.js` (48,788 bytes)
- `sql-wasm.wasm` (659,806 bytes)
- `LICENSE-sql.js` - MIT, from `github.com/sql-js/sql.js`

Retrieved 2026-08-04 from `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/`.

SHA-384, in the form a subresource-integrity attribute would take, so anyone
can verify these bytes are the ones the CDN served on that date:

```
sql-wasm.js    sha384-DJiKBv+LC78e5InEB+MvFIAH079ynMK/ERTtFUCpDzXhH1Bht7aVfpg3yOVsuYl9
sql-wasm.wasm  sha384-6ZuuATBQILaZsPJlJK3qnWdqkbq+uewAZt7SZG+qToG8hZJu8u88xg2ipZi99uOA
```

## Why these are in the repository

The page used to fetch both from a CDN at load time, with no `integrity`
attribute and no `crossorigin`. That was two problems, and only the first is
the obvious one.

**It did not work offline.** With no network `initSqlJs` is undefined and the
page renders an empty shell. The README promises local-first, and this was the
single dependency that broke it.

**The code that parses the health record was fetched from a third party on
every load.** "No server-side anything, your data never leaves the machine" was
true of the DATA and false of the TRUST BOUNDARY. A substituted `sql-wasm.js`
has the parsed database in the same JS heap it just built, and with no
integrity pin there was nothing to detect it with. For a repository whose whole
argument is that a client should not quietly claim more than it can support,
shipping that gap under a local-first banner was the wrong shape of mistake.

Vendoring removes the class rather than mitigating it. An `integrity` attribute
would have closed the substitution hole and left the offline one open, and it
would need re-pinning on every upgrade - a maintenance burden whose failure
mode is silent.

## Upgrading

Fetch the new version, record its size and SHA-384 here, and check the page
still renders the demo. `tools/test_offline.py` fails if the page ever reaches
the network again, so a regression to a CDN reference is caught rather than
noticed.
