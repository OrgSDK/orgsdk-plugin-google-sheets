# Changelog

All notable releases of `@orgsdk/plugin-google-sheets` are documented here.

The catalog treats versions as **write-once**: a given `(slug, version)` may be
re-published only with identical artifact content; differing content is
rejected with HTTP 409. Every entry below is therefore forward-only.

## [1.0.3] — Google BYO OAuth setup guide

### Added
- **`auth.setupGuide`** — a complete structured setup guide that the dashboard
  renders as an in-product checklist for bringing your own Google OAuth client.
  One-click connection remains the default; the guide appears only after the
  user deliberately chooses "Use your own OAuth app" or when one-click is
  unavailable. The resulting connection is shared with Google Tasks.
  - Seven ordered steps: Google Cloud project → enable Sheets + Tasks APIs →
    consent screen → Web application OAuth client → authorized redirect URI →
    download JSON → connect.
  - Callback URL presentation, credential field presentation, prerequisites,
  and an HTTPS troubleshooting URL.
  - Permission labels for both shared scopes (`spreadsheets`, `tasks`).
  - Every external link is HTTPS-validated by the canonical author schema.

### Changed
- Bump `plugin/.plugin.json` version `1.0.2` → `1.0.3`.
- Bump `package.json` version `1.0.2` → `1.0.3`.
- Bump `@orgsdk/plugins` devDependency `0.2.1` → `0.2.2` (models
  `auth.setupGuide`). **The lockfile must be regenerated after SDK 0.2.2 is
  published to npm.**
- `tests/manifest.test.ts` version assertion → `1.0.3` and new setup-guide
  assertions.

### Frozen (unchanged from 1.0.2)
- All seven safe functions, the first-party authProvider, GET /callback, the
  union Sheets+Tasks scopes, the first-party/BYO discriminator, and runtime
  dependencies.

## [1.0.2] — standalone repository extraction

A forward-only patch release that migrates the `google-sheets` plugin from the
OrgSDK monorepo (`packages/plugins/src/google-sheets/`) into this standalone
repository. **No plugin source behavior changed** — the seven safe functions,
the `google-oauth` connect-ownership contract (authProvider + GET /callback +
first-party), the union Sheets+Tasks scopes, the `source` first-party/BYO
discriminator and BYO-precedence resolution, and the `@googleapis/sheets` +
`google-auth-library` runtime dependencies are byte-identical to the monorepo
`1.0.1`. `zod` (already imported at runtime in `appendToTable`) is now
explicitly declared as a runtime dependency.

### Why 1.0.2 (not 1.0.1)

The repository/package/schema additions alter the immutable publishable content
of the staged artifact:

- manifest `$schema` (`https://orgsdk.ai/schemas/plugin-manifest.v1.json`)
- manifest `entry` (`index.ts`)
- `marketplace.links.sourceRepo` provenance link
- type-only import specifiers (`orgsdk/plugins` → `@orgsdk/plugins`)
- the generated artifact `package.json` carrying the runtime dependencies

Because catalog versions are write-once, the existing `1.0.1` artifact cannot be
re-published with this changed content — it would differ and be rejected with
HTTP 409. Rather than mutate the published history of `1.0.1`, the new artifact
lands as a fresh `1.0.2` entry.

### Changed

- Bump `plugin/.plugin.json` version `1.0.1` → `1.0.2` (catalog source of
  truth).
- Bump `package.json` version `1.0.1` → `1.0.2` (kept in sync; enforced by the
  CI version guard).
- Add manifest `$schema`, `entry`, and `marketplace.links.sourceRepo`.
- Update type-only import specifiers `orgsdk/plugins` → `@orgsdk/plugins`.
- **Declare `zod` (`^4.0.0`) as a runtime dependency.** `appendToTable` already
  imported `{ z }` at runtime (row-value validation) in the monorepo source;
  the monorepo relied on `zod` being top-level. The isolated repository must
  declare it so local typecheck resolves and the staged artifact documents the
  true runtime closure. `resolvePluginDeps` keeps `zod` external (present in the
  daemon image) — it is resolved at runtime, not bundled.
- **Install-resolution correction (zero runtime change).** A repo-local
  `overrides` entry dedupes `google-auth-library` to a single copy for local
  typechecking. See
  [docs/contract-migration.md](docs/contract-migration.md#install-resolution-correction-zero-runtime-change).

### Frozen (unchanged from monorepo 1.0.1)

- All seven safe functions — names, parameters, return types, metadata, tags,
  the readonly/write split (three readonly, four write), and the three
  discovery flags.
- The shared `google-oauth` connect-ownership contract: **authProvider present**
  (`GoogleOAuthProvider`), `requiredCredentials: ["google-oauth"]` on every
  function, the GET /callback httpEndpoint, `firstParty: true`, and the
  callbackPath `/callback`. google-sheets remains the sole connect owner for
  the whole Google train.
- The **union scopes** (spreadsheets + tasks) requested at connect time.
- The `source: "first-party" | "byo"` discriminator, BYO-precedence resolution
  order, and relay-refresh semantics in `auth-provider.ts` /
  `client-resolver.ts` / `oauth.ts` / `first-party-client.ts`.
- No `config` (no Zod tenant_config schema), no `tables`.
- The factory `PluginModule` entry shape (`default export` →
  `(ctx) => PluginModule`).
- The `@googleapis/sheets` (`^13.0.2`) and `google-auth-library` (`^10.6.2`)
  runtime dependencies and their usage.
- `plugin/docs/overview.md` and `plugin/guides/usage-patterns.md` — verbatim.

### Dependency-closure determination

`@googleapis/sheets@^13.0.2` resolves to `13.0.2` (the source-declared supported
range; no root/latest drift). Its direct dependency is
`googleapis-common@^8.0.0`, which pins `google-auth-library@10.5.0` exactly.
`google-auth-library@^10.6.2` (declared at top level) resolves to `10.9.0`.
`zod@^4.0.0` is a direct runtime import (`appendToTable` row validation) and is
kept external by the bundler (present in the daemon image).

`Bun.build` (target: `bun`, format: `esm`, `external: ["zod"]`) inlines the
full Google closure (both Google packages and their transitives) into a single
deterministic `__bundle.js`. The daemon imports it directly — no `node_modules`,
no native binary. `tests/google-bundle.test.ts` verifies this end to end: the
bundle loads, the factory materializes all seven safe functions, the
authProvider and GET /callback endpoint are present — all without a network
call.

### Server-process assumptions

- **Publish time:** `resolvePluginDeps` runs `bun install` + `Bun.build` in a
  temp staging dir. Requires network access to resolve the Google packages
  (and zod) from npm. Produces a deterministic `__bundle.js` (pure JS).
- **Daemon runtime:** imports `__bundle.js` directly. No `node_modules`, no
  native binary. Works in the standard daemon container image. Makes outbound
  HTTPS to `www.googleapis.com` at call time (gated by the connected
  credential's scopes). First-party credentials additionally call the relay's
  `/api/oauth/{config,exchange,refresh}` at connect/refresh (the relay holds
  OrgSDK's client secret); BYO credentials refresh locally.
