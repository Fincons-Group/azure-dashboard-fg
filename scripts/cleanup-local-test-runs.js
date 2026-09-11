// Deletes every document in the `testSuiteRunsLocal` collection - the
// counterpart to scripts/publish-local-test-runs.js. Run this once tst-e2e's
// own CI pipeline starts publishing real runs, so local test data doesn't
// linger alongside it.
//
// Only ever touches testSuiteRunsLocal, never the collection the real
// pipeline writes to, so there's no separate confirmation gate needed here.
//
// Usage: node scripts/cleanup-local-test-runs.js
import "dotenv/config";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LOCAL_COLLECTION = "testSuiteRunsLocal";

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountRaw) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not set.");
    process.exit(1);
}

const app = initializeApp({ credential: cert(JSON.parse(serviceAccountRaw)) });
const db = getFirestore(app);

const snapshot = await db.collection(LOCAL_COLLECTION).get();

if (snapshot.empty) {
    console.log(`${LOCAL_COLLECTION} is already empty.`);
    process.exit(0);
}

const batch = db.batch();
snapshot.docs.forEach((doc) => batch.delete(doc.ref));
await batch.commit();

console.log(`Deleted ${snapshot.size} doc(s) from ${LOCAL_COLLECTION}.`);
