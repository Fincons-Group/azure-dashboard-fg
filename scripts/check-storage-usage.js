// Standalone check for scripts/lib/storage-usage.js's free-tier warning -
// publish-local-test-runs.js and cleanup-local-test-runs.js both already run
// it as a side effect, but this lets it be checked any time in between,
// without needing to publish or clean anything up first.
//
// Usage: node scripts/check-storage-usage.js
import "dotenv/config";
import { initializeApp, cert } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { warnIfStorageUsageIsHigh } from "./lib/storage-usage.js";

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountRaw) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountRaw);
const app = initializeApp({ credential: cert(serviceAccount) });
const bucket = getStorage(app).bucket(`${serviceAccount.project_id}.appspot.com`);

await warnIfStorageUsageIsHigh(bucket);
