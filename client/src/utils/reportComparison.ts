import type { DefectFilters, Outcome } from "../types";
import type { DynamicSprintReportExcelData } from "./excelReport";

const STORAGE_KEY = "dynamic-sprint-report-snapshots-v1";

export interface ReportSnapshot {
    scopeKey: string;
    generatedAt: string;
    totalTests: number;
    outcomes: Record<Outcome, number>;
    effectiveBugs: number;
    openBugs: number;
    reopenedBugs: number;
    bugStates: Record<string, string>;
    criticalHighOpenBugs: number;
    bugsWithoutResolutionDate: number;
}

export function reportScopeKeyForSelection(
    project: string,
    areaPath: string,
    sprint: string,
    planIds: number[],
    filters: DefectFilters,
): string {
    return JSON.stringify({
        project,
        areaPath,
        sprint,
        planIds: [...planIds].sort((a, b) => a - b),
        environment: filters.environment,
        targetVersion: filters.targetVersion,
        suites: [...filters.suites].sort(),
    });
}

export function reportScopeKey(data: DynamicSprintReportExcelData, filters: DefectFilters): string {
    return reportScopeKeyForSelection(
        data.meta.project, data.meta.areaPath, data.meta.sprint,
        data.plans.map((plan) => plan.id), filters,
    );
}

export function makeReportSnapshot(data: DynamicSprintReportExcelData, filters: DefectFilters): ReportSnapshot {
    const outcomes: Record<Outcome, number> = {
        Passed: 0, Failed: 0, Blocked: 0, NotApplicable: 0,
        Paused: 0, InProgress: 0, NotRun: 0,
    };
    let totalTests = 0;
    for (const plan of data.plans) {
        if (!plan.overview) continue;
        totalTests += plan.overview.totalTestCases;
        for (const outcome of Object.keys(outcomes) as Outcome[]) {
            outcomes[outcome] += plan.overview.outcomeCounts[outcome] ?? 0;
        }
    }

    const report = data.stats.sprintDefectReport;
    const openDefects = report.effectiveDefects.filter(
        (bug) => bug.state !== "Closed" && bug.state !== "Removed"
    );
    return {
        scopeKey: reportScopeKey(data, filters),
        generatedAt: data.meta.generatedAt.toISOString(),
        totalTests,
        outcomes,
        effectiveBugs: report.effectiveCount,
        openBugs: openDefects.length,
        reopenedBugs: report.reopenedCount,
        bugStates: Object.fromEntries(
            report.effectiveDefects.map((bug) => [String(bug.id), bug.state])
        ),
        criticalHighOpenBugs: openDefects.filter((bug) =>
            /^[12]\s*-/.test(bug.severity ?? "")
        ).length,
        bugsWithoutResolutionDate: report.withoutResolutionDateCount ?? 0,
    };
}

export function loadPreviousSnapshot(scopeKey: string): ReportSnapshot | null {
    try {
        const snapshots = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        const previous = snapshots[scopeKey];
        return previous?.scopeKey === scopeKey && Number.isFinite(previous.totalTests) &&
            Number.isFinite(previous.openBugs) && Number.isFinite(previous.reopenedBugs) &&
            Number.isFinite(previous.outcomes?.Passed) && Number.isFinite(previous.outcomes?.Failed) &&
            Number.isFinite(previous.outcomes?.Blocked)
            ? previous as ReportSnapshot
            : null;
    } catch {
        return null;
    }
}

export function saveReportSnapshot(snapshot: ReportSnapshot): void {
    try {
        const snapshots = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        snapshots[snapshot.scopeKey] = snapshot;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    } catch {
        // Export succeeded even if browser storage is unavailable.
    }
}

export function buildFollowUpText(previous: ReportSnapshot, current: ReportSnapshot, language: string): string {
    const it = language.startsWith("it");
    const date = new Date(previous.generatedAt).toLocaleString(it ? "it-IT" : "en-GB");
    const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
    const testChanges = [
        [it ? "test superati" : "passed tests", current.outcomes.Passed - previous.outcomes.Passed],
        [it ? "test falliti" : "failed tests", current.outcomes.Failed - previous.outcomes.Failed],
        [it ? "test bloccati" : "blocked tests", current.outcomes.Blocked - previous.outcomes.Blocked],
    ] as const;
    const changedTests = testChanges.filter(([, delta]) => delta !== 0);
    const testDetail = changedTests.length
        ? changedTests.map(([label, delta]) => `${label} ${signed(delta)}`).join(", ")
        : it ? "nessuna variazione nei principali indicatori" : "no change in the main indicators";

    const previousStates = previous.bugStates ?? {};
    const currentStates = current.bugStates ?? {};
    const hasBugHistory = Object.keys(previousStates).length > 0;
    const isClosed = (state: string) => state === "Closed" || state === "Removed";
    const newBugs = hasBugHistory
        ? Object.keys(currentStates).filter((id) => previousStates[id] == null).length
        : null;
    const closedBugs = hasBugHistory
        ? Object.entries(currentStates).filter(
            ([id, state]) => previousStates[id] != null &&
                !isClosed(previousStates[id]) && isClosed(state)
        ).length
        : null;
    const reopenedSincePrevious = hasBugHistory
        ? Object.entries(currentStates).filter(
            ([id, state]) => previousStates[id] != null &&
                isClosed(previousStates[id]) && !isClosed(state)
        ).length
        : Math.max(0, current.reopenedBugs - previous.reopenedBugs);
    const openDelta = current.openBugs - previous.openBugs;
    const criticalCurrent = current.criticalHighOpenBugs ?? 0;
    const criticalPrevious = previous.criticalHighOpenBugs;
    const missingDateCurrent = current.bugsWithoutResolutionDate ?? 0;
    const missingDatePrevious = previous.bugsWithoutResolutionDate;
    const bugDetails = [
        ...(newBugs == null ? [] : [it ? `nuovi ${newBugs}` : `new ${newBugs}`]),
        ...(closedBugs == null ? [] : [it ? `chiusi ${closedBugs}` : `closed ${closedBugs}`]),
        it ? `riaperti ${reopenedSincePrevious}` : `reopened ${reopenedSincePrevious}`,
        it
            ? `aperti ${current.openBugs} (${signed(openDelta)})`
            : `open ${current.openBugs} (${signed(openDelta)})`,
        criticalPrevious == null
            ? it
                ? `critici/alti aperti ${criticalCurrent}`
                : `open critical/high ${criticalCurrent}`
            : it
                ? `critici/alti aperti ${criticalCurrent} (${signed(criticalCurrent - criticalPrevious)})`
                : `open critical/high ${criticalCurrent} (${signed(criticalCurrent - criticalPrevious)})`,
        missingDatePrevious == null
            ? it
                ? `senza data di risoluzione ${missingDateCurrent}`
                : `without a resolution date ${missingDateCurrent}`
            : it
                ? `senza data di risoluzione ${missingDateCurrent} (${signed(missingDateCurrent - missingDatePrevious)})`
                : `without a resolution date ${missingDateCurrent} (${signed(missingDateCurrent - missingDatePrevious)})`,
    ].join(", ");

    return it
        ? `Buongiorno,\n\ncondivido il report aggiornato. Rispetto al report del ${date}:\n\nAndamento test: ${testDetail}. Il totale dei test superati è ${current.outcomes.Passed} su ${current.totalTests}.\n\nAndamento bug: ${bugDetails}.\n\nResto a disposizione per eventuali approfondimenti.`
        : `Hello,\n\nI am sharing the updated report. Compared with the report from ${date}:\n\nTest progress: ${testDetail}. Passed tests total ${current.outcomes.Passed} out of ${current.totalTests}.\n\nBug progress: ${bugDetails}.\n\nPlease let me know if you would like further details.`;
}

export function buildInitialReportText(current: ReportSnapshot, language: string): string {
    const it = language.startsWith("it");

    return it
        ? `Buongiorno,\n\ncondivido il primo report relativo all'ambito selezionato.\n\nAndamento test: ${current.outcomes.Passed} superati su ${current.totalTests}, ${current.outcomes.Failed} falliti e ${current.outcomes.Blocked} bloccati.\n\nAndamento bug: ${current.openBugs} aperti, di cui ${current.criticalHighOpenBugs ?? 0} critici/alti; ${current.bugsWithoutResolutionDate ?? 0} sono ancora senza data di risoluzione.\n\nQuesta estrazione verrà utilizzata come riferimento per evidenziare le variazioni nei prossimi aggiornamenti.\n\nResto a disposizione per eventuali approfondimenti.`
        : `Hello,\n\nI am sharing the first report for the selected scope.\n\nTest progress: ${current.outcomes.Passed} passed out of ${current.totalTests}, ${current.outcomes.Failed} failed, and ${current.outcomes.Blocked} blocked.\n\nBug progress: ${current.openBugs} open, including ${current.criticalHighOpenBugs ?? 0} critical/high; ${current.bugsWithoutResolutionDate ?? 0} still have no resolution date.\n\nThis extraction will be used as the baseline for highlighting changes in future updates.\n\nPlease let me know if you would like further details.`;
}
