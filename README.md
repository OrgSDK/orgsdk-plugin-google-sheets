# @orgsdk/plugin-google-sheets

Official OrgSDK plugin for Google Sheets — range and structured-table read/write
for agent workflows. Seven safe functions exposing the Google Sheets REST
surface. This plugin **owns the shared `google-oauth` connect flow** for the
whole Google train: connecting once (one-click first-party or BYO) stores a
single `google-oauth` credential whose granted scopes cover **Sheets + Tasks**,
so the `google-tasks` plugin works with no separate connect step.

[![CI](https://github.com/OrgSDK/orgsdk-plugin-google-sheets/actions/workflows/ci.yml/badge.svg)](https://github.com/OrgSDK/orgsdk-plugin-google-sheets/actions/workflows/ci.yml)

## Repository layout

```
orgsdk-plugin-google-sheets/
├── .github/workflows/
│   ├── ci.yml                 # calls the shared reusable CI workflow (OrgSDK/plugins)
│   └── publish-catalog.yml    # calls the shared reusable publish workflow (opt-in; manual dry-run)
├── plugin/                    # the publishable plugin folder
│   ├── .plugin.json           # manifest (slug, version, oauth2 google-oauth auth, firstParty, union scopes, marketplace)
│   ├── index.ts               # entry — factory (ctx) => PluginModule (owns authProvider + /callback)
│   ├── google-sheets-functions.ts  # seven functions: range + structured-table ops
│   ├── auth-provider.ts       # GoogleOAuthProvider — initiate/handleCallback/configure/authSetup/isFirstPartyAvailable
│   ├── client-resolver.ts     # BYO-precedence resolution (3 tenant tiers → first-party relay fallback)
│   ├── oauth.ts               # shared google-oauth bundle → OAuth2Client (first-party relay refresh | BYO local)
│   ├── first-party-client.ts  # relay /api/oauth/{config,exchange,refresh} client + access-token cache
│   ├── terminal-oauth-flow.ts # CLI authSetup (interactive paste-the-code flow)
│   ├── docs/overview.md       # plugin-local docs
│   └── guides/usage-patterns.md  # agent-facing composition patterns
├── tests/                     # bun:test — manifest, purity, shape, packaging, google-bundle smoke, credential-shape, connect-resolution, callback-endpoint
├── docs/                      # contract migration, release/promotion contract
├── package.json
├── tsconfig.json
├── biome.json
└── README.md
```

The `plugin/` folder is the canonical source for the `google-sheets` plugin; it
is published to the OrgSDK catalog on merge to `main` when opted in via the
`ORGSDK_ENABLE_CATALOG_PUBLISH` repo variable (see [docs/release.md](docs/release.md)).

## Local development

Requires [Bun](https://bun.sh) ≥ 1.3.x.

```bash
# Install (frozen lockfile in CI; dev: generates one)
bun install

# Lint + format check
bun run check

# Typecheck (no emit)
bun run typecheck

# Run tests
bun run test

# Validate manifest + source purity (orgsdk-plugin validate)
bun run validate

# Stage distributable artifact into dist/ (orgsdk-plugin package)
bun run package

# Full build pipeline (typecheck → validate → package)
bun run build
```

The `validate`, `package`, `version-guard`, and `publish` npm scripts delegate to
the [`orgsdk-plugin`](https://www.npmjs.com/package/@orgsdk/plugins) CLI shipped
by the `@orgsdk/plugins` dev dependency. There are no local management scripts.

## Functions

Seven functions across range and structured-table operations. Three are
readonly (read-only Google Sheets GETs), four are write (mutating). Three
readonly functions are tagged `discovery` (safe to use in exploration
workflows).

| Group | Readonly | Write |
|---|---|---|
| Range ops (3) | getSheetData | appendToSheet, clearSheet |
| Structured-table ops (4) | listSheetTables, getTableData | appendToTable, updateTableRow |

Every function declares `requiredCredentials: ["google-oauth"]` — none are
callable until the shared credential is connected.

## Credentials & the coordinated Google train

This plugin **owns** the shared `google-oauth` connect flow: it registers the
`GoogleOAuthProvider` and the `GET /callback` httpEndpoint. It is the sole
connect owner for both `google-sheets` and `google-tasks`. `google-tasks`
is functions-only and consumes the credential this plugin stores.

| Provider | Type | Connect method |
|---|---|---|
| `google-oauth` | oauth2 | **One-click "Connect Google"** when the relay has OrgSDK's first-party client configured; otherwise supply your own OAuth client JSON (BYO). The granted scopes cover Sheets + Tasks. |

### Union scopes (frozen contract)

The connect requests the **union** of scopes:

- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/tasks`

so a single stored `google-oauth` credential covers both this plugin and
`google-tasks`. Dropping the tasks scope would silently break `google-tasks`
after a single connect. Gmail is a restricted scope and lives in the separate
`gmail` plugin (BYO only).

### The `source` discriminator (frozen contract)

A stored `google-oauth` bundle carries a `source` field set at connect time:

- **`source: "first-party"`** — OrgSDK's relay holds the client secret. At
  runtime this plugin fetches a fresh access token from the relay's
  `/api/oauth/refresh` endpoint (cached per refresh token); the bundle carries
  no `client_secret`.
- **`source: "byo"`** (or absent/legacy) — the tenant's own OAuth client. The
  plugin refreshes locally using the bundled `client_secret`.

### BYO always wins (resolution order)

Client resolution (first hit wins):

1. `google-oauth-client/default` (tenant shared client)
2. `google-oauth-client/<name>` (tenant per-credential client)
3. `google-oauth/<name>` client fields (legacy: client baked into token)
4. first-party via the relay (OrgSDK's own client; no BYO)

A tenant who supplied their own client keeps full control (quota isolation,
restricted-scope consent). The relay-held client secret **never** reaches a
tenant database or daemon container.

The provider key (`google-oauth`), the `source` discriminator, and the
first-party flag must never change — both plugins (sheets + tasks) and the relay
depend on them. See [docs/contract-migration.md](docs/contract-migration.md).

## Manifest & version rules

- The manifest lives at `plugin/.plugin.json`.
- `version` is the **source of truth** for the catalog — bump it on every
  publishable content change (the CI version guard enforces this).
- `package.json` → `version` is kept in sync with the manifest (enforced by the
  version guard).
- Versions are **write-once** in the catalog: re-publishing the same
  `(slug, version)` with identical content is idempotent; differing content is
  rejected (HTTP 409). Treat every publish as forward-only.
- See [docs/release.md](docs/release.md) for the automatic publish model and
  required repository settings.

## CI/CD

CI and catalog publishing delegate to centrally maintained **reusable
workflows** in [OrgSDK/plugins](https://github.com/OrgSDK/plugins), pinned to an
immutable commit. The caller workflows (`.github/workflows/`) only wire up
triggers, the opt-in gate, artifact names, and secrets — no plugin mechanics
are duplicated. See the
[reusable-workflows docs](https://github.com/OrgSDK/plugins/blob/main/docs/reusable-workflows.md)
for the full contract.

## Runtime dependencies: @googleapis/sheets + google-auth-library + zod

`google-sheets-functions.ts` imports `sheets_v4` from
[`@googleapis/sheets`](https://www.npmjs.com/package/@googleapis/sheets)
(`^13.0.2`) and constructs a `sheets_v4.Sheets` client; `auth-provider.ts`,
`oauth.ts`, and `terminal-oauth-flow.ts` import `OAuth2Client` from
[`google-auth-library`](https://www.npmjs.com/package/google-auth-library)
(`^10.6.2`); `google-sheets-functions.ts` imports `z` from
[`zod`](https://www.npmjs.com/package/zod) (`^4.0.0`) for runtime row
validation in `appendToTable`. At publish time, the platform's
`resolvePluginDeps` bundles the plugin entry plus the two Google packages (and
their full transitive closure) into a single `__bundle.js` ESM file via
`Bun.build`; `zod` is kept external (present in the daemon image). The daemon
imports that bundle directly — there is **no runtime node_modules resolution**
in the tenant container.

See [docs/contract-migration.md](docs/contract-migration.md) for the full
dependency-closure analysis and the install-resolution correction.

## Security constraints

- This plugin owns the connect flow — it registers an `authProvider` and the
  `GET /callback` endpoint. The shared `google-oauth` credential is injected
  per-call as the leading `credentials` argument; the `source` discriminator
  selects first-party (relay-owned refresh) vs BYO (local refresh) handling.
  Secrets are never logged. The relay-held client secret never reaches a tenant
  DB or daemon container.
- Source purity is enforced: no imports from private `@orgsdk/*` packages, no
  cross-plugin imports (`oauth.ts` + `first-party-client.ts` are self-contained
  duplicates of the google-tasks leaf modules — cloud-mode plugins must be
  self-contained because the materialiser blocks sibling imports), no runtime
  value imports from the authoring SDK. The `validate` script and
  `tests/purity.test.ts` guard this.
- Publish credentials (`ORGSDK_PUBLISH_TOKEN`) live as a GitHub secret
  (repository-level or `catalog-publish` environment); they are never committed
  to the repo. See [docs/release.md](docs/release.md).

> **Pre-existing security/resource concerns (frozen, not refactored in this
> extraction).** Every handler issues an authenticated Google Sheets request
> with no per-call allow/deny list, rate-limit guard, or response-size cap. The
> scope of what an agent can do is bounded only by the connected credential's
> scopes. `clearSheet`, `appendToSheet`, `appendToTable`, and `updateTableRow`
> are mutating (some destructively so — `clearSheet` is irreversible). These
> behaviors are frozen verbatim per the migration discipline. See
> [docs/contract-migration.md](docs/contract-migration.md#known-pre-existing-issues-recorded-not-fixed-in-this-release).

## Authoring contract & runtime dependencies

The plugin authoring types come from the public
[`@orgsdk/plugins`](https://www.npmjs.com/package/@orgsdk/plugins) npm package,
imported type-only (`import type { … } from "@orgsdk/plugins"`). The SDK is a
dev-only dependency. The runtime artifact carries **three** runtime dependencies
— `@googleapis/sheets` (`^13.0.2`), `google-auth-library` (`^10.6.2`), and
`zod` (`^4.0.0`, kept external by the bundler as a daemon-image framework dep).

See [docs/contract-migration.md](docs/contract-migration.md).

## Source attribution

Extracted from the OrgSDK monorepo at:

- **Source path:** `packages/plugins/src/google-sheets/`
- **Source version:** `1.0.1`

No plugin behavior changed in this extraction — only the type-only import
specifiers (`orgsdk/plugins` → `@orgsdk/plugins`), the manifest `$schema`,
`entry`, `version`, and `marketplace.links.sourceRepo` were added.

## License

Proprietary — All rights reserved. This source is the confidential property
of OrgSDK. No part of this repository may be reproduced, distributed, or
transmitted in any form without the prior written permission of OrgSDK.
Unauthorized use, modification, or redistribution is strictly prohibited.
