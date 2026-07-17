/**
 * Credential-shape tests — the shared google-oauth contract + relay-refresh
 * semantics, with NO real Google or relay network calls.
 *
 * google-sheets owns the connect flow; the resulting `google-oauth` credential
 * is shared with google-tasks. A stored credential bundle carries a `source`
 * discriminator set at connect time:
 *
 *   - `source: "first-party"` → OrgSDK's relay owns the client secret; the
 *     plugin fetches a fresh access token from the relay (no local refresh
 *     possible — the bundle carries no client_secret). Tested by mocking
 *     global `fetch` to return a relay /api/oauth/refresh response and
 *     asserting the plugin name in the payload is "google-sheets".
 *   - `source: "byo"` (or absent/legacy) → the tenant's own OAuth client; the
 *     plugin refreshes locally using the bundled client_secret. Constructing
 *     the OAuth2Client + setCredentials does NOT make a network call — the
 *     refresh happens lazily on the first authenticated API request, which
 *     these tests never trigger.
 *
 * These tests exercise oauth.ts directly (imported from source, not the
 * bundle). global `fetch` is stubbed for the whole suite so that any stray
 * network attempt is intercepted and asserted, never reaching Google or the
 * relay. The provider key and source discriminator are never changed.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { GoogleOAuthBundle } from "../plugin/oauth";
import { getGoogleOAuth2Client } from "../plugin/oauth";

// Relay env required by first-party-client.ts (relayBase() / apiKey()). Only
// read on the first-party path. Set per-test in beforeEach; left set for the
// isolated test process (no restore needed — the process exits with the run).
const ORIGINAL_FETCH = globalThis.fetch;

function fakeRelayRefreshResponse(accessToken: string): Response {
	return new Response(
		JSON.stringify({ tokens: { access_token: accessToken, expires_in: 3600 } }),
		{
			status: 200,
			headers: { "content-type": "application/json" },
		},
	);
}

describe("credential shape (google-oauth source discriminator)", () => {
	let fetchMock: ReturnType<typeof mock>;

	beforeEach(() => {
		process.env.PUBLIC_BASE_URL = "https://relay.test";
		process.env.DAEMON_API_KEY = "daemon-key-test";
		// Default: every fetch looks like a successful relay refresh. Tests
		// that must prove NO fetch simply assert call count is zero.
		fetchMock = mock((_input: unknown, _init?: unknown) =>
			Promise.resolve(fakeRelayRefreshResponse("at_default")),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("BYO bundle builds a local-refresh client WITHOUT any fetch call", async () => {
		const bundle: GoogleOAuthBundle = {
			secret_clientId: "byo-client-id",
			secret_clientSecret: "byo-client-secret",
			secret_refreshToken: "rt_byo_unique_1",
		};
		const client = await getGoogleOAuth2Client(bundle);
		// No network call: constructing OAuth2Client + setCredentials is local.
		expect(fetchMock.mock.calls.length).toBe(0);
		// The refresh token is staged for local refresh (lazy, never triggered).
		expect(client.credentials.refresh_token).toBe("rt_byo_unique_1");
		expect(client.credentials.access_token).toBeUndefined();
	});

	it("BYO bundle with no refresh token throws the connect prompt (and no fetch)", async () => {
		const bundle: GoogleOAuthBundle = {
			secret_clientId: "byo-client-id",
			secret_clientSecret: "byo-client-secret",
		};
		await expect(getGoogleOAuth2Client(bundle)).rejects.toThrow(
			/Missing google-oauth refresh token/,
		);
		expect(fetchMock.mock.calls.length).toBe(0);
	});

	it("first-party bundle refreshes via the relay /api/oauth/refresh endpoint (plugin: google-sheets)", async () => {
		// Unique refresh token to defeat the module-level access-token cache.
		const bundle: GoogleOAuthBundle = {
			source: "first-party",
			secret_clientId: "fp-client-id",
			secret_refreshToken: "rt_fp_unique_2",
		};
		fetchMock = mock((input: unknown, init?: unknown) => {
			const url = String(input);
			const body = (init as { body?: string } | undefined)?.body ?? "";
			expect(url).toBe("https://relay.test/api/oauth/refresh");
			// Auth header + plugin/refreshToken in the relay payload. The plugin
			// name MUST be "google-sheets" — google-sheets owns the first-party
			// client slot on the relay for the whole Google train.
			const headers = (init as { headers?: Record<string, string> } | undefined)
				?.headers;
			expect(headers?.Authorization).toBe("Bearer daemon-key-test");
			expect(headers?.["Content-Type"]).toBe("application/json");
			expect(body).toContain('"plugin":"google-sheets"');
			expect(body).toContain('"refreshToken":"rt_fp_unique_2"');
			return Promise.resolve(fakeRelayRefreshResponse("at_fp_fresh"));
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const client = await getGoogleOAuth2Client(bundle);
		// Exactly one relay round-trip (the cached access token is now warm).
		expect(fetchMock.mock.calls.length).toBe(1);
		// No client secret on the client and no refresh_token — the relay owns
		// refresh; only the freshly-fetched access token is staged.
		expect(client.credentials.access_token).toBe("at_fp_fresh");
		expect(client.credentials.refresh_token).toBeUndefined();
	});

	it("first-party access token is cached: a second call makes NO relay fetch", async () => {
		// Same refresh token reuses the warmed cache entry from the prior test's
		// token fetch — prove cache short-circuits the relay round-trip.
		const bundle: GoogleOAuthBundle = {
			source: "first-party",
			secret_clientId: "fp-client-id",
			secret_refreshToken: "rt_fp_unique_2",
		};
		const client = await getGoogleOAuth2Client(bundle);
		// No new fetch (cache hit within the buffer window).
		expect(fetchMock.mock.calls.length).toBe(0);
		expect(client.credentials.access_token).toBe("at_fp_fresh");
	});

	it("first-party bundle with no refresh token throws before any fetch", async () => {
		const bundle: GoogleOAuthBundle = {
			source: "first-party",
			secret_clientId: "fp-client-id",
		};
		await expect(getGoogleOAuth2Client(bundle)).rejects.toThrow(
			/Missing google-oauth refresh token for first-party/,
		);
		expect(fetchMock.mock.calls.length).toBe(0);
	});

	it("absent source is treated as byo (legacy bundles refresh locally)", async () => {
		// No `source` field — legacy/older credentials behave as BYO.
		const bundle: GoogleOAuthBundle = {
			secret_clientId: "legacy-id",
			secret_clientSecret: "legacy-secret",
			secret_refreshToken: "rt_legacy_unique_3",
		};
		const client = await getGoogleOAuth2Client(bundle);
		expect(fetchMock.mock.calls.length).toBe(0);
		expect(client.credentials.refresh_token).toBe("rt_legacy_unique_3");
	});
});
