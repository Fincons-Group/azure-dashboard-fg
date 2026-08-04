import type { TestCaseRow } from "../types";

export interface GroupStats {
    total: number;
    withOpenBugs: number;
    withoutOpenBugs: number;
    activeBugs: number;
    closedBugs: number;
    passed: number;
    failed: number;
    blocked: number;
    notApplicable: number;
    notRun: number;
    passRate: number;
    passRateExclNA: number;
}

export function computeGroupStats(
    rows: TestCaseRow[]
): GroupStats {
    let withOpenBugs = 0;
    let activeBugs = 0;
    let closedBugs = 0;
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notApplicable = 0;
    let notRun = 0;

    for (const tc of rows) {
        const active = tc.bugs.filter((b) => b.state !== "Closed").length;

        activeBugs += active;
        closedBugs += tc.bugs.length - active;

        if (tc.hasOpenBugs) {
            withOpenBugs++;
        }

        if (tc.outcome === "Passed") {
            passed++;
        } else if (tc.outcome === "Failed") {
            failed++;
        } else if (tc.outcome === "Blocked") {
            blocked++;
        } else if (tc.outcome === "NotApplicable") {
            notApplicable++;
        } else {
            notRun++;
        }
    }

    const total = rows.length;
    const passRate = total
        ? Math.round((passed / total) * 1000) / 10
        : 0;

    // Not Applicable cases are neither a pass nor a fail, so they shouldn't
    // dilute the pass rate the way an unrun or failed case would - same
    // convention as CoverageSection's suitePassRateExcludingNA.
    const applicable = total - notApplicable;
    const passRateExclNA = applicable
        ? Math.round((passed / applicable) * 1000) / 10
        : 0;

    return {
        total,
        withOpenBugs,
        withoutOpenBugs: total - withOpenBugs,
        activeBugs,
        closedBugs,
        passed,
        failed,
        blocked,
        notApplicable,
        notRun,
        passRate,
        passRateExclNA,
    };
}
