import type {
	PluginContext,
	PluginFactory,
	PluginModule,
} from "@orgsdk/plugins";
import { GoogleOAuthProvider } from "./auth-provider";
import { safeFunctions as sheetsFns } from "./google-sheets-functions";

// google-sheets owns the shared Google OAuth connect flow for both the
// google-sheets and google-tasks plugins. The connect MUST request the union
// of scopes (spreadsheets + tasks) so the single `google-oauth` credential it
// stores covers both plugins. Gmail is a restricted scope and lives in the
// separate `gmail` plugin (BYO only). See docs/plan-first-party-oauth.md.
const SCOPES = [
	"https://www.googleapis.com/auth/spreadsheets",
	"https://www.googleapis.com/auth/tasks",
];

const createPlugin: PluginFactory = (ctx: PluginContext): PluginModule => {
	const authProvider = new GoogleOAuthProvider(ctx, SCOPES);
	return {
		safeFunctions: [...sheetsFns],
		httpEndpoints: authProvider.getHttpEndpoints(),
		authProvider,
		async onLoad() {
			const cred = await ctx.stores.credential.get("google-oauth", "default");
			if (!cred) {
				ctx.logger.warn(
					"[google-sheets] No google-oauth credential found. Connect Google via the Credentials tab.",
				);
			}
		},
	};
};

export default createPlugin;
