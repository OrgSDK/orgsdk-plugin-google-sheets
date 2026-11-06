import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("published documentation describes current licensing and installation", async () => {
	for (const path of ["../README.md", "../plugin/docs/overview.md"]) {
		const text = await readFile(new URL(path, import.meta.url), "utf8");
		expect(text).toContain("Apache-2.0");
		expect(text).toContain("https://orgsdk.ai/plugins/releases.json");
		expect(text).not.toMatch(
			/private[ ,]+proprietary|proprietary LICENSE|one-click|no publishing workflow|no remote, publishing workflow/i,
		);
	}
});
