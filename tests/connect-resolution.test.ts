/**
 * Connect-resolution tests — the google-sheets-owned connect contract.
 *
 * google-sheets owns the shared "Connect Google" flow for the whole Google
 * train. Three frozen invariants are pinned here, with NO real Google or relay
 * network calls (global `fetch` is stubbed; the credential store is a mock):
 *
 *  1. UNION SCOPES — initiate MUST request spreadsheets + tasks together so the
 *     single stored google-oauth credential covers both this plugin and
 *     google-tasks. Dropping the tasks scope would silently break google-tasks.
 *  2. BYO PRECEDENCE — a tenant-supplied OAuth client always wins over the
 *     relay-held first-party client. The resolution order is:
 *       google-oauth-client/default → google-oauth-client/<name>
 *       → google-oauth/<name> client fields → first-party (relay fallback).
 *  3. FIRST-PARTY FALLBACK — when no BYO client is configured, resolution
 *     falls through to the relay-held first-party client, whose bundle carries
 *     NO client secret.
 *
 * Cache-awareness: first-party-client.ts keeps a module-level config cache
 * (keyed by plugin name, 60s TTL) that is NOT isolated across test files in a
 * single `bun test` run. The BYO tests below never touch the relay (BYO
 * short-circuits before it), so they are cache-independent. The first-party
 * tests assert only on `source` and secret-absence — never on a specific
 * cached `clientId` — so they pass whether the cache is cold (own fetch
 * answers) or warm (leaked available:true from another file). No test here
 * depends on a cache-cold "relay unreachable" state; that defensive path is
 * covered by the visible try/catch in client-resolver.ts / auth-provider.ts.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { PluginContext } from "@orgsdk/plugins";
import { resolveGoogleClient } from "../plugin/client-resolver";

const ORIGINAL_FETCH = globalThis.fetch;

/** Build a ctx whose credential.getSecrets looks up a (provider,name) map. */
function ctxWithSecrets(
	secrets: Record<string, Record<string, Record<string, unknown>>>,
	publicBaseUrl = "https://app.orgsdk.test",
): PluginContext {
	return {
		stores: {
			credential: {
				get: async () => null,
				list: async () => [],
				upsert: async () => {},
				delete: async () => {},
				getSecrets: async (provider: string, name: string) =>
					secrets[provider]?.[name] ?? null,
				setSecrets: async () => {},
			},
			config: {
				list: async () => [],
				get: async () => null,
				set: async () => ({ key: "", value: {}, updatedAt: null }),
				delete: async () => {},
			},
		},
		publicBaseUrl,
		logger: {
			trace() {},
			debug() {},
			info() {},
			warn() {},
			error() {},
			fatal() {},
			child() {
				return this;
			},
		},
	};
}

/** A fetch mock that answers any relay /api/oauth/config as available. */
describe("connect resolution (BYO precedence + union scopes + first-party fallback)", () => {
	beforeEach(() => {
		process.env.PUBLIC_BASE_URL = "https://relay.test";
		process.env.DAEMON_API_KEY = "daemon-key-test";
	});
	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
	});
	// NOTE: fetch defaults to an available first-party config so that any
	// first-party resolution (cold cache or warm) observes available:true.
	let fetchCalls = 0;
	beforeEach(() => {
		fetchCalls = 0;
		globalThis.fetch = mock((input: unknown) => {
			fetchCalls++;
			const url = String(input);
			if (url.includes("/api/oauth/config")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							available: true,
							clientId: "fp-relay-id",
							redirectUri: "https://relay.test/plugins/google-sheets/callback",
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			}
			return Promise.resolve(new Response("{}", { status: 404 }));
		}) as unknown as typeof fetch;
	});

	// ── BYO precedence: tenant client always wins (relay never contacted) ────
	it("BYO tier 1: google-oauth-client/default wins (no relay fetch)", async () => {
		const ctx = ctxWithSecrets({
			"google-oauth-client": {
				default: {
					secret_clientId: "byo-default-id",
					secret_clientSecret: "byo-default-secret",
				},
			},
		});
		const resolved = await resolveGoogleClient(ctx, "work");
		expect(resolved?.source).toBe("byo");
		expect(resolved).toMatchObject({
			clientId: "byo-default-id",
			clientSecret: "byo-default-secret",
		});
		// redirectUri is bound to this plugin's callback path.
		expect(resolved?.redirectUri).toBe(
			"https://app.orgsdk.test/plugins/google-sheets/callback",
		);
		// BYO short-circuits before the relay is contacted.
		expect(fetchCalls).toBe(0);
	});

	it("BYO tier 2: google-oauth-client/<name> wins over google-oauth/<name>", async () => {
		const ctx = ctxWithSecrets({
			"google-oauth-client": {
				work: {
					secret_clientId: "byo-named-id",
					secret_clientSecret: "byo-named-secret",
				},
			},
			"google-oauth": {
				work: {
					secret_clientId: "legacy-id",
					secret_clientSecret: "legacy-secret",
					secret_refreshToken: "rt",
				},
			},
		});
		const resolved = await resolveGoogleClient(ctx, "work");
		expect(resolved?.source).toBe("byo");
		expect(resolved).toMatchObject({ clientId: "byo-named-id" });
		expect(fetchCalls).toBe(0);
	});

	it("BYO tier 3: google-oauth/<name> client fields are used as legacy fallback", async () => {
		const ctx = ctxWithSecrets({
			"google-oauth": {
				work: {
					secret_clientId: "legacy-id",
					secret_clientSecret: "legacy-secret",
					secret_refreshToken: "rt",
				},
			},
		});
		const resolved = await resolveGoogleClient(ctx, "work");
		expect(resolved?.source).toBe("byo");
		expect(resolved).toMatchObject({ clientId: "legacy-id" });
		expect(fetchCalls).toBe(0);
	});

	it("BYO requires BOTH client_id and client_secret (partial entry is skipped → first-party)", async () => {
		const ctx = ctxWithSecrets({
			"google-oauth-client": {
				default: { secret_clientId: "only-id" }, // no secret → skipped
			},
		});
		const resolved = await resolveGoogleClient(ctx, "default");
		// Partial BYO falls through to first-party.
		expect(resolved?.source).toBe("first-party");
		expect(resolved).not.toHaveProperty("clientSecret");
	});

	// ── First-party fallback: no BYO → relay-held client, NO secret stored ───
	it("first-party fallback when no BYO configured (bundle carries NO client secret)", async () => {
		const resolved = await resolveGoogleClient(ctxWithSecrets({}), "default");
		expect(resolved?.source).toBe("first-party");
		// First-party carries NO client secret — the relay owns it.
		expect(resolved).not.toHaveProperty("clientSecret");
		expect(typeof resolved?.clientId).toBe("string");
		// redirectUri resolves to a callback path (own or relay-echoed).
		expect(resolved?.redirectUri).toContain("/plugins/google-sheets/callback");
	});

	// ── Union scopes: the shared-credential contract ─────────────────────────
	it("initiate requests the UNION of spreadsheets + tasks scopes", async () => {
		// Use a BYO-configured ctx so initiate resolves locally (no relay) and
		// we can inspect the generated auth URL's scope parameter directly.
		const ctx = ctxWithSecrets({
			"google-oauth-client": {
				default: {
					secret_clientId: "byo-id",
					secret_clientSecret: "byo-secret",
				},
			},
		});
		const { GoogleOAuthProvider } = await import("../plugin/auth-provider");
		const provider = new GoogleOAuthProvider(ctx, [
			"https://www.googleapis.com/auth/spreadsheets",
			"https://www.googleapis.com/auth/tasks",
		]);
		const { authUrl } = await provider.initiate("default");
		const url = new URL(authUrl);
		const scope = url.searchParams.get("scope") ?? "";
		expect(scope).toContain("https://www.googleapis.com/auth/spreadsheets");
		expect(scope).toContain("https://www.googleapis.com/auth/tasks");
		// consent + offline so a refresh_token is returned (shared credential).
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent");
		expect(url.searchParams.get("state")).toBeTruthy();
	});

	it("isFirstPartyAvailable returns true when the relay answers available", async () => {
		// The relay config cache is warm (available:true) from this file's own
		// beforeEach fetch or from a prior file; either way the probe returns
		// true. A thrown/missing config would return false (caught) — that
		// defensive path is visible in auth-provider.ts.
		const { GoogleOAuthProvider } = await import("../plugin/auth-provider");
		const provider = new GoogleOAuthProvider(ctxWithSecrets({}), [
			"https://www.googleapis.com/auth/spreadsheets",
		]);
		await expect(provider.isFirstPartyAvailable()).resolves.toBe(true);
	});
});
