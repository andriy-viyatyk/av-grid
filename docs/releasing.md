# Releasing

Cutting a release is two commands. Everything after them is automated.

```bash
npm version patch      # or minor / major — bumps, syncs, commits, tags
git push --follow-tags # pushes main and the tag; the tag starts the release
```

That is the whole procedure. The rest of this page is what those two commands set in motion, and
what to do when something goes wrong.

## What each step does

**`npm version <patch|minor|major>`** bumps `package.json`, then runs the `version` lifecycle
script, which is [`scripts/sync-version.mjs`](../scripts/sync-version.mjs) followed by a `git add`.
That script copies the new version into the two constants in `src/` that quote it —
`AVGrid.version` and the `version` export — and staging them means the sync lands in the same
commit as the bump rather than trailing behind it. npm then commits and creates the tag.

The two constants are string literals rather than a read of `package.json` because the library
ships to a browser, where the manifest may not be resolvable at runtime. A test asserts all three
agree, so a version that was bumped in only one place fails the suite instead of shipping a bundle
that misreports itself.

**`git push --follow-tags`** pushes the branch and any tags on it. The tag is what matters:
[`.github/workflows/release.yml`](../.github/workflows/release.yml) triggers on `v*` and does the
rest — checks the tag against `package.json`, runs the full suite, builds, publishes to npm with a
provenance attestation, and creates the GitHub release with generated notes.

**Watch it:** `gh run watch` — or the Actions tab. If the workflow fails, nothing was published;
see *Recovering* below.

## Authentication — there is no token

Publishing uses npm **trusted publishing** over OIDC. npm is configured to trust *this workflow
file in this repository*, and mints a short-lived credential per run. No `NPM_TOKEN` secret exists,
so there is nothing to leak and nothing to rotate — which also sidesteps npm's ongoing restriction
of tokens that bypass 2FA.

The configuration lives on npmjs.com, under the `av-grid` package → **Settings → Trusted
Publisher**:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `andriy-viyatyk` |
| Repository | `av-grid` |
| Workflow filename | `release.yml` |
| Environment | *(empty)* |

Two consequences worth knowing:

- **Renaming or moving the workflow file breaks publishing** until the trusted publisher entry is
  updated to match. The binding is to the filename, not to the job.
- **The workflow is read from the tagged commit**, not from `main`. A change to the release process
  only affects tags created after it is on the branch.

## Version numbers

The published line starts at **2.0.0**. Versions 1.0.0–1.0.5 are a different library under the same
name: the 2021 React component this project is the descendant of, preserved on the `react-1.x`
branch and at the `v1.0.5-react` tag. Nothing in the 1.x line shares an API with this one, which is
why the rewrite took a major bump rather than continuing the sequence.

Ordinary semver from here. The public surface is [`docs/api.md`](api.md) — if a change alters
anything on that page in a way existing code would notice, it is a major.

## Recovering

**The workflow failed before `npm publish`.** Nothing was published and the tag is harmless. Fix
the problem on `main`, then move the tag:

```bash
git tag -d v2.0.1 && git push origin :refs/tags/v2.0.1   # delete local and remote
npm version 2.0.1 --allow-same-version                   # re-tag the fixed commit
git push --follow-tags
```

**The workflow failed after `npm publish`.** The version is on npm and **that is permanent** —
npm allows unpublishing only within 72 hours, and the number can never be reused afterwards either
way. Do not try to republish it. Ship the fix as the next patch version.

**The release published but the GitHub release is missing.** Only the last step failed; create it
by hand with `gh release create v2.0.1 --generate-notes --verify-tag`.

## Publishing by hand

Only if Actions is unavailable. It needs `npm login` as `viyatyk`, and it produces **no provenance
attestation**, so prefer the workflow.

```bash
npm test && npm run build
npm publish --dry-run     # review the file list and the tarball size first
npm publish
```

`prepublishOnly` runs the build regardless, so `dist/` cannot be stale — but reviewing the dry run
is still the step that catches a `files` mistake before it is permanent.

## After a release

- **jsDelivr serves from npm automatically** — no separate hosting, and no action needed:
  `https://cdn.jsdelivr.net/npm/av-grid@<version>/dist/av-grid.js`. That URL is where an agent
  downloads the file to vendor a frozen copy into a Persephone board's `lib/`; a board's CSP
  forbids loading it remotely at runtime.
- **If the render path changed**, the benchmark row in
  [`../tasks/benchmark-results.md`](../tasks/benchmark-results.md) should already exist — it is
  required at change time, not at release time.
