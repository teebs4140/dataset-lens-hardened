# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately to the fork maintainer rather than opening a
public issue: **dylan.thibault@duke.edu**.

Please include the affected version, what an attacker would need to control (for example a
crafted data file, or a filter expression), and the observed impact. A sample file that
reproduces the issue is the most useful thing you can send.

If the issue originates in the upstream project, please also report it to
https://github.com/vikasgaddu1/dataset-lens/issues so other users benefit.

## Threat model

This extension parses data files that may come from outside your organisation, so **the
data file is treated as untrusted input**. Specifically:

- Variable names, labels, formats and dataset labels are free-text fields inside the file.
  They are escaped before being rendered in the viewer.
- Cell values are rendered as text, never as markup.
- The webview runs under `default-src 'none'`, so it cannot make network requests even if
  content injection were achieved, and `script-src` is bound to a per-render nonce, so injected
  script cannot execute even if an escaping gap were found.

The extension performs **no network communication** and collects **no telemetry**. The only
outbound traffic is `pip` installing `pandas`, `numpy`, `pyreadstat` and `pyreadr` from PyPI
into a private virtualenv the first time a Python-backed format is opened.

Filter (WHERE) expressions are evaluated by `pandas.query()` only. There is deliberately no
`eval` fallback; expressions `query()` cannot parse are rejected rather than executed.

## What is still trusted

- The Python packages installed from PyPI, and the `js-stream-sas7bdat` / `xport-js` npm
  packages, including the prebuilt native binaries the former ships.
- The Python interpreter found on your `PATH`, used to create the virtualenv.

## Verifying what you installed

Each release is distributed as a `.vsix` with a published SHA-256. To confirm the file you
received is the file that was built:

```bash
sha256sum dataset-lens-hardened-<version>.vsix
```

Compare the result against the hash published with the release. To go further, rebuild from
source (`npm install && npx tsc -p ./ && npx vsce package`) and compare the contents.
