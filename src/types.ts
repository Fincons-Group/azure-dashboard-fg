export type Outcome =
  | "Passed"
  | "Failed"
  | "Blocked"
  | "NotApplicable"
  | "Paused"
  | "InProgress"
  | "NotRun";

export interface BugInfo {
  id: number;
  title: string;
  state: string;
  // Plain-text extract of the bug's Description / Repro Steps, truncated -
  // see htmlToPlainText in dashboardData.ts.
  description?: string;
  url?: string;
  creator?: string;
  assignee?: {
    displayName: string;
    uniqueName: string;
  };
  // ISO strings straight from Azure DevOps (System.CreatedDate /
  // System.ChangedDate / Microsoft.VSTS.Common.ClosedDate). Optional so
  // responses served from an older cache still type-check.
  createdDate?: string;
  changedDate?: string;
  closedDate?: string;
}

export type MyWorkItemsMode =
  | "assigned"
  | "mentioned"
  | "following"
  | "created";

export interface WorkItemSummary {
  id: number;
  title: string;
  type: string;
  state: string;
  priority?: number;
  changedDate?: string;
  createdDate?: string;
  closedDate?: string;
  url?: string;
  assignee?: {
    displayName: string;
    uniqueName: string;
  };
  creator?: {
    displayName: string;
    uniqueName: string;
  };
  mentions?: string[];
  tags?: string[];
}

export interface TestCaseRow {
  planName: string;
  areaPath: string;
  iteration?: string;
  suiteName: string;
  suiteId: number;
  testCaseId: number;
  testCaseTitle: string;
  testCaseUrl?: string;
  priority: number;
  hasOpenBugs: boolean;
  outcome: Outcome;
  bugs: BugInfo[];
  lastRunId?: number;
  lastRunUrl?: string;
}

export interface SuiteStat {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notApplicable: number;
  notRun: number;
  openBugs: number;
}

export interface TestPlanSummary {
  id: number;
  name: string;
  url?: string;
  areaPath?: string;
  iteration?: string;
  state?: string;
  owner?: string;
}

export interface TestCaseSummary {
  id: number;
  title: string;
  suiteId: number;
}

export interface TestSuiteSummary {
  id: number;
  name: string;
  testCases: TestCaseSummary[];
  children: TestSuiteSummary[];
}

export interface RunCard {
  id: number;
  name: string;
  state: string;
  startedDate?: string;
  completedDate?: string;
  url?: string;
  counts: Record<Outcome, number>;
  total: number;
  passRate: number;
}

export interface AutomationTestCaseRow {
  testCaseId: number;
  testCaseTitle: string;
  planId: number;
  planName: string;
  areaPath: string;
  iteration?: string;
  suiteName: string;
  isAutomated: boolean;
}

export interface AutomationKpis {
  automatedTests: number;
  manualTests: number;
  automationCoveragePct: number;
  flakyTestsCount: number;
  automationSuccessRatePct: number;
}

export interface CoverageByModule {
  module: string;
  automated: number;
  manual: number;
  coveragePct: number;
}

export interface FlakyTestRankItem {
  testCaseId: number;
  testName: string;
  flakeCount: number;
  lastFailedDate?: string;
}

// Real automation coverage/success-rate/flaky-test KPIs, computed from Test
// Factory's Test Case `Microsoft.VSTS.TCM.AutomationStatus` field - distinct
// from CoverageArea/CycleTimeResponse, which track Epic->task completion,
// not test-case automation status. No CI/CD metrics here: there is no real
// pipeline data source wired up (a prior version of this feature hardcoded
// mock pipeline numbers - deliberately not resurrected).
export interface AutomationKpiResponse {
  kpis: AutomationKpis;
  coverageByModule: CoverageByModule[];
  flakyTests: FlakyTestRankItem[];
}

export interface DashboardStats {
  areaPaths: string[];
  suites: string[];
  priorities: number[];
  totalTestCases: number;
  withOpenBugs: number;
  withoutOpenBugs: number;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  notApplicableCount: number;
  notRunCount: number;
  executedCount: number;
  passRate: number;
  groupedByPriority: Record<string, TestCaseRow[]>;
}

export interface TrendPoint {
  date: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notApplicable: number;
  notRun: number;
  passRate: number;
  cumulativeExecuted: number;
}

export interface ExecutionTrendResponse {
  trend: TrendPoint[];
  totalTestCases: number;
}

export interface AffectedTestCase {
  id: number;
  title: string;
}

export interface ErrorSummary {
  signature: string;
  sampleMessage: string;
  count: number;
  affectedTestCases: AffectedTestCase[];
  lastOccurred?: string;
}

export interface CommonErrorsResponse {
  errors: ErrorSummary[];
  totalFailedResults: number;
  cacheTimestamp: number;
}

export type ClosureReason =
  | "Valid Defect"
  | "OutOfScope"
  | "Duplicate"
  | "Not Reproducible";

export interface DefectRecord {
  id: number;
  title: string;
  state: string;
  // Plain-text extract of the bug's Description / Repro Steps, truncated -
  // see htmlToPlainText in dashboardData.ts.
  description?: string;
  reason?: string;
  severity?: string;
  priority?: number;
  areaPath: string;
  iterationPath?: string;
  suiteName?: string;
  // Only set for bugs whose own suite doesn't map to a real Test Factory
  // suite (currently Test Agenti/Business) - the suite resolved by
  // matching the linked test case's title against its equivalently-titled
  // original in a genuine Test Factory suite. See getTestCaseLookups in
  // defectData.ts.
  resolvedSuiteName?: string;
  environment?: string;
  createdDate: string;
  closedDate?: string;
  changedDate: string;
  estimatedResolutionDate?: string;
  reopenedCount: number;
  hasLinkedTestCase: boolean;
  tags: string[];
  closureReason?: ClosureReason;
  url?: string;
  creator?: string;
  assignedTo?: { displayName: string; uniqueName: string };
  // When the bug moved into its current state - only meaningful while
  // state is "Da verificare" (see VERIFICA_STATE in defectData.ts), used
  // to trigger the Teams "sent to verifica" notification without a second
  // revisions fetch.
  verificaTransition?: { changedDate: string };
  // Same idea, but for the combined "Da verificare"/"In verifica" window
  // (see VERIFICA_PENDING_STATES in defectData.ts) - used by the
  // per-assignee verifica Teams notification, which cares about either
  // sub-state.
  verificaPendingTransition?: { changedDate: string };
  // Opposite direction of verificaPendingTransition - last time the bug
  // LEFT the "Da verificare"/"In verifica" window (whether it passed to
  // Closed or bounced back to Reopened/New). Used to count "verified
  // today" for the Sprint Defect Report's Azione 2 auto-text.
  verificaExitTransition?: { changedDate: string };
  // Last time the bug transitioned into "Riaperto" - same idea as
  // reopenedCount (a lifetime total) but date-stamped, so "reopened today"
  // can be computed without a second revisions fetch.
  lastReopenedTransition?: { changedDate: string };
  // First time the bug transitioned into Resolved/Da verificare (fix ready
  // for retest) - distinct from closedDate, which is when QA signed off.
  // Used by the "Average Bug Fix Time" KPI (opened -> first Resolved, not
  // opened -> Closed). Not copied into DefectSummary, so it never reaches
  // /api/defects' JSON response - see computeSprintDefectReport's
  // toSummary() in defectData.ts.
  firstResolvedTransition?: { changedDate: string };
}

export interface DefectSummary {
  id: number;
  title: string;
  state: string;
  description?: string;
  priority?: number;
  severity?: string;
  ageDays?: number;
  url?: string;
  creator?: string;
  assignee?: { displayName: string; uniqueName: string };
  // ISO strings from Azure DevOps - carried through so the Excel export can
  // show them and build its "today's bugs" sheet. Optional: absent on
  // responses served from an older server cache.
  createdDate?: string;
  changedDate?: string;
  closedDate?: string;
  estimatedResolutionDate?: string;
  // Report origin ("Test Factory" | "Test Agenti" | "Business" | "DSI") and
  // whether the bug is tagged out-of-scope - see computeSprintDefectReport.
  origin?: string;
  outOfScope?: boolean;
}

export type DefectWithoutTestCase = DefectSummary;

export interface DefectTrendPoint {
  weekStart: string;
  opened: number;
  closed: number;
  openTotal: number;
}

export interface BacklogTrendPoint extends DefectTrendPoint {
  delta: number;
}

export interface AgingBucket {
  bucket: string;
  count: number;
}

export type BacklogDirection = "growing" | "stable" | "shrinking";

// Verifica activity for TEAMS_VERIFICA_ASSIGNEE_ALLOWLIST's people, scoped to
// whatever records the caller passes in (e.g. the currently selected area
// path/sprint) - drives the Sprint Defect Report's auto-generated Azione 2
// text. All four counts are independent of each other (a bug can count
// toward verifiedToday and closedToday at once if it was verified-and-closed
// the same day).
export interface VerificaActivitySummary {
  // Left "Da verificare"/"In verifica" today, regardless of where it went.
  verifiedToday: number;
  closedToday: number;
  // Subset of closedToday that's also tagged OutOfScope.
  closedTodayOutOfScopeCount: number;
  // Transitioned into "Riaperto" today.
  reopenedToday: number;
  // Currently sitting in "Da verificare"/"In verifica" (not date-scoped).
  stillPendingVerification: number;
  // Separate from the allowlist-scoped counts above: bugs sitting in "Da
  // verificare"/"In verifica" whose assignee is NOT on the allowlist,
  // split by who they belong to - a @gruppoitas.it email is DSI, anyone
  // else (not on the allowlist, not @gruppoitas.it) is the System
  // Integrator. Priority order matters: an allowlisted person is always
  // Test Factory even if their email happened to also match one of these.
  dsiPendingCount: number;
  siPendingCount: number;
}

export interface SprintDefectReport {
  total: number;
  effectiveCount: number;
  outOfScopeCount: number;
  byOrigin: Record<string, number>;
  // Like byOrigin, but counting every detected bug (including out-of-scope
  // ones) rather than just the effective/in-scope subset.
  byOriginDetected: Record<string, number>;
  byStatus: Record<string, number>;
  byStatusAll: Record<string, number>;
  bySeverity: Record<string, number>;
  // Effective (in-scope) bug count per suite, Test Factory suites only
  // (DSI and Test Agenti excluded) - zero-seeded so a suite with no bugs
  // still shows 0.
  testFactoryBySuite: Record<string, number>;
  // Same shape, but for Test Agenti/Business-origin bugs, bucketed by
  // their *resolved* suite (see DefectRecord.resolvedSuiteName) rather
  // than their own Custom.Suite value.
  testAgentiBySuite: Record<string, number>;
  testBusinessBySuite: Record<string, number>;
  effectiveDefects: DefectSummary[];
  // Every detected DSI-origin bug (in-scope or not), so the report can list
  // them without a second query - the DSI suite lives in the bug's own
  // Custom.Suite field, not in any selected test plan's suite tree.
  dsiDefects: DefectSummary[];
  // Same idea for Business-origin bugs (Custom.Suite = "Test Business") -
  // drives the Excel export's "Bug Business" sheet.
  businessDefects: DefectSummary[];
  // Every detected bug (any origin, in-scope or not) created or last changed
  // "today" in the report timezone (TEAMS_VERIFICA_TIMEZONE, default
  // Europe/Rome) - drives the Excel export's "Bug Odierni" sheet.
  todaysDefects: DefectSummary[];
  // Both scoped to ALL detected bugs (like byStatusAll/total), not just
  // the effective subset - reopened/unresolved-time tracking applies to
  // out-of-scope bugs too.
  reopenedCount: number;
  mttrDays: number | null;
  // Also scoped to ALL detected bugs (like total/byStatusAll) - a bug
  // still needs an estimated resolution date whether or not it's in-scope.
  withoutResolutionDateCount: number;
}

export interface DefectFilterOptions {
  iterations: string[];
  areas: string[];
  environments: string[];
  targetVersions: string[];
  suites: string[];
}

export interface DefectFilterParams {
  iteration?: string;
  area?: string;
  environment?: string;
  targetVersion?: string;
  suites?: string[];
}

export interface DefectStats {
  totalOpen: number;
  totalClosed: number;
  bySeverity: Record<string, number>;
  byPriority: Record<string, number>;
  byComponent: Record<string, number>;
  byTeam: Record<string, number>;
  byTestSuite: Record<string, number>;
  byAssignee: Record<string, number>;
  trend: DefectTrendPoint[];
  mttrDays: number | null;
  agingBuckets: AgingBucket[];
  reopenDistribution: AgingBucket[];
  reopenedBugCount: number;
  reopenRate: number;
  duplicateRate: number;
  bugsPerStory: number | null;
  defectsWithoutLinkedTestCase: DefectWithoutTestCase[];
  defectsWithoutSuite: DefectSummary[];
  defectLeakageRate: number | null;
  defectRejectionRate: number;
  regressionRate: number;
  rejectionReasons: Record<string, number>;
  closureReasonBreakdown: Record<string, number>;
  outOfScopeRate: number;
  outOfScopeBySuite: Record<string, number>;
  sprintDefectReport: SprintDefectReport;
  verificaActivitySummary: VerificaActivitySummary;
  firstTimeFixRate: number | null;
  densityByComponent: Record<string, number | null>;
  backlogTrend: BacklogTrendPoint[];
  backlogDirection: BacklogDirection;
  slaBreaches: DefectSummary[];
  availableFilters: DefectFilterOptions;
}

export interface DefectDashboardResponse {
  stats: DefectStats;
  cacheTimestamp: number;
}

export interface PlanOverviewBugState {
  name: string;
  color: string;
  category: string;
}

export interface PlanOverviewBugStateCount {
  state: string;
  count: number;
  color?: string;
  category?: string;
}

export interface PlanOverviewSuiteCount {
  suiteName: string;
  count: number;
}

export interface PlanOverviewSuiteDetail {
  suiteId: number;
  suiteName: string;
  totalTestCases: number;
  outcomeCounts: Record<Outcome, number>;
  bugs: BugInfo[];
}

// One row per test case in a plan, with everything the Excel export's
// filterable "Casi di Test" sheet needs. Populated by computePlanOverview().
export interface PlanOverviewTestCase {
  suiteId: number;
  suiteName: string;
  testCaseId: number;
  title: string;
  url?: string;
  // Test Case work item state (Design | Ready | Closed).
  state?: string;
  priority: number;
  // Aggregated execution verdict across the test case's points (same value
  // that feeds the suite outcome counts).
  outcome: Outcome;
  // Reached a real verdict (Passed | Failed | Blocked).
  executed: boolean;
  notRun: boolean;
  // Executed but has open bugs -> needs another pass once they're fixed.
  needsRetest: boolean;
  automationStatus?: string;
  assignedTo?: string;
  // Tester the point is assigned to (may differ from who actually ran it).
  tester?: string;
  // Identity that ran the most recent result.
  lastRunBy?: string;
  lastRunAt?: string;
  daysSinceLastRun?: number;
  configuration?: string;
  tags: string[];
  bugCount: number;
  hasOpenBugs: boolean;
  bugIds: number[];
  areaPath?: string;
  lastRunId?: number;
  lastRunUrl?: string;
}

export interface PlanOverviewResponse {
  planId: number;
  planName: string;
  reportUrl?: string; // first URL found in the plan's ADO description, if any
  totalTestCases: number;
  totalBugs: number;
  testsBySuite: PlanOverviewSuiteCount[];
  outcomeCounts: Record<Outcome, number>;
  bugStates: PlanOverviewBugState[];
  bugsByState: PlanOverviewBugStateCount[];
  bugs: BugInfo[];
  suites: PlanOverviewSuiteDetail[];
  testCases: PlanOverviewTestCase[];
}

// Sourced from the Analytics OData feed (TestPointHistorySnapshot), which
// has a `NotApplicable` bucket the REST-based `Outcome` union above doesn't,
// so this is intentionally its own shape rather than reusing `Outcome`.
export interface TestPlanProgressCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notApplicable: number;
  notExecuted: number;
}

export interface TestPlanProgressNode {
  id: number;
  title: string;
  counts: TestPlanProgressCounts;
  children: TestPlanProgressNode[];
}

export interface TestPlanProgressResponse {
  planId: number;
  planTitle: string;
  nodes: TestPlanProgressNode[];
}

export interface DeleteTestCaseItem {
  planId: number;
  suiteId: number;
  testCaseId: number;
}

export interface DeleteTestCasesResult {
  deleted: number[];
  failed: { id: number; message: string }[];
}

export interface SprintInfo {
  // A hand-maintained sprint from sprints.ts has a numeric id; a sprint
  // derived from a real Azure DevOps iteration (see releaseReadinessData's
  // iteration-scoped path) uses its iteration path as an opaque id instead.
  id: number | string;
  name: string;
  startDate: string;
  endDate: string;
  hasEnded: boolean;
}

export type RagStatus = "green" | "amber" | "red";

// Mirrors the org's formal release exit-criteria checklist (code_coverage.md,
// "Criteri di Accettazione - Test Funzionali Manuali"): each row is either a
// hard BLOCK gate or a WARN (tracked-only, doesn't block release).
export type GateAction = "block" | "warn";

export type GateCriterionId =
  | "testsExecuted"
  | "testsPassed"
  | "requirementsCoverage"
  | "testCaseRelevance"
  | "criticalDefectsOpen"
  | "highDefectsOpen"
  | "mediumDefectsOpen"
  | "lowDefectsOpen";

export interface ReleaseGateCriterion {
  id: GateCriterionId;
  action: GateAction;
  target: string;
  // null when the underlying data isn't available yet (e.g. requirements
  // coverage needs test-case-to-requirement links that aren't built) -
  // the criterion is still listed, but excluded from the pass/fail count
  // and from the RAG computation.
  actual: string | null;
  tracked: boolean;
  passed: boolean;
}

export interface ReleaseGateSummary {
  ragStatus: RagStatus;
  criteria: ReleaseGateCriterion[];
  trackedCount: number;
  passingCount: number;
}

export interface SprintCompletion {
  plannedCount: number;
  // Includes notApplicableCount below - a Not Applicable test case was
  // still assessed by a tester, just found out-of-scope, so it counts as
  // executed the same as a Passed/Failed/Blocked one. Only notExecutedCount
  // (never run at all) is excluded, so plannedCount == executedCount +
  // notExecutedCount.
  executedCount: number;
  notExecutedCount: number;
  // Subset of executedCount marked out-of-scope for the release.
  notApplicableCount: number;
  // notApplicableCount as a % of plannedCount - same figure as the
  // testCaseRelevance gate criterion's `actual`, surfaced here too for the
  // Sprint Metrics stat row.
  testCaseRelevancePct: number;
  completionRatePct: number;
  carryOverCount: number;
}

export interface PassRateDelta {
  currentSprintPassRate: number | null;
  previousSprintPassRate: number | null;
  deltaPct: number | null;
  previousSprintName: string | null;
}

export interface BlockingDefect {
  id: number;
  title: string;
  severity?: string;
  priority?: number;
  state: string;
  url?: string;
  creator?: string;
  assignee?: { displayName: string; uniqueName: string };
}

export interface BlockingDefectsSummary {
  criticalCount: number;
  highCount: number;
  totalCount: number;
  items: BlockingDefect[];
}

export interface ReleaseReadinessResponse {
  sprint: SprintInfo;
  releaseGate: ReleaseGateSummary;
  completion: SprintCompletion;
  passRateDelta: PassRateDelta;
  blockingDefects: BlockingDefectsSummary;
  cacheTimestamp: number;
}

export interface NavBadgesResponse {
  openCriticalHighDefects: number;
}

// Served by GET /api/report-extra-kpis, a companion endpoint to the Sprint
// Report's main /api/defects + /api/plans/:planId/overview calls - kept
// separate rather than folded into either response because computing
// firstExecutionPassRate requires enumerating Azure DevOps test run history
// (see src/testRunHistoryData.ts), which is heavier than everything else on
// the report and benefits from its own cache/loading state.
export interface ReportExtraKpis {
  // Outcome of each test case's earliest execution attempt (not its
  // current/latest outcome), bucketed by plan classification (see
  // src/planClassifier.ts). Null when a bucket has no executed history yet.
  firstExecutionPassRate: {
    functional: number | null;
    uat: number | null;
  };
  // Opened -> first transition into Resolved/Da verificare, in business
  // days (not opened -> Closed in calendar days, which is the existing
  // mttrDays/avgClosureDays KPI). Null when no in-scope bug has resolved yet.
  avgFixTimeBusinessDays: number | null;
  // Open bugs with severity Critical or High, as a % of total bugs -
  // same denominator style as the existing Bug Re-open Rate.
  criticalHighBugPct: number;
  // % of planned test cases NOT blocked by a linked bug. A test case
  // marked Blocked with no linked bug does not currently reduce this
  // score - see computeReportExtraKpis in src/reportExtraKpis.ts.
  testPlanCorrectnessPct: number;
  // NotApplicable test cases that are likely duplicates: same title
  // already marked NotApplicable in another suite of the same plan(s), or
  // in the previous sprint's plan(s) of the same area path. Matched by
  // title rather than test case ID because a test case is typically
  // re-authored (new work item, same title) each time it's re-added to a
  // suite/plan - see computeReportExtraKpis in src/reportExtraKpis.ts.
  duplicateNotApplicable: {
    count: number;
    pct: number; // % of this scope's total NotApplicable test cases
    titles: string[];
    previousSprintName: string | null;
  };
}

export type CoverageStatus = "done" | "in-progress" | "at-risk";

export interface CoverageTask {
  id: number;
  title: string;
  url?: string;
  state: string;
  isDone: boolean;
  assignee?: string;
}

export interface CoverageArea {
  id: number;
  title: string;
  url?: string;
  owner: string | null;
  // ISO date string from the Epic's Target Date field, or null if unset.
  dueDate: string | null;
  currentPct: number;
  // Read from AZDO_EPIC_TARGET_FIELD (see coverageData.ts) - null when the
  // Epic doesn't carry that field.
  targetPct: number | null;
  status: CoverageStatus;
  tasks: CoverageTask[];
}

// One automation task whose revision history showed both a start (entered
// In Progress/Doing) and a subsequent done (entered Closed/Done/Completed/
// Resolved) transition - tasks missing either transition (never started,
// still in progress, or done without a recorded start) aren't included,
// since there's no cycle to measure yet.
export interface CycleTimeTask {
  id: number;
  title: string;
  url?: string;
  epicId: number;
  epicTitle: string;
  // ISO timestamps of the two transitions themselves (not just the day).
  startDate: string;
  doneDate: string;
  cycleTimeDays: number;
}

export interface ThroughputPoint {
  weekStart: string;
  completedCount: number;
}

export interface CycleTimeTrendPoint {
  weekStart: string;
  avgCycleTimeDays: number;
  completedCount: number;
}

// Every automation task under Test Factory's epics (not just the subset
// CycleTimeTask covers, which is only tasks whose cycle could be measured) -
// lets the client compute an "open" count (and list) per epic without a
// second call.
export interface AutomationTaskStatus {
  id: number;
  title: string;
  url?: string;
  epicId: number;
  epicTitle: string;
  state: string;
  isDone: boolean;
}

export interface CycleTimeResponse {
  tasks: CycleTimeTask[];
  allTasks: AutomationTaskStatus[];
  throughput: ThroughputPoint[];
  cycleTimeTrend: CycleTimeTrendPoint[];
  overallAvgCycleTimeDays: number | null;
  overallMedianCycleTimeDays: number | null;
}

// One document per tst-e2e CI run, published by
// notification/cosmos/publish-results-to-cosmos.ts in that repo and read
// back here via src/cosmosE2eData.ts - distinct from AutomationKpiResponse
// above, which is ADO Test Case automation-status data, not live Playwright
// run results.
export interface E2eRun {
  id: string;
  branch: string;
  commitSha?: string;
  startedAt: string;
  finishedAt?: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  durationMs: number;
  reportUrl?: string;
}

export interface E2eHistoryResponse {
  runs: E2eRun[];
  // False when FIREBASE_SERVICE_ACCOUNT_JSON isn't set yet - lets the client
  // show a "not configured" hint instead of an error banner (see
  // FirebaseConfigError in src/firebaseE2eData.ts).
  configured: boolean;
}
