# KTA Agent

This project provides a local Node.js agent that reads data from Google Sheets and answers user questions about fees, refunds, subjects, and admissions.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure Google Sheets access:
   - Set `GOOGLE_SHEET_ID=1WmfGrZ5f6_QxWGPEbZP5ePAbkD9FIEy_-UxPXB3f0DA`
   - Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of your Google service account JSON file, or set `GOOGLE_SERVICE_ACCOUNT_JSON` to the JSON contents.

3. Start the server:
   ```bash
   npm start
   ```

4. Open `kta-chat-widget.html` in a browser and chat with the endpoint.

## Environment variables

Create a `.env` file or set these values in your environment:

```env
PORT=3000
GOOGLE_SHEET_ID=1WmfGrZ5f6_QxWGPEbZP5ePAbkD9FIEy_-UxPXB3f0DA
GOOGLE_SHEET_RANGE=A:Z
GOOGLE_SHEET_TABS=Subjects Fees,Enrollments,Policy
# GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
# or
# GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account", ...}
```

The agent will fetch data from the sheet tabs named `Subjects Fees`, `Enrollments`, and `Policy`. If you use different tab names, set `GOOGLE_SHEET_TABS` to a comma-separated list matching your Google Sheet tabs.

## Sheet tab structure

Use headers in each tab so the agent can match your rows reliably. For example:

- `Subjects Fees` tab:
  - `Question`, `Answer`, `Fee`, `Refund`, `Policy`
- `Enrollments` tab:
  - `Question`, `Answer`, `Admission`, `Registration`, `Batch`
- `Policy` tab:
  - `Question`, `Answer`, `Policy`, `Refund Policy`, `Terms`
  - or if you prefer a single note, leave one text cell in `Policy` and the agent will use that text for refund/policy queries.

The agent looks for common header names like `response`, `answer`, `reply`, `refund`, `fee`, and `policy`.

## API

- `POST /api/chat`
  - Body: `{ "message": "...", "sessionId": "..." }`
  - Response: `{ "reply": "...", "sourceTab": "Subjects_Fees|Enrollments|Policy|fallback" }`

- `GET /health`
  - Response: `{ "ok": true, "sheetIdConfigured": true|false }`

## Notes

- The agent uses Google Sheets data when the sheet ID and credentials are configured.
- If the sheet is not configured, the agent returns a fallback message and still works locally.

