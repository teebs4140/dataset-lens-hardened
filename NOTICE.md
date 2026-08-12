# Attribution and provenance

## Upstream project

This extension is a fork of **Dataset Lens** by Vikas Gaddu.

- Upstream source: https://github.com/vikasgaddu1/dataset-lens
- Upstream Marketplace listing: `elearnsas.dataset-lens`
- Forked from upstream version **2.5.0**
- License: MIT (unchanged — see `LICENSE`)

The upstream `LICENSE` file ships with an unfilled `[Your Name or Organization]`
copyright placeholder. It is preserved here verbatim rather than rewritten, since
altering another project's copyright notice is exactly what the MIT terms forbid.

All credit for the original design and implementation — the readers, the webview,
the Python backend, the format support — belongs to the upstream author. This fork
changes a small number of security-relevant lines and nothing else of substance.

## Why this fork exists

The upstream extension was audited before internal use. The audit found **no malware,
no telemetry, and no network activity**, and confirmed that the code published to the
Marketplace is byte-identical to the code on GitHub. It did find several ordinary
security defects, all of which are fixed here. See `CHANGELOG.md` for the specifics.
The full audit trail (plan, decisions, and verification output) is kept in the maintainer's
separate audit workspace rather than in this repository.

This fork exists to carry those fixes, not because the upstream project is untrustworthy.
Fixes are offered upstream; if they are merged, this fork should be retired in favour
of the original.

## Provenance note

Upstream's public git history begins at a commit titled *"Republish under clean repo
with no prior references"*, so history before version 2.3.0 is not publicly inspectable.
This is recorded as a plain fact about what can and cannot be reviewed. It is **not**
an allegation of wrongdoing — the audited 2.5.0 tree is clean, and its published bytes
were verified against its source.

## Bundled third-party components

- `js-stream-sas7bdat` — MIT, wraps the ReadStat C library; ships prebuilt native binaries.
- `xport-js` — SAS XPORT parser.
- Python packages provisioned at runtime into a private virtualenv: `pandas`, `numpy`,
  `pyreadstat`, `pyreadr`. These are downloaded from PyPI on first use; they are not
  bundled in the extension package.
