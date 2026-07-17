# Contract migration — completed

## Status: consuming `@orgsdk/plugins` from npm

This plugin imports its authoring types from the public
[`@orgsdk/plugins`](https://www.npmjs.com/package/@orgsdk/plugins) npm package.
The migration from the monorepo workspace specifier is complete.

## What changed (from the monorepo source)

1. **Import specifiers updated** — `from "orgsdk/plugins"` →
   `from "@orgsdk/plugins"`. All imports are **type-only**
   (`import type { … }`), erased at compile time.
2. **devDependency** is the published npm package, pinned to an exact version
   (`@orgsdk/plugins@0.2.1`) for reproducibility.
3. **Purity guards** — type-only imports from `@orgsdk/plugins` are
   allowed; value imports and all other `@orgsdk/*` packages are blocked
   (enforced by `tests/purity.test.ts` and `orgsdk-plugin validate`).
4. **Artifact runtime dependencies — `@googleapis/sheets` + `google-auth-library` + `zod`.**
   `google-sheets-functions.ts` imports `{ sheets_v4 }` from `@googleapis/sheets`
   at runtime and constructs a `sheets_v4.Sheets` client; `auth-provider.ts`,
   `oauth.ts`, and `terminal-oauth-flow.ts` import `{ OAuth2Client }` from
   `google-auth-library` and build the OAuth2 client from the shared
   `google-oauth` bundle; `google-sheets-functions.ts` imports `{ z }` from
   `zod` and validates `appendToTable` rows at runtime. All three are declared
   as runtime `dependencies` entries, so the generated artifact `package.json`
   carries `"dependencies": { "@googleapis/sheets": "^13.0.2", "google-auth-library": "^10.6.2", "zod": "^4.0.0" }`
   and the platform's `resolvePluginDeps` bundles the Google closure into
   `__bundle.js` at publish time, keeping `zod` external (present in the daemon
   image). The daemon imports the bundle directly — no runtime node_modules
   resolution. The authoring SDK (`@orgsdk/plugins`) is **not** a runtime
   dependency (type-only imports are erased at compile time).
5. **Manifest `$schema`** — `plugin/.plugin.json` declares
   `$schema: https://orgsdk.ai/schemas/plugin-manifest.v1.json` for editor
   completion and schema validation.
6. **Manifest `entry`** — declared as `index.ts` (explicit, not defaulted).
7. **Provenance** — `marketplace.links.sourceRepo` points at this repository
   (canonical key supported by `plugin-manifest.v1`). The upstream Google APIs
   are documented in the README; the `homepage` (workspace.google.com/products/sheets)
   and `docs` (developers.google.com/sheets/api/guides/concepts) user-facing
   links are preserved verbatim.
8. **No local management scripts** — `validate`, `package`, `version-guard`,
   and `publish` are npm scripts that delegate to the `orgsdk-plugin` CLI
   shipped by `@orgsdk/plugins`.
9. **Reusable CI/CD workflows** — `.github/workflows/ci.yml` and
   `publish-catalog.yml` call the centrally maintained reusable workflows in
   `OrgSDK/plugins` (pinned to an immutable commit) instead of duplicating
   CI/publish mechanics.

## What did NOT change (frozen behavior)

- All seven safe functions — names, parameters, return types, metadata, tags,
  the readonly/write split (three readonly, four write), and the three
  discovery flags.
- The shared `google-oauth` **connect-ownership** contract: `authProvider`
  present (`GoogleOAuthProvider`), `requiredCredentials: ["google-oauth"]` on
  every function, the GET /callback httpEndpoint, `firstParty: true`, and
  `callbackPath: "/callback"`. google-sheets remains the **sole** connect owner
  for the whole Google train (google-tasks is functions-only and consumes the
  credential this plugin stores).
- The **union scopes** (spreadsheets + tasks) requested at connect time so the
  single stored credential covers both plugins.
- The `source: "first-party" | "byo"` discriminator and BYO-precedence
  resolution order in `client-resolver.ts` + the relay-refresh semantics in
  `oauth.ts` / `first-party-client.ts` — first-party bundles refresh via the
  relay (no local client secret); BYO bundles refresh locally.
  `oauth.ts` + `first-party-client.ts` are byte-identical self-contained
  duplicates of the google-tasks leaf modules.
- No `config` (no Zod tenant_config schema), no `httpEndpoints` beyond the
  /callback, no `tables`.
- The factory `PluginModule` entry shape (`default export` →
  `(ctx) => PluginModule`) — not a static `safeFunctions` export.
- The `@googleapis/sheets`, `google-auth-library`, and `zod` usage —
  byte-identical.
- `plugin/docs/overview.md` and `plugin/guides/usage-patterns.md` — verbatim.

## Install-resolution correction (zero runtime change)

`googleapis-common@^8.0.0` (a direct dependency of `@googleapis/sheets@13.0.2`)
pins `google-auth-library` to an **exact** `10.5.0`, while this plugin declares
`google-auth-library@^10.6.2` (resolves to `10.9.0`). An unconstrained install
therefore produces **two copies** of `google-auth-library` (the nested `10.5.0`
under `googleapis-common` and the top-level `10.9.0`). At runtime this is
harmless — JavaScript duck-typing means `new sheets_v4.Sheets({ auth })` works
regardless of which copy the `OAuth2Client` came from — but TypeScript rejects
it as a type-identity mismatch ("Types have separate declarations of a private
property 'redirectUri'").

The correction is a repo-local `overrides` entry in `package.json`:

```json
"overrides": { "google-auth-library": "10.9.0" }
```

This forces Bun to install a **single** `google-auth-library@10.9.0`, so both
`oauth.ts` and the `sheets_v4.Sheets` constructor resolve the same
`OAuth2Client` type. `10.9.0` is within the same major (`10.x`) as
googleapis-common's pinned `10.5.0` — backward compatible.

**This does not change the published artifact.** The generated artifact
`package.json` carries only the `dependencies` block
(`@googleapis/sheets ^13.0.2`, `google-auth-library ^10.6.2`, `zod ^4.0.0`) —
the `overrides` field is repo-local and does not flow into the staged artifact
(verified by `tests/packaging.test.ts`, which asserts the artifact
`dependencies` keys exactly equal the three runtime packages and that no
`overrides` leaks). At publish time, `resolvePluginDeps` installs from the
artifact ranges (no override) and may again produce two copies — `Bun.build`
inlines both into `__bundle.js`, which loads and runs identically.
`tests/google-bundle.test.ts` stages the ranges WITHOUT the override and proves
the bundle still loads and materializes all seven functions.

This is the same category as the google-tasks migration's "type-only
corrections necessary for tsc, zero runtime change" — a compile/install-time
convenience that leaves runtime behavior and the artifact contract
byte-identical.

## Complete dependency-closure determination

The `google-sheets` plugin's runtime dependency closure (required for
server-side bundling via `resolvePluginDeps`):

| Package | Role | Bundled? |
|---|---|---|
| `@googleapis/sheets@^13.0.2` | direct runtime import (`sheets_v4` in google-sheets-functions.ts) | yes — inlined into `__bundle.js` |
| `google-auth-library@^10.6.2` | direct runtime import (`OAuth2Client` in auth-provider.ts, oauth.ts, terminal-oauth-flow.ts) | yes — inlined |
| `zod@^4.0.0` | direct runtime import (`z` in google-sheets-functions.ts, appendToTable row validation) | external — present in the daemon image, resolved at runtime |
| `googleapis-common@^8.0.0` | transitive of @googleapis/sheets | yes — inlined |
| `gaxios`, `https-proxy-agent`, `agent-base`, `jws`, `jsrsasign`, `googleads-info`, … | transitive of google-auth-library / googleapis-common | yes — inlined |
| `@orgsdk/plugins` | authoring SDK, type-only imports | erased (not in runtime closure) |

`@googleapis/sheets@^13.0.2` resolves to `13.0.2`,
`google-auth-library@^10.6.2` resolves to `10.9.0`, and `zod@^4.0.0` resolves
to the latest `4.x` — the source-declared supported ranges. There is no
root/latest drift; the artifact pins the source ranges, not newer majors.

`Bun.build` (target: `bun`, format: `esm`, `external: ["zod"]`) produces a
deterministic single-file bundle. The daemon imports it directly — no
`node_modules`, no native binary. Verified by `tests/google-bundle.test.ts`.

### Server-process assumptions

- **Publish time:** `resolvePluginDeps` needs network access to resolve the
  Google packages (and zod) from npm into a temp staging dir, then `Bun.build`.
  No native compilation step (pure JS).
- **Daemon runtime:** the standard daemon container image suffices. No system
  packages, no native addons. The Sheets client makes outbound HTTPS to
  `www.googleapis.com` at call time (gated by the connected credential's
  scopes). First-party credentials additionally call the relay's
  `/api/oauth/{config,exchange,refresh}` at connect/refresh (the relay holds
  OrgSDK's client secret); BYO credentials refresh locally.

> **Stop condition satisfied.** The user asked to "stop if bundle/load fails."
> The full Google dependency closure bundles cleanly into a single ESM file,
> loads, and the factory materializes all seven safe functions with the
> authProvider and GET /callback endpoint present — all with no network calls.
> The gate passes; no issue is hidden.

## Known pre-existing issues (recorded, not fixed in this release)

These predate the extraction and are frozen byte-for-byte per the migration
discipline (skill learning #6 — never combine a behavioral refactor with an
extraction):

### Security / resource concerns (frozen)

- **Arbitrary outbound Google Sheets API calls.** Every handler issues an
  authenticated request to `www.googleapis.com`. The scope of what an agent can
  do is bounded only by the connected credential's scopes. There is no
  per-call allow/deny list, no rate-limit guard, and no response-size cap.
- **Mutating/destructive operations.** `clearSheet` is irreversible;
  `appendToSheet`, `appendToTable`, and `updateTableRow` mutate the sheet. No
  confirmation gate exists at the plugin layer (approval gating is the
  harness's responsibility, not the plugin's).
- **`updateTableRow` / `appendToTable` fetch-then-write.** These read table
  metadata then write — a read-modify-write that can clobber a concurrent edit.
  This is surfaced verbatim.
- **Module-level access-token cache in `first-party-client.ts`.**
  `accessTokenCache` is a process-global keyed by refresh token. It is not
  scoped per-tenant or per-agent. In the daemon's shared-process model this is
  acceptable because credentials are resolved per-call, but it means a cached
  token could persist across a token rotation within the same process lifetime.

### Code-quality concerns (frozen)

- **`google-sheets-functions.ts` exceeds the 300-line guideline** (988 lines).
  This is a pre-existing monorepo file-size violation (G5). It is frozen in
  this extraction; a split into per-group modules is a separate, later release.
- **Pre-existing `as` casts** in several handlers (e.g.
  `sheet.tables as Array<{…}>`, `resp.data.replies?.[0] as any`). These narrow
  the Google API's union-typed responses. They were not introduced by the
  migration and are frozen.
- **`getGoogleOAuth` reads `credentials["google-oauth"]` via an `as` cast**
  (`creds["google-oauth"] as GoogleOAuthBundle | undefined`). Frozen.

### Self-contained leaf-module duplication (frozen, by design)

`oauth.ts` and `first-party-client.ts` are byte-identical copies of the
google-tasks plugin's leaf modules. The source NOTE documents why: cloud-mode
plugins must be self-contained because the materialiser's path-traversal guard
blocks cross-plugin sibling imports. The two copies must be kept in sync
manually. This is an accepted architectural constraint, not a defect to fix in
this extraction.

## Why `@orgsdk/plugins`?

The package provides the stable, minimal, structural TypeScript contract
between plugin authors and the OrgSDK daemon — with no private daemon,
platform, storage, or database internals. See
[OrgSDK/plugins](https://github.com/OrgSDK/plugins) for the full API surface.

## Type-only contract

All imports from `@orgsdk/plugins` are `import type { … }` — erased at compile
time. The runtime plugin artifact carries **only** `@googleapis/sheets`,
`google-auth-library`, and `zod` as dependencies. This means:

- Minimal runtime weight (three framework dependencies; the two Google
  packages' full closure is bundled at publish time, zod is resolved from the
  daemon image).
- Plugin source typechecks against the same contract the daemon enforces.

## Upgrading the contract version

The dependency is pinned exactly (`0.2.1`). When a new contract version is
released, update the version in `package.json`, regenerate the lockfile with
`bun install`, and confirm tests still pass. Prefer deliberate, reviewed
upgrades over floating ranges while the contract is still pre-1.0.
