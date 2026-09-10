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
  priority?: number;
  // Plain-text extract of the bug's Description / Repro Steps, truncated
  // server-side (see htmlToPlainText in the server's dashboardData.ts).
  description?: string;
  url?: string;
  creator?: string;
  assignee?: {
    displayName: string;
    uniqueName: string;
  };
  // ISO strings from Azure DevOps (created / last changed / closed).
  // Optional: absent on responses served from an older server cache.
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

export interface ProjectSummary {
  id: string;
  name: string;
}

// Same shape as the Iteration classification tree - used for the Area Path
// selector on the dynamic Sprint Report page.
export type AreaPathNode = IterationNode;

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

export interface DashboardResponse {
  stats: DashboardStats;
  cacheTimestamp: number;
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

export interface SprintDefectReport {
  total: number;
  effectiveCount: number;
  outOfScopeCount: number;
  byOrigin: Record<string, number>;
  byOriginDetected: Record<string, number>;
  byStatus: Record<string, number>;
  byStatusAll: Record<string, number>;
  bySeverity: Record<string, number>;
  testFactoryBySuite: Record<string, number>;
  testAgentiBySuite: Record<string, number>;
  testBusinessBySuite: Record<string, number>;
  effectiveDefects: DefectSummary[];
  // Every detected DSI-origin bug (see the server's computeSprintDefectReport)
  // - may be absent on responses served from an older cache.
  dsiDefects?: DefectSummary[];
  // Every detected Business-origin bug (Custom.Suite = "Test Business"),
  // for the Excel export's "Bug Business" sheet - absent on older caches.
  businessDefects?: DefectSummary[];
  // Every detected bug created or last changed today (report timezone), for
  // the Excel export's "Bug Odierni" sheet - absent on older caches.
  todaysDefects?: DefectSummary[];
  reopenedCount: number;
  mttrDays: number | null;
  withoutResolutionDateCount: number;
}

export interface VerificaActivitySummary {
  verifiedToday: number;
  closedToday: number;
  closedTodayOutOfScopeCount: number;
  reopenedToday: number;
  stillPendingVerification: number;
  dsiPendingCount: number;
  siPendingCount: number;
}

export interface DefectSummary extends BugInfo {
  severity?: string;
  ageDays?: number;
  estimatedResolutionDate?: string;
  // Report origin ("Test Factory" | "Test Agenti" | "Business" | "DSI") and
  // out-of-scope flag - populated server-side in computeSprintDefectReport.
  origin?: string;
  outOfScope?: boolean;
}

export interface DefectFilterOptions {
  iterations: string[];
  areas: string[];
  environments: string[];
  targetVersions: string[];
  suites: string[];
}

export interface DefectFilters {
  iteration: string;
  area: string;
  environment: string;
  targetVersion: string;
  suites: string[];
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
  defectsWithoutLinkedTestCase: BugInfo[];
  defectsWithoutSuite: BugInfo[];
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

// One row per test case in a plan - drives the Excel "Casi di Test" sheet.
export interface PlanOverviewTestCase {
  suiteId: number;
  suiteName: string;
  testCaseId: number;
  title: string;
  url?: string;
  state?: string;
  priority: number;
  outcome: Outcome;
  executed: boolean;
  notRun: boolean;
  needsRetest: boolean;
  automationStatus?: string;
  assignedTo?: string;
  tester?: string;
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
  reportUrl?: string; // see PlanOverviewResponse in the server's src/types.ts
  totalTestCases: number;
  totalBugs: number;
  testsBySuite: PlanOverviewSuiteCount[];
  outcomeCounts: Record<Outcome, number>;
  bugStates: PlanOverviewBugState[];
  bugsByState: PlanOverviewBugStateCount[];
  bugs: BugInfo[];
  suites: PlanOverviewSuiteDetail[];
  // May be absent on responses served from an older server cache.
  testCases?: PlanOverviewTestCase[];
}

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
  // Read server-side from AZDO_EPIC_TARGET_FIELD - null when the Epic
  // doesn't carry that field.
  targetPct: number | null;
  status: CoverageStatus;
  tasks: CoverageTask[];
}

// One automation task whose revision history showed both a start (entered
// In Progress/Doing) and a subsequent done (entered Closed/Done/Completed/
// Resolved) transition - tasks missing either transition aren't included.
export interface CycleTimeTask {
  id: number;
  title: string;
  url?: string;
  epicId: number;
  epicTitle: string;
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
// lets the page compute an "open" count (and list) per epic without a
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

// One document per tst-e2e CI run - mirrors the server's copy of the same
// name in src/types.ts (see that file's note on why types are
// hand-duplicated between the client and server TS roots).
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
  // False when the server's COSMOS_ENDPOINT/COSMOS_KEY aren't set yet.
  configured: boolean;
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
  executedCount: number;
  notExecutedCount: number;
  notApplicableCount: number;
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
// Report's main fetchDefects/fetchPlanOverview calls - kept separate rather
// than folded into either response because firstExecutionPassRate requires
// enumerating Azure DevOps test run history server-side, which is heavier
// than everything else on the report and benefits from its own loading
// state (see DynamicSprintReportPage.tsx's extraKpis query). Mirrors
// src/types.ts's copy of the same name (this project hand-duplicates types
// between the client and server TS roots rather than sharing a package).
export interface ReportExtraKpis {
  firstExecutionPassRate: {
    functional: number | null;
    uat: number | null;
  };
  avgFixTimeBusinessDays: number | null;
  criticalHighBugPct: number;
  testPlanCorrectnessPct: number;
  duplicateNotApplicable: {
    count: number;
    pct: number;
    titles: string[];
    previousSprintName: string | null;
  };
}

export interface IterationNode {
  id: string;
  name: string;
  path: string;
  startDate: string | null;
  finishDate: string | null;
}

// The NRT/A11Y/DAST test-suite hub (TestSuitesPage). Mock data for now (see
// data/testSuitesMockData.ts) - there's no backend endpoint yet for these
// three suites, unlike E2eRun above which already reads from Firestore.
// Kept as real types (not inlined in the page) so the eventual API can slot
// in behind the same shape.
export type TestSuiteKey = "nrt" | "a11y" | "dast";

// Which product the run covers. "plurifond"/"frontOfficeAuto" mirror the
// Area Path leaf names used elsewhere (see seedPresets() in
// useExcelExportPresets.ts: "Nuova Frontiera\\Plurifond" and
// "...\\Front Office Auto\\..."). "all" is a full regression run that
// exercises every app together in one pass - NRT/A11Y/DAST runs are not
// always scoped to a single app.
export type TestAppScope = "plurifond" | "frontOfficeAuto" | "all";

// Mirrors tst-e2e's own Environment enum (tst/pre/prd) in
// src/config/environments.ts of the automation repo.
export type TestEnvironment = "tst" | "pre" | "prd";

export type TestRunStatus = "good" | "warn" | "bad";

export interface NrtDomainResult {
  // Short domain code used in spec paths/tags (vit, sin, dan, ana, por, doc).
  domain: string;
  label: string;
  total: number;
  passed: number;
  flaky: number;
}

export interface NrtTestStep {
  title: string;
  durationMs: number;
}

// One Playwright spec's result within a run - mirrors what
// scripts/publish-local-test-runs.js walks out of the run's suites tree
// (title/tags/tests/results/steps), one entry per test rather than per spec
// file, so a spec with multiple tests (e.g. a skipped variant) gets one row
// each.
export interface NrtTestResult {
  title: string;
  domain: string;
  file: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  steps: NrtTestStep[];
}

export interface NrtRunDetail {
  totalTests: number;
  passed: number;
  flaky: number;
  durationMs: number;
  domains: NrtDomainResult[];
  // Optional: older mock runs and any real run published before this field
  // existed won't have it - the UI should treat it as "no per-test detail
  // available" rather than an empty list.
  tests?: NrtTestResult[];
}

export interface A11yRuleViolation {
  // axe-core rule id, e.g. "color-contrast" - see
  // https://dequeuniversity.com/rules/axe/4.12/{ruleId}
  ruleId: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  count: number;
  description: string;
}

// One axe-core scan target within a run - mirrors one
// tst-e2e/reports/a11y/<run>/axe-data-<label>.json file (the wizard step or
// dialog that got scanned, e.g. "comparto-initial").
export interface A11yStepResult {
  label: string;
  violations: number;
  incomplete: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  rules: A11yRuleViolation[];
}

export interface A11yRunDetail {
  stepsScanned: number;
  violations: number;
  incomplete: number;
  // Not present in the raw axe-data-*.json files (only violations/incomplete
  // are persisted there) - undefined when this run's numbers were parsed
  // from real report files rather than the aggregated a11y/index.html.
  passes?: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  steps: A11yStepResult[];
}

export interface DastAlert {
  // OWASP ZAP risk level - no "Critical" tier, unlike axe's impact scale.
  risk: "High" | "Medium" | "Low" | "Informational";
  title: string;
  target: string;
}

export interface DastRunDetail {
  endpointsScanned: number;
  riskScore: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
  alerts: DastAlert[];
}

export interface TestSuiteRun {
  // e.g. "nrt_20260910_0857_tst_full_core_v1.0" - mirrors the run-folder
  // naming already used under tst-e2e/reports/runs/.
  id: string;
  suite: TestSuiteKey;
  app: TestAppScope;
  env: TestEnvironment;
  branch: string;
  commitSha?: string;
  startedAt: string;
  status: TestRunStatus;
  // Filename of the generated report this run opens into (smart-report.html,
  // a11y/index.html, or the dated ZAP report) - not a full URL yet, since
  // there's nowhere public these are hosted until a backend exists.
  reportFile: string;
  // ZAP's own report generator emits an English and an Italian HTML report
  // side by side for the same scan (see reports/zap/ - one plain-named file,
  // one with an "-IT-" suffix) - only ever set for suite "dast", where the
  // UI renders a second "Open report" button for it.
  reportFileIt?: string;
  reportTool: string;
  // NRT and A11Y specs can execute inside the very same Playwright run (the
  // a11y-chrome project alongside the vit specs) - this cross-links the two
  // suite entries that came from one run.
  linkedRunId?: string;
  nrt?: NrtRunDetail;
  a11y?: A11yRunDetail;
  dast?: DastRunDetail;
}
