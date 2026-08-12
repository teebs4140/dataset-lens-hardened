# Distributing this fork

Two channels. The VSIX path works today and needs no accounts. The Marketplace path
needs a publisher identity that only you can create.

---

## Before either channel: fill in the placeholders

`package.json` ships with deliberate placeholders so nothing can be published under a
name that isn't yours:

| Field | Current value | Replace with |
|---|---|---|
| `publisher` | `REPLACE-ME-publisher` | your registered Marketplace publisher ID |
| `repository.url` | `https://github.com/REPLACE-ME-org/...` | your fork's repo URL |
| `homepage`, `bugs.url` | same | same |

Also consider replacing `icon.png`. It is the upstream project's icon. MIT covers reuse of
the file, but shipping a public listing with the original's artwork invites confusion about
which extension is which. For internal VSIX distribution this matters much less.

---

## Git remotes

The hardened code is on **`main`**. The clone's original remote was renamed `origin` -> `upstream`
and its push URL disabled, so a stray `git push` cannot aim at the original author's repository.
Upstream's exact 2.5.0 tree is still preserved as `upstream/main`, so the full audit diff remains
one command:

```bash
git diff upstream/main..main
```

When you create your own GitHub repo for the fork, add it as `origin` and push:

```bash
git remote add origin https://github.com/<your-org>/dataset-lens-secure.git
git push -u origin main
```

To pick up future upstream releases later: `git fetch upstream && git rebase upstream/main`.

---

## Channel 1 — VSIX for Duke colleagues (works now)

Build:

```bash
npm install
npx tsc -p ./
npx vsce package
sha256sum dataset-lens-secure-*.vsix
```

Distribute the `.vsix` plus its SHA-256 (network share, GitHub release, or attachment).
Publish the hash somewhere your colleagues trust and separately from the file itself, so a
tampered copy can be detected.

They install with:

```bash
code --install-extension dataset-lens-secure-2.6.0.vsix
```

or Extensions panel → `...` → **Install from VSIX...**

Tell them to verify before installing:

```bash
sha256sum dataset-lens-secure-2.6.0.vsix
```

**Current build:** `dataset-lens-secure-2.6.0.vsix`
SHA-256: `1a3e26d1f5ddf636cd47e11240dde8692b99d8bb2f9ee7f52f5d3f241a688b90`

(That hash is for the build produced in this working tree. Re-hash after any rebuild — VSIX
files embed timestamps, so a rebuild will not reproduce the same hash byte-for-byte. This file
is excluded from the package precisely so that recording the hash here cannot change it.)

Note that colleagues still need Python 3 on their `PATH`; the extension provisions its own
virtualenv on first use.

---

## Channel 2 — public Marketplace listing

These steps require your Microsoft identity and a secret token. **Do them yourself** — do not
delegate them to an agent, and never paste the token into a file in this repo.

1. **Create an Azure DevOps organisation** (free) at https://dev.azure.com if you don't have one.
   Use an account you're willing to have permanently associated with the listing.

2. **Create a Personal Access Token**
   - Azure DevOps → User settings → Personal Access Tokens → New Token
   - **Organization: `All accessible organizations`** (a token scoped to a single org will fail
     with a confusing 401 at publish time — this is the most common setup mistake)
   - Scopes: `Custom defined` → **Marketplace → Manage**
   - Copy the token once; it is never shown again.

3. **Create the publisher** at https://marketplace.visualstudio.com/manage
   - Pick a publisher ID. It becomes permanent and public, and forms half of the extension
     identity (`<publisher>.dataset-lens-secure`).
   - Put that exact ID into `package.json`'s `publisher` field.

4. **Check institutional policy before using Duke branding.** A publisher ID or display name
   that implies Duke/DCRI endorsement is an institutional-identity question, not a technical
   one. Confirm with whoever owns that at your institution first. A neutral personal publisher
   ID avoids the question entirely.

5. **Log in and publish**

   ```bash
   npx vsce login <your-publisher-id>   # paste the PAT when prompted
   npx vsce publish
   ```

   Or publish a pre-built file without storing credentials:

   ```bash
   npx vsce publish --packagePath dataset-lens-secure-2.6.0.vsix -p <PAT>
   ```

6. **After publishing**
   - The listing takes a few minutes to appear and is scanned automatically.
   - Verify the live listing shows your publisher, your repo link, and the fork banner.
   - Colleagues can then `code --install-extension <publisher>.dataset-lens-secure`.

### Marketplace expectations for a fork

- The listing must not imply it is the original. The README banner already states the fork
  relationship in the first line — keep it there; it is the first thing the listing renders.
- Keep the MIT `LICENSE` and `NOTICE.md` intact.
- Bumping `version` in `package.json` is required for every publish; the Marketplace rejects
  a re-publish of an existing version.

---

## Offer the fixes upstream

The healthiest outcome is that this fork becomes unnecessary. Consider opening a PR (or a
private security report) against https://github.com/vikasgaddu1/dataset-lens with the
`eval` removal and the escaping pass. `CHANGELOG.md` is written to be usable as the PR body.
