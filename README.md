# MailMate

MailMate is an interactive email-triage demo built with Three.js, vanilla JavaScript, and Vite. It sorts a 26-message test inbox into five buckets, extracts deadlines and next actions, drafts replies, and requires explicit human approval before simulating a send.

**Triage runs in the browser.** There is no mailbox connection and no network uploads. Classification, search, summaries and replies run locally. An optional local FastAPI service stores human feedback in SQLite and handles manual retraining; when it is not running, the triage demo still works and feedback reports that the service is offline instead of pretending to save.

## What it does

- Sorts messages into Important, Academic, Internship, Personal, and Spam
- Extracts deadlines from natural-language date cues
- Pulls out next actions and creates reminders
- Drafts editable replies using the sender name, action, and deadline
- Trains a TF-IDF + multinomial logistic regression classifier in the browser and shows its probability for every bucket
- Scores sentiment, urgency, and a transparent priority rank with visible factors
- Searches by meaning with TF-IDF vectors instead of exact keywords
- Summarises long messages and recommends related mail
- Groups conversations into threads with an on-device summary, participants, timeline, interview slot and preparation actions
- Rewrites a reply in warm, concise, or formal tone
- Generates a daily brief with a ranked focus list and a plan
- Requires a checked consent box before every simulated send
- Logs sends on the page only; no email leaves the browser
- Imports JSON or CSV files locally through the File API
- Includes filter, search, reminder, reset, and mobile detail-overlay flows
- Renders a live Three.js sorting-table scene with a static fallback when WebGL is unavailable
- Collects human-in-the-loop feedback: confirm a bucket or send the correct one, then review analytics, export CSV and retrain manually

## On-device AI

The AI layer is real, small, and fully local. Nothing is pre-computed and no request leaves the page.

- **Classifier:** TF-IDF + multinomial logistic regression trained at runtime from 125 labelled examples in `src/lib/ai-training.js`.
- **Evaluation:** 5-fold cross-validation reports 93.6% accuracy and 93.5% macro F1. The numbers come from the bundled examples, not from a claim.
- **Search:** TF-IDF vectors with cosine similarity, so "budget forecast" finds the finance mail even without an exact keyword match.
- **Signals:** lexicon-based sentiment and urgency, extractive summaries, priority scoring with visible point factors, and nearest-neighbour related mail.
- **Threads:** messages sharing a `thread_id` are grouped and ordered by timestamp. The summary combines the classifier label, sentiment and extractive summaries of the real messages, and reports the engine used.
- **Generation:** template-based tone rewrites. The deterministic keyword classifier stays the primary bucket; the model runs alongside it and reports agreement and confidence.

Open the **AI** section in the page to inspect the model card, live cross-validation metrics, and a classifier playground.

## Human-in-the-loop feedback

Each classified message has two feedback actions: **Correct prediction** and **Incorrect prediction**. Choosing the incorrect one asks for the right bucket (Important, Academic, Internship, Personal, or Spam). Feedback stores the email ID and subject, the original prediction, the corrected category, the original confidence, the model version, and a timestamp.

The **Feedback** button in the app bar opens the analytics dashboard: total submissions, corrected predictions, user agreement rate, most-corrected categories, recent feedback, CSV export, manual retraining, and model version history.

Important rules the implementation keeps:

- **User agreement is not model accuracy.** Agreement is `correct feedback / total feedback`, a human review signal. Model accuracy is measured separately on a fixed labelled holdout and labelled as such.
- **Corrections never retrain automatically.** Saving feedback only writes a database row.
- **Retraining is manual and admin-only.** An administrator approves individual feedback rows, then explicitly starts a retrain. The new model is stored as an inactive candidate with its own evaluation. It becomes active only after a separate activation action.
- **Nothing is fabricated.** When the service is unreachable the dashboard says so and shows no invented analytics.

> The original project had no Python backend and no scikit-learn pipeline — the classifier was, and still is, hand-written JavaScript in `src/lib/ml.js`. The feedback service therefore uses an equivalent TF-IDF + logistic-regression pipeline in scikit-learn. The browser classifier and all existing triage behaviour are untouched.

### Run the feedback service

```bash
python -m pip install -r backend/requirements.txt
npm run api
```

The API listens on `http://127.0.0.1:8000`. The Vite dev server proxies `/api` to it, so `npm run dev` plus `npm run api` is all you need. The database and model artifacts are created under `backend/data/` and are git-ignored.

Admin actions use an `X-Admin-Token` header. The development default is `mailmate-admin-dev`; set `MAILMATE_ADMIN_TOKEN` to change it. The dashboard's token field is only used for approval, retraining and activation.

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service status, active model and feedback count |
| `POST` | `/api/feedback` | Save correct/incorrect feedback |
| `GET` | `/api/feedback` | List recent feedback |
| `POST` | `/api/feedback/{id}/approve` | Approve one row for training (admin) |
| `GET` | `/api/analytics` | Feedback analytics plus separate model metrics |
| `GET` | `/api/feedback/export` | Download approved feedback as CSV |
| `GET` | `/api/model/current` | Active model version |
| `GET` | `/api/model/versions` | Model version history |
| `POST` | `/api/model/retrain` | Train an inactive candidate from approved feedback (admin) |
| `POST` | `/api/model/{version}/activate` | Activate a stored version (admin) |

The initial `v1` model is trained from the same 125 labelled examples in `src/lib/ai-training.js`, split deterministically into 100 training and 25 held-out examples. The holdout is fixed across versions so metrics stay comparable.

## Stack

- [Vite](https://vite.dev/)
- [Three.js](https://threejs.org/)
- Vanilla JavaScript and modular CSS
- [FastAPI](https://fastapi.tiangolo.com/), SQLAlchemy, SQLite and scikit-learn for the optional feedback service
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
npm run test:api
```

`npm test` covers classification, deadline and action extraction, reply drafting, reminders, JSON/CSV import validation, and the AI layer: model training and metrics, predictions, sentiment, summaries, priority scoring, semantic search, related mail, tone rewrites, and the daily brief.

`npm run test:api` runs the Python API and database suite against an isolated SQLite file per test. It checks required-field persistence, validation, analytics, approval, CSV export, admin authorization, manual retraining with only approved feedback, candidate evaluation, activation, and version history.

## Motion

The interface uses a small CSS and vanilla-JavaScript motion layer in `src/lib/motion.js` and `src/styles/motion.css`: scroll reveals, a scroll-progress bar, pointer spotlights on cards, staggered message rendering, a detail-pane swap, animated probability bars, and modal entrances. All motion is opt-in: `html.has-motion` is added only after the observers are wired, so content stays visible if scripts fail. `prefers-reduced-motion: reduce` disables the effects.

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
src/ui/inbox-demo.js    Inbox state, approvals, reminders, imports, AI controls
src/lib/triage.js       Classification, extraction, drafting logic
src/lib/ai.js           TF-IDF + logistic regression, sentiment, priority, search, summaries, brief
src/lib/ai-training.js  Labelled examples for the on-device classifier
src/lib/dataset.js      JSON/CSV parsing and validation
src/lib/feedback.js     Client for the local feedback service
src/lib/motion.js       Scroll reveals, progress bar, spotlights and value pulses
src/styles/             Design tokens, section styles and the motion layer
public/                 Test inbox, sample CSV, favicon
tests/                  Node unit tests
backend/app/            FastAPI routes, SQLAlchemy models, scikit-learn pipeline
backend/tests/          API and database tests
backend/data/           Local SQLite database and model artifacts (git-ignored)
```

## Demo disclaimer

MailMate is a portfolio prototype, not a mail service. Approval is simulated, sends are logged only on the page, and no data leaves your machine. The bundled inbox and the upload parser are deterministic and offline. Feedback is stored only in the local SQLite file created by the optional FastAPI service.

## License

MIT
