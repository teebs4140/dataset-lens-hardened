# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

**This is a security-hardened fork** of [vikasgaddu1/dataset-lens](https://github.com/vikasgaddu1/dataset-lens).
Read `NOTICE.md` for the relationship to upstream, `CHANGELOG.md` for what changed, and
`SECURITY.md` for the threat model before changing parsing or rendering code.

## Build and test

```bash
npm install          # dependencies
npm run compile      # tsc -p ./   (output goes to out/, which is committed)
npm run watch        # watch mode
npx vsce package     # build the .vsix
```

`out/` is committed and must stay reproducible from `src/`: a clean `npx tsc -p ./` followed by
`diff -r` against `out/` should be empty. That property is what lets anyone verify the published
package matches the source, so do not hand-edit anything in `out/`.

Test the Python readers directly (they are plain CLIs):

```bash
python python/sas_reader.py metadata <file.sas7bdat>
python python/xpt_reader.py  data     <file.xpt> 0 100 "" "AGE > 30"
python python/r_reader.py    metadata <file.rds>
```

Press F5 in VS Code to launch an Extension Development Host.

## Publishing

**This is a fork.** Upstream's publishing instructions (publisher `elearnsas`, a PAT in a local
`.env`, an Azure DevOps org belonging to the original author) were removed, because following them
from this repository would publish under someone else's identity.

Do not publish from an automated session. Build and test freely, but never run `vsce publish`,
never create publisher accounts, and never write a Personal Access Token into any file here.
Release steps are maintainer-only and kept outside this repository.

## Architecture

TypeScript-first with a Python fallback, and a single webview renderer.

### Which reader handles which file

This is the detail that matters most when changing reader code:

| Format | Reader | Python needed? |
|---|---|---|
| `.sas7bdat` | `src/readers/EnhancedSASReader.ts` (js-stream-sas7bdat), Python only on failure | No |
| `.xpt` v5/v6 | `src/readers/XPTReader.ts` (xport-js) | No |
| `.xpt` v8/v9 | `python/xpt_reader.py` (pyreadstat) | **Yes** |
| `.rds`, `.rdata`, `.rda` | `python/r_reader.py` (pyreadr) | **Yes** |
| Dataset-JSON `.json` | `src/DatasetJsonProvider.ts` | No |

### Components

**Extension layer**
- `src/extension.ts` — entry point; registers five custom editors and the `sasDataExplorer.*` commands.
- `src/SasDataProvider.ts`, `XptDataProvider.ts`, `RDataProvider.ts`, `DatasetJsonProvider.ts` —
  one `CustomReadonlyEditorProvider` per format; own document lifecycle and reader selection.
- `src/WebviewPanel.ts` — the single `SASWebviewPanel`; message routing, CSV export, and the only
  place that sets `webview.html`.

**Renderer**
- `src/PaginationWebview.ts` — the *only* renderer. Every editor goes through
  `getPaginationHTML()`. Pagination at 50/100/200/500 rows per page.
- The virtual-scrolling renderers were deleted in this fork: they were exported but never imported,
  and carried their own `eval()` and a weaker CSP. Do not reintroduce that pattern.

**Python backend** — `python/{sas_reader,xpt_reader,r_reader}.py`. CLI scripts taking
`<command> <file> [args...]` and printing a single JSON object to stdout. Errors are returned as
`{"error": "..."}`, which the TypeScript side surfaces to the user.

**Python environment** — `src/utils/pythonEnvironment.ts` creates a private venv under
`globalStorageUri` on first use of a Python-backed format. It probes every interpreter on the
machine (the `sasDataExplorer.pythonPath` setting first, then `python.defaultInterpreterPath`, then
version-suffixed names newest-first), and installs wheels-only before allowing source builds. Never
call `spawn` with `shell: true` here — arguments would be concatenated unquoted, which breaks paths
containing spaces and any argument containing spaces.

### Data flow

1. VS Code matches the file pattern and activates the custom editor.
2. The document loads metadata via its reader (TypeScript, falling back to Python).
3. `SASWebviewPanel` sets `webview.html` from `getPaginationHTML(metadata)`.
4. The webview posts `webviewReady`; the panel then sends the first page.
5. Messages webview → extension: `webviewReady`, `loadData`, `applyFilter`, `updateFilter`,
   `applyWhereClause`, `getUniqueValues`, `toggleVariable`, `reorderVariables`, `searchVariables`,
   `exportCsv`.
6. Messages extension → webview: `initialData`, `dataChunk`, `filterResult`, `exportCsvDone`,
   `exportCsvError`, `error`.

**Message handler order matters**: set webview options → attach the message handler → set HTML →
wait for `webviewReady` → send data. Attaching the handler after setting HTML drops the ready signal.

## Security invariants

Changing any of these reopens a fixed vulnerability. They are the reason this fork exists.

1. **No `eval`.** WHERE clauses are evaluated by `pandas.query()` only. Expressions it cannot parse
   are rejected, never passed to `eval`. There must be no `eval(` anywhere in `src/`, `out/`, or
   `python/`.
2. **Dataset metadata is untrusted.** Variable names, labels, formats, dataset labels, file paths
   and cell values come from the file and may be hostile. In `PaginationWebview.ts`, use `esc()` for
   HTML context and `jsonForScript()` for anything embedded in `<script>`; client-side, use
   `escapeHtml()` before any `innerHTML`. Prefer `textContent` where no markup is needed.
3. **CSP.** `default-src 'none'`, and `script-src` bound to a per-render nonce. Do not add
   `unsafe-inline` or `unsafe-eval`, and do not add inline event handlers (`onclick=`) — they cannot
   execute under a nonce. Use `addEventListener`.
4. **A failed filter must be an error**, never a silent return of unfiltered rows. Showing every row
   to someone who believes they are looking at a filtered subset is a data-integrity bug.
5. **Serialize defensively in Python.** `json.dumps` cannot encode `datetime.date`; normalise values
   as the readers do (`isoformat()`, `str()`, decode bytes, `.item()` for numpy scalars).

## Data loading

- Small datasets (< 1000 rows): loaded in full, filtered client-side.
- Larger: one page per request; WHERE filtering applied in pandas/TypeScript before paging.
- `FilterState` tracks selected variables, the WHERE clause, and column order.
