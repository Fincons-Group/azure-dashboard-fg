// Temporary local dev tool: reads a tst-e2e checkout's report output straight
// off disk and publishes it to Firebase, so the Test Suites / E2E History
// pages have real-shaped data to render against before tst-e2e's own CI
// pipeline exists (see docs/e2e-firebase-integration-plan.md Part C).
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
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LOCAL_COLLECTION = "testSuiteRunsLocal";

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

function nrtStatus(detail) {
    if (detail.passed < detail.totalTests - detail.flaky) return "bad";
    if (detail.flaky > 0) return "warn";
    return "good";
}

function a11yStatus(detail) {
    if (detail.critical > 0) return "bad";
    if (detail.serious > 0) return "warn";
    return "good";
}

// Domain tags look like "domain:vit" on each spec (see
// tst-e2e/playwright.config.ts's tag scheme) - falls back to "other" for
// specs that predate tagging or don't carry one.
function specDomain(tags) {
    const tag = (tags || []).find((t) => t.startsWith("domain:"));
    return tag ? tag.slice("domain:".length) : "other";
}

// A11Y specs (tagged type:accessibility, e.g. comparto-step-a11y.spec.ts)
// execute inside the same Playwright run as the NRT specs - see the
// a11y-chrome project in playwright.config.ts - but they're a different
// suite in this UI (see TestSuiteKey), not an NRT domain. Untagged specs
// (tags: [], e.g. the auth setup) have no type tag at all and stay in, since
// they're real NRT scaffolding, not a different suite's tests.
function specType(tags) {
    const tag = (tags || []).find((t) => t.startsWith("type:"));
    return tag ? tag.slice("type:".length) : null;
}
function isNrtSpec(tags) {
    const type = specType(tags);
    return type === null || type === "nrt";
}

function testStatus(result) {
    if (!result) return "skipped";
    if (result.status === "passed") return "passed";
    if (result.status === "skipped") return "skipped";
    return "failed";
}

// The suites tree nests arbitrarily (a top-level suite per spec file, then
// nested suites per describe block) before reaching specs - walk it
// recursively rather than assuming a fixed depth.
function collectTests(suites, domains) {
    const tests = [];
    for (const suite of suites || []) {
        for (const spec of suite.specs || []) {
            if (!isNrtSpec(spec.tags)) continue;
            const domain = specDomain(spec.tags);
            for (const test of spec.tests || []) {
                const result = (test.results || [])[0];
                tests.push({
                    title: spec.title,
                    domain,
                    file: suite.file,
                    status: testStatus(result),
                    durationMs: Math.round(result?.duration ?? 0),
                    steps: (result?.steps || []).map((s) => ({
                        title: s.title,
                        durationMs: Math.round(s.duration),
                    })),
                });
                domains.add(domain);
            }
        }
        collectTests(suite.suites, domains).forEach((t) => tests.push(t));
    }
    return tests;
}

function buildDomainSummary(tests, allDomains) {
    return [...allDomains].sort().map((domain) => {
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

function buildNrtRuns() {
    const jsonDir = path.join(reportsDir, "json");
    let files = [];
    try {
        files = readdirSync(jsonDir).filter((f) => f.endsWith(".json"));
    } catch {
        console.warn(`No json/ folder under ${reportsDir} - skipping NRT runs.`);
        return [];
    }

    return files.map((file) => {
        const id = file.replace(/\.json$/, "");
        const { stats, suites } = JSON.parse(readFileSync(path.join(jsonDir, file), "utf8"));
        const startedAt = new Date(stats.startTime);

        const domainsSeen = new Set();
        // Only type:nrt (or untagged) specs - stats.expected/skipped/unexpected
        // below would include type:accessibility specs like
        // comparto-step-a11y.spec.ts too, since Playwright's own stats block
        // doesn't know about this UI's suite split.
        const tests = collectTests(suites, domainsSeen);

        const detail = {
            totalTests: tests.length,
            passed: tests.filter((t) => t.status === "passed").length,
            // stats.flaky is a run-wide count that could in principle include a
            // non-NRT spec's retry - left as-is rather than recomputed per-test,
            // since a test's retry history isn't captured in collectTests().
            flaky: stats.flaky,
            durationMs: Math.round(stats.duration),
            domains: buildDomainSummary(tests, domainsSeen),
            tests,
        };

        return {
            id,
            suite: "nrt",
            app: "all",
            env: envFromId(id),
            branch,
            commitSha,
            startedAt: startedAt.toISOString(),
            status: nrtStatus(detail),
            reportFile: `runs/${id}/smart-report.html`,
            reportTool: "Playwright + SmartReport",
            nrt: detail,
        };
    });
}

function buildA11yRuns() {
    const a11yDir = path.join(reportsDir, "a11y");
    let entries = [];
    try {
        entries = readdirSync(a11yDir).filter((name) =>
            statSync(path.join(a11yDir, name)).isDirectory()
        );
    } catch {
        console.warn(`No a11y/ folder under ${reportsDir} - skipping a11y runs.`);
        return [];
    }

    // a11y/index.html is ONE merged report across every scanned step,
    // regardless of how many spec folders axe ran across (each folder here
    // is one spec's scan targets, not a separate "run") - so this builds
    // ONE TestSuiteRun by flattening every folder's axe-data-*.json into a
    // single steps array, instead of one run per folder pointing at the
    // same merged report N times over.
    const steps = [];
    for (const folder of entries) {
        const dir = path.join(a11yDir, folder);
        const stepFiles = readdirSync(dir).filter(
            (f) => f.startsWith("axe-data-") && f.endsWith(".json")
        );

        for (const file of stepFiles) {
            const data = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
            const tally = { critical: 0, serious: 0, moderate: 0, minor: 0 };
            for (const v of data.violations) tally[v.impact] += 1;

            steps.push({
                label: data.label,
                violations: data.violations.length,
                incomplete: data.incomplete.length,
                ...tally,
                rules: data.violations.map((v) => ({
                    ruleId: v.id,
                    impact: v.impact,
                    count: 1,
                    description: v.help,
                })),
                timestamp: data.timestamp,
            });
        }
    }

    if (steps.length === 0) return [];

    steps.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const startedAt = steps[0].timestamp;
    const id = `a11y_${startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "_")}`;

    const detail = {
        stepsScanned: steps.length,
        violations: steps.reduce((sum, s) => sum + s.violations, 0),
        incomplete: steps.reduce((sum, s) => sum + s.incomplete, 0),
        critical: steps.reduce((sum, s) => sum + s.critical, 0),
        serious: steps.reduce((sum, s) => sum + s.serious, 0),
        moderate: steps.reduce((sum, s) => sum + s.moderate, 0),
        minor: steps.reduce((sum, s) => sum + s.minor, 0),
        // timestamp was only needed to order/derive startedAt above - not
        // part of the A11yStepResult shape.
        steps: steps.map(({ timestamp, ...step }) => step),
    };

    return [
        {
            id,
            suite: "a11y",
            app: "plurifond",
            env: "tst",
            branch,
            commitSha,
            startedAt,
            status: a11yStatus(detail),
            reportFile: "a11y/index.html",
            reportTool: "axe-core",
            a11y: detail,
        },
    ];
}

// ZAP only produces HTML reports here (no JSON summary), so there's nothing
// structured to parse into a DastRunDetail yet without scraping the HTML -
// left out rather than faked. Revisit once tst-e2e's ZAP step emits JSON too.
function buildDastRuns() {
    return [];
}

const runs = [...buildNrtRuns(), ...buildA11yRuns(), ...buildDastRuns()];

if (runs.length === 0) {
    console.log("Nothing to publish.");
    process.exit(0);
}

const app = initializeApp({ credential: cert(JSON.parse(serviceAccountRaw)) });
const db = getFirestore(app);

for (const run of runs) {
    await db.collection(LOCAL_COLLECTION).doc(run.id).set(run);
    console.log(`Wrote ${LOCAL_COLLECTION}/${run.id} (${run.suite})`);
}

console.log(`\nPublished ${runs.length} run(s) to ${LOCAL_COLLECTION}.`);
