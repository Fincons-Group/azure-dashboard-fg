import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { FirebaseConfigError } from "./firebaseE2eData.js";

// scripts/publish-spec-catalog.js is, for now, the only thing that ever
// writes here - same "-Local" stopgap idea as testSuiteRunsLocal in
// firebaseTestSuitesData.ts, until tst-e2e's own CI publishes this list
// directly (see docs/tst-e2e-reports-followups.md). Replaces the old
// git-ls-files-against-TEST_SUITES_REPORTS_DIR approach, which only ever
// worked on a machine with a live tst-e2e checkout on disk - never true for
// the hosted (Render) deployment.
const COLLECTION = "testSpecCatalogLocal";
const KINDS = ["nrt", "a11y", "security"] as const;
export type SpecKind = (typeof KINDS)[number];
const CACHE_DURATION_MS = 5 * 60 * 1000;

let app: App | null = null;

// Same lazy + memoized init as firebaseTestSuitesData.ts's getApp() - reuses
// whichever module initializes the Firebase app first via getApps().
function getApp(): App {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!raw) {
        throw new FirebaseConfigError(
            "FIREBASE_SERVICE_ACCOUNT_JSON is not set - the spec catalog is not configured yet."
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

let cache: { data: Record<SpecKind, string[]>; timestamp: number } | null = null;

// Returns null when Firebase is configured but nothing has been published
// yet (distinct from FirebaseConfigError, which callers use to show the
// same "not configured" hint either way - see testSpecCatalogData.ts).
export async function getSpecFilePaths(): Promise<Record<SpecKind, string[]> | null> {
    if (cache && Date.now() - cache.timestamp < CACHE_DURATION_MS) {
        return cache.data;
    }

    const db = getDb();
    const snapshots = await Promise.all(KINDS.map((kind) => db.collection(COLLECTION).doc(kind).get()));

    if (snapshots.every((snapshot) => !snapshot.exists)) {
        return null;
    }

    const data = Object.fromEntries(
        KINDS.map((kind, i) => [kind, (snapshots[i]!.data()?.specPaths as string[] | undefined) ?? []])
    ) as Record<SpecKind, string[]>;

    cache = { data, timestamp: Date.now() };

    return data;
}

export function clearSpecCatalogCache(): void {
    cache = null;
}
