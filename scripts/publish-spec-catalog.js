// Temporary local dev tool: scans a tst-e2e checkout for real Playwright spec
// files and publishes the list to Firebase, so the "Automated spec files"
// tab (AutomationKpiPage.tsx / GET /api/test-spec-catalog) has a real
// inventory to render on the hosted (Render) deployment, which has no
// tst-e2e checkout on disk to scan itself. Stopgap until tst-e2e's own CI
// publishes this list directly (see docs/tst-e2e-reports-followups.md).
//
// Writes ONLY to the `testSpecCatalogLocal` collection - never a collection
// real CI would publish to - same isolation idea as testSuiteRunsLocal in
// publish-local-test-runs.js.
//
// Usage: node scripts/publish-spec-catalog.js
// Reuses TEST_SUITES_REPORTS_DIR (already required to be a tst-e2e
// checkout's reports/ folder for the local report-link fallback) to locate
// the checkout root, rather than introducing a second env var for the same
// path.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTION = "testSpecCatalogLocal";

// Mirrors tst-e2e's own src/tests/<kind> layout - "ui" is where every
// domain-tagged NRT spec lives (see src/scripts/tmp-mark-automated.ts's
// equivalent listSpecFiles for a11y/security).
const KIND_SUBDIR = { nrt: "ui", a11y: "a11y", security: "security" };

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

// Same derivation as scripts/publish-local-test-runs.js: reportsDir is
// <tst-e2e checkout>/reports, so its parent is the checkout root.
const repoRoot = path.dirname(reportsDir);

// Same git-ls-files approach as tmp-mark-automated.ts, and for the same
// reason: an OneDrive-synced checkout's fs.readdirSync returns an
// inconsistent partial listing across runs (Files On-Demand placeholder
// quirk), while git ls-files reads the tracked-file list from the index.
function listSpecFiles(kind) {
    try {
        const output = execFileSync(
            "git",
            ["-C", repoRoot, "ls-files", "--", `src/tests/${KIND_SUBDIR[kind]}/**/*.spec.ts`],
            { encoding: "utf8" }
        );

        return output
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((rel) => rel.replace(/^src\/tests\//, ""));
    } catch (error) {
        console.error(`Failed to list ${kind} spec files under ${repoRoot}:`, error);
        return [];
    }
}

const serviceAccount = JSON.parse(serviceAccountRaw);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const updatedAt = new Date().toISOString();

for (const kind of Object.keys(KIND_SUBDIR)) {
    const specPaths = listSpecFiles(kind);
    await db.collection(COLLECTION).doc(kind).set({ specPaths, updatedAt });
    console.log(`Wrote ${COLLECTION}/${kind}: ${specPaths.length} spec file(s).`);
}

console.log("\nDone.");
