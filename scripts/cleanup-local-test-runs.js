// Deletes every document in the `testSuiteRunsLocal` collection - the
// counterpart to scripts/publish-local-test-runs.js. Run this once tst-e2e's
// own CI pipeline starts publishing real runs, so local test data doesn't
// linger alongside it.
//
// Only ever touches testSuiteRunsLocal, never the collection the real
// pipeline writes to, so there's no separate confirmation gate needed here.
//
// Also purges each deleted run's uploaded report files (Storage has no TTL,
// and nothing else in this repo ever removes them - see
// docs/tst-e2e-reports-followups.md) - by prefix rather than by exact
// filename, so it catches the HTML + all PDF variants regardless of which
// ones actually got uploaded. Harmless (a no-op) for runs that were never
// published with PUBLISH_REPORTS_TO_FIREBASE=true, since deleteFiles() on a
// prefix with nothing under it just returns.
//
// Usage: node scripts/cleanup-local-test-runs.js
import "dotenv/config";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { warnIfStorageUsageIsHigh } from "./lib/storage-usage.js";

const LOCAL_COLLECTION = "testSuiteRunsLocal";
// One "folder" (subcollection) per suite kind - see
// src/firebaseTestSuitesData.ts and publish-local-test-runs.js's write loop.
const KINDS = ["nrt", "a11y", "security"];

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountRaw) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountRaw);
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
// Same bucket naming as publish-local-test-runs.js - confirmed against the
// real project that "<project_id>.appspot.com" is the right one.
const bucket = getStorage(app).bucket(`${serviceAccount.project_id}.appspot.com`);

async function deleteRunReportFiles(runId) {
    try {
        await bucket.deleteFiles({ prefix: `test-suites-reports/runs/${runId}/` });
    } catch (err) {
        // Storage isn't provisioned on projects still on the free Spark plan
        // (see .env.example's PUBLISH_REPORTS_TO_FIREBASE note) - that's not
        // this script's problem to fail on, since most runs never had
        // reports uploaded in the first place.
        console.warn(`  (couldn't purge Storage files for ${runId}: ${err.message})`);
    }
}

let totalDeleted = 0;

for (const kind of KINDS) {
    const snapshot = await db.collection(LOCAL_COLLECTION).doc(kind).collection("runs").get();

    if (snapshot.empty) continue;

    await Promise.all(snapshot.docs.map((doc) => deleteRunReportFiles(doc.id)));

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    console.log(`Deleted ${snapshot.size} doc(s) (+ any Storage report files) from ${LOCAL_COLLECTION}/${kind}/runs.`);
    totalDeleted += snapshot.size;
}

console.log(
    totalDeleted === 0
        ? `${LOCAL_COLLECTION} is already empty.`
        : `\nDeleted ${totalDeleted} doc(s) total from ${LOCAL_COLLECTION}.`
);

await warnIfStorageUsageIsHigh(bucket);
