/**
 * Client for the relay's first-party OAuth endpoints.
 *
 * Used by the google plugin when a tenant has no BYO OAuth client: instead of
 * exchanging/refreshing tokens locally (which requires the client_secret), the
 * plugin asks the relay to do it. The relay holds OrgSDK's client secret; this
 * client only ever sees public client_ids and the resulting tokens.
 *
 * Runs inside the plugin-host subprocess, which inherits PUBLIC_BASE_URL and
 * DAEMON_API_KEY from the engine env (plugin-host-client.ts).
 */

export interface FirstPartyConfig {
	available: boolean;
	clientId?: string;
	redirectUri?: string;
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expiry_date?: number;
	expires_in?: number;
	scope?: string;
	token_type?: string;
}

function relayBase(): string {
	const base = process.env.PUBLIC_BASE_URL;
	if (!base) {
		throw new Error(
			"PUBLIC_BASE_URL is not set — first-party OAuth is unavailable in local mode",
		);
	}
	return base.replace(/\/$/, "");
}

function apiKey(): string {
	const key = process.env.DAEMON_API_KEY;
	if (!key) {
		throw new Error("DAEMON_API_KEY is not set — cannot authenticate to relay");
	}
	return key;
}

async function relayFetch(path: string, init?: RequestInit): Promise<Response> {
	const base = relayBase();
	const key = apiKey();
	return fetch(`${base}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${key}`,
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...init?.headers,
		},
	});
}

/** Look up the public client_id + redirect_uri for a first-party plugin. */
const CONFIG_CACHE_TTL_MS = 60_000;
let configCache: {
	plugin: string;
	value: FirstPartyConfig;
	at: number;
} | null = null;

export async function getFirstPartyConfig(
	plugin: string,
): Promise<FirstPartyConfig> {
	if (
		configCache &&
		configCache.plugin === plugin &&
		Date.now() - configCache.at < CONFIG_CACHE_TTL_MS
	) {
		return configCache.value;
	}
	const res = await relayFetch(`/api/oauth/config?plugin=${plugin}`);
	if (!res.ok) {
		throw new Error(
			`Relay /api/oauth/config returned ${res.status}: ${await res.text()}`,
		);
	}
	const data = (await res.json()) as FirstPartyConfig;
	configCache = { plugin, value: data, at: Date.now() };
	return data;
}

/** Exchange an authorisation code for tokens via the relay. */
export async function exchangeFirstPartyCode(
	plugin: string,
	code: string,
	redirectUri: string,
): Promise<TokenResponse> {
	const res = await relayFetch("/api/oauth/exchange", {
		method: "POST",
		body: JSON.stringify({ plugin, code, redirectUri }),
	});
	const data = (await res.json().catch(() => null)) as {
		tokens?: TokenResponse;
		error?: string;
	} | null;
	if (!res.ok || !data?.tokens) {
		throw new Error(
			data?.error ?? `Relay /api/oauth/exchange returned ${res.status}`,
		);
	}
	return data.tokens;
}

/** Refresh an access token via the relay (first-party bundles can't refresh locally). */
export async function refreshFirstPartyToken(
	plugin: string,
	refreshToken: string,
): Promise<TokenResponse> {
	const res = await relayFetch("/api/oauth/refresh", {
		method: "POST",
		body: JSON.stringify({ plugin, refreshToken }),
	});
	const data = (await res.json().catch(() => null)) as {
		tokens?: TokenResponse;
		error?: string;
	} | null;
	if (!res.ok || !data?.tokens) {
		throw new Error(
			data?.error ?? `Relay /api/oauth/refresh returned ${res.status}`,
		);
	}
	return data.tokens;
}

/**
 * Cached access-token fetch keyed by refresh token. First-party bundles carry
 * no client secret, so the daemon cannot refresh locally — it must ask the
 * relay. Cache avoids a relay round-trip on every API call (tokens last ~1hr).
 */
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const accessTokenCache = new Map<
	string,
	{ token: string; expiresAt: number }
>();

/** Return a usable access token, refreshing via the relay only near expiry. */
export async function getFirstPartyAccessToken(
	plugin: string,
	refreshToken: string,
): Promise<string> {
	const cached = accessTokenCache.get(refreshToken);
	if (
		cached &&
		cached.expiresAt > Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS
	) {
		return cached.token;
	}
	const tokens = await refreshFirstPartyToken(plugin, refreshToken);
	const expiresIn = tokens.expires_in ?? 3600;
	accessTokenCache.set(refreshToken, {
		token: tokens.access_token,
		expiresAt: Date.now() + expiresIn * 1000,
	});
	return tokens.access_token;
}

export type { TokenResponse };
