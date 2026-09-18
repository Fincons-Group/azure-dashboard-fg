// Shared by publish-local-test-runs.js and cleanup-local-test-runs.js - both
// touch the same bucket, so both are good moments to warn before an
// unnoticed pile-up of report uploads turns into a real Blaze bill.
//
// 5GB is GCP's standard "Always Free" Cloud Storage allowance (same number
// Firebase's Spark plan advertises) - it still applies on Blaze, which just
// removes the hard cap rather than the free quota itself. Override via
// FIREBASE_STORAGE_FREE_TIER_GB if the real project's quota differs.
const FREE_TIER_BYTES = Number(process.env.FIREBASE_STORAGE_FREE_TIER_GB || 5) * 1024 ** 3;
// "Close to the limit" = 80% used, i.e. only ~20% of the free tier left.
const WARN_RATIO = 0.8;

// Sums every object in the bucket (not just test-suites-reports/) since the
// free-tier quota is project-wide - a small number of large report uploads
// isn't the only thing that could push it over.
export async function warnIfStorageUsageIsHigh(bucket) {
    const [files] = await bucket.getFiles();
    const totalBytes = files.reduce((sum, f) => sum + Number(f.metadata.size || 0), 0);
    const ratio = totalBytes / FREE_TIER_BYTES;
    const usedGb = (totalBytes / 1024 ** 3).toFixed(2);
    const limitGb = (FREE_TIER_BYTES / 1024 ** 3).toFixed(0);

    console.log(`\nStorage bucket usage: ${usedGb} GB / ${limitGb} GB free tier (${(ratio * 100).toFixed(1)}%).`);

    if (ratio < WARN_RATIO) return;

    console.warn(
        `\n⚠ gs://${bucket.name} is at ${(ratio * 100).toFixed(0)}% of the ${limitGb} GB free tier - ` +
            `within ${Math.max(0, 100 - ratio * 100).toFixed(0)}% of it. Before it's exceeded (and Blaze starts ` +
            `billing for the overage):\n` +
            `  1. Review/download what's there, e.g.:\n` +
            `     gsutil -m cp -r gs://${bucket.name}/test-suites-reports ./test-suites-reports-backup\n` +
            `     (or browse it in the Firebase console: Storage tab)\n` +
            `  2. Free space with: npm run e2e:cleanup-local\n`
    );
}
