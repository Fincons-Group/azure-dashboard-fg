import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { E2eRun } from "./types.js";

// Thrown when FIREBASE_SERVICE_ACCOUNT_JSON isn't set - distinct from a real
// Firebase failure (bad credentials, network) so the server route can tell
// "not configured yet" apart from "something's actually broken" (see
// sendApiError's AzdoConfigError handling in server.ts for the equivalent
// pattern on the Azure DevOps side).
export class FirebaseConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FirebaseConfigError";
    }
}

const COLLECTION = "e2eRuns";
const CACHE_DURATION_MS = 5 * 60 * 1000;

let app: App | null = null;

// Lazy + memoized so a server with no Firebase env var set still starts and
// serves every other route fine - only a request to /api/e2e-history ever
// touches this. FIREBASE_SERVICE_ACCOUNT_JSON is the full contents of the
// service-account key file downloaded from Firebase Console > Project
// Settings > Service accounts > Generate new private key - it already
// carries the project id, so nothing else needs configuring.
function getApp(): App {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!raw) {
        throw new FirebaseConfigError(
            "FIREBASE_SERVICE_ACCOUNT_JSON is not set - e2e history is not configured yet."
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

let cache: { data: E2eRun[]; timestamp: number } | null = null;

export async function getE2eRunHistory(limit = 30): Promise<E2eRun[]> {
    if (cache && Date.now() - cache.timestamp < CACHE_DURATION_MS) {
        return cache.data;
    }

    const snapshot = await getDb()
        .collection(COLLECTION)
        .orderBy("startedAt", "desc")
        .limit(limit)
        .get();

    const runs = snapshot.docs.map((doc) => doc.data() as E2eRun);

    cache = { data: runs, timestamp: Date.now() };

    return runs;
}

export function clearE2eHistoryCache(): void {
    cache = null;
}
