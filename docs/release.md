# Release & catalog promotion

## Publishing model: automatic on main (opt-in)

A push (or PR merge) to `main` that touches **publishable artifact content**
automatically performs a **real, authenticated** catalog publish — **but only
when the repo variable `ORGSDK_ENABLE_CATALOG_PUBLISH` is set to `true`**.
There is no manual publish step for normal releases.

The `publish-catalog.yml` workflow calls the centrally maintained reusable
catalog-publish workflow in [OrgSDK/plugins](https://github.com/OrgSDK/plugins)
(pinned to an immutable commit). It triggers on `push` to `main` for these
paths:

- `plugin/**` — the shipped plugin source (the staged artifact).
- `package.json` — feeds the generated artifact `package.json`
  (`name`, `type`, `dependencies`).

> google-sheets declares `@googleapis/sheets`, `google-auth-library`, and `zod`
> as runtime `dependencies` entries. A change to the `dependencies` block (e.g.
> a version bump) is publishable content and requires a version bump; the
> version-guard enforces this. A change to the repo-local `overrides` block is
> NOT publishable (it does not flow into the generated artifact `package.json`).

A push that changes only docs, tests, workflows, README, or scripts does **not**
trigger a publish.

Publishing never runs on pull-request code — only on the `push` to `main`
event (the merged commit). `workflow_dispatch` remains available for dry-runs
and manual recovery.

## Publish opt-in gate

Real publishing (automatic **and** manual) is gated on the repo variable
`ORGSDK_ENABLE_CATALOG_PUBLISH == 'true'`. Exact behavior:

- **Push to main, gate enabled** → full publish.
- **Push to main, gate disabled/unset** → the publish job is skipped at the
  job level; the `catalog-publish` environment is never requested, so **no
  secrets are accessed** (clean skip — CI still validates the build).
- **Manual `dry_run=true`** → always builds + previews the payload (no POST),
  regardless of the gate. Usable even before the gate is enabled.
- **Manual `dry_run=false`** → requires the gate; fails clearly with an error
  if `ORGSDK_ENABLE_CATALOG_PUBLISH != 'true'`.

The safe choice: **manual real publish also requires opt-in.** A deliberate
human action is not enough on its own — the gate must be on.

## Required repository settings

These are configured in GitHub **repo Settings**, not in the repo files:

| Setting | Where | Value |
|---|---|---|
| `ORGSDK_ENABLE_CATALOG_PUBLISH` | Settings → Secrets and variables → **Variables** | `true` (opt in to publishing) |
| `ORGSDK_CATALOG_URL` | Settings → Secrets and variables → **Variables** | `https://app.orgsdk.ai` |
| `ORGSDK_PUBLISH_TOKEN` | repository secret **or** `catalog-publish` environment secret | scoped catalog publisher token (secret) |
| `catalog-publish` environment | Settings → Environments | deployment branches restricted to `main` (see below) |

Environment configuration for `catalog-publish` (fully automatic publishing):

- **Deployment branches** — restrict to `main`.
- **Required reviewers** — leave **OFF** by default. A reviewer gate makes
  publishing approval-based rather than automatic; enable it only as a
  temporary emergency pause.
- A repository-level `ORGSDK_PUBLISH_TOKEN` is sufficient — there is no need
  to re-add the secret to the environment. An environment-level secret is also
  supported and takes precedence if both exist.

The token is injected by GitHub (from the repository or the environment); it is
never printed or written to logs. The workflow references it only as
`${{ secrets.ORGSDK_PUBLISH_TOKEN }}`.

> **Slug scoping.** The catalog publisher token authenticates `POST /api/plugins`
> for **public** plugin uploads. Slug scoping for this repository is achieved
> by *repository isolation*: the repo contains only the `google-sheets` plugin
> source, so a publish from here can only ever stage slug `google-sheets` (the
> slug is read from `plugin/.plugin.json`). The `ORGSDK_PUBLISH_TOKEN` secret
> is this repo's own copy of the canonical platform publisher token — it is
> sourced independently from the operator via the deployed signing-root
> process, never copied from another plugin repo.

## Why the workflow runs its own verification

The publish workflow runs its **own** full verification (typecheck + lint +
tests + validate + package) instead of depending on the `CI` workflow's
status check. It must build the artifact to publish anyway, and a
self-contained build is robust against CI job-name changes, cancellations, and
status-check bypass races (defense in depth).

## Version policy

- **Current version:** `1.0.2`.
- The manifest version (`plugin/.plugin.json` → `version`) is the **source of
  truth** for the catalog. `package.json` → `version` is kept in sync (enforced
  by the CI version guard).
- Bump the version on **every** publishable content change. The CI version
  guard (`orgsdk-plugin version-guard`, run as `bun run version-guard`)
  fails a PR/commit if publishable content changed but the manifest version
  did not. Docs/workflow/scripts-only changes do **not** require a bump.
- Versions are **write-once** in the catalog: re-publishing the same
  `(slug, version)` with identical content is idempotent; different content is
  rejected with HTTP 409. Always bump the version for changed content.

### 1.0.2 — standalone repository extraction

`1.0.2` is a forward-only patch release that migrates the `google-sheets` plugin
from the OrgSDK monorepo (`packages/plugins/src/google-sheets/`) into this
standalone repository. No plugin source behavior changed — the seven safe
functions, the `google-oauth` connect-ownership contract (authProvider + GET
/callback + first-party), the union Sheets+Tasks scopes, the `source`
first-party/BYO discriminator, and the `@googleapis/sheets` + `google-auth-library`
runtime dependencies are byte-identical to the monorepo `1.0.1`. `zod`
(already imported at runtime) is now explicitly declared.

The repository/package/schema additions (`$schema`, `entry`,
`marketplace.links.sourceRepo`, type-only import specifiers, the generated
artifact `package.json` carrying the runtime dependencies) alter the immutable
publishable content of the staged artifact. Because catalog versions are
write-once, the existing `1.0.1` artifact cannot be re-published with this
changed content — it would differ and be rejected with HTTP 409. The new
artifact lands as a fresh `1.0.2` entry.

See [CHANGELOG.md](../CHANGELOG.md) for the full dependency-closure determination
and server-process assumptions.

## Manual dry-run / recovery

Run `Publish to Catalog` → `Run workflow` with `dry_run = true` (default).
This packages, validates, and prints the payload **without** POSTing. It does
not require `ORGSDK_PUBLISH_TOKEN`. Select `dry_run = false` to force a real
publish manually (requires the token).

## The artifact

`bun run package` produces:

```
dist/
├── google-sheets/                              # staged plugin folder (slug-named)
│   ├── .plugin.json
│   ├── package.json                           # generated: name, version, type, dependencies.{@googleapis/sheets, google-auth-library, zod}
│   ├── index.ts
│   ├── google-sheets-functions.ts
│   ├── auth-provider.ts
│   ├── client-resolver.ts
│   ├── oauth.ts
│   ├── first-party-client.ts
│   ├── terminal-oauth-flow.ts
│   ├── docs/overview.md
│   └── guides/usage-patterns.md
├── google-sheets-1.0.2.manifest.json          # file list + SHA-256 checksums (sorted)
└── google-sheets-1.0.2.tgz                    # tarball of the plugin folder
```

Packaging is deterministic: `dist/` is fully removed and recreated on every
run. The generated `package.json` carries
`"dependencies": { "@googleapis/sheets": "^13.0.2", "google-auth-library": "^10.6.2", "zod": "^4.0.0" }`
(the three runtime dependencies) and no `@orgsdk/plugins` (type-only imports are
erased). The repo-local `overrides` block does not appear in the artifact.
