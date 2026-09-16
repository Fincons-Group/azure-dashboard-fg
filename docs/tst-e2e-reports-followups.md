# tst-e2e follow-ups for the Test Suites hub

Companion to [e2e-firebase-integration-plan.md](./e2e-firebase-integration-plan.md) (which covers the
`e2eRuns` / E2E History page). This one covers what's still missing on the **`tst-e2e`** side for the
NRT/A11Y/DAST Test Suites hub (`TestSuitesPage.tsx`, `GET /api/test-suites`,
`src/firebaseTestSuitesData.ts` in this repo).

Everything below lives in the `tst-e2e` repo, not this one. `azure-dashboard-fg`'s side is either
already done or noted as "done here" per item.

## 1. Real CI publish pipeline (the big one)

Today the only thing writing to Firestore is `scripts/publish-local-test-runs.js` in this repo, run by
hand against a local checkout - explicitly a stopgap (see its own header comment) that writes to
`testSuiteRunsLocal`, never the collection real CI should use.

- [ ] Add a step to `tst-e2e`'s CI pipeline, run after NRT/A11Y/DAST finish (**always**, even on
      failure - same requirement as e2eRuns), that builds one Firestore document per run in the same
      shape `TestSuiteRun` expects (`src/types.ts` in this repo / `client/src/types.ts` - keep both in
      sync, see their "mirror" comments).
- [ ] Write to a real `testSuiteRuns` collection (not `-Local`). Once this exists,
      `src/firebaseTestSuitesData.ts`'s `COLLECTION` constant in this repo should switch to read from
      it instead of (or in addition to - see open question below) `testSuiteRunsLocal`.
- [ ] Store `FIREBASE_SERVICE_ACCOUNT_JSON` as a CI secret, never a repo file - same handling as
      Part C of the e2e-history plan.
- [ ] **Also upload each run's report file(s) to Firebase Storage as part of this step** and set
      `reportUrl`/`reportUrlIt` on the document (see §2 for exactly which files). Skipping this means
      every report link 404s outside a machine with `TEST_SUITES_REPORTS_DIR` set locally - see §2 for
      the same upload logic already built here for the local stopgap script; CI should do the same
      thing, just from the pipeline instead of a laptop.
- [ ] **No opt-in flag needed here, unlike the local script.** `azure-dashboard-fg`'s
      `PUBLISH_REPORTS_TO_FIREBASE` env var only gates the local stopgap script on someone's laptop
      (real quota usage from a manually-run command that could misfire) - it has no reach into this
      repo's CI and can't gate it. Once this pipeline step exists it should just run unconditionally,
      same "always run, even on failure" pattern as `e2eRuns` in the other plan doc - CI runs are
      deterministic and intentional, they don't need a confirmation gate the way a copy-pasted local
      command does.

**Open question for whoever owns this:** once real CI is publishing, should
`publish-local-test-runs.js` and `testSuiteRunsLocal` be deleted outright (per its own comment: "Delete
both scripts and this var once CI is publishing for real"), or kept around as a manual-testing escape
hatch? If kept, `firebaseTestSuitesData.ts` would need to read/merge both collections instead of just
one - not done, since it adds real complexity for a use case (testing against fake data) that may not
be worth keeping once CI is real.

## 2. Report upload scope - what to upload, what to skip

Confirmed against a real local run: report folders carry a lot that shouldn't be uploaded.

| Suite | Upload | Skip | Why |
|---|---|---|---|
| NRT | `smart-report.html` + `smart-report.pdf` + `smart-report-dark.pdf` + `smart-report-minimal.pdf` (~9.4MB total) | `data/` (103MB), `trace/` + `traces/` (100MB+) | `smart-report.html` embeds almost everything inline (94 base64 refs vs. Playwright's own `index.html` at only 3) - it degrades gracefully without the trace/data folders. Only the video-attachment deep-links break, which point at local `file://` paths regardless and were never viewable remotely anyway. |
| A11Y | `a11y/index.html` | n/a - it's the only file | Single self-contained file, no sibling assets. |
| DAST | Both ZAP reports (English ~3.3MB, Italian ~135KB) | n/a | See §3 - these two are not interchangeable, upload both. |

This exact scope (NRT + A11Y) is already built in `scripts/publish-local-test-runs.js` in this repo,
gated behind `PUBLISH_REPORTS_TO_FIREBASE=true` in `.env` - CI's version of the upload step should
follow the same scope.

## 3. DAST: needs a structured summary, not just the two HTML files

`buildDastRuns()` in `publish-local-test-runs.js` currently returns `[]` - deliberately, per its own
comment: *"ZAP only produces HTML reports here (no JSON summary), so there's nothing structured to
parse into a DastRunDetail yet without scraping the HTML - left out rather than faked."* That
boundary is intentional and hasn't been crossed here (see §5 - no DAST upload was added either, since
there'd be no run document to attach a `reportUrl` to).

- [ ] Have the ZAP step emit a JSON summary alongside the HTML reports - endpoints scanned, risk score,
      and alert counts/list matching `DastRunDetail` in `src/types.ts` (`endpointsScanned`, `riskScore`,
      `high`/`medium`/`low`/`informational`, `alerts: [{ risk, title, target }]`). ZAP's own report
      generator can usually emit JSON alongside HTML in the same run - check the automation config for
      whatever currently only requests the two HTML formats.
- [ ] Once that JSON exists, `buildDastRuns()` here can be extended to parse it (mirroring
      `buildNrtRuns()`/`buildA11yRuns()`) and upload the two report files with real stats attached - at
      that point this becomes a change in `azure-dashboard-fg`, not `tst-e2e`.

## 4. Italian ZAP report: confirmed real gap, needs a decision

Checked both real report files line-by-line (not assumed): the Italian report has complete
description/evidence/solution/CWE-reference content **per alert type**, but for any alert type with
more than one occurrence it shows exactly one representative URL and says so explicitly in the page
text - e.g. *"Istanza rappresentativa mostrata: il conteggio reale è 11"* ("representative instance
shown, real count is 11"). The English report enumerates every instance.

For header/CSP/cookie/CORS-type findings (most of what's in this scan) that's a non-issue, since the
fix is one site-wide config change regardless of how many pages got flagged. It matters for anything
where instances genuinely differ per page (e.g. confirming no additional vulnerable library versions
turn up elsewhere, or checking each disclosed value individually).

Pick one:
- [ ] **Do nothing, document the tradeoff** - Italian stays a summary, English stays canonical for
      remediation. Cheapest option; the label change in §5 already reflects this in the UI.
- [ ] **Change the ZAP Italian report template/config** to enumerate every instance instead of one
      representative sample, so both reports carry equivalent detail. Real work in whatever generates
      the `-IT-` report in the ZAP step.

## 5. Already done here (azure-dashboard-fg)

No action needed on these - listed so this doc doesn't duplicate what's already shipped:

- `GET /api/test-suites` + `src/firebaseTestSuitesData.ts` reading `testSuiteRunsLocal` (v0.7.0).
- `TestSuitesPage.tsx` reads real Firestore data instead of the deleted mock file, with proper
  loading/error/"not configured" states.
- `TestSuiteRun.reportUrl`/`reportUrlIt` fields added (optional, preferred over the local
  `TEST_SUITES_REPORTS_DIR` static-file fallback when present).
- `scripts/publish-local-test-runs.js` uploads NRT + A11Y report files to Firebase Storage and sets
  `reportUrl`, gated behind `PUBLISH_REPORTS_TO_FIREBASE=true` (separate opt-in from
  `E2E_LOCAL_PUBLISH`, since this one has real storage-quota cost, not just a safety confirmation).
- "Open report (IT)" button relabeled to make clear it's a summary, not an equivalent alternate to the
  English report (see §4).
