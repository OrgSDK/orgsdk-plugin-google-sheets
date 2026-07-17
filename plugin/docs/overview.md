# Google Sheets

Read and write Google Sheets from agent workflows. Owns the shared **"Connect
Google"** OAuth flow used by both `google-sheets` and `google-tasks`, and
supports one-click first-party connection when the relay holds OrgSDK's client.

## What it does

The `google-sheets` plugin turns a spreadsheet into a structured read/write
target for agents. Two access models are supported:

- **Range mode** — classic `Sheet1!A:Z` read/append, headers inferred from the
  first row.
- **Tables mode** — Google Sheets Tables (typed, named tables) for row-level
  get / update.

Typical uses:

- **Reporting sink** — write a summary row after each workflow run.
- **CRM sync** — append extracted contacts/entities to a shared sheet.
- **Invoice pipeline** — read invoices from Gmail (the `gmail` plugin), extract
  fields with `evalStructured`, and append rows here.

## Functions

| Function | Purpose |
|---|---|
| `getSheetData` | Read a range as rows. |
| `appendToSheet` | Append rows to a range (first row = headers). |
| `clearSheet` | Clear a range. |
| `listSheetTables` | List named tables in a spreadsheet. |
| `getTableData` | Read rows from a named table. |
| `appendToTable` | Append rows to a named table. |
| `updateTableRow` | Update a single row in a named table by index. |

The full function list (parameters, return types) is available per-plugin via
the `plugins:info` command in the dashboard.

## Credentials

Every function declares `requiredCredentials: ["google-oauth"]`, so a Google
credential must be connected before any function is callable. This plugin
owns the connect flow — connecting once stores a single `google-oauth`
credential whose granted scopes cover **Sheets + Tasks** (the `google-tasks`
plugin shares it; no second connect needed).

| Provider | Type | Connect method |
|---|---|---|
| `google-oauth` | oauth2 | **One-click "Connect Google"** when the relay has OrgSDK's first-party client configured; otherwise supply your own OAuth client JSON (BYO). |

> **BYO always wins.** If you've supplied your own Google OAuth client, it is
> used in preference to the first-party client. The relay-held client secret
> never reaches a tenant database or daemon container.

## Using it in a workflow

```typescript
// Append report rows (range mode — first row must be headers)
await appendToSheet({
  spreadsheetId: "1Abc...xyz",        // from the sheet URL
  range: "Sheet1!A:Z",
  rows: [
    ["2026-07-09", "signup", 42],
    ["2026-07-09", "churn", 3],
  ],
});

// Read typed rows from a named table
const table = await getTableData({
  spreadsheetId: "1Abc...xyz",
  tableId: "contacts",
});
```

## Composing with other plugins

A common invoice pipeline reads from Gmail, extracts with the LLM plugin, and
writes here. This requires a **BYO** client whose granted scopes cover Gmail +
Sheets (the first-party client does not include Gmail):

```
getMessages({ query: "subject:invoice newer_than:7d" })   // gmail plugin
  → evalStructured(emailBody, invoiceSchema)                // llm plugin
  → appendToSheet(spreadsheetId, range, rows)            // google-sheets plugin
```

## Notes

- Always call `getSheetHeaders`/`getSheetData` before appending to
  verify column order.
- For large datasets, prefer `appendToTable` (batch) over row-by-row.
- Gmail is a restricted scope and lives in the separate `gmail` plugin (BYO
  only) — see that plugin's overview.
