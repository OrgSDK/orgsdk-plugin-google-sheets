import { describe, expect, it } from "bun:test";
import { getGoogleOAuth2Client } from "../plugin/oauth";

describe("OrgSDK execution credential snapshot", () => {
	it("accepts the access-token-only native snapshot without a refresh secret", async () => {
		const client = await getGoogleOAuth2Client({
			source: "byo",
			secret_accessToken: "synthetic-access",
		});
		expect(client.credentials).toEqual({ access_token: "synthetic-access" });
	});
	it("rejects missing tokens and unsupported first-party credentials", async () => {
		await expect(getGoogleOAuth2Client({ source: "byo" })).rejects.toThrow(
			"Missing google-oauth access token",
		);
		await expect(
			getGoogleOAuth2Client({
				source: "first-party",
				secret_accessToken: "synthetic",
			}),
		).rejects.toThrow("own OAuth application");
	});
});
