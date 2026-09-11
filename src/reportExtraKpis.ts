import {
  getDefectData,
  getAllSuiteNames,
  filterRecords,
  computeSprintDefectReport,
} from "./defectData.js";
import { computePlanOverview } from "./planOverviewData.js";
import {
  getFirstExecutionOutcomes,
  getFirstExecutionStepSummaries,
} from "./testRunHistoryData.js";
import { classifyPlan } from "./planClassifier.js";
import { businessDaysBetween } from "./businessDays.js";
import type { ReportExtraKpis } from "./types.js";

export interface ComputeReportExtraKpisParams {
  project?: string;
  area?: string;
  iteration?: string;
  planIds: number[];
}

export async function computeReportExtraKpis(
  params: ComputeReportExtraKpisParams,
): Promise<ReportExtraKpis> {
  const { project, area, iteration, planIds } = params;

  const [
    records,
    allSuiteNames,
    overviews,
    firstExecutionOutcomes,
    firstExecutionSteps,
  ] =
    await Promise.all([
      getDefectData(project),
      getAllSuiteNames(project),
      Promise.all(
        planIds.map((planId) => computePlanOverview(planId, project)),
      ),
      getFirstExecutionOutcomes(project, planIds),
      getFirstExecutionStepSummaries(project, planIds),
    ]);

  const filtered = filterRecords(records, { iteration, area });
  const report = computeSprintDefectReport(filtered, allSuiteNames);
  const allTestCases = overviews.flatMap((overview) => overview.testCases);

  // KPI: Critical Defect Rate. The PDF defines the denominator as executed
  // test cases (and explicitly includes NotApplicable), not total bugs.
  const executedOutcomes = new Set([
    "Passed",
    "Failed",
    "Blocked",
    "NotApplicable",
  ]);
  const executedTestCaseCount = allTestCases.filter((testCase) =>
    executedOutcomes.has(testCase.outcome),
  ).length;
  const criticalDefectCount = report.effectiveDefects.filter(
    (bug) => bug.severity === "1 - Critical",
  ).length;
  const criticalHighBugPct = executedTestCaseCount
    ? Math.round((criticalDefectCount / executedTestCaseCount) * 1000) / 10
    : null;

  // KPI: Average Bug Fix Time - opened -> first Resolved, business days.
  const resolvedBugs = filtered.filter((r) => r.firstResolvedTransition);
  const avgFixTimeBusinessDays = resolvedBugs.length
    ? Math.round(
        (resolvedBugs.reduce(
          (sum, r) =>
            sum +
            businessDaysBetween(
              new Date(r.createdDate),
              new Date(r.firstResolvedTransition!.changedDate),
            ),
          0,
        ) /
          resolvedBugs.length) *
          10,
      ) / 10
    : null;

  // In this team's process, an incorrect/non-executable case is marked N/A
  // during Execute. That Azure outcome is therefore the authoritative flag.
  const notApplicableCount = allTestCases.filter(
    (tc) => tc.outcome === "NotApplicable",
  ).length;
  const testPlanCorrectnessPct = allTestCases.length
    ? Math.round(
        ((allTestCases.length - notApplicableCount) / allTestCases.length) *
          1000,
      ) / 10
    : 100;

  // KPI: First Execution Pass Rate, split Functional vs UAT. Each test
  // case's plan is classified once (by the overview it belongs to, so
  // testCaseId doesn't need to double as a lookup key), then its earliest
  // recorded outcome is bucketed. NotRun/Blocked/etc first attempts are
  // excluded from the denominator, matching the existing passRate
  // convention in computeStatusCardKpis (which excludes NotApplicable).
  const buckets = {
    functional: { passed: 0, executed: 0, stepPassed: 0, stepExecuted: 0 },
    uat: { passed: 0, executed: 0, stepPassed: 0, stepExecuted: 0 },
  };

  const finishedOutcomes = new Set([
    "passed",
    "failed",
    "blocked",
    "notapplicable",
    "inconclusive",
    "timeout",
    "aborted",
    "warning",
    "error",
  ]);

  for (const overview of overviews) {
    const kind = classifyPlan(overview.planName);

    for (const testCase of overview.testCases) {
      const firstExecution = firstExecutionOutcomes.get(testCase.testCaseId);

      if (!firstExecution) {
        continue;
      }

      const normalizedOutcome = firstExecution.outcome.toLowerCase();
      if (finishedOutcomes.has(normalizedOutcome)) {
        buckets[kind].executed++;
      }
      if (normalizedOutcome === "passed") {
        buckets[kind].passed++;
      }

      const stepSummary = firstExecutionSteps.get(testCase.testCaseId);
      if (stepSummary) {
        buckets[kind].stepPassed += stepSummary.passed;
        buckets[kind].stepExecuted += stepSummary.executed;
      }
    }
  }

  const passRateOf = (bucket: {
    passed: number;
    executed: number;
  }): number | null => {
    return bucket.executed
      ? Math.round((bucket.passed / bucket.executed) * 1000) / 10
      : null;
  };

  const stepPassRateOf = (bucket: {
    stepPassed: number;
    stepExecuted: number;
  }): number | null =>
    bucket.stepExecuted
      ? Math.round((bucket.stepPassed / bucket.stepExecuted) * 1000) / 10
      : null;

  const verifiedBugs = filtered.filter((bug) => bug.firstResolvedTransition);
  const reopenedAfterVerificationCount = verifiedBugs.filter(
    (bug) => bug.reopenedCount > 0,
  ).length;
  const bugReopenRate = verifiedBugs.length
    ? Math.round((reopenedAfterVerificationCount / verifiedBugs.length) * 1000) /
      10
    : null;

  const closedBugs = filtered.filter((bug) => bug.closedDate);
  const avgClosingTimeBusinessDays = closedBugs.length
    ? Math.round(
        (closedBugs.reduce(
          (sum, bug) =>
            sum +
            businessDaysBetween(
              new Date(bug.createdDate),
              new Date(bug.closedDate!),
            ),
          0,
        ) /
          closedBugs.length) *
          10,
      ) / 10
    : null;

  return {
    firstExecutionPassRate: {
      functional: passRateOf(buckets.functional),
      uat: passRateOf(buckets.uat),
      functionalSteps: stepPassRateOf(buckets.functional),
      uatSteps: stepPassRateOf(buckets.uat),
    },
    avgFixTimeBusinessDays,
    criticalHighBugPct,
    testPlanCorrectnessPct,
    bugReopenRate,
    avgClosingTimeBusinessDays,
  };
}
