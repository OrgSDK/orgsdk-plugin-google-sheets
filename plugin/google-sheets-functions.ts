import type { SafeFunction } from "@orgsdk/plugins";
export const moduleDescription =
	"Read, write, and manage Google Sheets data and tables";

import {
	sheets_v4,
	type sheets_v4 as sheetsV4Namespace,
} from "@googleapis/sheets";
import { z } from "zod";
import type { GoogleOAuthBundle } from "./oauth.ts";
import { getGoogleOAuth2Client } from "./oauth.ts";

function getGoogleOAuth(creds: Record<string, unknown>): GoogleOAuthBundle {
	return (creds["google-oauth"] as GoogleOAuthBundle | undefined) ?? {};
}

/**
 * Normalize spreadsheetId from full URL or return as-is if already an ID.
 * Handles URLs like: https://docs.google.com/spreadsheets/d/<ID>/edit
 */
function normalizeSpreadsheetId(input: string): string {
	const trimmed = input.trim();
	// Match Google Sheets URL pattern
	const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
	if (match && match[1]) {
		return match[1];
	}
	// Return as-is if not a URL
	return trimmed;
}

export const safeFunctions: SafeFunction[] = [
	{
		name: "appendToSheet",
		requiredCredentials: ["google-oauth"],
		metadata: {
			category: "google",
			tags: ["auth"],
			readonly: false,
			version: "1.0.0",
			relatedTo: ["getSheetData", "clearSheet", "appendToTable"],
		},
		handler: async (
			credentials: Record<string, unknown>,
			{
				spreadsheetId,
				range,
				rows,
				valueInputOption,
			}: {
				spreadsheetId: string;
				range: string;
				rows: unknown[][];
				valueInputOption?: "RAW" | "USER_ENTERED";
			},
		) => {
			if (!credentials["google-oauth"]) {
				throw new Error(
					"Missing google-oauth credential. Create .secrets/google-oauth.json",
				);
			}
			if (typeof spreadsheetId !== "string" || !spreadsheetId) {
				throw new Error("appendToSheet: spreadsheetId is required");
			}
			if (typeof range !== "string" || !range) {
				throw new Error("appendToSheet: range is required");
			}

			if (
				!Array.isArray(rows) ||
				rows.length === 0 ||
				!rows.every((r) => Array.isArray(r))
			) {
				throw new Error(
					"appendToSheet: rows must be a 2D array, e.g. [[val1, val2], [val3, val4]]",
				);
			}

			const normalizedId = normalizeSpreadsheetId(spreadsheetId);

			const values = rows;
			const inputOption: sheetsV4Namespace.Params$Resource$Spreadsheets$Values$Append["valueInputOption"] =
				valueInputOption ?? "USER_ENTERED";

			const google = getGoogleOAuth(credentials);
			const auth = await getGoogleOAuth2Client(google);
			const sheets = new sheets_v4.Sheets({ auth });

			const resp = await sheets.spreadsheets.values.append({
				spreadsheetId: normalizedId,
				range,
				valueInputOption: inputOption,
				insertDataOption: "INSERT_ROWS",
				requestBody: {
					values,
				} as sheetsV4Namespace.Schema$ValueRange,
			});

			return {
				success: true,
				updates: resp.data.updates,
			};
		},
		description:
			"Append rows to a Google Sheet range. Always pass a 2D array: [[val1, val2], ...]. Spreadsheet ID + range are passed at runtime.",
		returnType: "Promise<{ success: boolean; updates: any }>",
		parameters: [
			{ name: "spreadsheetId", type: "string" },
			{ name: "range", type: "string" },
			{ name: "rows", type: "unknown[][]" },
			{ name: "valueInputOption", type: '"RAW" | "USER_ENTERED"' },
		],
		docs: {
			summary:
				"Append rows to a Google Sheet at a specified range. Rows are inserted after the last row of data in the range. Accepts a full Sheets URL or just the spreadsheet ID.",
			parameters: [
				{
					name: "spreadsheetId",
					type: "string",
					description:
						"The spreadsheet ID from the Google Sheets URL, or the full URL itself (the ID will be extracted automatically).",
					example: '"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"',
				},
				{
					name: "range",
					type: "string",
					description:
						"A1 notation range where rows will be appended. Typically the sheet name or sheet + column range.",
					example: '"Sheet1!A:E"',
				},
				{
					name: "rows",
					type: "unknown[][]",
					description:
						"2D array of values to append. Each inner array is one row. Values can be strings, numbers, booleans, or null.",
					example: '[["Acme Corp", 150, "USD", "2026-03-15"]]',
				},
				{
					name: "valueInputOption",
					type: '"RAW" | "USER_ENTERED"',
					description:
						"How values are interpreted. USER_ENTERED parses formulas and dates like the Sheets UI. RAW inserts values as-is.",
					defaultValue: "USER_ENTERED",
					optional: true,
				},
			],
			returns: {
				type: "Promise<{ success: boolean; updates: any }>",
				description: "Success status and update metadata from the Sheets API.",
			},
			examples: [
				{
					title: "Append a single row",
					code: 'await googleSheets.appendToSheet(\n  "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",\n  "Sheet1!A:D",\n  [["Acme Corp", 150, "USD", "2026-03-15"]]\n);',
				},
				{
					title: "Append multiple rows",
					code: 'const rows = invoices.map(inv => [\n  inv.provider,\n  inv.amount,\n  inv.currency,\n  new Date().toISOString().split("T")[0],\n]);\nawait googleSheets.appendToSheet(SPREADSHEET_ID, "Expenses!A:D", rows);',
					description: "Batch append from processed data",
				},
			],
			caveats: [
				"Rows must be a 2D array — [[val1, val2], ...], not an array of objects",
				"For object-based rows, use appendToTable instead (requires a structured table)",
				"Column order must match the sheet headers — verify with getSheetData first",
			],
			seeAlso: ["getSheetData", "clearSheet", "appendToTable"],
		},
	},
	{
		name: "getSheetData",
		requiredCredentials: ["google-oauth"],
		metadata: {
			category: "google",
			tags: ["readonly", "auth", "discovery"],
			readonly: true,
			discovery: true,
			version: "1.0.0",
			relatedTo: ["appendToSheet", "listSheetTables"],
		},
		handler: async (
			credentials: Record<string, unknown>,
			{ spreadsheetId, range }: { spreadsheetId: string; range: string },
		) => {
			if (!credentials["google-oauth"]) {
				throw new Error(
					"Missing google-oauth credential. Create .secrets/google-oauth.json",
				);
			}
			if (typeof spreadsheetId !== "string" || !spreadsheetId) {
				throw new Error("getSheetData: spreadsheetId is required");
			}
			if (typeof range !== "string" || !range) {
				throw new Error("getSheetData: range is required");
			}

			const normalizedId = normalizeSpreadsheetId(spreadsheetId);

			const google = getGoogleOAuth(credentials);
			const auth = await getGoogleOAuth2Client(google);
			const sheets = new sheets_v4.Sheets({ auth });

			const resp = await sheets.spreadsheets.values.get({
				spreadsheetId: normalizedId,
				range,
			});

			return resp.data.values ?? [];
		},
		description: "Read values from a Google Sheet range",
		returnType: "Promise<unknown[][]>",
		parameters: [
			{ name: "spreadsheetId", type: "string" },
			{ name: "range", type: "string" },
		],
	},
	{
		name: "clearSheet",
		requiredCredentials: ["google-oauth"],
		metadata: {
			category: "google",
			tags: ["auth"],
			readonly: false,
			version: "1.0.0",
			relatedTo: ["appendToSheet", "getSheetData"],
		},
		handler: async (
			credentials: Record<string, unknown>,
			{ spreadsheetId, range }: { spreadsheetId: string; range: string },
		) => {
			if (!credentials["google-oauth"]) {
				throw new Error(
					"Missing google-oauth credential. Create .secrets/google-oauth.json",
				);
			}
			if (typeof spreadsheetId !== "string" || !spreadsheetId) {
				throw new Error("clearSheet: spreadsheetId is required");
			}
			if (typeof range !== "string" || !range) {
				throw new Error("clearSheet: range is required");
			}

			const normalizedId = normalizeSpreadsheetId(spreadsheetId);

			const google = getGoogleOAuth(credentials);
			const auth = await getGoogleOAuth2Client(google);
			const sheets = new sheets_v4.Sheets({ auth });

			await sheets.spreadsheets.values.clear({
				spreadsheetId: normalizedId,
				range,
				requestBody: {},
			});

			return { success: true };
		},
		description:
			"Clear values in a Google Sheet range. Tip: use a range that excludes headers (e.g. Sheet1!A2:Z)",
		returnType: "Promise<{ success: boolean }>",
		parameters: [
			{ name: "spreadsheetId", type: "string" },
			{ name: "range", type: "string" },
		],
	},
	{
		name: "listSheetTables",
		requiredCredentials: ["google-oauth"],
		metadata: {
			category: "google",
			tags: ["readonly", "auth", "discovery"],
			readonly: true,
			discovery: true,
			version: "1.0.0",
			relatedTo: ["appendToTable", "getSheetData"],
		},
		handler: async (
			credentials: Record<string, unknown>,
			{ spreadsheetId }: { spreadsheetId: string },
		) => {
			if (!credentials["google-oauth"]) {
				throw new Error(
					"Missing google-oauth credential. Create .secrets/google-oauth.json",
				);
			}
			if (typeof spreadsheetId !== "string" || !spreadsheetId) {
				throw new Error("listSheetTables: spreadsheetId is required");
			}

			const normalizedId = normalizeSpreadsheetId(spreadsheetId);

			const google = getGoogleOAuth(credentials);
			const auth = await getGoogleOAuth2Client(google);
			const sheets = new sheets_v4.Sheets({ auth });

			// Fetch sheets + tables.
			// Some Sheets API deployments reject unknown/unsupported field masks; fall back to full fetch.
			let resp: sheetsV4Namespace.Schema$Spreadsheet;
			try {
				const r = await sheets.spreadsheets.get({
					spreadsheetId: normalizedId,
					fields:
						"sheets(properties(sheetId,title),tables(tableId,name,range))",
				});
				resp = r.data;
			} catch {
				const r = await sheets.spreadsheets.get({
					spreadsheetId: normalizedId,
				});
				resp = r.data;
			}

			// Helper to convert column index to letter (0 -> A, 1 -> B, 26 -> AA)
			function columnToLetter(index: number): string {
				let letter = "";
				let temp = index;
				while (temp >= 0) {
					letter = String.fromCharCode((temp % 26) + 65) + letter;
					temp = Math.floor(temp / 26) - 1;
				}
				return letter;
			}

			// Helper to convert GridRange to A1 notation
			function gridRangeToA1(
				gridRange: sheetsV4Namespace.Schema$GridRange,
				sheetTitle: string,
			): string {
				const startCol = gridRange.startColumnIndex ?? 0;
				const endCol = (gridRange.endColumnIndex ?? 0) - 1;
				const startRow = (gridRange.startRowIndex ?? 0) + 1; // 1-indexed in A1 notation
				const endRow = gridRange.endRowIndex ?? 0;

				if (startCol === endCol && startRow === endRow) {
					// Single cell
					return `${sheetTitle}!${columnToLetter(startCol)}${startRow}`;
				}

				// Range
				const startCell = `${columnToLetter(startCol)}${startRow}`;
				const endCell = `${columnToLetter(endCol)}${endRow}`;
				return `${sheetTitle}!${startCell}:${endCell}`;
			}

			const tables: Array<{
				tableId: string;
				name: string;
				sheetId: number;
				sheetTitle: string;
				range: sheetsV4Namespace.Schema$GridRange;
				a1Range: string;
			}> = [];

			const sheetsData = resp.sheets ?? [];
			for (const sheet of sheetsData) {
				const sheetId = sheet.properties?.sheetId;
				const sheetTitle = sheet.properties?.title;
				if (sheetId === undefined || sheetTitle === undefined) {
					continue;
				}

				// Table fields: tableId (string), name (string), range (GridRange)
				const sheetTables =
					(sheet.tables as Array<{
						tableId?: string;
						name?: string;
						range?: sheetsV4Namespace.Schema$GridRange;
					}>) ?? [];

				for (const table of sheetTables) {
					if (
						table.tableId !== undefined &&
						table.name !== undefined &&
						table.range !== undefined
					) {
						const a1Range = gridRangeToA1(table.range, sheetTitle!);
						tables.push({
							tableId: table.tableId,
							name: table.name,
							sheetId: sheetId!,
							sheetTitle: sheetTitle!,
							range: table.range,
							a1Range,
						});
					}
				}
			}

			return tables;
		},
		description:
			"List all structured tables in a Google Sheet. Returns array with tableId (string), name, sheetId, sheetTitle, range (GridRange), a1Range (A1 notation for debugging).",
		returnType:
			"Promise<Array<{ tableId: string; name: string; sheetId: number; sheetTitle: string; range: any; a1Range: string }>>",
		parameters: [{ name: "spreadsheetId", type: "string" }],
	},
	{
		name: "appendToTable",
		requiredCredentials: ["google-oauth"],
		metadata: {
			category: "google",
			tags: ["auth"],
			readonly: false,
			version: "1.0.0",
			relatedTo: ["listSheetTables", "appendToSheet"],
		},
		handler: async (
			credentials: Record<string, unknown>,
			{
				spreadsheetId,
				tableId,
				rows,
			}: {
				spreadsheetId: string;
				tableId: string;
				rows: Record<string, unknown>[];
			},
		) => {
			if (!credentials["google-oauth"]) {
				throw new Error(
					"Missing google-oauth credential. Create .secrets/google-oauth.json",
				);
			}
			if (typeof spreadsheetId !== "string" || !spreadsheetId) {
				throw new Error("appendToTable: spreadsheetId is required");
			}
			if (typeof tableId !== "string" || !tableId) {
				throw new Error("appendToTable: tableId is required");
			}

			if (
				!Array.isArray(rows) ||
				rows.length === 0 ||
				!rows.every(
					(r) => typeof r === "object" && r !== null && !Array.isArray(r),
				)
			) {
				throw new Error(
					"appendToTable: rows must be an array of objects, e.g. [{ ColumnName: value, ... }]",
				);
			}

			// Validate cell values
			const cellValue = z.union([
				z.string(),
				z.number(),
				z.boolean(),
				z.null(),
				z.undefined(),
			]);
			const rowSchema = z.array(z.record(z.string(), cellValue)).min(1);

			const parsed = rowSchema.safeParse(rows);
			if (!parsed.success) {
				const preview = JSON.stringify(rows, null, 2)?.slice(0, 200);
				throw new Error(
					`appendToTable: invalid row values. ` +
						`Expected [{ ColumnName: value, ... }] where values are string, number, boolean, or null. Got: ${preview}`,
				);
			}

			const normalizedId = normalizeSpreadsheetId(spreadsheetId);

			// Helper to convert a value to CellData
			function valueToCellData(
				value: unknown,
			): sheetsV4Namespace.Schema$CellData {
				const cellData: sheetsV4Namespace.Schema$CellData = {};

				// Basic formula detection: starts with '='
				if (typeof value === "string" && value.startsWith("=")) {
					cellData.userEnteredValue = { formulaValue: value };
				} else if (typeof value === "number") {
					cellData.userEnteredValue = { numberValue: value };
				} else if (typeof value === "boolean") {
					cellData.userEnteredValue = { boolValue: value };
				} else if (value === null || value === undefined) {
					// Empty cell
					cellData.userEnteredValue = { stringValue: "" };
				} else {
					// Everything else as string (including Date objects, etc.)
					cellData.userEnteredValue = {
						stringValue: String(value),
					};
				}

				return cellData;
			}

			const google = getGoogleOAuth(credentials);
			const auth = await getGoogleOAuth2Client(google);
			const sheets = new sheets_v4.Sheets({ auth });

			// Fetch spreadsheet metadata: sheetId + table columns (needed for object→array conversion)
			let resolvedSheetId = 0;
			let tableColumns: string[] = [];
			try {
				const spreadsheet = await sheets.spreadsheets.get({
					spreadsheetId: normalizedId,
					fields: "sheets(properties(sheetId),tables(tableId,columns))",
				});

				const sheetsData = spreadsheet.data.sheets ?? [];
				for (const sheet of sheetsData) {
					const sheetId = sheet.properties?.sheetId;
					const sheetTables =
						(sheet.tables as Array<{
							tableId?: string;
							columns?: Array<{ columnId?: string; name?: string }>;
						}>) ?? [];

					for (const table of sheetTables) {
						if (table.tableId === tableId && sheetId !== undefined) {
							resolvedSheetId = sheetId!;
							tableColumns =
								table.columns?.filter((c) => c.name).map((c) => c.name!) ?? [];
							break;
						}
					}
					if (tableColumns.length > 0) break;
				}
			} catch {
				// Fallback: full fetch if field mask fails
				try {
					const spreadsheet = await sheets.spreadsheets.get({
						spreadsheetId: normalizedId,
					});
					const sheetsData = spreadsheet.data.sheets ?? [];
					for (const sheet of sheetsData) {
						const sheetId = sheet.properties?.sheetId;
						const sheetTables =
							(sheet.tables as Array<{
								tableId?: string;
								columns?: Array<{ columnId?: string; name?: string }>;
							}>) ?? [];

						for (const table of sheetTables) {
							if (table.tableId === tableId && sheetId !== undefined) {
								resolvedSheetId = sheetId!;
								tableColumns =
									table.columns?.filter((c) => c.name).map((c) => c.name!) ??
									[];
								break;
							}
						}
						if (tableColumns.length > 0) break;
					}
				} catch {
					console.warn(
						`Failed to resolve sheetId for table ${tableId}, using fallback 0`,
					);
				}
			}

			// Convert object rows to array rows using column order
			if (tableColumns.length === 0) {
				throw new Error(
					`appendToTable: no column metadata found for table "${tableId}". ` +
						`Ensure the table has defined columns.`,
				);
			}
			const arrayRows = rows.map((obj) => {
				const unknownKeys = Object.keys(obj).filter(
					(k) => !tableColumns.includes(k),
				);
				if (unknownKeys.length > 0) {
					throw new Error(
						`appendToTable: unknown column(s): ${unknownKeys.join(", ")}. ` +
							`Valid columns: ${tableColumns.join(", ")}`,
					);
				}
				return tableColumns.map((name) => obj[name] ?? null);
			});

			// Convert rows to RowData format
			const rowData: sheetsV4Namespace.Schema$RowData[] = arrayRows.map(
				(rowArr) => ({
					values: rowArr.map((val) => valueToCellData(val)),
				}),
			);

			// Use type assertion for the request since the types may not fully match
			const resp = await sheets.spreadsheets.batchUpdate({
				spreadsheetId: normalizedId,
				requestBody: {
					requests: [
						{
							appendCells: {
								sheetId: resolvedSheetId, // Resolved sheetId or fallback 0
								tableId: tableId, // API expects string for tableId
								rows: rowData,
								fields: "*",
							},
						},
					],
				} as sheetsV4Namespace.Schema$BatchUpdateSpreadsheetRequest,
			});

			return {
				success: true,
				updates: (resp.data.replies?.[0] as any)?.appendCells,
			};
		},
		description:
			"Append rows to a structured Google Sheet table. Pass rows as objects keyed by column name: [{ Provider: 'X', Amount: 100 }, ...]. Column names must match table headers exactly. Use listSheetTables to find tableId. Formula detection: strings starting with '='.",
		returnType: "Promise<{ success: boolean; updates: any }>",
		parameters: [
			{ name: "spreadsheetId", type: "string" },
			{ name: "tableId", type: "string" },
			{
				name: "rows",
				type: "Record<string, unknown>[]",
			},
		],
	},
	{
		name: "getTableData",
		requiredCredentials: ["google-oauth"],
		metadata: {
			category: "google",
			tags: ["readonly", "auth", "discovery"],
			readonly: true,
			discovery: true,
			version: "1.0.0",
			relatedTo: ["listSheetTables", "appendToTable", "updateTableRow"],
		},
		handler: async (
			credentials: Record<string, unknown>,
			{ spreadsheetId, tableId }: { spreadsheetId: string; tableId: string },
		) => {
			if (!credentials["google-oauth"]) {
				throw new Error(
					"Missing google-oauth credential. Create .secrets/google-oauth.json",
				);
			}
			if (typeof spreadsheetId !== "string" || !spreadsheetId) {
				throw new Error("getTableData: spreadsheetId is required");
			}
			if (typeof tableId !== "string" || !tableId) {
				throw new Error("getTableData: tableId is required");
			}

			const normalizedId = normalizeSpreadsheetId(spreadsheetId);

			const google = getGoogleOAuth(credentials);
			const auth = await getGoogleOAuth2Client(google);
			const sheets = new sheets_v4.Sheets({ auth });

			// Fetch table metadata to get range and column headers
			let tableInfo:
				| {
						sheetTitle: string;
						range: sheetsV4Namespace.Schema$GridRange;
						columns: Array<{ columnId: string; name: string }>;
				  }
				| undefined;

			try {
				const spreadsheet = await sheets.spreadsheets.get({
					spreadsheetId: normalizedId,
					fields:
						"sheets(properties(sheetId,title),tables(tableId,range,columns))",
				});

				const sheetsData = spreadsheet.data.sheets ?? [];
				for (const sheet of sheetsData) {
					const sheetTitle = sheet.properties?.title;
					const sheetTables =
						(sheet.tables as Array<{
							tableId?: string;
							range?: sheetsV4Namespace.Schema$GridRange;
							columns?: Array<{ columnId?: string; name?: string }>;
						}>) ?? [];

					for (const table of sheetTables) {
						if (table.tableId === tableId && table.range && sheetTitle) {
							tableInfo = {
								sheetTitle,
								range: table.range,
								columns:
									table.columns
										?.filter((c) => c.columnId && c.name)
										.map((c) => ({ columnId: c.columnId!, name: c.name! })) ??
									[],
							};
							break;
						}
					}
					if (tableInfo) break;
				}
			} catch {
				// Fallback: full fetch if field mask fails
				const spreadsheet = await sheets.spreadsheets.get({
					spreadsheetId: normalizedId,
				});
				const sheetsData = spreadsheet.data.sheets ?? [];
				for (const sheet of sheetsData) {
					const sheetTitle = sheet.properties?.title;
					const sheetTables =
						(sheet.tables as Array<{
							tableId?: string;
							range?: sheetsV4Namespace.Schema$GridRange;
							columns?: Array<{ columnId?: string; name?: string }>;
						}>) ?? [];

					for (const table of sheetTables) {
						if (table.tableId === tableId && table.range && sheetTitle) {
							tableInfo = {
								sheetTitle,
								range: table.range,
								columns:
									table.columns
										?.filter((c) => c.columnId && c.name)
										.map((c) => ({ columnId: c.columnId!, name: c.name! })) ??
									[],
							};
							break;
						}
					}
					if (tableInfo) break;
				}
			}

			if (!tableInfo) {
				throw new Error(`Table with ID ${tableId} not found in spreadsheet`);
			}

			// Helper to convert column index to letter
			function columnToLetter(index: number): string {
				let letter = "";
				let temp = index;
				while (temp >= 0) {
					letter = String.fromCharCode((temp % 26) + 65) + letter;
					temp = Math.floor(temp / 26) - 1;
				}
				return letter;
			}

			// Build A1 range for data rows (skip header row)
			const startCol = tableInfo.range.startColumnIndex ?? 0;
			const endCol = (tableInfo.range.endColumnIndex ?? 1) - 1;
			const dataStartRow = (tableInfo.range.startRowIndex ?? 0) + 2; // +1 for 1-indexed, +1 to skip header
			// endRowIndex is exclusive, so we use it directly as the last row number
			const endRow = tableInfo.range.endRowIndex ?? dataStartRow;

			const a1Range = `${tableInfo.sheetTitle}!${columnToLetter(startCol)}${dataStartRow}:${columnToLetter(endCol)}${endRow}`;

			// Fetch the data
			const resp = await sheets.spreadsheets.values.get({
				spreadsheetId: normalizedId,
				range: a1Range,
			});

			const rawRows = resp.data.values ?? [];
			const columnNames = tableInfo.columns.map((c) => c.name);

			// Convert to array of objects with column names as keys
			const rows = rawRows.map((row, rowIndex) => {
				const obj: Record<string, unknown> = {
					_rowIndex: dataStartRow + rowIndex, // 1-indexed row number in sheet
				};
				columnNames.forEach((name, colIndex) => {
					obj[name] = row[colIndex] ?? null;
				});
				return obj;
			});

			return {
				tableId,
				tableName: tableInfo.columns.length > 0 ? undefined : tableId,
				columns: columnNames,
				rows,
				rowCount: rows.length,
			};
		},
		description:
			"Read all data rows from a structured Google Sheet table. Returns rows as objects with column names as keys. Each row includes _rowIndex for updates. Use listSheetTables to find tableId.",
		returnType:
			"Promise<{ tableId: string; columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number }>",
		parameters: [
			{ name: "spreadsheetId", type: "string" },
			{ name: "tableId", type: "string" },
		],
	},
	{
		name: "updateTableRow",
		requiredCredentials: ["google-oauth"],
		metadata: {
			category: "google",
			tags: ["auth"],
			readonly: false,
			version: "1.0.0",
			relatedTo: ["getTableData", "appendToTable"],
		},
		handler: async (
			credentials: Record<string, unknown>,
			{
				spreadsheetId,
				tableId,
				rowIndex,
				updates,
			}: {
				spreadsheetId: string;
				tableId: string;
				rowIndex: number;
				updates: Record<string, unknown>;
			},
		) => {
			if (!credentials["google-oauth"]) {
				throw new Error(
					"Missing google-oauth credential. Create .secrets/google-oauth.json",
				);
			}
			if (typeof spreadsheetId !== "string" || !spreadsheetId) {
				throw new Error("updateTableRow: spreadsheetId is required");
			}
			if (typeof tableId !== "string" || !tableId) {
				throw new Error("updateTableRow: tableId is required");
			}
			if (typeof rowIndex !== "number" || rowIndex < 1) {
				throw new Error(
					"updateTableRow: rowIndex must be a positive number (1-indexed sheet row)",
				);
			}
			if (!updates || typeof updates !== "object") {
				throw new Error(
					"updateTableRow: updates must be an object with column name keys",
				);
			}

			const normalizedId = normalizeSpreadsheetId(spreadsheetId);

			const google = getGoogleOAuth(credentials);
			const auth = await getGoogleOAuth2Client(google);
			const sheets = new sheets_v4.Sheets({ auth });

			// Fetch table metadata to get column info
			let tableInfo:
				| {
						sheetTitle: string;
						range: sheetsV4Namespace.Schema$GridRange;
						columns: Array<{
							columnId: string;
							name: string;
							columnIndex: number;
						}>;
				  }
				| undefined;

			try {
				const spreadsheet = await sheets.spreadsheets.get({
					spreadsheetId: normalizedId,
					fields:
						"sheets(properties(sheetId,title),tables(tableId,range,columns))",
				});

				const sheetsData = spreadsheet.data.sheets ?? [];
				for (const sheet of sheetsData) {
					const sheetTitle = sheet.properties?.title;
					const sheetTables =
						(sheet.tables as Array<{
							tableId?: string;
							range?: sheetsV4Namespace.Schema$GridRange;
							columns?: Array<{ columnId?: string; name?: string }>;
						}>) ?? [];

					for (const table of sheetTables) {
						if (table.tableId === tableId && table.range && sheetTitle) {
							const startCol = table.range.startColumnIndex ?? 0;
							tableInfo = {
								sheetTitle,
								range: table.range,
								columns:
									table.columns
										?.filter((c) => c.columnId && c.name)
										.map((c, idx) => ({
											columnId: c.columnId!,
											name: c.name!,
											columnIndex: startCol + idx,
										})) ?? [],
							};
							break;
						}
					}
					if (tableInfo) break;
				}
			} catch {
				// Fallback: full fetch
				const spreadsheet = await sheets.spreadsheets.get({
					spreadsheetId: normalizedId,
				});
				const sheetsData = spreadsheet.data.sheets ?? [];
				for (const sheet of sheetsData) {
					const sheetTitle = sheet.properties?.title;
					const sheetTables =
						(sheet.tables as Array<{
							tableId?: string;
							range?: sheetsV4Namespace.Schema$GridRange;
							columns?: Array<{ columnId?: string; name?: string }>;
						}>) ?? [];

					for (const table of sheetTables) {
						if (table.tableId === tableId && table.range && sheetTitle) {
							const startCol = table.range.startColumnIndex ?? 0;
							tableInfo = {
								sheetTitle,
								range: table.range,
								columns:
									table.columns
										?.filter((c) => c.columnId && c.name)
										.map((c, idx) => ({
											columnId: c.columnId!,
											name: c.name!,
											columnIndex: startCol + idx,
										})) ?? [],
							};
							break;
						}
					}
					if (tableInfo) break;
				}
			}

			if (!tableInfo) {
				throw new Error(`Table with ID ${tableId} not found in spreadsheet`);
			}

			// Helper to convert column index to letter
			function columnToLetter(index: number): string {
				let letter = "";
				let temp = index;
				while (temp >= 0) {
					letter = String.fromCharCode((temp % 26) + 65) + letter;
					temp = Math.floor(temp / 26) - 1;
				}
				return letter;
			}

			// Build update requests for each column in updates
			const data: sheetsV4Namespace.Schema$ValueRange[] = [];
			const columnMap = new Map(
				tableInfo.columns.map((c) => [c.name, c.columnIndex]),
			);

			for (const [columnName, value] of Object.entries(updates)) {
				const colIndex = columnMap.get(columnName);
				if (colIndex === undefined) {
					throw new Error(
						`Column "${columnName}" not found in table. Available: ${tableInfo.columns.map((c) => c.name).join(", ")}`,
					);
				}

				const cellRange = `${tableInfo.sheetTitle}!${columnToLetter(colIndex)}${rowIndex}`;
				data.push({
					range: cellRange,
					values: [[value]],
				});
			}

			if (data.length === 0) {
				return { success: true, updatedCells: 0 };
			}

			const resp = await sheets.spreadsheets.values.batchUpdate({
				spreadsheetId: normalizedId,
				requestBody: {
					valueInputOption: "USER_ENTERED",
					data,
				},
			});

			return {
				success: true,
				updatedCells: resp.data.totalUpdatedCells ?? 0,
				updatedColumns: Object.keys(updates),
			};
		},
		description:
			"Update specific columns in a row of a Google Sheet table. Use _rowIndex from getTableData. Pass updates as { columnName: newValue }.",
		returnType:
			"Promise<{ success: boolean; updatedCells: number; updatedColumns: string[] }>",
		parameters: [
			{ name: "spreadsheetId", type: "string" },
			{ name: "tableId", type: "string" },
			{ name: "rowIndex", type: "number" },
			{ name: "updates", type: "Record<string, unknown>" },
		],
	},
];
