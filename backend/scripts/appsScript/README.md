# Internal Dashboard — Apps Script setup

Live data source for the Internal Dashboard: a **standalone** Google Apps
Script Web App (not bound to any spreadsheet, and deliberately never uses
DriveApp — see below), same request/response contract as Meta Automation
(`META_AUTOMATION_WEBAPP_URL` / `META_AUTOMATION_API_KEY`).

Two separate scripts, two separate Apps Script projects:

- **`InternalDashboardSheets.gs`** — the one you deploy as a public Web App.
  Only uses `SpreadsheetApp`. This is what the backend calls on every
  dashboard load.
- **`BootstrapBrandSheetMapping.gs`** — run manually from the Apps Script
  editor whenever the brand roster changes. Uses `DriveApp` to find each
  client's spreadsheet by name. Never deployed as a web app.

## Why two scripts (debugged 2026-09-15)

A first attempt put both in one project. The moment `DriveApp`'s scope got
authorized (via the one-time consent flow), the deployment's "Anyone" access
broke completely — for every action, including a trivial `ping` that
touches no Google service at all. `doPost()` kept completing successfully
server-side (visible in the Apps Script **Executions** log, every time) but
the HTTP response was never deliverable to any caller — curl, Node `fetch`,
and even a logged-in browser console all got back a generic Google Drive
"cannot open file" page instead of the real JSON. A brand-new standalone
project with the identical `doPost` logic but no `DriveApp` reference at all
worked immediately and has stayed reliable since. Conclusion: Google
restricts anonymous ("Anyone") serving for unverified Apps Script projects
once they hold a Drive scope grant, even for requests that don't touch
Drive. Keeping `DriveApp` confined to a script that's never publicly
deployed avoids the whole class of failure.

## Deploy `InternalDashboardSheets.gs`

1. As the account that should be the read identity for all client Brand
   Tracking sheets (it needs every one of those ~30 files in its own
   "Shared with me" already, since the script reads Sheets as whoever
   deploys it) — go to [script.new](https://script.new) for a fresh
   standalone project.
2. Delete the default `Code.gs` content, paste in `InternalDashboardSheets.gs`.
3. Edit `API_KEY` to a random string (e.g. `openssl rand -hex 32`).
4. **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the `/exec` URL from the deployment dialog.
6. Set in `backend/.env` (and the Vercel project's env vars for production):
   ```
   INTERNAL_DASHBOARD_SHEETS_WEBAPP_URL=<the /exec URL>
   INTERNAL_DASHBOARD_SHEETS_API_KEY=<the same random string as API_KEY>
   ```

## Bootstrap the brand → spreadsheet mapping

1. In a **different** standalone project (script.new again — keep this
   completely separate from the deployed one above), paste
   `BootstrapBrandSheetMapping.gs`.
2. Set `ROSTER_SPREADSHEET_ID` to the master roster spreadsheet's ID (from
   its URL: `docs.google.com/spreadsheets/d/<ID>/edit`).
3. In the function dropdown next to **Run**, select `resolveBrandSheets`,
   click **Run**. First time, approve the Drive authorization prompt
   (Review permissions → Advanced → Go to [project] (unsafe) → Allow) —
   this project is never deployed as a web app, so authorizing Drive here
   is safe.
4. It writes one row per brand into a new "ATLAS Brand Sheet Mapping" tab in
   the roster spreadsheet. Re-run whenever the roster changes.
5. Set `MASTER_ROSTER_SPREADSHEET_ID` in `backend/.env`, then run:
   ```
   node scripts/mapBrandSheets.js            # dry run
   node scripts/mapBrandSheets.js --commit   # writes brand_sheet_sources
   ```
   This reads the mapping tab through the deployed (safe) web app's
   `getSheetValues` action, not Drive directly.

## Verify the deployed web app is working

```
curl -X POST "$INTERNAL_DASHBOARD_SHEETS_WEBAPP_URL" \
  -H "Content-Type: text/plain" \
  -d '{"action":"ping","apiKey":"<your key>"}'
```
Expect `{"ok":true,"data":{"pong":true,"time":"..."}}`.

## Redeploying after editing the script

Apps Script Web App URLs are versioned — editing the code in the editor does
NOT update the live `/exec` URL. Use **Deploy → Manage deployments → (pencil
icon) → Version: New version → Deploy** to push code changes to the existing
URL, or the URL changes and every env var needs updating again.
