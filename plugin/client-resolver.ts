/**
 * Google OAuth client resolution — decides how a credential will authenticate.
 *
 * Resolution order (first hit wins):
 *   1. google-oauth-client/default           (tenant shared client)
 *   2. google-oauth-client/<name>             (tenant per-credential client)
 *   3. google-oauth/<name> client fields      (legacy: client baked into token)
 *   4. first-party via the relay              (OrgSDK's own client; no BYO)
 *
 * BYO always wins — a tenant who supplied their own client keeps full control
 * (quota isolation, restricted-scope consent). First-party is the fallback.
 *
 * The callback path is bound to this plugin (google-sheets), which owns the
 * shared "Connect Google" flow for google-sheets + google-tasks.
 */
import type { PluginContext } from "@orgsdk/plugins";
import { getFirstPartyConfig } from "./first-party-client";

/** This plugin owns the OAuth callback handler, so the redirect URI is fixed. */
const CALLBACK_PATH = "/plugins/google-sheets/callback";

/** BYO has the secret locally; first-party delegates to the relay. */
export type ResolvedClientConfig =
	| {
			source: "byo";
			clientId: string;
			clientSecret: string;
			redirectUri: string;
	  }
	| {
			source: "first-party";
			clientId: string;
			redirectUri: string;
	  };

/** `null` when no client could be resolved. */
export type ResolvedClient = ResolvedClientConfig | null;

const BYO_LOOKUP_PAIRS = (name: string): Array<[string, string]> => [
	["google-oauth-client", "default"],
	["google-oauth-client", name],
	["google-oauth", name],
];

/** Try the three tenant-side BYO tiers. Returns the first hit or null. */
async function lookupByoClient(
	ctx: PluginContext,
	credentialName: string,
): Promise<{ clientId: string; clientSecret: string } | null> {
	for (const [provider, name] of BYO_LOOKUP_PAIRS(credentialName)) {
		const secrets = await ctx.stores.credential.getSecrets(provider, name);
		const clientId = secrets?.secret_clientId as string | undefined;
		const clientSecret = secrets?.secret_clientSecret as string | undefined;
		if (clientId && clientSecret) return { clientId, clientSecret };
	}
	return null;
}

/**
 * Resolve how `credentialName` should authenticate.
 * The `redirectUri` is this plugin's callback path (google-sheets owns the
 * shared connect flow); the relay's first-party config echoes the same path.
 */
export async function resolveGoogleClient(
	ctx: PluginContext,
	credentialName: string,
): Promise<ResolvedClient> {
	const redirectUri = `${ctx.publicBaseUrl}${CALLBACK_PATH}`;

	const byo = await lookupByoClient(ctx, credentialName);
	if (byo) {
		return {
			source: "byo",
			clientId: byo.clientId,
			clientSecret: byo.clientSecret,
			redirectUri,
		};
	}

	// First-party: OrgSDK's own client, held by the relay. Only reached when
	// the tenant supplied no client of their own.
	try {
		const firstParty = await getFirstPartyConfig("google-sheets");
		if (firstParty.available && firstParty.clientId) {
			return {
				source: "first-party",
				clientId: firstParty.clientId,
				redirectUri: firstParty.redirectUri ?? redirectUri,
			};
		}
	} catch {
		// Relay unreachable or local mode — first-party unavailable.
	}

	return null;
}
