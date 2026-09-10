# E2E Results via Firebase — Setup Plan

Goal: `tst-e2e` (Playwright + SmartReport) writes test-run results to Firebase; `azure-dashboard-fg` reads them and displays trend charts, without introducing a new public ingest endpoint or exposing Firebase to the browser.

Do the parts **in order** — each has a checkpoint before moving to the next.

## Part A — Firebase project setup (console only, ~15 min)

1. Firebase console → create a new project (e.g. `azure-dashboard-e2e-reports`). Skip Google Analytics.
2. **Build → Firestore Database → Create database** → Production mode → pick a region.
3. **Firestore → Rules** → paste and Publish:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```
   This blocks all direct browser/client access. Only the two backends (via `firebase-admin`, using the service-account key) should ever touch Firestore.
4. **Project Settings (gear icon) → Service accounts → Generate new private key.** Downloads one JSON file. This file is the password to the whole database — treat it like a secret, not a config file.

**Do not:** commit the JSON key to either repo, paste it into Slack/email, or log its contents. If it ever leaks, regenerate it from this same screen — the old key stops working immediately.

## Part B — Data shape (notes only)

One Firestore collection, `e2eRuns`, one document per CI run:

```
runId, branch, commitSha, startedAt, finishedAt,
totalTests, passed, failed, skipped, flaky, durationMs, reportUrl
```

Keep it flat for v1 — no per-test subcollections yet. Can be extended later without breaking existing documents.

## Part C — `tst-e2e`: write results after each run

1. `npm install firebase-admin` in `tst-e2e`.
2. Store the JSON key as a **CI secret** (Azure Pipelines: secure file, or a pipeline variable holding the JSON as text) — never as a file in the repo.
3. Add a script that runs after Playwright/SmartReport finishes (even on failure): reads the results summary, builds one `e2eRuns` document (Part B shape), initializes `firebase-admin` from the secret at runtime, writes it with `.set()`.
4. Wire the script into the pipeline as an "always run" step, so failed runs get recorded too.

**Do not:** run this script from a laptop against the real project to test it — use the Firestore emulator (`firebase emulators:start --only firestore`) or a separate throwaway dev project instead, so a stray local run can't pollute production history.

**Checkpoint:** trigger one CI run, then check the Firebase console under Firestore → `e2eRuns` for a new document. Don't proceed until it's there.

## Part D — `azure-dashboard-fg`: read results and display them

1. `npm install firebase-admin`.
2. Store the same service-account JSON as a server-side secret (env var, same pattern as `AZDO_PAT`) — never in `client/`, never shipped to the browser.
3. Add one route, e.g. `GET /api/automation/e2e-history`, on the existing Express server. Because it's just another route on the same app, it's automatically covered by the PAT gate already in front of every handler ([src/server.ts:56-71](../src/server.ts#L56-L71)) — no new auth logic needed. It queries Firestore server-side and returns JSON.
4. Build a page/tab reusing the pattern from `AutomationKpiPage.tsx` / `AutomationKpiCharts.tsx` to chart pass-rate and flaky-test trends over time.

**Do not:** put Firebase client config (`apiKey`, `projectId`, etc.) into the React frontend and query Firestore directly from the browser. That would bypass the PAT gate entirely — Firebase auth has nothing to do with the ADO PAT check. Firebase stays strictly server-to-server on both sides.

## Part E — Security checklist

- Never commit the service-account JSON. Add its filename to `.gitignore` in both repos as a backstop.
- Never let the browser hold Firebase credentials or talk to Firestore directly.
- Never log the key's contents.
- Skip trying to make a "read-only" vs "write-only" key pair for v1: Firebase's Admin SDK ignores Firestore rules and has full project access regardless of which key is used — real scoping needs custom IAM roles in Google Cloud, which is unnecessary complexity here. One key, kept secret in two places (tst-e2e's CI secrets, this app's server env), is a fine starting point.

## Suggested execution order

1. Part A → confirm rules published.
2. Part C steps 1-4 → confirm one document lands in Firestore.
3. Part D steps 1-3 → confirm `curl` (with the PAT header) on the new route returns that document.
4. Part D step 4 → build the chart.
