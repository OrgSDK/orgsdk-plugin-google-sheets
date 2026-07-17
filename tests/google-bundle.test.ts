/**
 * Isolated materialize/load smoke — the dependency-bundling gate.
 *
 * This simulates the daemon-side bundling flow (packages/platform/src/plugins/
 * resolve-deps.ts) that runs at publish time:
 *
 *   stage source + declared deps → bun install → Bun.build → __bundle.js
 *
 * The daemon imports __bundle.js directly at runtime — there is no node_modules
 * resolution in the tenant container. So this test proves the FULL closure of
 * the `google-sheets` plugin (@googleapis/sheets + google-auth-library +
 * googleapis-common, gaxios, https-proxy-agent, jws, …) bundles into a single
 * ESM file, loads, and materializes all seven safe functions PLUS the
 * authProvider and the GET /callback httpEndpoint. `zod` is kept external
 * (present in the daemon image — same model as resolvePluginDeps).
 *
 * No network calls are made: the factory + onLoad are exercised, but the
 * safe-function handlers (which call the Sheets API) are never invoked, and
 * initiate/handleCallback are never called (no relay or Google round-trip).
 * onLoad calls the credential store (returns null → a warning is logged).
 *
 * If @googleapis/sheets or google-auth-library ever fail to bundle or load here
 * (e.g. a future version hard-requires a native binary or dynamic import that
 * Bun.build can't inline), this test BLOCKS rather than hiding the issue, per
 * the migration discipline.
 *
 * Modeled on tests/google-bundle.test.ts in orgsdk-plugin-google-tasks.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN_DIR = join(ROOT, "plugin");

/** All seven google-sheets safe-function names, sorted. */
const EXPECTED_FUNCTION_NAMES = [
	"appendToSheet",
	"appendToTable",
	"clearSheet",
	"getSheetData",
	"getTableData",
	"listSheetTables",
	"updateTableRow",
] as const;

// A no-op PluginContext sufficient to construct the factory + authProvider +
// onLoad without a daemon or DB. No handler or initiate/handleCallback is
// invoked, so no credential resolution, relay, or Google network access occurs.
const noopCtx = {
	stores: {
		credential: {
			get: async () => null,
			list: async () => [],
			upsert: async () => {},
			delete: async () => {},
			getSecrets: async () => null,
			setSecrets: async () => {},
		},
		config: {
			list: async () => [],
			get: async () => null,
			set: async () => ({ key: "", value: {}, updatedAt: null }),
			delete: async () => {},
		},
	},
	publicBaseUrl: "http://localhost:3000",
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

interface MaterializedModule {
	safeFunctions: Array<{ name: string; requiredCredentials?: string[] }>;
	authProvider: {
		type: string;
		initiate: unknown;
		handleCallback: unknown;
	} | null;
	httpEndpoints: Array<{ method: string; path: string }>;
	onLoad?: () => Promise<void>;
}

interface StagedBundle {
	bundlePath: string;
	stagingDir: string;
}

async function stagePluginBundle(): Promise<StagedBundle> {
	const stagingDir = await mkdtemp(
		join(tmpdir(), "orgsdk-google-sheets-smoke-"),
	);
	// Copy plugin source (everything under plugin/ except manifest/package.json
	// — those are regenerated for the staging dir, mirroring resolvePluginDeps).
	const entries = await readdir(PLUGIN_DIR, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === ".plugin.json") continue;
		const src = join(PLUGIN_DIR, entry.name);
		const dest = join(stagingDir, entry.name);
		if (entry.isDirectory()) {
			await $`cp -r ${src} ${dest}`.quiet();
		} else {
			await $`cp ${src} ${dest}`.quiet();
		}
	}
	// Declare the three runtime packages — this mirrors the published artifact
	// package.json exactly (the source-declared supported ranges). zod is kept
	// external by Bun.build (present in the daemon image) but must be installed
	// in the staging dir so the external `import "zod"` resolves at load time.
	await writeFile(
		join(stagingDir, "package.json"),
		JSON.stringify(
			{
				private: true,
				dependencies: {
					"@googleapis/sheets": "^13.0.2",
					"google-auth-library": "^10.6.2",
					zod: "^4.0.0",
				},
			},
			null,
			2,
		),
	);
	// Resolve all three packages (and the Google transitive closure) into the
	// staging dir's own node_modules.
	await $`bun install`.cwd(stagingDir).quiet();
	// Bundle with the same config as resolvePluginDeps (target bun, esm,
	// zod external — zod is present in the daemon image).
	const result = await Bun.build({
		entrypoints: [join(stagingDir, "index.ts")],
		outdir: stagingDir,
		target: "bun",
		format: "esm",
		external: ["zod"],
	});
	if (!result.success || result.outputs.length === 0) {
		throw new Error(`Bun.build failed: ${result.logs.map(String).join("; ")}`);
	}
	return { bundlePath: result.outputs[0].path, stagingDir };
}

async function loadBundleModule(
	bundlePath: string,
): Promise<MaterializedModule> {
	const mod = (await import(bundlePath)) as {
		default: (ctx: typeof noopCtx) => MaterializedModule;
	};
	const factory = mod.default;
	if (typeof factory !== "function") {
		throw new Error("bundle default export is not a factory function");
	}
	return factory(noopCtx);
}

describe("isolated materialize/load smoke (resolvePluginDeps simulation)", () => {
	let loaded: StagedBundle;

	it("bundles the full Google dependency closure into a single ESM file", async () => {
		const out = await stagePluginBundle();
		loaded = out;
		const bytes = await readFile(out.bundlePath, "utf-8");
		// @googleapis/sheets + google-auth-library + their transitive closure
		// (googleapis-common, gaxios, https-proxy-agent, jws, …) is a large body
		// of code. Bun.build tree-shakes aggressively but the closure still
		// exceeds 100KB (typically several hundred KB inlined).
		expect(bytes.length).toBeGreaterThan(100_000);
		// No bare `from "@googleapis/sheets"`, `from "google-auth-library"`, or
		// any `@googleapis/*` should remain — the entire closure must be
		// inlined, not left as an external import. (zod IS intentionally
		// external — present in the daemon image.)
		expect(bytes).not.toMatch(
			/^\s*import.*from\s+["']@googleapis\/sheets["']/m,
		);
		expect(bytes).not.toMatch(
			/^\s*import.*from\s+["']google-auth-library["']/m,
		);
		expect(bytes).not.toMatch(
			/^\s*import.*from\s+["']@googleapis\/[^"']*["']/m,
		);
	});

	it("the bundle loads and the factory exposes all seven safe functions", async () => {
		const mod = await loadBundleModule(loaded.bundlePath);
		expect(Array.isArray(mod.safeFunctions)).toBe(true);
		expect(mod.safeFunctions.length).toBe(7);
		expect(mod.safeFunctions.map((f) => f.name).sort()).toEqual(
			[...EXPECTED_FUNCTION_NAMES].sort(),
		);
	});

	it("every bundled function requires the google-oauth credential", async () => {
		const mod = await loadBundleModule(loaded.bundlePath);
		for (const fn of mod.safeFunctions) {
			expect(fn.requiredCredentials).toEqual(["google-oauth"]);
		}
	});

	it("the bundle carries the authProvider (google-sheets owns connect)", async () => {
		const mod = await loadBundleModule(loaded.bundlePath);
		expect(mod.authProvider).not.toBeNull();
		expect(mod.authProvider?.type).toBe("oauth2");
		expect(typeof mod.authProvider?.initiate).toBe("function");
		expect(typeof mod.authProvider?.handleCallback).toBe("function");
	});

	it("the bundle registers the GET /callback httpEndpoint", async () => {
		const mod = await loadBundleModule(loaded.bundlePath);
		expect(mod.httpEndpoints.length).toBe(1);
		expect(mod.httpEndpoints[0].method).toBe("GET");
		expect(mod.httpEndpoints[0].path).toBe("/callback");
	});

	it("onLoad runs without a credential and without a network call", async () => {
		const mod = await loadBundleModule(loaded.bundlePath);
		await expect(mod.onLoad?.()).resolves.toBeUndefined();
	});

	it("re-bundling is byte-deterministic (same source → same output modulo path)", async () => {
		const firstBytes = await readFile(loaded.bundlePath, "utf-8");
		const second = await stagePluginBundle();
		const secondBytes = await readFile(second.bundlePath, "utf-8");
		// Normalize the staging path (resolvePluginDeps does the same) then
		// compare — the only allowed difference is the embedded temp path. Bun
		// also mangles the entry-path basename into internal identifiers, so
		// normalize both forms.
		const norm = (s: string, dir: string) => {
			const base = dir.split("/").pop() ?? dir;
			return s
				.replaceAll(dir, "/plugin-bundle-root")
				.replaceAll(base, "plugin-bundle-root")
				.replaceAll(base.replaceAll("-", "_"), "plugin_bundle_root");
		};
		expect(norm(secondBytes, second.stagingDir)).toBe(
			norm(firstBytes, loaded.stagingDir),
		);
		await rm(second.stagingDir, { recursive: true, force: true });
	});

	// Cleanup after the whole describe block (bun:test runs these sequentially).
	it("cleans up the staging dir", async () => {
		await rm(loaded.stagingDir, { recursive: true, force: true });
		expect(loaded.stagingDir).toBeDefined();
	});
});
