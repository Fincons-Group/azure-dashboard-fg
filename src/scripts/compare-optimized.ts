/**
 * Differential test: runs the current (unbatched) data builds and the new
 * batched "*Optimized" builds against live Azure DevOps and reports any
 * mismatch in their output. Nothing in the server is switched over until this
 * prints "identico" for every target.
 *
 *   npx tsx src/scripts/compare-optimized.ts \
 *     --project "Nuova Frontiera" \
 *     --iteration "Nuova Frontiera\Front Office Auto\Sprint 2" \
 *     --area "Nuova Frontiera\Front Office Auto\Sprint 2" \
 *     --plans 4715,7414
 *
 * PAT / org / default project come from .env (loaded by azdo.ts).
 */
import "dotenv/config";
import {
    buildDashboard,
    buildDashboardOptimized,
    clearDashboardCache,
} from "../dashboardData.js";
import {
    buildDefectRecords,
    buildDefectRecordsOptimized,
    computeDefectStats,
    getStoryCount,
    getStoryPointsByArea,
    getAllSuiteNames,
    filterRecords,
    clearDefectCache,
} from "../defectData.js";
import {
    computePlanOverview,
    computePlanOverviewReference,
    clearPlanOverviewCache,
} from "../planOverviewData.js";

function arg(name: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    if (hit) return hit.slice(name.length + 3);
    const idx = process.argv.indexOf(`--${name}`);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const project = arg("project") || process.env.AZDO_PROJECT || undefined;
const iteration = arg("iteration") || undefined;
const area = arg("area") || undefined;
const planIds = (arg("plans") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

// Canonical form: object keys sorted, arrays of identifiable objects sorted by
// a stable key, so ordering differences don't count as mismatches.
function canon(v: any): any {
    if (Array.isArray(v)) {
        const arr = v.map(canon);
        const keyOf = (x: any) =>
            x && typeof x === "object"
                ? String(
                      x.id ??
                          x.testCaseId ??
                          x.suiteId ??
                          x.state ??
                          x.suiteName ??
                          x.bucket ??
                          x.weekStart ??
                          x.signature ??
                          JSON.stringify(x)
                  )
                : String(x);
        return [...arr].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    }
    if (v && typeof v === "object") {
        const out: Record<string, any> = {};
        for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
        return out;
    }
    return v;
}

function findDiffs(a: any, b: any, path = "", out: string[] = []): string[] {
    if (out.length > 40) return out;
    if (a === b) return out;

    const typeOf = (x: any) =>
        x === null ? "null" : Array.isArray(x) ? "array" : typeof x;
    const ta = typeOf(a);
    const tb = typeOf(b);

    if (ta !== tb) {
        out.push(`${path || "<root>"}: type ${ta} vs ${tb}`);
        return out;
    }

    if (ta === "array") {
        if (a.length !== b.length) {
            const ids = (arr: any[]) =>
                arr
                    .map((x) =>
                        x && typeof x === "object" ? x.id ?? "?" : x
                    )
                    .join(",");
            out.push(
                `${path}[]: length ${a.length} vs ${b.length}` +
                    ` | current=[${ids(a)}] optimized=[${ids(b)}]`
            );
        }
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i += 1) {
            findDiffs(a[i], b[i], `${path}[${i}]`, out);
        }
        return out;
    }

    if (ta === "object") {
        for (const k of new Set([
            ...Object.keys(a),
            ...Object.keys(b),
        ])) {
            findDiffs(a[k], b[k], path ? `${path}.${k}` : k, out);
        }
        return out;
    }

    out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return out;
}

function report(label: string, current: any, optimized: any): boolean {
    const diffs = findDiffs(canon(current), canon(optimized));
    if (diffs.length === 0) {
        console.log(`  ✅ ${label}: identico`);
        return true;
    }
    console.log(`  ❌ ${label}: ${diffs.length} differenze (prime 40):`);
    for (const d of diffs) console.log(`     ${d}`);
    return false;
}

async function main() {
    console.log(
        `Confronto per project="${project ?? "(default)"}"` +
            (iteration ? ` iteration="${iteration}"` : "") +
            (area ? ` area="${area}"` : "") +
            (planIds.length ? ` plans=${planIds.join(",")}` : "")
    );

    let ok = true;

    // --- Target 0: dashboard (test-case -> bug graph) ---
    console.log("\n[0] buildDashboard vs buildDashboardOptimized");
    clearDashboardCache();
    const dashCurrent = await buildDashboard(project);
    const dashOpt = await buildDashboardOptimized(project);
    ok = report("dashboard", dashCurrent, dashOpt) && ok;

    // --- Target 1: defect records ---
    console.log("\n[1] buildDefectRecords vs buildDefectRecordsOptimized");
    clearDefectCache();
    clearDashboardCache();
    const recCurrent = await buildDefectRecords(project);
    const recOpt = await buildDefectRecordsOptimized(project);
    ok = report("defectRecords", recCurrent, recOpt) && ok;

    // --- Target 2: full DefectStats (catches downstream drift) ---
    console.log("\n[2] computeDefectStats (record correnti vs ottimizzati)");
    const [storyCount, spByArea, suiteNames] = await Promise.all([
        getStoryCount(project),
        getStoryPointsByArea(project),
        getAllSuiteNames(project),
    ]);
    const filt = { iteration, area, environment: undefined, suites: [] };
    const statsCurrent = computeDefectStats(
        filterRecords(recCurrent, filt as any),
        storyCount,
        spByArea,
        recCurrent,
        suiteNames
    );
    const statsOpt = computeDefectStats(
        filterRecords(recOpt, filt as any),
        storyCount,
        spByArea,
        recOpt,
        suiteNames
    );
    ok = report("defectStats", statsCurrent, statsOpt) && ok;

    // --- Target 3: plan overviews ---
    for (const planId of planIds) {
        console.log(
            `\n[3] computePlanOverviewReference(${planId}) vs computePlanOverview`
        );
        clearPlanOverviewCache();
        clearDashboardCache();
        const poRef = await computePlanOverviewReference(planId, project);
        clearPlanOverviewCache();
        const poLive = await computePlanOverview(planId, project);
        // `testCases` is an Excel-only addition with no reference to diff.
        const strip = (po: any) => ({ ...po, testCases: undefined });
        ok =
            report(
                `planOverview:${planId}`,
                strip(poRef),
                strip(poLive)
            ) && ok;
    }

    console.log(
        ok
            ? "\n=== ✅ TUTTO IDENTICO - safe to swap ==="
            : "\n=== ❌ DIFFERENZE TROVATE - non fare lo swap ==="
    );
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});
