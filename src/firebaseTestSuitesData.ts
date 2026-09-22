import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import {
    getFirestore,
    type Firestore,
    type QueryDocumentSnapshot,
    type QuerySnapshot,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { FirebaseConfigError } from "./firebaseE2eData.js";
import type { TestSuiteRun } from "./types.js";

// scripts/publish-local-test-runs.js is, for now, the only thing that ever
// writes here - there's no tst-e2e CI pipeline yet for the NRT/A11Y/Security
// Test Suites hub (unlike e2eRuns above, see docs/e2e-firebase-integration-plan.md).
// Once that pipeline exists it should publish to a real "testSuiteRuns"
// collection instead, and this should read from that one - kept separate so
// a stray local publish can never masquerade as real CI history.
//
// Structured as testSuiteRunsLocal/<kind>/runs/<runId> (one "folder" per
// suite kind) rather than one flat collection keyed only by a `suite`
// field - a single Playwright invocation can carry real content for more
// than one kind (e.g. a run pointed at the a11y/security tag subset has no
// real NRT content at all), and a flat collection with a computed `suite`
// field on each doc made that ambiguous to query and easy to display
// wrong. Publishing now writes one doc per kind that actually has content,
// straight into its own folder - see splitRunsByKind in the publish script.
const COLLECTION = "testSuiteRunsLocal";
const KINDS = ["nrt", "a11y", "security"] as const;
const CACHE_DURATION_MS = 5 * 60 * 1000;
const MAX_RUNS_PER_KIND = 200;

let app: App | null = null;
let projectId: string | null = null;

// Same lazy + memoized init as firebaseE2eData.ts's getApp() - reuses
// whichever module (this one or firebaseE2eData.ts) initializes the Firebase
// app first via getApps(), since a server process only ever needs one.
function getApp(): App {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!raw) {
        throw new FirebaseConfigError(
            "FIREBASE_SERVICE_ACCOUNT_JSON is not set - test suite runs are not configured yet."
        );
    }

    if (!app) {
        const existingApps = getApps();

        if (existingApps.length > 0) {
            app = existingApps[0]!;
        } else {
            const serviceAccount = JSON.parse(raw);
            app = initializeApp({ credential: cert(serviceAccount) });
        }

        projectId = JSON.parse(raw).project_id;
    }

    return app;
}

function getDb(): Firestore {
    return getFirestore(getApp());
}

// Same bucket naming as scripts/publish-local-test-runs.js - confirmed
// against the real project that "<project_id>.appspot.com" is the right
// one, not the newer "<project_id>.firebasestorage.app" convention.
function getBucket() {
    getApp();
    return getStorage(getApp()).bucket(`${projectId}.appspot.com`);
}

// Report files are uploaded privately (no public ACL - see
// publish-local-test-runs.js) so a compromised/leaked link can't serve them
// forever. This mints a fresh signed URL, good for a few minutes, each time
// GET /api/test-suites-reports/runs/:runId/:filename (itself gated behind
// assertAllowedDomain() like every other /api route) is called - never a
// permanent one. Returns null when the object doesn't exist (nothing was
// ever published for that run/file), which the route turns into a 404.
export async function getSignedReportFileUrl(
    runId: string,
    filename: string
): Promise<string | null> {
    const file = getBucket().file(`test-suites-reports/runs/${runId}/${filename}`);
    const [exists] = await file.exists();

    if (!exists) return null;

    const [url] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 5 * 60 * 1000,
    });

    return url;
}

let cache: { data: TestSuiteRun[]; timestamp: number } | null = null;

export async function getTestSuiteRuns(): Promise<TestSuiteRun[]> {
    if (cache && Date.now() - cache.timestamp < CACHE_DURATION_MS) {
        return cache.data;
    }

    const db = getDb();

    const snapshots = await Promise.all(
        KINDS.map((kind) =>
            db
                .collection(COLLECTION)
                .doc(kind)
                .collection("runs")
                .orderBy("startedAt", "desc")
                .limit(MAX_RUNS_PER_KIND)
                .get()
        )
    );

    const runs = snapshots
        .flatMap((snapshot: QuerySnapshot) =>
            snapshot.docs.map((doc: QueryDocumentSnapshot) => doc.data() as TestSuiteRun)
        )
        .sort((a: TestSuiteRun, b: TestSuiteRun) => b.startedAt.localeCompare(a.startedAt));

    cache = { data: runs, timestamp: Date.now() };

    return runs;
}

export function clearTestSuiteRunsCache(): void {
    cache = null;
}
