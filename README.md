# MailMate

MailMate is an interactive email-triage demo built with Three.js, vanilla JavaScript, and Vite. It sorts a 24-message test inbox into five buckets, extracts deadlines and next actions, drafts replies, and requires explicit human approval before simulating a send.

**Everything runs in the browser.** There is no mailbox connection, backend, analytics, or network upload.

## What it does

- Sorts messages into Important, Academic, Internship, Personal, and Spam
- Extracts deadlines from natural-language date cues
- Pulls out next actions and creates reminders
- Drafts editable replies using the sender name, action, and deadline
- Requires a checked consent box before every simulated send
- Logs sends on the page only; no email leaves the browser
- Imports JSON or CSV files locally through the File API
- Includes filter, search, reminder, reset, and mobile detail-overlay flows
- Renders a live Three.js sorting-table scene with a static fallback when WebGL is unavailable

## Stack

- [Vite](https://vite.dev/)
- [Three.js](https://threejs.org/)
- Vanilla JavaScript and modular CSS
- Locally bundled Bricolage Grotesque, Geist, and Geist Mono fonts

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Build and preview

```bash
npm run build
npm run preview
```

## Tests

```bash
npm test
```

The unit suite covers classification, deadline and action extraction, reply drafting, reminders, and JSON/CSV import validation.

## Import format

Upload a `.json` or `.csv` file (up to 2 MB and 300 messages). Each message needs a sender, subject, and body.

```json
[
  {
    "from": { "name": "Priya Raman", "email": "priya.raman@example.com" },
    "subject": "Budget forecast: numbers due Friday",
    "body": "The Q4 forecast needs your revised numbers by Friday 20 November at 5pm.",
    "receivedAt": "2026-11-15T07:42:00Z"
  }
]
```

CSV supports `from` or the separate `fromName` / `fromEmail` columns, plus `subject`, `body`, `receivedAt`, and `id`. Sample files are included in `public/`.

## Project structure

```
index.html              Page markup and dialogs
src/main.js             Navigation, scene lifecycle, pipeline tabs
src/hero/               Three.js sorting-table scene
src/ui/inbox-demo.js    Inbox state, approvals, reminders, imports
src/lib/triage.js       Classification, extraction, drafting logic
src/lib/dataset.js      JSON/CSV parsing and validation
src/styles/             Design tokens and section styles
public/                 Test inbox, sample CSV, favicon
tests/                  Node unit tests
```

## Demo disclaimer

MailMate is a portfolio prototype, not a mail service. Approval is simulated, sends are logged only on the page, and no data is transmitted. The bundled inbox and the upload parser are deterministic and offline.

## License

MIT
