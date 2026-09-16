import assert from "node:assert/strict";
import { test } from "node:test";
import type { DefectFilters } from "../types";
import type { DynamicSprintReportExcelData } from "./excelReport";
import {
    buildInitialReportText,
    buildFollowUpText,
    loadPreviousSnapshot,
    makeReportSnapshot,
    reportScopeKeyForSelection,
    saveReportSnapshot,
} from "./reportComparison";

const filters: DefectFilters = {
    iteration: "Sprint 2", area: "Area", environment: "", targetVersion: "", suites: [],
};

function report(passed: number, openBugs: number): DynamicSprintReportExcelData {
    return {
        meta: {
            title: "Sprint 2", project: "Project", areaPath: "Area",
            sprint: "Sprint 2", generatedAt: new Date("2026-09-15T10:00:00Z"),
        },
        plans: [{
            id: 12, name: "Plan", overview: {
                totalTestCases: 10,
                outcomeCounts: {
                    Passed: passed, Failed: 1, Blocked: 0, NotApplicable: 0,
                    Paused: 0, InProgress: 0, NotRun: 9 - passed,
                },
            } as DynamicSprintReportExcelData["plans"][number]["overview"],
        }],
        stats: { sprintDefectReport: {
            effectiveCount: openBugs,
            reopenedCount: 0,
            effectiveDefects: Array.from({ length: openBugs }, (_, id) => ({ id, state: "New" })),
        } } as unknown as DynamicSprintReportExcelData["stats"],
    };
}

test("only reports with the same scope and filters share a baseline", () => {
    const first = makeReportSnapshot(report(4, 3), filters);
    const reordered = reportScopeKeyForSelection("Project", "Area", "Sprint 2", [12], filters);
    const filtered = reportScopeKeyForSelection("Project", "Area", "Sprint 2", [12], {
        ...filters, suites: ["Suite A"],
    });
    assert.equal(first.scopeKey, reordered);
    assert.notEqual(first.scopeKey, filtered);
});

test("the first extraction also receives an email proposal", () => {
    const current = makeReportSnapshot(report(4, 3), filters);
    const text = buildInitialReportText(current, "it");
    assert.match(text, /primo report/);
    assert.match(text, /4 superati su 10/);
    assert.match(text, /3 aperti/);
});

test("follow-up reports measured changes from the previous extraction", () => {
    const previous = makeReportSnapshot(report(4, 3), filters);
    const current = makeReportSnapshot(report(6, 1), filters);
    const text = buildFollowUpText(previous, current, "it");
    assert.match(text, /test superati \+2/);
    assert.match(text, /aperti 1 \(-2\)/);
    assert.match(text, /6 su 10/);
});

test("a published report becomes the baseline for the next extraction", () => {
    const stored = new Map<string, string>();
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value),
        },
    });

    try {
        const first = makeReportSnapshot(report(4, 3), filters);
        saveReportSnapshot(first);
        const baseline = loadPreviousSnapshot(first.scopeKey);
        assert.deepEqual(baseline, first);

        const next = makeReportSnapshot(report(6, 1), filters);
        assert.match(buildFollowUpText(baseline!, next, "it"), /aperti 1 \(-2\)/);
    } finally {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: originalStorage,
        });
    }
});

test("the follow-up identifies new, closed, reopened and critical bugs", () => {
    const previousData = report(4, 0);
    previousData.stats.sprintDefectReport.effectiveDefects = [
        { id: 1, title: "Critical", state: "New", severity: "1 - Critical" },
        { id: 2, title: "Medium", state: "New", severity: "3 - Medium" },
        { id: 3, title: "Closed", state: "Closed", severity: "2 - High" },
    ];
    previousData.stats.sprintDefectReport.effectiveCount = 3;
    previousData.stats.sprintDefectReport.withoutResolutionDateCount = 1;

    const currentData = report(6, 0);
    currentData.stats.sprintDefectReport.effectiveDefects = [
        { id: 1, title: "Critical", state: "Closed", severity: "1 - Critical" },
        { id: 2, title: "Medium", state: "New", severity: "3 - Medium" },
        { id: 3, title: "Reopened", state: "Reopened", severity: "2 - High" },
        { id: 4, title: "New high", state: "New", severity: "2 - High" },
    ];
    currentData.stats.sprintDefectReport.effectiveCount = 4;
    currentData.stats.sprintDefectReport.withoutResolutionDateCount = 2;

    const text = buildFollowUpText(
        makeReportSnapshot(previousData, filters),
        makeReportSnapshot(currentData, filters),
        "it",
    );
    assert.match(text, /Andamento bug/);
    assert.match(text, /nuovi 1/);
    assert.match(text, /chiusi 1/);
    assert.match(text, /riaperti 1/);
    assert.match(text, /aperti 3 \(\+1\)/);
    assert.match(text, /critici\/alti aperti 2 \(\+1\)/);
    assert.match(text, /senza data di risoluzione 2 \(\+1\)/);
});
