Deploying the KTA agent (recommended: Render or Heroku)

Overview
- This Node/Express app exposes `/api/chat` (public read) and `/api/enroll` (write-protected).
- The app reads/writes Google Sheets using a service account.

Required environment variables
- `GOOGLE_SHEET_ID` — your Google spreadsheet ID.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — JSON content of a service account with Editor access to the sheet (or set `GOOGLE_APPLICATION_CREDENTIALS` to a keyfile path).
- `ADMIN_API_KEY` — a strong random string used to protect write operations.
- Optional: `GOOGLE_SHEET_TABS`, `GOOGLE_SHEET_REFUND_TAB`, `GOOGLE_SHEET_ENROLLMENTS_TAB`.

Prepare Google Sheet
1. Create your Google Sheet with tabs: `Subjects Fees`, `Enrollments`, `Policy`, `Refunds` (names are configurable).
2. Share the spreadsheet (Edit) with the service account email from the key.

Deploy on Render (quick)
1. Create a new Web Service. Connect your GitHub repo or upload the code.
2. Set the start command to: `node server.js`.
3. Add the environment variables listed above in the service settings.
4. Deploy. Render provides HTTPS URL; use that in your frontend widget as `WEBHOOK_URL`.

Heroku automatic deploy (GitHub Actions)

- Create a Heroku app (`heroku create <app-name>` or via dashboard).
- In your GitHub repository settings -> Secrets, add:
  - `HEROKU_API_KEY` — your Heroku API key
  - `HEROKU_APP_NAME` — the Heroku app name
  - `HEROKU_EMAIL` — your Heroku account email
- The repository already contains a workflow at `.github/workflows/deploy-heroku.yml` which runs tests and deploys to Heroku when you push to `main` or `master`.
- The repo includes a `Procfile` so Heroku will run `node server.js`.

Render one-click sample

- This repo includes a `render.yaml` manifest which you can import into Render as an infrastructure-as-code service definition. To create the service from the manifest:
  1. In Render dashboard choose "New -> Import from GitHub" and point to this repo.
 2. Alternatively, use the "Create a new service" flow and choose Docker, set the Dockerfile path to `Dockerfile`, build command `npm ci`, start command `node server.js`.
 3. Add required environment variables to Render service settings (`GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `ADMIN_API_KEY`, etc.).

Notes and next steps
- Do not store `ADMIN_API_KEY` in client-side code. Use server-side secrets and a backend admin UI for secure writes.
- If you want, I can add a GitHub Actions workflow to deploy to Render via its API (requires `RENDER_API_KEY`), or prepare a `docker-compose.yml` for local development. Which would you prefer?

Render: creating API key and finding your Service ID

1. Create a Render API key
   - Open Render dashboard, click your avatar (top-right) -> Account -> API Keys.
   - Click "Create Key" -> give it a name like `github-actions` -> copy the generated key.

2. Find your Render Service ID
   - Open the Render dashboard and select the service you created for this app.
   - In the service's Settings page look for the "Service ID" (or check the URL — the dashboard contains the service identifier). If you don't see it, you can list services with the API:

```bash
curl -H "Authorization: Bearer <RENDER_API_KEY>" \
  https://api.render.com/v1/services
```

Look for the object matching your app and copy its `id` field — that's the `RENDER_SERVICE_ID`.

3. Add GitHub secrets (two options)

- Using GitHub CLI:

```bash
gh secret set RENDER_API_KEY --body "<your_render_api_key>"
gh secret set RENDER_SERVICE_ID --body "<your_render_service_id>"
```

- Using GitHub UI:
  - Repo -> Settings -> Secrets and variables -> Actions -> New repository secret.
  - Add `RENDER_API_KEY` with the API key value, and `RENDER_SERVICE_ID` with the service id.

After adding these secrets the action `.github/workflows/deploy-render-action.yml` will trigger on pushes to `main`/`master`.

Optional: one-step helper script

There's a helper script at `scripts/trigger_deploy.sh` that will initialize git (if needed), add a remote (if you pass `--remote`), commit, push, and set the three GitHub secrets using the `gh` CLI. Example:

```bash
# export values in the environment, then run the script
export RENDER_API_KEY="<your_render_api_key>"
export RENDER_SERVICE_ID="<your_render_service_id>"
export ADMIN_API_KEY="<your_admin_api_key>"
./scripts/trigger_deploy.sh --remote git@github.com:yourusername/yourrepo.git --branch main
```

The script requires `git` and the GitHub CLI `gh` (authenticated). It must be run locally.

Security notes
- NEVER embed `ADMIN_API_KEY` in public client code. Use the key only in server-to-server calls, or keep the enrollment flow behind a protected admin UI.
- If you want public sign-ups via the chat widget, the safest pattern is:
  1. Collect student enrollment intent in the public widget.
  2. Pass the enrollment to a backend you control (same domain) that validates CAPTCHA and rate-limits.
  3. That backend calls `/api/enroll` with `x-api-key`.

Updating the sheet manually
- Use `scripts/update_refunds.js` to edit an uploaded XLSX and produce `KTA Database.updated.xlsx`.

Questions
- If you want, I can prepare a Dockerfile and a sample `docker-compose.yml` next, and add CI deploy steps for GitHub Actions. Do you want that?"}