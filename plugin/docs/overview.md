# Google Sheets for OrgSDK

## Install in OrgSDK

Open your project's Plugins page, select this plugin and enable the pinned release.
The default catalogue is https://orgsdk.ai/plugins/releases.json. The executor
downloads the versioned bundle and verifies its SHA256. Configure the provider
and attach the credential described below before running an action.

The plugin is Apache-2.0 licensed; see LICENSE, NOTICE and TRADEMARKS.md.
The generated npm distribution is a separate publication surface. Installing npm
files alone does not register a project plugin. Local builds do not publish it.

## Credentials

Connect your own Google OAuth application in OrgSDK with `https://www.googleapis.com/auth/spreadsheets`.
Enable the corresponding Google API and register the exact callback URL shown
by OrgSDK in your Google Cloud OAuth client. Attach the resulting `google-oauth`
credential to this project plugin. The host owns consent and token refresh;
execution receives only `{source: "byo", secret_accessToken}`. Client and refresh
secrets stay on the host. No hosted OAuth relay is supported.

A Google credential may be shared with another Google plugin only when its granted
scopes cover both plugins. Provider consent, app verification and account permissions
are required independently of installing this package.

## Functions

- `appendToSheet` — Append rows to a Google Sheet range. Always pass a 2D array: [[val1, val2], ...]. Spreadsheet ID + range are passed at runtime.
- `getSheetData` — Read values from a Google Sheet range
- `clearSheet` — Clear values in a Google Sheet range. Tip: use a range that excludes headers (e.g. Sheet1!A2:Z)
- `listSheetTables` — List all structured tables in a Google Sheet. Returns array with tableId (string), name, sheetId, sheetTitle, range (GridRange), a1Range (A1 notation for debugging).
- `appendToTable` — Append rows to a structured Google Sheet table. Pass rows as objects keyed by column name: [{ Provider: 'X', Amount: 100 }, ...]. Column names must match table headers exactly. Use listSheetTables to find tableId. Formula detection: strings starting with '='.
- `getTableData` — Read all data rows from a structured Google Sheet table. Returns rows as objects with column names as keys. Each row includes _rowIndex for updates. Use listSheetTables to find tableId.
- `updateTableRow` — Update specific columns in a row of a Google Sheet table. Use _rowIndex from getTableData. Pass updates as { columnName: newValue }.

## Example action

```typescript
return await googleSheets.getSheetData({ spreadsheetId: "your-spreadsheet-id", range: "Sheet1!A1:D20" });
```

Use named argument objects. Exact parameters and return types are in the release catalogue and the project tool contract.
