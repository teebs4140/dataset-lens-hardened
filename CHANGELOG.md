# Changelog

## 2.6.0 — security-hardening fork of upstream 2.5.0

Forked from [vikasgaddu1/dataset-lens](https://github.com/vikasgaddu1/dataset-lens) 2.5.0.
No features were added or removed. Every change below is security or correctness.

### Fixed — arbitrary code execution via WHERE clause (high)

`python/xpt_reader.py` evaluated filter expressions with `pandas.query()` and, when that
failed to parse, fell back to `df[eval(clause)]` — running the filter text as arbitrary
Python with the user's privileges. This affected XPT files handled by the Python backend
(v8/v9; v5/v6 use the TypeScript reader).

The `eval` fallback is removed. Unparseable expressions now return a clear error. All three
readers (SAS, XPT, R) are now consistent in using `pandas.query()` only.

**Behaviour change:** filter expressions that only ever worked through `eval` now report an
error instead of silently executing. Ordinary comparisons and `AND`/`OR` combinations are
unaffected.

### Fixed — silent loss of filtering (correctness)

When a WHERE clause failed, `xpt_reader.py` logged a warning to stderr and returned the
**unfiltered** dataset. A rejected filter was therefore indistinguishable from a filter that
matched every row — a dangerous failure mode when reviewing clinical data. Filter failures
are now surfaced to the user as errors.

### Fixed — HTML/script injection from untrusted dataset metadata (medium)

Variable names, labels, formats, dataset labels, file paths and cell values are free-text
fields read out of the data file, and were interpolated into the webview without escaping.
A crafted `.sas7bdat`/`.xpt`/`.rds`/`.json` file could inject markup or script into the
viewer panel. Three distinct sink classes were fixed in `src/PaginationWebview.ts`:

- **HTML context** — dataset metadata table and variable metadata table now escaped.
- **Script context** — `JSON.stringify(metadata.variables)` was embedded directly inside a
  `<script>` block, so a label containing `</script>` escaped the script element entirely.
  Now serialized with angle brackets and separators encoded.
- **Runtime DOM** — `innerHTML` assignments for the variable list, the display-mode relabel,
  and the Unique Values modal (which renders raw cell values) now escape their inputs.

The main data grid already used `textContent` and was never affected.

### Changed — Content Security Policy tightened

Dropped `unsafe-eval` from the webview CSP, and replaced `script-src 'unsafe-inline'` with a
**per-render nonce**. The panel's single inline script carries the nonce; anything injected into
the page does not, so script introduced through a sink that was missed cannot execute at all.
This backstops the escaping above rather than replacing it. The template uses `addEventListener`
throughout and contains no inline event handlers, so nothing in the UI depends on `unsafe-inline`.
`default-src 'none'` is retained, so the panel still cannot reach the network.

### Removed — unreachable code carrying `eval`

`src/VirtualScrollingWebview.ts`, `src/VirtualScrollingWebviewComplete.ts` and the unused
`webview/` assets were exported but never imported or called by any editor — all five custom
editors render through `PaginationWebview.ts`. They contained their own `eval()`-based filter
evaluator and a weaker CSP. Deleting them means no `eval` ships in the package at all.

### Changed — Python dependencies given upper bounds

`python/requirements.txt` used open-ended `>=` floors, which today resolve `pandas` to 3.x —
a major version this code has never been tested against, picked up silently on any fresh
install. Ranges are now bounded to tested major versions.

### Verification

- `tsc` compiles clean; no `eval(` remains in `src/`, `out/`, or `python/`.
- The code-execution payload was confirmed to execute against upstream's logic and to be
  rejected by this build.
- A real XPT file carrying `<img src=x onerror=...>` in a column label renders escaped.
- Metadata, pagination, valid filters (including SAS-style quoted comparisons), and error
  handling were exercised end-to-end against a generated XPT file.
