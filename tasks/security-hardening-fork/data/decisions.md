# Decisions log — Dataset Lens security-hardening fork

Append-only. Each entry records a choice, the reasoning, and (where relevant) the evidence.
Agents doing implementation work should **append new entries here** rather than editing history.
Format: `### D<n> — <title>` / Decision / Why / Evidence / Status.

---

### D1 — Distribution: both a shareable VSIX and a public Marketplace listing
**Decision:** Ship both. Build a `.vsix` for immediate internal Duke use, and prepare everything
for a public Marketplace publish so it is a one-command operation when Dylan is ready.
**Why:** Dylan chose "Both" when asked. The VSIX unblocks colleagues now with no account setup and
the strongest trust story (they install the exact bytes we built and hashed). The Marketplace
listing makes install-by-name easy later.
**Status:** Accepted, drives Phase D.

### D2 — WHERE-clause fix: remove the unsafe eval, keep `pandas.query()` only
**Decision:** Delete the `df[eval(clause)]` fallback rather than building a validated expression parser.
**Why:** Dylan chose removal. `sas_reader.py` and `r_reader.py` already run `query()`-only and are
not reported as functionally deficient, so the fallback buys little. Removal is a few lines,
auditable at a glance, and eliminates the only genuine RCE. A custom parser is a new attack surface
and more code to maintain for marginal filter flexibility.
**Trade-off accepted:** exotic expressions that only ever worked through `eval` will now return a
clean error instead of silently executing. This is a deliberate, documented behavior change.
**Status:** Accepted, drives F1.

### D3 — Scope correction: the live renderer is `PaginationWebview.ts`, not the virtual-scrolling files
**Decision:** Apply the HTML-escaping work to `src/PaginationWebview.ts`. Delete the
virtual-scrolling webviews and the unreferenced `webview/` assets instead of hardening them.
**Why:** Discovered while scoping: all five custom editors construct `SASWebviewPanel`, which renders
only `getPaginationHTML()`. `getVirtualScrollingHTML` / `getVirtualScrollingHTMLComplete` are exported
but never imported or called anywhere in `src/` or `out/`; `webview/script.js` is referenced nowhere.
The `eval()` both reviews focused on is therefore unreachable, while the file that actually renders
every dataset has **no `escapeHtml` function at all**. Hardening only the dead file would have left
the real injection path open — this correction is the single most important scoping result.
**Evidence:** `grep -rn "getVirtualScrollingHTML" src/ out/` returns only the definitions and their
compiled exports, no call sites. `grep -n "function escapeHtml" src/PaginationWebview.ts` returns nothing.
**Consequence for severity:** F1 (`xpt_reader.py` eval) is the only live arbitrary-execution bug.
This corroborates Dylan's empirical result that the webview eval breakout could not be exploited.
**Status:** Accepted, drives F2/F3/F6.

### D4 — Severity framing carried into the fork's public docs
**Decision:** Describe F2/F3 as "a crafted data file can inject HTML/JS into the viewer panel," not
as remote code execution; describe F1 as local arbitrary code execution.
**Why:** Honest severity. The webview is sandboxed, the CSP is `default-src 'none'` so even a
successful injection cannot exfiltrate, and the extension's message handlers are limited to
`loadData` and a save-dialog-gated `exportCsv`. Overstating it in a Duke-facing README would be
misleading; understating F1 would be worse.
**Status:** Accepted.

### D5 — Fork identity (PROVISIONAL — needs Dylan's confirmation before publishing)
**Decision (provisional):** extension `name: dataset-lens-secure`, `displayName: "Dataset Lens (Secure Fork)"`.
Publisher left as a clearly-marked placeholder until Dylan registers a real publisher ID.
**Why:** The Marketplace forbids reusing `elearnsas.dataset-lens`; a fork needs its own id and
publisher. The publisher ID must be registered by a human against a Microsoft/Azure DevOps account,
so an agent cannot pick it unilaterally — but nothing else in the build is blocked by it, so work
proceeds with a placeholder. Renaming later is a one-line change.
**Blocked on:** Dylan registering the publisher (and confirming whether Duke/DCRI naming or
branding requires institutional sign-off before a *public* listing carries a Duke-associated name).
The internal VSIX path (D1) is **not** blocked by this.
**Status:** Provisional.

### D6 — Never write credentials into this repo
**Decision:** The Azure DevOps PAT used by `vsce` will never be written to any file in this repo.
Publishing steps will be documented for Dylan to run interactively; agents must not attempt to
create accounts, obtain tokens, or publish.
**Why:** Publishing is an irreversible, outward-facing act tied to Dylan's identity, and a leaked
PAT scoped to *Marketplace → Manage* would let anyone push code under his publisher name.
**Status:** Accepted, binding on all agents working in this repo.

### D7 — Upstream attribution is mandatory
**Decision:** Keep the upstream MIT LICENSE intact and add explicit credit to Vikas Gaddu, a link
to the original repo, and a plain statement of what this fork changed.
**Why:** MIT requires the copyright notice be preserved, and a security fork that obscures its
origin is both a licensing problem and a trust problem. The provenance note also belongs in the
record: upstream's git history begins at "Republish under clean repo with no prior references,"
so pre-2.3.0 history is not inspectable — worth stating factually, not as an accusation.
**Status:** Accepted.

### D8 — Verification standard: evidence before claims
**Decision:** No fix is marked done without captured command output — `tsc` result, `eval` greps,
and canary tests for both F1 and F2/F3. Results get appended to this file.
**Why:** The whole value of this fork to Duke colleagues is that someone actually checked. A claim
of "hardened" without output is exactly the thing this exercise exists to avoid.
**Status:** Accepted, drives Phase B.

---

## Implementation log
(Agents: append verification output and any new decisions below this line.)

### D9 — Silent filter failure treated as a defect and fixed (added during implementation)
**Decision:** When a WHERE clause cannot be parsed, `xpt_reader.get_data()` now returns
`{'error': ...}` instead of logging to stderr and returning the **unfiltered** dataframe.
**Why:** Not in the original audit, found while removing the eval. Upstream's caller swallowed
the exception, so a rejected filter and a filter matching every row looked identical in the UI.
Removing the eval fallback *increases* the number of rejected expressions, which would have made
this pre-existing bug more visible and more dangerous. For clinical data review, silently showing
all rows to someone who believes they are looking at a filtered subset is a worse outcome than an
error message. The TS layer already surfaces `result.error`, so no client change was needed.
**Status:** Implemented.

### D10 — Third injection vector found: script-context breakout (added during implementation)
**Decision:** Added `jsonForScript()` and used it wherever metadata is embedded inside `<script>`.
**Why:** Neither review caught this. `src/PaginationWebview.ts` embedded
`${JSON.stringify(metadata.variables)}` directly inside a script block, and a debug `console.log`
interpolated `dataset_label` / `fileName` into **single-quoted JS string literals**. A variable
label containing `</script>` closes the script element outright — a clean breakout needing no
quote-escaping trickery, strictly easier to exploit than the HTML-attribute paths that were the
focus of the audit. The same `console.log` interpolated a raw `&&` chain as `labelCondition`,
which can emit an unquoted string into JS; now coerced with `Boolean()`.
**Lesson recorded:** the audit searched for `innerHTML` and `eval`, which is why it missed
`JSON.stringify` inside a template literal. Script-context interpolation deserves its own grep.
**Status:** Implemented and verified.

### D11 — Deviation from spec: bounded version ranges, not exact pins
**Decision:** `requirements.txt` uses bounded ranges (`pandas>=2.0.0,<3.0.0`) rather than the exact
pins the spec called for.
**Why:** Exact pins across Windows/macOS/Linux and multiple Python versions risk unsatisfiable
resolutions on colleagues' machines, and cannot be validated from this environment for every
platform. Bounds capture the actual risk — the open-ended `>=1.5.0` floor resolves `pandas` to
**3.0.5** today, an untested major version — while leaving patch/security updates available.
Hash-pinning was rejected as too brittle for an auto-provisioned venv the user never sees.
**Evidence:** venv built from the new file resolved pandas 2.3.3, numpy 2.4.6, pyreadstat 1.3.6,
pyreadr — installed cleanly, all imports succeed.
**Status:** Implemented, deviation accepted.

### D12 — Publishing placeholders rather than a guessed identity
**Decision:** `publisher` is `REPLACE-ME-publisher` and repo URLs are `REPLACE-ME-org`; the build
still packages successfully.
**Why:** Per D6 an agent must not create the publisher identity. Placeholders that are obviously
placeholders are safer than a plausible-looking guess that could be published by accident. Also
flagged in PUBLISHING.md: `icon.png` is upstream's artwork, and any Duke-implying publisher name
is an institutional-identity decision requiring human sign-off, not a technical choice.
**Status:** Open — needs Dylan.

---

## Verification results (Phase B) — 2026-08-12

All commands run from the repo root on branch `security-hardening-fork`.

**Compile:** `npx tsc -p ./` → exit 0, no errors.

**No eval in shipped code:** `grep -rn "eval(" src/ out/ python/` → only the explanatory comment
at `python/xpt_reader.py:166`. Confirmed again inside the built VSIX: no `eval(` in
`extension/out` or `extension/python`.

**F1 — RCE closed, and the test is meaningful.** Payload:
`df.assign(x=__import__('os').system('touch <canary>'))['AGE']>0`
- against upstream's verbatim logic → **canary file created** (RCE confirmed present upstream)
- against this build → `ValueError: Unsupported WHERE expression: ...`, **canary not created**
- end-to-end through `xpt_reader.py data` on a real XPT → `{"error": "Unsupported WHERE ..."}`,
  canary not created

**F1 — no functional regression.** Against a real XPT written with `pyreadstat.write_xport`:
- `AGE > 20` → 3 rows (correct)
- `WHERE SEX == 'F'` → 2 rows (correct)
- SAS-style `SEX = 'F'` → 2 rows (correct, single `=` rewritten)
- metadata, pagination, and column selection all return correct JSON

**F2/F3/D10 — injection neutralized.** Hostile metadata (`<img src=x onerror=alert(1)>` and
`</script><script>alert(2)</script>` in names, labels, formats, dataset label, file path, dates,
version and encoding fields) rendered through the real compiled `getPaginationHTML`:
- raw `<img src=x onerror` present: **false**
- raw `</script><script>` present: **false**
- escaped `&lt;img src=x onerror` present: true
- `<script>` open tags == `</script>` close tags (1 == 1) → no element breakout

**End-to-end with a genuine file:** an XPT written with `<img src=x onerror=alert(1)>` as a real
column label was read by `xpt_reader.py` (label survives into metadata, confirming the attack
input is realistic) and rendered → raw tag absent, escaped form present.

**Package hygiene:** `dataset-lens-secure-2.6.0.vsix`, 183 files, 1.76 MB. Contains no
`tasks/`, `testing/`, `data/`, `.claude/`, or `__pycache__` entries, and no VirtualScrolling or
`webview/` files. SHA-256
`1a3e26d1f5ddf636cd47e11240dde8692b99d8bb2f9ee7f52f5d3f241a688b90`.

### Not verified (honest gaps)
- **No interactive VS Code run.** Everything above exercises the Python readers and the HTML
  *generator*; the webview's runtime DOM behaviour (`populateVariablesList`, `updateDisplayMode`,
  the Unique Values modal) was changed to route through `escapeHtml` and reviewed by reading, but
  not executed in a live panel. Worth one manual smoke test before wide distribution.
- **SAS7BDAT / RDS / RData / Dataset-JSON paths** were not opened end-to-end; they share the same
  renderer (so they inherit the escaping fixes) but their own readers were not re-tested.
- Only Linux was exercised. Windows `py`-launcher venv creation is unchanged from upstream but untested here.

### D13 — Correction to D5's naming
**Correction:** D5 proposed `displayName: "Dataset Lens (Secure Fork)"`. The implemented value is
**"Dataset Lens (Hardened Fork)"** — "hardened" describes what was actually done (specific defects
fixed) whereas "secure" is an absolute claim no software should make about itself. The extension
`name` is `dataset-lens-secure` as planned, since that is the install identifier and the more
recognisable word there. The `sas7bdat` custom-editor label stays plain "Dataset Lens" to match
its sibling editors ("Dataset Lens - XPT", etc.).
**Status:** Implemented.

### D14 — CSV formula injection: considered, deliberately NOT changed
**Decision:** Leave `exportCsv` in `src/WebviewPanel.ts` as-is. Documented as a known limitation
rather than silently altering exported values.
**Why:** The export does correct RFC 4180 quoting, but a cell whose value begins with `=`, `+`,
`-` or `@` is interpreted as a formula when the CSV is opened in Excel — the classic CSV-injection
issue. The usual mitigation (prefixing such cells with an apostrophe or a tab) **mutates the
exported data**. For a clinical-data viewer whose entire purpose is faithful representation, an
export that silently differs from the source is arguably a worse defect than the one it fixes,
and it would surprise anyone diffing an export against the original dataset.
The risk is also low here: it requires a malicious dataset *and* the user exporting it *and*
opening the result in a spreadsheet that honours formulas, and modern Excel prompts before
executing external content.
**Recommendation for Dylan:** if exports are routinely opened in Excel, this is worth revisiting —
the cleanest fix is an opt-in "sanitize for Excel" checkbox in the export UI, so the mutation is
the user's explicit choice. Flagged rather than silently decided.
**Status:** Open, deliberately deferred.

### D15 — Reproducibility property preserved
**Note:** The property that made upstream verifiable — committed `out/` reproduces exactly from
`src/` via `npx tsc -p .` — still holds for this fork. Verified after all changes: `diff -r`
between a clean rebuild and the committed `out/` is empty. Anyone can therefore repeat Dylan's
original audit against this fork, which is the whole basis for asking colleagues to trust it.
**Status:** Verified.

### D16 — CSP nonce added (completing spec Phase A step 3)
**Decision:** `script-src` is now `'nonce-<per-render-random>'` instead of `'unsafe-inline'`.
**Why:** The first pass only dropped `unsafe-eval`, leaving the spec's nonce step undone. Without
it, escaping is the *only* thing standing between a crafted file and script execution. With it,
injected script fails to run even if a sink was missed — the two defenses are independent, which
is the point.
**Safety check before applying:** nonce-based CSP blocks inline event handlers, which
`unsafe-inline` permitted. `grep -cE 'on(click|change|input|load|error|submit|keyup|keydown|mouseover)='`
over `PaginationWebview.ts` returns **0** — the live template wires everything through
`addEventListener`, so nothing breaks. (The deleted dead file *did* contain an inline `onclick`,
one more reason removing it was correct.)
**Evidence:** nonce present in CSP and on the `<script>` tag, differs between two renders of the
same metadata, `unsafe-inline`/`unsafe-eval` both absent. Full canary suite re-run after the
change: all pass; `out/` still reproduces from `src/`.
**Status:** Implemented and verified.
