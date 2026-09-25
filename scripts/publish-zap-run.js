// Publishes one ZAP scan (from a local tst-e2e checkout's reports/zap/
// folder) to Firebase as a "security" run - same local-only
// testSuiteRunsLocal collection and same opt-in guard as
// publish-local-test-runs.js, which only knows about Playwright's own JSON
// reports and never picks these files up.
//
// A ZAP scan leaves three things behind in reports/zap/:
//   <stamp>-ZAP-Report-.html          English report (ZAP's traditional
//                                     template, + a <stamp>-ZAP-Report-/
//                                     folder of CSS/logo it links to)
//   <stamp>-ZAP-Report-summary.json   ZAP's traditional-json output
//   <host>-<stamp>-IT.html            Italian report (self-contained)
// where <stamp> is YYYY-MM-DD-HHMMSS. Both HTML reports are uploaded to
// Storage and the run doc carries per-alert counts parsed from the summary.
//
// Usage: E2E_LOCAL_PUBLISH=true node scripts/publish-zap-run.js
// Picks the newest scan by default - set ZAP_RUN_STAMP=2026-09-23-112325 to
// publish a specific one instead. Always uploads the reports (no separate
// PUBLISH_REPORTS_TO_FIREBASE opt-in): a ZAP run doc without them has
// nothing to open.
//
// ZAP_APP=plurifond|frontOfficeAuto names the team whose journeys the scan
// covered - ZAP's own output can't tell (every alert sits on the shared
// host root or on Microsoft login pages), and the Security tab's per-team
// table groups scans by it. Unset leaves the scan as "all" (unassigned).
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { warnIfStorageUsageIsHigh } from "./lib/storage-usage.js";

const LOCAL_COLLECTION = "testSuiteRunsLocal";

if (process.env.E2E_LOCAL_PUBLISH !== "true") {
    console.error(
        "Refusing to run: set E2E_LOCAL_PUBLISH=true to confirm you want to " +
            "publish a local ZAP scan to Firebase (collection: " +
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

const ZAP_APPS = ["plurifond", "frontOfficeAuto"];
const zapApp = process.env.ZAP_APP || "all";
if (zapApp !== "all" && !ZAP_APPS.includes(zapApp)) {
    console.error(`ZAP_APP must be one of: ${ZAP_APPS.join(", ")} (got "${zapApp}").`);
    process.exit(1);
}

const zapDir = path.join(reportsDir, "zap");
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

const STAMP = String.raw`\d{4}-\d{2}-\d{2}-\d{6}`;
const EN_REPORT = new RegExp(`^(${STAMP})-ZAP-Report-.*\\.html$`);
const IT_REPORT = new RegExp(`^(.+)-(${STAMP})-IT\\.html$`);

const zapFiles = readdirSync(zapDir);

function pickEnglishReport() {
    const candidates = zapFiles
        .map((f) => ({ file: f, match: f.match(EN_REPORT) }))
        .filter((c) => c.match)
        .map((c) => ({ file: c.file, stamp: c.match[1] }))
        .sort((a, b) => b.stamp.localeCompare(a.stamp));
    const wanted = process.env.ZAP_RUN_STAMP;
    return wanted ? candidates.find((c) => c.stamp === wanted) : candidates[0];
}

const en = pickEnglishReport();
if (!en) {
    console.error(`No <stamp>-ZAP-Report-*.html found in ${zapDir}.`);
    process.exit(1);
}

const summaryFile = zapFiles.find(
    (f) => f.startsWith(`${en.stamp}-ZAP-Report-`) && f.endsWith("summary.json")
);
if (!summaryFile) {
    console.error(`No summary JSON found for ZAP run ${en.stamp}.`);
    process.exit(1);
}

const summary = JSON.parse(readFileSync(path.join(zapDir, summaryFile), "utf8"));
const sites = summary.site || [];

// The scanned app is the one host that isn't a third-party login/telemetry
// page the browser passed through - picked as the site ZAP reported the
// most alert types for among the non-Microsoft hosts, falling back to the
// last site listed (ZAP lists the context target last in practice).
const THIRD_PARTY = /(microsoft|msauth|msftauth|live\.com|microsoftonline)/i;
const targetSite =
    sites
        .filter((s) => !THIRD_PARTY.test(s["@host"]))
        .sort((a, b) => (b.alerts || []).length - (a.alerts || []).length)[0] ?? sites[sites.length - 1];
const target = targetSite?.["@host"] ?? "unknown";

// The Italian report is generated separately, a minute or two after the
// English one, and named after the target host - take the first one for
// the same host at or after the English report's own stamp.
const it = zapFiles
    .map((f) => ({ file: f, match: f.match(IT_REPORT) }))
    .filter((c) => c.match && c.match[1] === target && c.match[2] >= en.stamp)
    .map((c) => ({ file: c.file, stamp: c.match[2] }))
    .sort((a, b) => a.stamp.localeCompare(b.stamp))[0];
if (!it) console.warn(`  (no Italian report found for ${target} at/after ${en.stamp})`);

const RISKS = { 3: "high", 2: "medium", 1: "low", 0: "informational" };
const RISK_RANK = { high: 3, medium: 2, low: 1, informational: 0 };
const CONFIDENCE = { 0: "False Positive", 1: "Low", 2: "Medium", 3: "High", 4: "Confirmed" };

const alerts = sites
    .flatMap((site) =>
        (site.alerts || []).map((a) => ({
            name: a.name ?? a.alert,
            risk: RISKS[a.riskcode] ?? "informational",
            confidence: CONFIDENCE[a.confidence] ?? String(a.confidence),
            instances: Number(a.count ?? (a.instances || []).length),
            pluginId: String(a.pluginid),
            site: site["@host"],
        }))
    )
    .sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || b.instances - a.instances);

const alertsByRisk = { high: 0, medium: 0, low: 0, informational: 0 };
for (const a of alerts) alertsByRisk[a.risk] += 1;

// Same good/warn/bad reading as the rest of the Test Suites hub: any High
// alert fails the run, Medium is a warning, Low/Informational alone pass.
const status = alertsByRisk.high > 0 ? "bad" : alertsByRisk.medium > 0 ? "warn" : "good";

function envFromHost(host) {
    if (/tst/i.test(host)) return "tst";
    if (/pre/i.test(host)) return "pre";
    return "prd";
}

// "2026-09-23-112325" -> "20260923_1123", matching the Playwright run ids'
// "nrt_<yyyymmdd>_<hhmm>_<env>_..." shape.
const [y, mo, d, hms] = en.stamp.split("-");
const env = envFromHost(target);
const id = `zap_${y}${mo}${d}_${hms.slice(0, 4)}_${env}_${target.split(".")[0]}`;

// ZAP's traditional HTML links its stylesheets and logo from a sibling
// folder by relative path. Opened through a signed Storage URL those can't
// resolve (each object needs its own signature), so they're inlined here -
// the uploaded report is a single self-contained file. The Italian report
// already is one.
function inlineEnglishReport(html, assetDir) {
    const mime = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
    return html
        .replace(/<link\s+href="([^"]+\.css)"\s+rel="stylesheet">/g, (tag, href) => {
            const file = path.join(assetDir, href);
            return existsSync(file) ? `<style>\n${readFileSync(file, "utf8")}\n</style>` : tag;
        })
        .replace(/src="([^"]+\.(png|svg|jpg))"/g, (attr, src) => {
            const file = path.join(assetDir, src);
            if (!existsSync(file)) return attr;
            const type = mime[path.extname(file)] ?? "application/octet-stream";
            return `src="data:${type};base64,${readFileSync(file).toString("base64")}"`;
        });
}

const serviceAccount = JSON.parse(serviceAccountRaw);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
// Same bucket as publish-local-test-runs.js - see its comment on naming.
const bucket = getStorage(app).bucket(`${serviceAccount.project_id}.appspot.com`);

const destDir = `test-suites-reports/runs/${id}`;
const enHtml = inlineEnglishReport(readFileSync(path.join(zapDir, en.file), "utf8"), zapDir);
await bucket.file(`${destDir}/zap-report-en.html`).save(enHtml, { contentType: "text/html; charset=utf-8" });
console.log(`Uploaded ${en.file} -> ${destDir}/zap-report-en.html`);

if (it) {
    await bucket
        .file(`${destDir}/zap-report-it.html`)
        .save(readFileSync(path.join(zapDir, it.file)), { contentType: "text/html; charset=utf-8" });
    console.log(`Uploaded ${it.file} -> ${destDir}/zap-report-it.html`);
}

const { branch, commitSha } = gitInfo(tstE2eRoot);

// reportFile/reportFileIt are the reports/-relative paths the dev-only
// /test-suites-reports static route serves (see TestSuiteRun.reportFile);
// reportUrl/reportUrlIt the gated signed-URL API paths used everywhere else.
const run = {
    id,
    suite: "security",
    app: zapApp,
    env,
    branch,
    ...(commitSha ? { commitSha } : {}),
    startedAt: new Date(summary.created ?? Date.now()).toISOString(),
    status,
    reportFile: `zap/${en.file}`,
    reportUrl: `/api/test-suites-reports/runs/${id}/zap-report-en.html`,
    ...(it
        ? {
              reportFileIt: `zap/${it.file}`,
              reportUrlIt: `/api/test-suites-reports/runs/${id}/zap-report-it.html`,
          }
        : {}),
    reportTool: `OWASP ZAP ${summary["@version"] ?? ""}`.trim(),
    zap: {
        target,
        zapVersion: summary["@version"] ?? "",
        alertsByRisk,
        alerts,
    },
};

await db.collection(LOCAL_COLLECTION).doc("security").collection("runs").doc(id).set(run);
console.log(`Wrote ${LOCAL_COLLECTION}/security/runs/${id}`);
console.log(
    `  ${target} - ${alerts.length} alert types (high ${alertsByRisk.high}, medium ${alertsByRisk.medium}, ` +
        `low ${alertsByRisk.low}, info ${alertsByRisk.informational}) -> ${status}`
);

await warnIfStorageUsageIsHigh(bucket);
