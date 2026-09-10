import {
  getDefectData,
  getAllSuiteNames,
  filterRecords,
  computeSprintDefectReport,
} from "./defectData.js";
import { computePlanOverview } from "./planOverviewData.js";
import { getFirstExecutionOutcomes } from "./testRunHistoryData.js";
import { classifyPlan } from "./planClassifier.js";
import { businessDaysBetween } from "./businessDays.js";
import { getIterations, type IterationNode } from "./azdo.js";
import { computeTestPlans } from "./dashboardData.js";
import type { ReportExtraKpis } from "./types.js";

// Finds the sprint immediately before `iterationPath` under the same parent
// node, ordered by start date (not by name - "Sprint 10" would otherwise
// sort before "Sprint 2"). Returns null when there's no dated sibling
// before it (e.g. the very first sprint, or an iteration tree without
// dates configured).
function findPreviousIteration(
  iterationPath: string,
  iterations: IterationNode[],
): IterationNode | null {
  const current = iterations.find((it) => it.path === iterationPath);
  if (!current || !current.startDate) {
    return null;
  }

  const parentPath = iterationPath.slice(
    0,
    iterationPath.length - current.name.length - 1,
  );

  const before = iterations
    .filter((it) => {
      const itParentPath = it.path.slice(
        0,
        it.path.length - it.name.length - 1,
      );
      return (
        itParentPath === parentPath &&
        it.path !== current.path &&
        it.startDate &&
        it.startDate < current.startDate!
      );
    })
    .sort((a, b) => (a.startDate! < b.startDate! ? 1 : -1));

  return before[0] ?? null;
}

// Same denominator style as the existing Bug Re-open Rate (see
// client/src/utils/export.ts's reopenedPct) - open bugs at Critical or High
// severity, as a % of total detected bugs in scope.
const CRITICAL_HIGH_SEVERITIES = new Set(["1 - Critical", "2 - High"]);

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

  const [records, allSuiteNames, overviews, firstExecutionOutcomes] =
    await Promise.all([
      getDefectData(project),
      getAllSuiteNames(project),
      Promise.all(
        planIds.map((planId) => computePlanOverview(planId, project)),
      ),
      getFirstExecutionOutcomes(project),
    ]);

  const filtered = filterRecords(records, { iteration, area });
  const report = computeSprintDefectReport(filtered, allSuiteNames);

  // KPI: Critical/High Bugs % (open only, mirrors report.reopenedCount's
  // denominator - see computeStatusCardKpis in client/src/utils/export.ts).
  const criticalHighOpenCount = report.effectiveDefects.filter(
    (bug) =>
      bug.state !== "Closed" &&
      CRITICAL_HIGH_SEVERITIES.has(bug.severity ?? ""),
  ).length;
  const criticalHighBugPct = report.total
    ? Math.round((criticalHighOpenCount / report.total) * 1000) / 10
    : 0;

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

  // KPI: Test Plan Correctness/Executability - a Blocked test case only
  // counts against the score if it has a linked bug (see ReportExtraKpis'
  // field comment for the process caveat this implies: an untracked
  // Blocked outcome doesn't lower the score).
  const allTestCases = overviews.flatMap((overview) => overview.testCases);
  const blockedWithLinkedBug = allTestCases.filter(
    (tc) => tc.outcome === "Blocked" && tc.bugIds.length > 0,
  ).length;
  const testPlanCorrectnessPct = allTestCases.length
    ? Math.round(
        ((allTestCases.length - blockedWithLinkedBug) / allTestCases.length) *
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
    functional: { passed: 0, failed: 0 },
    uat: { passed: 0, failed: 0 },
  };

  for (const overview of overviews) {
    const kind = classifyPlan(overview.planName);

    for (const testCase of overview.testCases) {
      const firstExecution = firstExecutionOutcomes.get(testCase.testCaseId);

      if (!firstExecution) {
        continue;
      }

      if (firstExecution.outcome === "Passed") {
        buckets[kind].passed++;
      } else if (firstExecution.outcome === "Failed") {
        buckets[kind].failed++;
      }
    }
  }

  const passRateOf = (bucket: {
    passed: number;
    failed: number;
  }): number | null => {
    const denominator = bucket.passed + bucket.failed;
    return denominator
      ? Math.round((bucket.passed / denominator) * 1000) / 10
      : null;
  };

  // KPI: Duplicate NotApplicable test cases - flags a NotApplicable test
  // case whose title also shows up as NotApplicable elsewhere: another
  // suite of the same plan(s) in scope, or the previous sprint's plan(s)
  // (same area path). Matched by title, not test case ID, because a test
  // case is a new work item (new ID, same title) each time it's
  // re-added to a suite - see the field comment on ReportExtraKpis.
  const notApplicableTestCases = allTestCases.filter(
    (tc) => tc.outcome === "NotApplicable",
  );

  const currentSuiteIdsByTitle = new Map<string, Set<number>>();
  for (const tc of notApplicableTestCases) {
    const suiteIds = currentSuiteIdsByTitle.get(tc.title) ?? new Set();
    suiteIds.add(tc.suiteId);
    currentSuiteIdsByTitle.set(tc.title, suiteIds);
  }

  const withinPlanDuplicateTitles = new Set(
    Array.from(currentSuiteIdsByTitle.entries())
      .filter(([, suiteIds]) => suiteIds.size > 1)
      .map(([title]) => title),
  );

  let previousSprintNotApplicableTitles = new Set<string>();
  let previousSprintName: string | null = null;

  if (iteration) {
    const iterations = await getIterations(project);
    const previous = findPreviousIteration(iteration, iterations);

    if (previous) {
      const previousPlans = (await computeTestPlans(project)).filter(
        (plan) =>
          plan.iteration === previous.path && (!area || plan.areaPath === area),
      );

      if (previousPlans.length) {
        const previousOverviews = await Promise.all(
          previousPlans.map((plan) => computePlanOverview(plan.id, project)),
        );

        previousSprintNotApplicableTitles = new Set(
          previousOverviews
            .flatMap((o) => o.testCases)
            .filter((tc) => tc.outcome === "NotApplicable")
            .map((tc) => tc.title),
        );
        previousSprintName = previous.name;
      }
    }
  }

  const duplicateTitles = new Set(
    Array.from(currentSuiteIdsByTitle.keys()).filter(
      (title) =>
        withinPlanDuplicateTitles.has(title) ||
        previousSprintNotApplicableTitles.has(title),
    ),
  );

  const duplicateNotApplicable = {
    count: duplicateTitles.size,
    pct: notApplicableTestCases.length
      ? Math.round(
          (duplicateTitles.size / notApplicableTestCases.length) * 1000,
        ) / 10
      : 0,
    titles: Array.from(duplicateTitles),
    previousSprintName,
  };

  return {
    firstExecutionPassRate: {
      functional: passRateOf(buckets.functional),
      uat: passRateOf(buckets.uat),
    },
    avgFixTimeBusinessDays,
    criticalHighBugPct,
    testPlanCorrectnessPct,
    duplicateNotApplicable,
  };
}
