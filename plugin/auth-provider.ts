import type {
	AuthMeta,
	AuthProvider,
	HttpEndpoint,
	PluginContext,
} from "@orgsdk/plugins";
import { OAuth2Client } from "google-auth-library";
import {
	type ResolvedClientConfig,
	resolveGoogleClient,
} from "./client-resolver";
import {
	exchangeFirstPartyCode,
	getFirstPartyConfig,
} from "./first-party-client";
import { runGoogleOAuthFlow } from "./terminal-oauth-flow";

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Scopes requested at connect time. This plugin only touches the sensitive
 * tier (Sheets, Tasks), so the same scope set is used for first-party and BYO
 * connections. Gmail is a restricted scope and lives in the separate `gmail`
 * plugin (BYO only) — see docs/plan-first-party-oauth.md §6.
 */

interface PendingState {
	credentialName: string;
	createdAt: number;
	/** How the client was resolved at initiate — drives the callback path. */
	resolved: ResolvedClientConfig;
}

type GoogleOAuthClientFile = {
	installed?: { client_id?: string; client_secret?: string };
	web?: { client_id?: string; client_secret?: string };
};

export class GoogleOAuthProvider implements AuthProvider {
	readonly type = "oauth2" as const;
	readonly authMeta: AuthMeta = {
		displayName: "Google",
		configField: {
			label: "OAuth client JSON (Web application)",
			placeholder:
				'{"web": {"client_id": "...", "client_secret": "...", "redirect_uris": ["https://.../plugins/google-sheets/callback"]}}',
		},
	};
	private readonly pendingStates = new Map<string, PendingState>();
	private readonly ctx: PluginContext;
	private readonly scopes: string[];

	constructor(ctx: PluginContext, scopes: string[]) {
		this.ctx = ctx;
		this.scopes = scopes;
	}

	async initiate(
		credentialName: string,
	): Promise<{ authUrl: string; state: string }> {
		const resolved = await this.resolveClientConfig(credentialName);
		if (!resolved) {
			throw new Error(
				`Google OAuth client credentials not configured. ` +
					`Checked google-oauth-client/default, google-oauth-client/${credentialName}, google-oauth/${credentialName}. ` +
					`First-party (relay) is also unavailable. ` +
					`Either paste your OAuth client JSON in the Credentials tab, ` +
					`or configure GOOGLE_OAUTH_CLIENT_ID/SECRET on the relay.`,
			);
		}

		// This plugin is sensitive-scope only (Sheets, Tasks), so first-party and
		// BYO connections request the same scope set.
		const scopes = this.scopes;

		const oauth =
			resolved.source === "byo"
				? new OAuth2Client({
						clientId: resolved.clientId,
						clientSecret: resolved.clientSecret,
						redirectUri: resolved.redirectUri,
					})
				: new OAuth2Client({
						clientId: resolved.clientId,
						redirectUri: resolved.redirectUri,
					});

		const state = crypto.randomUUID();
		this.cleanExpiredStates();
		this.pendingStates.set(state, {
			credentialName,
			createdAt: Date.now(),
			resolved,
		});

		const authUrl = oauth.generateAuthUrl({
			access_type: "offline",
			prompt: "consent",
			scope: scopes,
			state,
		});

		return { authUrl, state };
	}

	async handleCallback(
		req: Request,
	): Promise<{ success: boolean; credentialName: string; error?: string }> {
		const url = new URL(req.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");

		if (!state || !code) {
			return {
				success: false,
				credentialName: "",
				error: "Missing code or state parameter",
			};
		}

		const pending = this.pendingStates.get(state);
		if (!pending) {
			return {
				success: false,
				credentialName: "",
				error: "Invalid or expired state",
			};
		}

		if (Date.now() - pending.createdAt > STATE_TTL_MS) {
			this.pendingStates.delete(state);
			return { success: false, credentialName: "", error: "State expired" };
		}

		this.pendingStates.delete(state);

		try {
			let refreshToken: string | undefined;
			let bundle: Record<string, unknown>;

			if (pending.resolved.source === "first-party") {
				// Secret-bearing exchange happens on the relay; this process
				// never sees the client secret.
				const { clientId, redirectUri } = pending.resolved;
				const tokens = await exchangeFirstPartyCode(
					"google-sheets",
					code,
					redirectUri,
				);
				refreshToken = tokens.refresh_token;
				bundle = {
					secret_clientId: clientId,
					secret_refreshToken: refreshToken,
					source: "first-party",
					createdAt: new Date().toISOString(),
				};
			} else {
				const { clientId, clientSecret, redirectUri } = pending.resolved;
				const oauth = new OAuth2Client({ clientId, clientSecret, redirectUri });
				const { tokens } = await oauth.getToken(code);
				refreshToken = tokens.refresh_token ?? undefined;
				bundle = {
					secret_clientId: clientId,
					secret_clientSecret: clientSecret,
					secret_refreshToken: refreshToken,
					source: "byo",
					createdAt: new Date().toISOString(),
				};
			}

			if (!refreshToken) {
				return {
					success: false,
					credentialName: pending.credentialName,
					error:
						"Google did not return a refresh_token. Revoke access at https://myaccount.google.com/permissions and retry.",
				};
			}

			await this.ctx.stores.credential.setSecrets(
				"google-oauth",
				pending.credentialName,
				bundle,
				{ label: `Google OAuth (${pending.credentialName})`, valid: true },
			);

			return { success: true, credentialName: pending.credentialName };
		} catch (err) {
			return {
				success: false,
				credentialName: pending.credentialName,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	getHttpEndpoints(): HttpEndpoint[] {
		return [
			{
				method: "GET",
				path: "/callback",
				handler: async (req) => {
					const result = await this.handleCallback(req);
					if (result.success) {
						return new Response(
							`<html><body><h2>Google OAuth success</h2><p>Credential '${result.credentialName}' saved. You can close this tab.</p></body></html>`,
							{ headers: { "Content-Type": "text/html" } },
						);
					}
					return new Response(
						`<html><body><h2>Google OAuth failed</h2><p>${result.error ?? "Unknown error"}</p></body></html>`,
						{ status: 400, headers: { "Content-Type": "text/html" } },
					);
				},
			},
		];
	}

	async configure(json: string, credentialName: string): Promise<void> {
		const parsed = JSON.parse(json) as GoogleOAuthClientFile;
		const src = parsed.installed ?? parsed.web;
		if (!src?.client_id || !src?.client_secret) {
			throw new Error(
				"JSON must contain an 'installed' or 'web' object with client_id and client_secret",
			);
		}
		await this.ctx.stores.credential.setSecrets(
			"google-oauth-client",
			credentialName,
			{
				secret_clientId: src.client_id,
				secret_clientSecret: src.client_secret,
			},
			{ label: `Google OAuth client (${credentialName})`, valid: true },
		);
	}

	async isFirstPartyAvailable(): Promise<boolean> {
		try {
			const config = await getFirstPartyConfig("google-sheets");
			return config.available;
		} catch (err) {
			console.warn(
				"[google-sheets] isFirstPartyAvailable failed — relay unreachable or DAEMON_API_KEY mismatch:",
				err instanceof Error ? err.message : String(err),
			);
			return false;
		}
	}

	async authSetup(
		options: Record<string, string>,
	): Promise<{ success: boolean; message?: string; error?: string }> {
		const result = await runGoogleOAuthFlow({
			store: this.ctx.stores.credential,
			credentialsPath: options.credentials ?? "",
			name: options.name ?? "default",
			label: options.label,
			redirectUri: options.redirectUri,
			scopes: this.scopes,
		});
		return {
			success: result.success,
			message: result.success
				? `Saved credential '${result.provider}/${result.name}'.`
				: undefined,
			error: result.error,
		};
	}

	private resolveClientConfig(
		credentialName: string,
	): Promise<ResolvedClientConfig | null> {
		return resolveGoogleClient(this.ctx, credentialName);
	}

	private cleanExpiredStates() {
		const now = Date.now();
		for (const [k, v] of this.pendingStates) {
			if (now - v.createdAt > STATE_TTL_MS) this.pendingStates.delete(k);
		}
	}
}
