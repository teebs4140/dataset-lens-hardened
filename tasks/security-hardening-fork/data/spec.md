# Spec — Dataset Lens security-hardening fork

**Owner:** Dylan Thibault (Duke / DCRI)
**Date started:** 2026-08-12
**Upstream:** `vikasgaddu1/dataset-lens` @ v2.5.0 (MIT), published as `elearnsas.dataset-lens`
**Status:** Phases A-D complete; publishing blocked only on Dylan registering a publisher ID (D5/D12).
**Goal:** Produce a hardened fork that Duke colleagues can install and trust, distributed both as a
shareable `.vsix` for immediate internal use and as a public Marketplace listing.

---

## 1. Background — what the audit established

Two independent reviews (Dylan's scan + this session's source review) agreed on the findings.
Verified facts, not assumptions:

- **Published bytes == source.** Dylan downloaded the real Marketplace VSIX
  (`elearnsas.dataset-lens` 2.5.0) and diffed it against a clean rebuild: every `out/*.js` is
  byte-identical to a fresh `tsc` compile of `src/`, Python/webview files match modulo line
  endings, and bundled `node_modules` are byte-identical to the npm registry tarballs.
  Independently reconfirmed here: `npx tsc -p . --outDir <scratch>` then `diff -r` against the
  committed `out/` → **clean**. So there is no hidden-payload problem; this is a code-quality
  hardening job, not a malware removal job.
- **No network, no telemetry, no install hooks.** No fetch/HTTP anywhere in extension code. The
  only outbound traffic is pip installing pandas/pyreadstat/numpy/pyreadr into a private venv.
- **Dependencies are legitimate.** `js-stream-sas7bdat` (ReadStat wrapper, defineEditor) ships
  prebuilt native binaries via `node-gyp-build`; `xport-js` is a known XPT parser.
- **CSV export is save-dialog gated** — the webview cannot make the extension write arbitrary paths.

### Correction to the original review (discovered while scoping this work)

The audit discussion focused on the `eval()` at `src/VirtualScrollingWebviewComplete.ts:1118`.
**That file is dead code.** All five custom editors (`SasDataProvider`, `XptDataProvider`,
`RDataProvider`, `DatasetJsonProvider`, and the `extension.ts` commands) construct
`SASWebviewPanel`, which renders **only** `getPaginationHTML()` from `src/PaginationWebview.ts`.
`getVirtualScrollingHTML` / `getVirtualScrollingHTMLComplete` are exported but never imported or
called anywhere in `src/` or `out/`. `webview/script.js` and `webview/styles.css` are likewise
never referenced.

Consequences:
- The webview `eval()` is **not reachable at runtime**. Dylan's finding that the breakout was not
  practically exploitable is consistent with this — it is unreachable, not merely fragile.
- Client-side WHERE filtering does not happen in the live path at all; filtering is done in Python
  via `pandas.query()`. This makes the `xpt_reader.py` eval the *only* live filter-execution risk.
- The live renderer `PaginationWebview.ts` **has no `escapeHtml` function at all**, and it is the
  file that actually needs the escaping pass. Fixing only the dead file would have left the real
  injection path untouched.

---

## 2. Findings to fix (live-path severity)

| # | Finding | Location | Severity | Reachable? |
|---|---|---|---|---|
| F1 | `df[eval(clause)]` fallback executes arbitrary Python | `python/xpt_reader.py:171` | **High — genuine RCE** | Yes: v8/v9 XPT → Python fallback path + user-typed WHERE |
| F2 | Unescaped metadata interpolated into webview HTML | `src/PaginationWebview.ts` server-side template (`${}`) + client `innerHTML` | **Medium — drive-by injection from a crafted file** | Yes |
| F3 | Unescaped cell values in Unique Values modal | `src/PaginationWebview.ts` (`table.innerHTML`, ~line 1863) | **Medium — data-driven injection** | Yes |
| F4 | CSP allows `unsafe-inline` + `unsafe-eval` | `src/PaginationWebview.ts:38` | Low — defense in depth | n/a |
| F5 | Unpinned pip requirements (`>=`, no hashes) | `python/requirements.txt` | Low — supply chain | n/a |
| F6 | Dead code carrying `eval()` and weak CSP | `VirtualScrollingWebview*.ts`, `webview/` | Low — audit noise, future footgun | Not reachable |

**F1 detail.** v5/v6 XPT files are handled by the TypeScript reader; v8/v9 fall through to
`python/xpt_reader.py`. When `pandas.query()` raises, the bare `except:` runs `df[eval(clause)]` on
the user's filter text — arbitrary Python, unsandboxed, with the user's privileges. Reproduced
upstream with a canary and with `os.system('id')`. `sas_reader.py` and `r_reader.py` already use
`query()` only, so removing the fallback makes all three readers consistent.

**F2/F3 detail.** The main data grid is safe (`td.textContent`). The unsafe sinks are:
- Server-side template: `${fileName}` (title), `metadata.dataset_label`, `metadata.file_path`,
  `created_date`, `modified_date`, `sas_version`, `os_version`, `encoding`, and the
  `metadata.variables.map(...)` block emitting `v.name`, `v.type`, `v.label`, `v.format`, `v.length`.
- Client-side: `span.innerHTML` in `populateVariablesList()` (~1081) and `updateDisplayMode()`
  (~1897), both emitting variable name/label.
- Client-side: the Unique Values modal building `headerHtml`/`bodyHtml` from **cell values**.

All of these derive from attacker-controllable bytes in a `.sas7bdat`/`.xpt`/`.json`/`.rds` file
(SAS variable labels are free-text, up to 256 chars). `safeWhere` (~1813) is already escaped and
needs no change.

---

## 3. Plan of work

### Phase A — Security fixes
1. **F1:** Delete the `except: return df[eval(clause)]` fallback in `python/xpt_reader.py`. On a
   `query()` failure, return a structured error explaining the unsupported expression. Audit the
   other readers to confirm no `eval` remains anywhere in `python/`.
2. **F2/F3:** Add an `escapeHtml()` helper on both sides of `PaginationWebview.ts` (a TS-side one
   for the server template, a JS-side one injected into the webview script) and apply it to every
   sink listed above. Prefer converting to `textContent` where the sink emits no markup.
3. **F4:** Tighten CSP. Drop `unsafe-eval` (nothing in the live path needs it). Keep inline
   script/style but bind them with a per-render nonce.
4. **F6:** Delete `src/VirtualScrollingWebview.ts`, `src/VirtualScrollingWebviewComplete.ts`, and
   the unreferenced `webview/` assets, so no `eval()` ships in the package at all.
5. **F5:** Pin `python/requirements.txt` to exact, known-good versions.

### Phase B — Verification (evidence required, no claims without output)
6. `npx tsc -p ./` compiles clean.
7. Grep proves zero `eval(` in shipped `src/`, `out/`, and `python/`.
8. Malicious-metadata canary: craft a dataset whose variable label contains
   `<img src=x onerror=...>` and confirm the rendered HTML shows it escaped as text.
9. F1 canary: confirm a filter expression that previously reached `eval` now returns a clean error
   instead of executing.
10. Open a normal dataset of each supported type and confirm no functional regression
    (metadata, paging, WHERE filter, unique values, CSV export).

### Phase C — Fork identity & attribution
11. Rename to a distinct extension id + publisher (cannot reuse `elearnsas.dataset-lens`).
12. Preserve upstream MIT LICENSE and add a `NOTICE`/README section crediting Vikas Gaddu and
    stating clearly that this is a hardened fork, what changed, and why.
13. Add `CHANGELOG.md` documenting the security fixes.
14. Add `SECURITY.md` with a contact address for reports.

### Phase D — Distribution (both channels, per decision D1)
15. **VSIX for immediate internal use:** `npx vsce package` → share the `.vsix`. Publish the
    SHA-256 of the file so colleagues verify the bytes they install.
16. **Public Marketplace:** document the exact steps Dylan must perform himself (they need a human
    with a Microsoft/Azure DevOps identity and a secret token — an agent must not and cannot do
    this): create Azure DevOps org → create publisher at marketplace.visualstudio.com/manage →
    generate a PAT scoped to *Marketplace → Manage* → `vsce login <publisher>` → `vsce publish`.
    The PAT must never be written into this repo.

---

## 4. Out of scope
- Rewriting the WHERE parser into a full safe-expression evaluator (decision D2 chose removal).
- Reviving virtual scrolling (dead code is being deleted, not repaired).
- Feature work, UI redesign, new file-format support.
- Anything requiring Dylan's credentials.

## 5. Definition of done
- All of F1–F6 addressed, each with verification output captured in `decisions.md`.
- `tsc` clean; no `eval(` anywhere in shipped code; canary tests pass; no functional regression.
- Fork identity, attribution, CHANGELOG, SECURITY.md in place.
- A built `.vsix` with a published SHA-256, plus written Marketplace publishing steps for Dylan.
