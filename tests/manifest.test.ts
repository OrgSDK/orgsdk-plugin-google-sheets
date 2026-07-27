import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MANIFEST_PATH = resolve(import.meta.dir, "..", "plugin", ".plugin.json");

async function readManifest() {
	const raw = await readFile(MANIFEST_PATH, "utf-8");
	return JSON.parse(raw) as Record<string, unknown>;
}

describe("manifest", () => {
	it("has the expected slug (name)", async () => {
		const m = await readManifest();
		expect(m.name).toBe("google-sheets");
	});

	it("has the bumped version 1.0.3", async () => {
		const m = await readManifest();
		expect(m.version).toBe("1.0.3");
	});

	it("declares the canonical $schema", async () => {
		const m = await readManifest();
		expect(m.$schema).toBe("https://orgsdk.ai/schemas/plugin-manifest.v1.json");
	});

	it("has a non-empty description", async () => {
		const m = await readManifest();
		expect(typeof m.description).toBe("string");
		expect((m.description as string).length).toBeGreaterThan(0);
	});

	it("declares entry as index.ts", async () => {
		const m = await readManifest();
		expect(m.entry).toBe("index.ts");
	});

	it("declares oauth2 auth with the shared google-oauth provider key", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		expect(auth.type).toBe("oauth2");
		expect(auth.provider).toBe("google-oauth");
		expect(typeof auth.label).toBe("string");
		expect((auth.label as string).length).toBeGreaterThan(0);
		expect(typeof auth.hint).toBe("string");
		expect((auth.hint as string).length).toBeGreaterThan(0);
	});

	// google-sheets OWNS the shared "Connect Google" flow for the whole Google
	// train. Its connect MUST request the UNION of scopes (spreadsheets + tasks)
	// so the single stored google-oauth credential covers both this plugin and
	// google-tasks. Asserting the union guards against silently dropping the
	// tasks scope, which would break google-tasks after a single connect.
	it("declares the union of Sheets + Tasks scopes (shared credential)", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		expect(auth.scopes).toEqual([
			"https://www.googleapis.com/auth/spreadsheets",
			"https://www.googleapis.com/auth/tasks",
		]);
	});

	// google-sheets owns the OAuth callback — the redirect_uri is bound to this
	// plugin's path (/plugins/google-sheets/callback). Asserting callbackPath
	// guards against losing the connect owner role.
	it("declares the /callback path (owns the OAuth connect flow)", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		expect(auth.callbackPath).toBe("/callback");
	});

	// firstParty: true declares the plugin CAN connect via OrgSDK's relay-held
	// client (one-click). Whether it's AVAILABLE per-tenant is a runtime relay
	// property (isFirstPartyAvailable). The manifest flag is the static opt-in.
	it("declares firstParty: true (one-click connect capable)", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		expect(auth.firstParty).toBe(true);
	});

	// Google Sheets' connection experience is author-owned metadata. The setup
	// guide appears only after the user deliberately chooses "Use your own
	// OAuth app" or when one-click connection is unavailable.
	it("declares a structured BYO setup guide (shared Sheets + Tasks connection)", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		const rawGuide = auth.setupGuide;
		expect(rawGuide).toBeDefined();
		const guide = rawGuide as Record<string, unknown>;
		expect(typeof guide.summary).toBe("string");
		expect(guide.configField).toBeDefined();
		const steps = guide.steps as Array<Record<string, unknown>>;
		expect(Array.isArray(steps)).toBe(true);
		expect(steps.length).toBeGreaterThanOrEqual(5);
		for (const step of steps) {
			const link = step.link as Record<string, string> | undefined;
			if (link) expect(link.url).toMatch(/^https:\/\//i);
		}
		expect(String(guide.troubleshootingUrl)).toMatch(/^https:\/\//i);
	});

	// The guide must name BOTH the Sheets and Tasks APIs because the shared
	// connection covers both plugins.
	it("the setup guide names both Sheets and Tasks APIs in the enable-APIs step", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		const guide = auth.setupGuide as Record<string, unknown> | undefined;
		const steps = guide?.steps as Array<Record<string, unknown>> | undefined;
		const enableStep = steps?.find((s) => /enable.*api/i.test(String(s.title)));
		const desc = enableStep?.description?.toString().toLowerCase() ?? "";
		expect(desc).toContain("sheets api");
		expect(desc).toContain("tasks api");
	});

	it("declares permission labels for both shared scopes", async () => {
		const m = await readManifest();
		const auth = m.auth as Record<string, unknown>;
		const guide = auth.setupGuide as Record<string, unknown> | undefined;
		const permissions = guide?.permissions as
			| Record<string, Record<string, string>>
			| undefined;
		expect(
			permissions?.["https://www.googleapis.com/auth/spreadsheets"]?.label
				?.length,
		).toBeGreaterThan(0);
		expect(
			permissions?.["https://www.googleapis.com/auth/tasks"]?.label?.length,
		).toBeGreaterThan(0);
	});

	it("declares marketplace metadata with the source-repo provenance link", async () => {
		const m = await readManifest();
		const mp = m.marketplace as Record<string, unknown>;
		expect(mp.displayName).toBe("Google Sheets");
		expect(mp.group).toBe("google");
		expect(mp.category).toBe("Data & AI");
		expect(Array.isArray(mp.tags)).toBe(true);
		expect(mp.tagline).toBeDefined();
		expect(Array.isArray(mp.useCases)).toBe(true);
		expect(typeof mp.permissionsSummary).toBe("string");
		const links = mp.links as Record<string, string>;
		expect(links.sourceRepo).toBe(
			"https://github.com/OrgSDK/orgsdk-plugin-google-sheets",
		);
		expect(links.homepage).toBe(
			"https://workspace.google.com/products/sheets/",
		);
		expect(links.docs).toBe(
			"https://developers.google.com/sheets/api/guides/concepts",
		);
	});
});
