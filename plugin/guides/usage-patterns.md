# Google Sheets Plugin — Usage Patterns

This plugin (`google-sheets`) owns the shared "Connect Google" OAuth flow used
by both `google-sheets` and `google-tasks`. Connecting once (via the
Credentials tab "Connect Google" button in the dashboard) stores a single
`google-oauth` credential whose granted scopes cover Sheets + Tasks.

Gmail is a restricted scope and lives in the separate `gmail` plugin (BYO only).

## Working with Sheets

- Always use `getSheetHeaders` before `appendToSheet` to verify column order
- Sheets are addressed by `spreadsheetId` (from URL) and `range` (e.g. "Sheet1!A:Z")
- For large datasets, use `batchUpdateSheet` rather than row-by-row calls
- The first row of your range is assumed to be headers when appending

## Composing with gmail

A common invoice-processing pattern reads invoices from Gmail (gmail plugin) and
writes them to Sheets (this plugin). This requires a BYO client whose granted
scopes cover Gmail + Sheets (the first-party client does not include Gmail):

```
getMessages({ query: "subject:invoice newer_than:7d" })   // gmail plugin
  → evalStructured(emailBody, invoiceSchema)
  → appendToSheet(spreadsheetId, range, rows)            // google-sheets plugin
```
