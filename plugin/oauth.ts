import { OAuth2Client } from "google-auth-library";

/** OrgSDK's host refreshes tokens before issuing a run-scoped snapshot. */
export interface GoogleOAuthBundle {
	source?: "first-party" | "byo";
	secret_accessToken?: string;
	[key: string]: unknown;
}
export async function getGoogleOAuth2Client(
	bundle: GoogleOAuthBundle,
): Promise<OAuth2Client> {
	if (bundle.source !== "byo")
		throw new Error(
			"Connect Google using your own OAuth application in OrgSDK.",
		);
	if (
		typeof bundle.secret_accessToken !== "string" ||
		!bundle.secret_accessToken.trim()
	) {
		throw new Error(
			"Missing google-oauth access token. Reconnect Google in OrgSDK.",
		);
	}
	const client = new OAuth2Client({
		transporterOptions: {
			timeout: 15_000,
			retry: false,
			maxContentLength: 2_000_000,
		},
	});
	client.setCredentials({ access_token: bundle.secret_accessToken });
	return client;
}

export function decodeBase64UrlToUtf8(encoded: string): string {
	const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
	const paddingLen = (4 - (base64.length % 4)) % 4;
	const padded = base64 + "=".repeat(paddingLen);
	return Buffer.from(padded, "base64").toString("utf-8");
}
