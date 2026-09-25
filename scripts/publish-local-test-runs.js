// Temporary local dev tool: reads a tst-e2e checkout's report output straight
// off disk and publishes it to Firebase, so the Test Suites / E2E History
// pages have real-shaped data to render against before tst-e2e's own CI
// pipeline exists (see docs/e2e-firebase-integration-plan.md Part C and
// docs/tst-e2e-reports-followups.md).
//
// Writes ONLY to the `testSuiteRunsLocal` collection - never the collection
// the real CI pipeline will publish to - so this can never contaminate real
// run history. Run `node scripts/cleanup-local-test-runs.js` to wipe it once
// CI takes over.
//
// Guarded by E2E_LOCAL_PUBLISH=true so `node scripts/publish-local-test-runs.js`
// never fires by accident (e.g. copy-pasted into the wrong shell).
//
// Usage: E2E_LOCAL_PUBLISH=true node scripts/publish-local-test-runs.js
// Add PUBLISH_REPORTS_TO_FIREBASE=true too to also upload each run's report
// file(s) to Firebase Storage and set reportUrl on the document -
// a separate opt-in since it's real storage-quota usage, not just a safety
// confirmation (see .env.example). Requires the Firebase project to be on
// the Blaze plan.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { warnIfStorageUsageIsHigh } from "./lib/storage-usage.js";

const LOCAL_COLLECTION = "testSuiteRunsLocal";
const PUBLISH_REPORTS = process.env.PUBLISH_REPORTS_TO_FIREBASE === "true";
// Optional allowlist so a laptop with dozens of accumulated local runs under
// reports/json can publish just a handful by id (matching the .json
// filename without its extension) instead of everything sitting there -
// unset (the default) keeps publishing every run found, same as before.
const ONLY_RUN_IDS = process.env.ONLY_RUN_IDS
    ? new Set(process.env.ONLY_RUN_IDS.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

if (process.env.E2E_LOCAL_PUBLISH !== "true") {
    console.error(
        "Refusing to run: set E2E_LOCAL_PUBLISH=true to confirm you want to " +
            "publish local tst-e2e reports to Firebase (collection: " +
            LOCAL_COLLECTION +
            ")."
    );
    process.exit(1);
}

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountRaw) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
    process.exit(1);
}

const reportsDir = process.env.TEST_SUITES_REPORTS_DIR;
if (!reportsDir) {
    console.error(
        "TEST_SUITES_REPORTS_DIR is not set - point it at a tst-e2e checkout's reports/ folder."
    );
    process.exit(1);
}

const tstE2eRoot = path.dirname(reportsDir);

function gitInfo(cwd) {
    try {
        const branch = execFileSync("git", ["branch", "--show-current"], { cwd })
            .toString()
            .trim();
        const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd })
            .toString()
            .trim();
        return { branch, commitSha };
    } catch {
        return { branch: "unknown", commitSha: undefined };
    }
}

const { branch, commitSha } = gitInfo(tstE2eRoot);

// Run-folder ids look like "nrt_20260910_0857_tst_full_core_v1.0" - the 4th
// underscore-separated segment is the environment (tst/pre/prd).
function envFromId(id) {
    const parts = id.split("_");
    return ["tst", "pre", "prd"].includes(parts[3]) ? parts[3] : "tst";
}

// A run pointed at only the a11y/security tag subset (a legitimate local
// check) has zero real domain-tagged NRT tests - nothing to call "bad"
// about, so it reads as "good" rather than a false failure of all-skipped
// setup steps.
//
// Status comes from an actual count of failed tests, not from
// `passed < totalTests` - totalTests also includes skipped tests, which
// aren't failures, so that comparison used to flag any run with even one
// skip (but zero real failures) as "bad".
function nrtStatus(detail) {
    if (detail.totalTests === 0) return "good";
    const failed = (detail.tests || []).filter((t) => t.status === "failed").length;
    if (failed > 0) return "bad";
    if (detail.flaky > 0) return "warn";
    return "good";
}

// Domain tags look like "domain:vit" on each spec (see
// tst-e2e/playwright.config.ts's tag scheme) - falls back to "other" for
// specs that predate tagging or don't carry one.
function specDomain(tags) {
    const tag = (tags || []).find((t) => t.startsWith("domain:"));
    return tag ? tag.slice("domain:".length) : "other";
}

// A11Y/Security specs (tagged type:accessibility/type:security, e.g.
// comparto-step-a11y.spec.ts) execute inside the same Playwright run as the
// NRT specs - see the a11y-chrome project in playwright.config.ts - but
// they're a different suite in this UI (see TestSuiteKey), not an NRT
// domain. Untagged specs (tags: [], e.g. the auth setup) have no type tag
// at all and count as "nrt", since they're real NRT scaffolding, not a
// different suite's tests.
function specType(tags) {
    const tag = (tags || []).find((t) => t.startsWith("type:"));
    return tag ? tag.slice("type:".length) : null;
}

// Which suite (nrt/a11y/security) a spec's results belong to - each kind
// gets published as its own isolated run doc (see buildPlaywrightRuns), even
// when several kinds come from the same Playwright invocation/.json file.
function specKind(tags) {
    const type = specType(tags);
    if (type === "accessibility") return "a11y";
    if (type === "security") return "security";
    return "nrt";
}

// The spec's own ADO test-case-id tag, e.g. "[a11y8952]" or "[8977]" (see
// src/scripts/tmp-mark-automated.ts's tag scheme) - undefined when absent.
function testCaseIdFromTags(tags) {
    const tag = (tags || []).find((t) => /^\[(?:a11y)?\d+\]$/.test(t));
    if (!tag) return undefined;
    const match = tag.match(/(\d+)/);
    return match ? Number(match[1]) : undefined;
}

// Playwright project names here look like "<domain>-chrome" or "a11y-chrome"
// (see playwright.config.ts's per-domain project list) - the browser engine
// is always the last "-"-separated segment. "chrome-setup" (the auth setup
// project) isn't a real browser result and is left as undefined.
const KNOWN_BROWSERS = new Set(["chrome", "chromium", "firefox", "webkit", "edge"]);
function browserFromProjectName(projectName) {
    const parts = (projectName || "").split("-");
    const last = parts[parts.length - 1];
    return KNOWN_BROWSERS.has(last) ? last : undefined;
}

// a11y/security specs (not NRT ones) carry a team: tag naming which product
// they belong to, e.g. "team:front-office-auto-sp1" - the "-spN" suffix is
// a sprint number within that same team, not a different team, so it's
// stripped before mapping to the dashboard's TestAppScope values.
function appFromTeamTag(tags) {
    const tag = (tags || []).find((t) => t.startsWith("team:"));
    if (!tag) return undefined;
    const team = tag.slice("team:".length).replace(/-sp\d+$/, "");
    if (team === "front-office-auto") return "frontOfficeAuto";
    if (team === "plurifonds") return "plurifond";
    return undefined;
}

// Playwright's per-test `status` (on the test object itself, not a result)
// is the aggregated outcome across every retry attempt - "flaky" means it
// failed at least once but passed on a later retry, and counts as passed
// here since that's the real final result. Looking only at results[0], as
// this used to, reports the first (possibly failed-then-retried) attempt
// instead of the true outcome.
function testStatus(test) {
    if (!test) return "skipped";
    if (test.status === "skipped") return "skipped";
    if (test.status === "expected" || test.status === "flaky") return "passed";
    return "failed";
}

// Real wall-clock time spent on a test is the sum of every attempt
// (including retries), not just the first one - a flaky test that failed
// fast then passed on retry still cost the time of both attempts.
function testDuration(test) {
    return Math.round((test?.results || []).reduce((sum, r) => sum + (r.duration ?? 0), 0));
}

// Playwright's JSON reporter puts a failure's message on result.error.message
// (older/simple failures) or result.errors[0].message (newer multi-error
// shape) - message text carries ANSI color codes for terminal output, so
// they're stripped before this ever reaches the dashboard's plain-text UI.
function testErrorMessage(result) {
    const message = result?.error?.message ?? result?.errors?.[0]?.message;
    return typeof message === "string" && message.trim()
        ? message.replace(/\x1b\[[0-9;]*m/g, "").trim()
        : undefined;
}

// The suites tree nests arbitrarily (a top-level suite per spec file, then
// nested suites per describe block) before reaching specs - walk it
// recursively rather than assuming a fixed depth. Collects every spec
// regardless of kind (nrt/a11y/security) - callers filter by kind for
// whichever stats/catalog they're building, see buildNrtRuns below.
function collectTests(suites) {
    const tests = [];
    for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
            const kind = specKind(spec.tags);
            const domain = specDomain(spec.tags);
            const testCaseId = testCaseIdFromTags(spec.tags);
            const app = appFromTeamTag(spec.tags);
            for (const test of spec.tests || []) {
                // The last attempt is the one that determines the final
                // outcome - its error/steps are what's worth showing (an
                // earlier failed attempt's error is stale once a retry
                // passed).
                const results = test.results || [];
                const lastResult = results[results.length - 1];
                const errorMessage = testErrorMessage(lastResult);
                const browser = browserFromProjectName(test.projectName);
                tests.push({
                    title: spec.title,
                    domain,
                    file: suite.file,
                    status: testStatus(test),
                    durationMs: testDuration(test),
                    steps: (lastResult?.steps || []).map((s) => ({
                        title: s.title,
                        durationMs: Math.round(s.duration),
                    })),
                    kind,
                    ...(errorMessage ? { errorMessage } : {}),
                    ...(testCaseId ? { testCaseId } : {}),
                    ...(browser ? { browser } : {}),
                    ...(app ? { app } : {}),
                });
            }
        }
        collectTests(suite.suites).forEach((t) => tests.push(t));
    }
    return tests;
}

// tests here should already be pre-filtered to one kind (see buildNrtRuns) -
// domains are derived straight from that set rather than needing a
// separately-tracked Set.
function buildDomainSummary(tests) {
    const domains = [...new Set(tests.map((t) => t.domain))];

    return domains.sort().map((domain) => {
        const domainTests = tests.filter((t) => t.domain === domain);
        return {
            domain,
            label: domain,
            total: domainTests.length,
            passed: domainTests.filter((t) => t.status === "passed").length,
            flaky: 0,
        };
    });
}

// Friendly display names for the app scopes appFromTeamTag resolves - unlike
// buildDomainSummary's domain codes (no known full-name source anywhere in
// tst-e2e, see appFromTeamTag), the team tag only ever resolves to one of
// these two products, so a real label is known and used instead of
// repeating the raw scope value.
const APP_LABELS = { frontOfficeAuto: "Front Office Auto", plurifond: "Plurifonds" };

// Same shape/idea as buildDomainSummary, grouped by the team: tag's app
// scope instead of domain - only a11y/security tests carry one (see
// appFromTeamTag), so this comes back empty for nrt's own tests, same as an
// old run published before the app field existed.
function buildTeamSummary(tests) {
    const apps = [...new Set(tests.map((t) => t.app).filter(Boolean))];

    return apps.sort().map((app) => {
        const appTests = tests.filter((t) => t.app === app);
        return {
            domain: app,
            label: APP_LABELS[app] ?? app,
            total: appTests.length,
            passed: appTests.filter((t) => t.status === "passed").length,
            flaky: 0,
        };
    });
}

// Uploads one local file to Storage at destPath, left with Storage's default
// private ACL - never made public. The server mints short-lived signed URLs
// on demand instead (see getSignedReportFileUrl in firebaseTestSuitesData.ts
// and GET /api/test-suites-reports in server.ts), so a leaked/shared link
// can't serve the file forever the way a permanent public URL would. Missing
// files (e.g. a PDF variant that wasn't generated) are skipped with a
// warning rather than failing the whole run. Returns whether the upload
// happened, so callers only point reportUrl at files that actually made it.
async function uploadReport(bucket, localPath, destPath) {
    try {
        statSync(localPath);
    } catch {
        console.warn(`  (skipping upload, not found: ${localPath})`);
        return false;
    }

    await bucket.upload(localPath, { destination: destPath });

    return true;
}

// tst-e2e's axe summary (reports/a11y/index.html) is one self-contained
// page, not a per-run artifact - each a11y run overwrites it. So it's only
// attached to a run it was actually regenerated by (written at/after the
// run's start), never to an older run it no longer describes. Uploaded as
// a11y-report.html next to smart-report.html (see REPORT_FILENAME_ALLOWLIST
// in server.ts).
async function attachA11yIndexReport(bucket, run, runStartTime) {
    const indexPath = path.join(reportsDir, "a11y", "index.html");
    let mtime;
    try {
        mtime = statSync(indexPath).mtimeMs;
    } catch {
        return;
    }
    if (mtime < new Date(runStartTime).getTime()) return;

    run.reportFileA11y = "a11y/index.html";
    if (PUBLISH_REPORTS && bucket) {
        const dest = `test-suites-reports/runs/${run.id}/a11y-report.html`;
        if (await uploadReport(bucket, indexPath, dest)) {
            run.reportUrlA11y = `/api/test-suites-reports/runs/${run.id}/a11y-report.html`;
        }
    }
}

// tests here is already the one kind's own subset (see buildPlaywrightRuns) -
// full isolation, never a mix of kinds, per the team's own steer: nrt/a11y/
// security never share a test, in Firestore or in memory.
function buildDetail(statsFlaky, tests) {
    return {
        totalTests: tests.length,
        passed: tests.filter((t) => t.status === "passed").length,
        // stats.flaky is a run-wide count that could in principle include a
        // retry from a test outside this kind's subset - left as-is rather
        // than recomputed per-test, since a test's retry history isn't
        // captured in collectTests().
        flaky: statsFlaky,
        // Sum of this kind's own tests only - not the whole run's
        // stats.duration, which would include a11y/security time on the nrt
        // doc and vice versa, breaking the isolation the folder split exists
        // for.
        durationMs: tests.reduce((sum, t) => sum + t.durationMs, 0),
        domains: buildDomainSummary(tests),
        teams: buildTeamSummary(tests),
        tests,
    };
}

// One Playwright invocation can carry real content for more than one suite
// kind (e.g. type:security or type:accessibility-tagged specs run alongside
// the domain-tagged NRT ones) - this builds one TestSuiteRun per kind that
// actually has content, each destined for its own
// testSuiteRunsLocal/<kind>/runs folder (see firebaseTestSuitesData.ts).
// Each doc's tests[] holds ONLY that kind's own specs - nrt/a11y/security
// never share a test between them, even though they may come from the same
// underlying .json report file.
async function buildPlaywrightRuns(bucket) {
    const jsonDir = path.join(reportsDir, "json");
    let files = [];
    try {
        // ONLY_RUN_IDS is applied here, before any upload - filtering the
        // built runs afterwards (as this used to) still uploaded every other
        // run's report files to Storage, leaving them orphaned without a doc.
        files = readdirSync(jsonDir)
            .filter((f) => f.endsWith(".json"))
            .filter((f) => !ONLY_RUN_IDS || ONLY_RUN_IDS.has(f.replace(/\.json$/, "")));
    } catch {
        console.warn(`No json/ folder under ${reportsDir} - skipping NRT/A11Y/Security runs.`);
        return [];
    }

    const runsPerFile = await Promise.all(files.map(async (file) => {
        const id = file.replace(/\.json$/, "");
        const parsed = JSON.parse(readFileSync(path.join(jsonDir, file), "utf8"));
        // Derived report variants (e.g. "<id>-by-team.json", which points back
        // at its own source via `sourceReport` instead of Playwright's own
        // stats/suites shape) live in the same json/ folder but aren't a
        // primary run to publish - skip them rather than crash on a shape
        // they were never meant to have.
        if (!parsed.stats || !parsed.suites) {
            console.warn(`  (skipping ${file}, not a Playwright run report)`);
            return [];
        }
        const { stats, suites } = parsed;
        const startedAt = new Date(stats.startTime).toISOString();

        const tests = collectTests(suites);
        const testsByKind = {
            nrt: tests.filter((t) => t.kind === "nrt"),
            a11y: tests.filter((t) => t.kind === "a11y"),
            security: tests.filter((t) => t.kind === "security"),
        };

        const base = {
            id,
            app: "all",
            env: envFromId(id),
            branch,
            commitSha,
            startedAt,
            reportFile: `runs/${id}/smart-report.html`,
            reportTool: "Playwright + SmartReport",
        };

        if (PUBLISH_REPORTS && bucket) {
            const runDir = path.join(reportsDir, "runs", id);
            const destDir = `test-suites-reports/runs/${id}`;

            const htmlUploaded = await uploadReport(
                bucket,
                path.join(runDir, "smart-report.html"),
                `${destDir}/smart-report.html`
            );
            // reportUrl is the gated API path the client fetches a signed
            // URL from (see TestSuiteRun.reportUrl in src/types.ts) - only
            // set it once the HTML the button actually opens is confirmed
            // uploaded.
            if (htmlUploaded) base.reportUrl = `/api/test-suites-reports/runs/${id}/smart-report.html`;
            // Siblings smart-report.html itself links to (PDF download
            // buttons) - uploaded alongside so they exist in Storage too.
            // Note: those links are plain relative hrefs baked into the
            // HTML, so once smart-report.html is opened via its own signed
            // URL, clicking one 403s (it isn't itself a signed URL) - a
            // known follow-up, not fixed by this upload alone.
            for (const pdf of ["smart-report.pdf", "smart-report-dark.pdf", "smart-report-minimal.pdf"]) {
                await uploadReport(bucket, path.join(runDir, pdf), `${destDir}/${pdf}`);
            }
        }

        // nrt is always published (even with 0 tests, e.g. an a11y/security-
        // only local check) so the Test Suites page's own domain-based
        // filter can tell "nothing but scaffolding ran" apart from "no run
        // happened at all" - see TestSuitesPage.tsx's runsBySuite filter.
        // a11y/security only publish when they actually have content.
        const nrtDetail = buildDetail(stats.flaky, testsByKind.nrt);
        const runs = [
            { ...base, suite: "nrt", status: nrtStatus(nrtDetail), nrt: nrtDetail },
        ];

        for (const kind of ["a11y", "security"]) {
            if (testsByKind[kind].length === 0) continue;
            const detail = buildDetail(stats.flaky, testsByKind[kind]);
            const run = { ...base, suite: kind, status: nrtStatus(detail), nrt: detail };
            if (kind === "a11y") await attachA11yIndexReport(bucket, run, stats.startTime);
            runs.push(run);
        }

        return runs;
    }));

    return runsPerFile.flat();
}

const serviceAccount = JSON.parse(serviceAccountRaw);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

// Default bucket naming isn't inferred from the service account alone (the
// Admin SDK needs an explicit storageBucket) - confirmed against the real
// project that "<project_id>.appspot.com" is the right one, not the newer
// "<project_id>.firebasestorage.app" convention some projects use instead.
const bucket = PUBLISH_REPORTS
    ? getStorage(app).bucket(`${serviceAccount.project_id}.appspot.com`)
    : null;

if (PUBLISH_REPORTS) {
    console.log(`Report uploads enabled - publishing to gs://${bucket.name}/test-suites-reports/`);
}

const runs = await buildPlaywrightRuns(bucket);

if (runs.length === 0) {
    console.log("Nothing to publish.");
    process.exit(0);
}

// One "folder" (subcollection) per suite kind - testSuiteRunsLocal/<suite>/runs/<id>
// - see firebaseTestSuitesData.ts for why this replaced one flat collection
// keyed only by a `suite` field.
for (const run of runs) {
    const ref = db.collection(LOCAL_COLLECTION).doc(run.suite).collection("runs").doc(run.id);
    await ref.set(run);
    console.log(`Wrote ${LOCAL_COLLECTION}/${run.suite}/runs/${run.id}`);
}

console.log(`\nPublished ${runs.length} run(s) to ${LOCAL_COLLECTION}.`);

if (PUBLISH_REPORTS) {
    await warnIfStorageUsageIsHigh(bucket);
}
