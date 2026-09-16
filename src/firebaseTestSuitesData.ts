import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import {
    getFirestore,
    type Firestore,
    type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FirebaseConfigError } from "./firebaseE2eData.js";
import type { TestSuiteRun } from "./types.js";

// scripts/publish-local-test-runs.js is, for now, the only thing that ever
// writes here - there's no tst-e2e CI pipeline yet for the NRT/A11Y/DAST
// Test Suites hub (unlike e2eRuns above, see docs/e2e-firebase-integration-plan.md).
// Once that pipeline exists it should publish to a real "testSuiteRuns"
// collection instead, and this should read from that one - kept separate so
// a stray local publish can never masquerade as real CI history.
const COLLECTION = "testSuiteRunsLocal";
const CACHE_DURATION_MS = 5 * 60 * 1000;
const MAX_RUNS = 200;

let app: App | null = null;

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
    }

    return app;
}

function getDb(): Firestore {
    return getFirestore(getApp());
}

let cache: { data: TestSuiteRun[]; timestamp: number } | null = null;

export async function getTestSuiteRuns(): Promise<TestSuiteRun[]> {
    if (cache && Date.now() - cache.timestamp < CACHE_DURATION_MS) {
        return cache.data;
    }

    const snapshot = await getDb()
        .collection(COLLECTION)
        .orderBy("startedAt", "desc")
        .limit(MAX_RUNS)
        .get();

    const runs = snapshot.docs.map(
        (doc: QueryDocumentSnapshot) => doc.data() as TestSuiteRun
    );

    cache = { data: runs, timestamp: Date.now() };

    return runs;
}

export function clearTestSuiteRunsCache(): void {
    cache = null;
}
