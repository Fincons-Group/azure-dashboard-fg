import assert from "node:assert/strict";
import test from "node:test";
import type { SuiteProgressGroup } from "../components/StatusReportCard";
import type { SprintDefectReport } from "../types";
import { computeStatusCardKpis } from "./export";

test("executed breakdown reports Passed, Failed and Blocked while excluding N/A", () => {
  const suiteGroups: SuiteProgressGroup[] = [
    {
      label: "Regression",
      totalTestCases: 20,
      outcomeCounts: {
        Passed: 7,
        Failed: 3,
        Blocked: 1,
        Paused: 0,
        InProgress: 0,
        NotApplicable: 3,
        NotRun: 6,
      },
    },
  ];
  const report = {
    byStatusAll: { Closed: 0 },
    byStatus: { Closed: 0 },
    total: 0,
    outOfScopeCount: 0,
    effectiveCount: 0,
    reopenedCount: 0,
    byOriginDetected: {},
    effectiveDefects: [],
  } as unknown as SprintDefectReport;

  const kpis = computeStatusCardKpis(suiteGroups, report);

  assert.deepEqual(
    {
      passed: kpis.totalPassed,
      failed: kpis.totalFailed,
      blocked: kpis.totalBlocked,
      executed: kpis.totalExecuted,
      executedPct: kpis.executedPct,
      notApplicable: kpis.totalNotApplicable,
      notRun: kpis.totalNotRun,
    },
    {
      passed: 7,
      failed: 3,
      blocked: 1,
      executed: 11,
      executedPct: 55,
      notApplicable: 3,
      notRun: 6,
    },
  );
});
