import { OAuth2Client } from "google-auth-library";
import { getFirstPartyAccessToken } from "./first-party-client";

// NOTE: oauth.ts + first-party-client.ts are shared leaf modules duplicated
// across the google-sheets and google-tasks plugins (cloud-mode plugins must
// be self-contained — cross-plugin sibling imports are blocked by the
// materialiser's path-traversal guard). Keep the two copies in sync.
const PLUGIN_NAME = "google-sheets";

export interface GoogleOAuthBundle {
	secret_clientId?: string;
	secret_clientSecret?: string;
	secret_refreshToken?: string;
	/** Discriminator set at connect time. Absent = legacy (treated as byo). */
	source?: "first-party" | "byo";
	[key: string]: unknown;
}

/**
 * Build an OAuth2Client from a stored credential bundle.
 *
 * BYO bundles refresh locally using the bundled client secret. First-party
 * bundles (`source: "first-party"`) carry no secret — a fresh access token is
 * fetched from the relay (cached per refresh token, see first-party-client).
 * Async because first-party may need a network round-trip.
 */
export async function getGoogleOAuth2Client(
	bundle: GoogleOAuthBundle,
): Promise<OAuth2Client> {
	const { secret_clientId, secret_clientSecret, secret_refreshToken } = bundle;

	if (bundle.source === "first-party") {
		if (!secret_refreshToken) {
			throw new Error(
				"Missing google-oauth refresh token for first-party credential.",
			);
		}
		const accessToken = await getFirstPartyAccessToken(
			PLUGIN_NAME,
			secret_refreshToken,
		);
		// No client secret and no refresh_token on the client — the relay owns
		// refresh. Access token is fresh (see cache in first-party-client).
		const client = new OAuth2Client({ clientId: secret_clientId });
		client.setCredentials({ access_token: accessToken });
		return client;
	}

	if (!secret_refreshToken) {
		throw new Error(
			"Missing google-oauth refresh token. Connect Google in the dashboard (Credentials tab).",
		);
	}
	const client = new OAuth2Client({
		clientId: secret_clientId,
		clientSecret: secret_clientSecret,
	});
	client.setCredentials({ refresh_token: secret_refreshToken });
	return client;
}

export function decodeBase64UrlToUtf8(encoded: string): string {
	const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
	const paddingLen = (4 - (base64.length % 4)) % 4;
	const padded = base64 + "=".repeat(paddingLen);
	return Buffer.from(padded, "base64").toString("utf-8");
}
