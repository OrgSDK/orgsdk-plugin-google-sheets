import assert from "node:assert/strict";
import nock from "nock";

const table = {
	tableId: "table",
	name: "Evidence",
	range: {
		sheetId: 0,
		startRowIndex: 0,
		endRowIndex: 10,
		startColumnIndex: 0,
		endColumnIndex: 1,
	},
	columns: [{ columnId: "name", name: "Name" }],
};
export default async function createFixture() {
	const fixture = {
		nativeNetworkMock: true,
		nativeRequests: 0,
		configuration: {},
		provider: "google-oauth",
		secret: {
			source: "byo",
			secret_accessToken: "synthetic-access",
		},
		async fetch(request) {
			const url = new URL(request.url);
			assert.equal(
				request.headers.get("authorization"),
				"Bearer synthetic-access",
			);
			assert.equal(url.origin, "https://sheets.googleapis.com");
			const path = url.pathname;
			if (path === "/v4/spreadsheets/sheet")
				return Response.json({
					spreadsheetId: "sheet",
					sheets: [
						{ properties: { sheetId: 0, title: "Sheet1" }, tables: [table] },
					],
				});
			if (path === "/v4/spreadsheets/sheet:batchUpdate")
				return Response.json({ replies: [{ appendCells: {} }] });
			if (path === "/v4/spreadsheets/sheet/values:batchUpdate")
				return Response.json({ totalUpdatedCells: 1 });
			if (path.startsWith("/v4/spreadsheets/sheet/values/"))
				return Response.json({
					range: "Sheet1!A2:A2",
					values: [["Example"]],
					updates: { updatedRows: 1 },
					clearedRange: "Sheet1!A1:A10",
				});
			assert.fail(path);
		},
		async run(call) {
			const range = { spreadsheetId: "sheet", range: "Sheet1!A1:A10" };
			await call("appendToSheet", { ...range, rows: [["Example"]] });
			assert(
				JSON.stringify(await call("getSheetData", range)).includes("Example"),
			);
			await call("clearSheet", range);
			assert(
				JSON.stringify(
					await call("listSheetTables", { spreadsheetId: "sheet" }),
				).includes("table"),
			);
			await call("appendToTable", {
				spreadsheetId: "sheet",
				tableId: "table",
				rows: [{ Name: "Example" }],
			});
			assert.equal(
				(
					await call("getTableData", {
						spreadsheetId: "sheet",
						tableId: "table",
					})
				).rows[0].Name,
				"Example",
			);
			assert.equal(
				(
					await call("updateTableRow", {
						spreadsheetId: "sheet",
						tableId: "table",
						rowIndex: 2,
						updates: { Name: "Updated" },
					})
				).success,
				true,
			);
		},
		close() {
			nock.cleanAll();
			nock.enableNetConnect();
			nock.restore();
		},
	};
	nock.disableNetConnect();
	for (const origin of ["https://sheets.googleapis.com"]) {
		for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
			nock(origin)
				.persist()
				.intercept(/.*/, method)
				.reply(async (request) => {
					fixture.nativeRequests++;
					const response = await fixture.fetch(request);
					return [
						response.status,
						Buffer.from(await response.arrayBuffer()),
						Object.fromEntries(response.headers),
					];
				});
		}
	}
	return fixture;
}
