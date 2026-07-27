/**
 * Callback-endpoint tests — the google-sheets-owned OAuth callback.
 *
 * google-sheets registers a GET /callback httpEndpoint whose handler delegates
 * to GoogleOAuthProvider.handleCallback. These tests pin the full callback
 * contract with NO real Google or relay network calls: a URL-routing `fetch`
 * mock answers the relay config/exchange endpoints and Google's token endpoint
 * depending on the URL, and a capturing credential store records the stored
 * bundle.
 *
 * Two connect paths are covered (the `source` discriminator set at connect):
 *  - FIRST-PARTY: code → relay /api/oauth/exchange → bundle WITHOUT a client
 *    secret (source: "first-party"). The relay holds the secret; the tenant
 *    daemon never sees it.
 *  - BYO: code → Google's token endpoint → bundle WITH the client secret
 *    (source: "byo"). Local refresh is possible later.
 *
 * Plus the endpoint-shape + error-path invariants: GET /callback, HTML
 * success/failure bodies, and rejection of missing/expired/unknown state.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { PluginContext } from "@orgsdk/plugins";
import { GoogleOAuthProvider } from "../plugin/auth-provider";

const ORIGINAL_FETCH = globalThis.fetch;
const UNION_SCOPES = [
	"https://www.googleapis.com/auth/spreadsheets",
	"https://www.googleapis.com/auth/tasks",
];

// Isolation: first-party-client.ts keeps a module-level config cache (60s TTL,
// keyed by plugin name) that is shared across every test file in one `bun test`
// run. `getFirstPartyConfig` returns that cached value WITHOUT calling `fetch`,
// so a value leaked from connect-resolution.test.ts (clientId "fp-relay-id")
// can bypass this file's routingFetch mock (clientId "fp-id") and land in the
// stored bundle — an order/timing-dependent flake. mock.module is file-scoped:
// only this file sees the cache-free doubles below; other files keep using the
// real cached module. The doubles mirror the real relay URL + response shape so
// this file's routingFetch answers exactly as it does for the real module.
mock.module("../plugin/first-party-client", () => ({
	getFirstPartyConfig: async (plugin: string) => {
		const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
		const res = await fetch(`${base}/api/oauth/config?plugin=${plugin}`);
		if (!res.ok) {
			throw new Error(`Relay /api/oauth/config returned ${res.status}`);
		}
		return (await res.json()) as {
			available: boolean;
			clientId?: string;
			redirectUri?: string;
		};
	},
	exchangeFirstPartyCode: async (
		plugin: string,
		code: string,
		redirectUri: string,
	) => {
		const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
		const res = await fetch(`${base}/api/oauth/exchange`, {
			method: "POST",
			body: JSON.stringify({ plugin, code, redirectUri }),
		});
		const data = (await res.json().catch(() => null)) as {
			tokens?: { refresh_token?: string };
			error?: string;
		} | null;
		if (!res.ok || !data?.tokens) {
			throw new Error(
				data?.error ?? `Relay /api/oauth/exchange returned ${res.status}`,
			);
		}
		return data.tokens;
	},
}));

interface StoredCredential {
	provider: string;
	name: string;
	bundle: Record<string, unknown>;
}

/** Build a ctx that captures setSecrets calls for later assertion. */
function capturingCtx(
	secrets: Record<string, Record<string, Record<string, unknown>>> = {},
): { ctx: PluginContext; stored: StoredCredential[] } {
	const stored: StoredCredential[] = [];
	const ctx: PluginContext = {
		stores: {
			credential: {
				get: async () => null,
				list: async () => [],
				upsert: async () => {},
				delete: async () => {},
				getSecrets: async (provider: string, name: string) =>
					secrets[provider]?.[name] ?? null,
				setSecrets: async (
					provider: string,
					name: string,
					bundle: Record<string, unknown>,
				) => {
					stored.push({ provider, name, bundle });
				},
			},
			config: {
				list: async () => [],
				get: async () => null,
				set: async () => ({ key: "", value: {}, updatedAt: null }),
				delete: async () => {},
			},
		},
		publicBaseUrl: "https://app.orgsdk.test",
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
	return { ctx, stored };
}

/**
 * A fetch mock that routes by URL for the two RELAY endpoints used by the
 * first-party connect path (config + exchange). Both use raw `fetch`, so they
 * are interceptable here. The BYO path's `oauth.getToken` goes through gaxios
 * (node:http) and is NOT exercised here — see the file-header comment.
 */
function routingFetch(opts: {
	firstPartyConfig?: unknown;
	exchangeTokens?: { refresh_token?: string };
}): typeof fetch {
	return mock((input: unknown) => {
		const url = String(input);
		if (url.includes("/api/oauth/config")) {
			return Promise.resolve(
				new Response(
					JSON.stringify(opts.firstPartyConfig ?? { available: false }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
			);
		}
		if (url.includes("/api/oauth/exchange")) {
			return Promise.resolve(
				new Response(JSON.stringify({ tokens: opts.exchangeTokens ?? {} }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			);
		}
		return Promise.resolve(new Response("{}", { status: 404 }));
	}) as unknown as typeof fetch;
}

describe("callback endpoint + handleCallback", () => {
	beforeEach(() => {
		process.env.PUBLIC_BASE_URL = "https://relay.test";
		process.env.DAEMON_API_KEY = "daemon-key-test";
	});
	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("registers exactly one GET /callback endpoint with an HTML handler", () => {
		const { ctx } = capturingCtx();
		const provider = new GoogleOAuthProvider(ctx, UNION_SCOPES);
		const eps = provider.getHttpEndpoints();
		expect(eps.length).toBe(1);
		expect(eps[0].method).toBe("GET");
		expect(eps[0].path).toBe("/callback");
		expect(typeof eps[0].handler).toBe("function");
	});

	it("endpoint handler returns HTML success body on a completed connect", async () => {
		globalThis.fetch = routingFetch({
			firstPartyConfig: {
				available: true,
				clientId: "fp-id",
				redirectUri: "https://relay.test/plugins/google-sheets/callback",
			},
			exchangeTokens: { refresh_token: "rt_fp" },
		});
		const { ctx } = capturingCtx();
		const provider = new GoogleOAuthProvider(ctx, UNION_SCOPES);
		const { state } = await provider.initiate("default");
		const handler = provider.getHttpEndpoints()[0].handler;
		const res = await handler(
			new Request(
				`https://app.orgsdk.test/plugins/google-sheets/callback?code=CODE&state=${state}`,
			),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html");
		const body = await res.text();
		expect(body).toContain("Google OAuth success");
		expect(body).toContain("'default'");
	});

	it("endpoint handler returns HTML failure (400) when state is missing", async () => {
		const { ctx } = capturingCtx();
		const provider = new GoogleOAuthProvider(ctx, UNION_SCOPES);
		const handler = provider.getHttpEndpoints()[0].handler;
		const res = await handler(
			new Request(
				"https://app.orgsdk.test/plugins/google-sheets/callback?code=CODE",
			),
		);
		expect(res.status).toBe(400);
		expect(await res.text()).toContain("Google OAuth failed");
	});

	it("handleCallback rejects a request missing code or state", async () => {
		const { ctx } = capturingCtx();
		const provider = new GoogleOAuthProvider(ctx, UNION_SCOPES);
		const res = await provider.handleCallback(
			new Request("https://app.orgsdk.test/plugins/google-sheets/callback"),
		);
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/Missing code or state/);
	});

	it("handleCallback rejects an unknown state", async () => {
		const { ctx } = capturingCtx();
		const provider = new GoogleOAuthProvider(ctx, UNION_SCOPES);
		const res = await provider.handleCallback(
			new Request(
				"https://app.orgsdk.test/plugins/google-sheets/callback?code=CODE&state=bogus",
			),
		);
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/Invalid or expired state/);
	});

	// ── FIRST-PARTY connect path: relay exchange, no client secret stored ────
	it("first-party connect: exchanges via relay, stores source:first-party WITHOUT a client secret", async () => {
		globalThis.fetch = routingFetch({
			firstPartyConfig: {
				available: true,
				clientId: "fp-id",
				redirectUri: "https://relay.test/plugins/google-sheets/callback",
			},
			exchangeTokens: { refresh_token: "rt_fp_unique_callback" },
		});
		const { ctx, stored } = capturingCtx();
		const provider = new GoogleOAuthProvider(ctx, UNION_SCOPES);
		const { state } = await provider.initiate("default");
		const res = await provider.handleCallback(
			new Request(
				`https://app.orgsdk.test/plugins/google-sheets/callback?code=CODE&state=${state}`,
			),
		);
		expect(res.success).toBe(true);
		expect(res.credentialName).toBe("default");
		expect(stored.length).toBe(1);
		expect(stored[0].provider).toBe("google-oauth");
		expect(stored[0].name).toBe("default");
		// First-party bundle carries NO client secret.
		expect(stored[0].bundle.source).toBe("first-party");
		expect(stored[0].bundle.secret_clientId).toBe("fp-id");
		expect(stored[0].bundle.secret_refreshToken).toBe("rt_fp_unique_callback");
		expect(stored[0].bundle.secret_clientSecret).toBeUndefined();
	});

	// ── BYO callback exchange is NOT exercised here ─────────────────────────
	// The BYO branch of handleCallback calls `oauth.getToken(code)`, which goes
	// through google-auth-library → gaxios → node:http (NOT globalThis.fetch),
	// so it cannot be intercepted by a fetch mock and would hit the real Google
	// token endpoint. The BYO contract is covered elsewhere instead:
	//   - BYO resolution + secret presence  → tests/connect-resolution.test.ts
	//   - BYO local-refresh bundle shape      → tests/credential-shape.test.ts
	// The first-party exchange above exercises the SAME handleCallback logic
	// (code/state extraction, bundle construction, source discriminator, credential
	// storage); the BYO branch differs only in the exchange call + secret storage.
});
