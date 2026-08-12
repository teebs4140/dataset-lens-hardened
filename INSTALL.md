# Installing Dataset Lens (Hardened Fork)

View SAS datasets (`.sas7bdat`), XPT/XPORT, R data files, and CDISC Dataset-JSON directly in
VS Code. No SAS installation required.

Takes about two minutes.

---

## Step 1 — Get the file

Download **`dataset-lens-hardened-2.6.0.vsix`** from wherever it was shared with you
(network share, email, or the repo's Releases page).

## Step 2 — Check you got the right file (optional, 10 seconds)

This confirms nobody tampered with the file in transit. Open a terminal where you saved it:

**macOS / Linux**
```bash
shasum -a 256 dataset-lens-hardened-2.6.0.vsix
```

**Windows (PowerShell)**
```powershell
Get-FileHash dataset-lens-hardened-2.6.0.vsix -Algorithm SHA256
```

The result should match the hash published alongside the download. If it doesn't, stop and ask
before installing.

## Step 3 — Install it

**The clicking way:**

1. Open VS Code
2. Click the **Extensions** icon in the left sidebar (or press `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Click the **`...`** menu at the top of the Extensions panel
4. Choose **Install from VSIX...**
5. Select the `.vsix` file you downloaded
6. Reload VS Code if prompted

**The terminal way:**

```bash
code --install-extension dataset-lens-hardened-2.6.0.vsix
```

## Step 4 — Open a dataset

Just double-click any `.sas7bdat`, `.xpt`, `.rds`, or `.rdata` file in VS Code's file explorer.
It opens in the viewer automatically.

For CDISC Dataset-JSON, right-click the `.json` file → **Open With...** → **Dataset Lens -
Dataset-JSON** (since `.json` files normally open in the text editor).

That's it.

---

## What you can do in the viewer

- **Page through data** — 50, 100, 200, or 500 rows at a time
- **Pick variables** — check and uncheck columns in the left sidebar; search to find one quickly
- **Filter rows** — type a SAS-style WHERE clause, e.g.

  ```
  AGE > 65
  SEX = 'F' AND ARM = 'Placebo'
  RACE NE 'WHITE'
  ```

- **See variable metadata** — labels, types, formats, and lengths
- **Unique values** — frequency counts for any variable, honouring your current filter
- **Export to CSV** — writes out the columns you selected and the rows your filter matched

---

## About Python (only for some file types)

Most files need nothing extra. Python is used **only** for:

- XPT **v8/v9** files (older v5/v6 XPT files don't need it)
- R data files (`.rds`, `.rdata`, `.rda`)

The first time you open one of those, the extension builds its own private Python environment and
shows a progress notification. This takes a minute and happens once. It does not touch your system
Python or any environment you use for your own work.

You need Python 3.9 or newer installed and on your PATH. If you don't have it,
get it from [python.org/downloads](https://www.python.org/downloads/).

**If setup fails**, the error message lists every interpreter it tried. Point the extension at a
specific Python instead — no need to change your PATH:

1. `Ctrl+,` / `Cmd+,` to open Settings
2. Search for `Dataset Lens`
3. Put the full path to a Python 3.9+ executable in **Python Path**

To start over, run **Dataset Lens: Reset Python Environment** from the Command Palette
(`Ctrl+Shift+P` / `Cmd+Shift+P`).

---

## Troubleshooting

**The file opened as unreadable text or binary junk.**
Right-click it → **Open With...** → pick the Dataset Lens entry.

**I want to see what went wrong.**
Command Palette → **Dataset Lens: Show Output**. For more detail, turn on
`Dataset Lens: Enable Debug Logging` in Settings and reopen the file.

**A WHERE clause is rejected.**
Filters support comparisons (`=`, `NE`, `>`, `<`, `GE`, `LE`) combined with `AND` / `OR` over column
names. Anything more exotic is refused **on purpose** — the original extension ran unrecognised
filter text as code, which is one of the bugs this fork fixes. Quote character values:
`SEX = 'F'`, not `SEX = F`.

**Nothing happens when I open a large file.**
Big datasets take a moment to load their first page. Check the output panel if it lasts more than
a few seconds.

---

## Why this is a fork

This is a security-hardened build of the community
[Dataset Lens](https://github.com/vikasgaddu1/dataset-lens) extension. The original was reviewed
before internal use: it contains no malware, no telemetry, and makes no network connections, and
its published build matches its public source. The review did find ordinary security bugs, which
this fork fixes — most importantly a flaw where a WHERE clause could execute arbitrary code, and
one where a maliciously crafted data file could inject content into the viewer.

**Your data never leaves your machine.** The extension makes no network requests. The only thing it
downloads is the Python packages described above, from PyPI.

Full details: [`CHANGELOG.md`](CHANGELOG.md) · [`SECURITY.md`](SECURITY.md) ·
[`NOTICE.md`](NOTICE.md)

Problems or questions: dylan.thibault@duke.edu
