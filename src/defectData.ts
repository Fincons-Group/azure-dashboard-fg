import {
    getAllBugFields,
    getWorkItemRevisions,
    getStoryCount,
    getStoriesWithFields,
    getWorkItem,
    getWorkItems,
    extractWorkItemIds,
    buildWorkItemUrl,
} from "./azdo.js";
import { getDashboardData } from "./dashboardData.js";
import type {
    DefectRecord,
    DefectStats,
    DefectTrendPoint,
    BacklogTrendPoint,
    AgingBucket,
    DefectSummary,
    BacklogDirection,
    DefectFilterParams,
    DefectFilterOptions,
    ClosureReason,
    SprintDefectReport,
} from "./types.js";

let defectCache: { data: DefectRecord[]; timestamp: number } | null = null;

const CACHE_DURATION_MS = 5 * 60 * 1000;

// This project's Bug workflow has a dedicated "Riaperto" (reopened) state
// rather than a generic Resolved/Closed -> Active/New transition, so a
// reopening is any transition into that state, regardless of prior state.
const REOPENED_TO_STATES = ["Riaperto"];

// Seeded with the canonical VSTS/Agile rejection reasons. Whether these
// actually appear depends on the project's process template - some
// processes (e.g. ours) track System.Reason as workflow transitions
// instead of a rejection judgement, in which case this legitimately
// computes to 0% rather than "not configured" (same as duplicateRate).
const REJECTED_REASONS = new Set([
    "Not a Bug",
    "Cannot Reproduce",
    "As Designed",
    "Won't Fix",
    "Invalid",
]);

// Tag applied to bugs raised against a test case that was wrongly scoped for
// the sprint it was tested in - i.e. not a real defect, so it shouldn't count
// against the team's defect rate. See bug-closure-reporting-context.md.
const OUT_OF_SCOPE_TAG = "OutOfScope";

// Tag manually applied when a bug is a regression on functionality that was
// already tested and passing in an earlier sprint/release.
const REGRESSION_TAG = "Regression";

// Custom.Suite value used for the new DSI test suite; every other suite
// (populated or not) is reported as "Test Factory" in the sprint report.
const DSI_SUITE_NAME = "Test DSI";

// Custom.Suite values for suites whose test cases are duplicates of Test
// Factory test cases (same title, different work item ID) kept in a
// separate suite - one for agent-run execution, one for business-side
// testing - rather than being real content suites in their own right.
// Unlike DSI (its own genuine suite), a bug filed against one of these needs
// its suite *resolved* via its linked test case's title rather than read
// directly off Custom.Suite. Keyed by the Custom.Suite value, valued by the
// origin label shown in reports. See getTestCaseLookups/buildDefectRecord
// below.
const DUPLICATE_SUITE_ORIGINS: Record<string, string> = {
    "Test Agenti": "Test Agenti",
    "Test Business": "Business",
};

// Custom.Suite is manually typed on each bug in Azure DevOps, so the same
// suite ends up spelled differently across bugs (e.g. "Login & Profilazione"
// vs "Login e profilazione"), fragmenting the by-suite charts into
// near-duplicate bars. Maps known variant spellings to the canonical suite
// name they actually refer to.
const SUITE_NAME_ALIASES: Record<string, string> = {
    "HomepageCliente&DettaglioCliente": "Homepage cliente",
    "Login & Profilazione": "Login e profilazione",
};

function normalizeSuiteName(
    rawSuiteName: string | undefined
): string | undefined {
    if (!rawSuiteName) {
        return rawSuiteName;
    }

    return SUITE_NAME_ALIASES[rawSuiteName] ?? rawSuiteName;
}

// Closed/Duplicate states considered terminal for closure-reason reporting.
// Anything still in an active state has no closure reason yet.
const TERMINAL_STATES = new Set(["Closed", "Duplicate"]);

// Days a bug may stay open before it's flagged in the High Attention list.
// Keyed by the exact Microsoft.VSTS.Common.Severity label used in this
// project; "default" covers severities not explicitly listed.
const SLA_THRESHOLD_DAYS: Record<string, number> = {
    "1 - Critical": 1,
    "2 - High": 5,
    "3 - Medium": 10,
    "4 - Low": 30,
    default: 30,
};

export function getDefectCacheTimestamp(): number {
    return defectCache?.timestamp ?? 0;
}

function countReopenings(revisions: any[]): number {
    let count = 0;

    for (let i = 1; i < revisions.length; i++) {
        const prevState =
            revisions[i - 1].fields?.[
            "System.State"
            ];
        const currState =
            revisions[i].fields?.[
            "System.State"
            ];

        if (
            currState !== prevState &&
            REOPENED_TO_STATES.includes(currState)
        ) {
            count++;
        }
    }

    return count;
}

function parseTags(tagsField?: string): string[] {
    return tagsField
        ? tagsField
              .split(";")
              .map((tag) => tag.trim())
              .filter(Boolean)
        : [];
}

// Unlike computeClosureReason (which only classifies terminal-state bugs, so
// closure-reason reporting stays about *how something was closed*), the
// sprint report needs to pull every OutOfScope-tagged bug - open or closed -
// out of the "effective defects" pool before computing status/severity/origin
// breakdowns for that pool.
function isOutOfScope(record: DefectRecord): boolean {
    return record.tags.includes(OUT_OF_SCOPE_TAG);
}

// "OutOfScope" (from the tag) takes priority over every other signal, since
// it's a manual call by whoever triaged the bug and should override whatever
// the workflow-driven System.Reason/State would otherwise imply. There's no
// custom ClosureReason field yet (see bug-closure-reporting-context.md), so
// "Environment Issue" isn't derivable and is intentionally left out until
// that's decided.
function computeClosureReason(
    state: string,
    reason: string | undefined,
    tags: string[]
): ClosureReason | undefined {
    if (!TERMINAL_STATES.has(state)) {
        return undefined;
    }

    if (tags.includes(OUT_OF_SCOPE_TAG)) {
        return "OutOfScope";
    }

    if (state === "Duplicate") {
        return "Duplicate";
    }

    if (reason === "Cannot Reproduce") {
        return "Not Reproducible";
    }

    return "Valid Defect";
}

// Returns the IDs of Test Cases linked to this bug, read directly off the
// bug's own relations. This is the bug-centric direction (bug -> test case),
// as opposed to the dashboard's test-case-centric direction (test case ->
// bug) used below - keeping both directions independent means a bug that's
// confirmed linked here won't silently fall back to "no test case" just
// because the reverse crawl in buildDashboard() didn't happen to surface it.
async function getLinkedTestCaseIds(
    bugId: number
): Promise<number[]> {
    const workItem = await getWorkItem(bugId);

    // Only "Tested By" relations (in either direction) represent a genuine
    // "this bug was found via this test case" link. A bug can also pick up
    // a Hierarchy (parent/child) relation to a Test Case - e.g. when a test
    // case was mistakenly set as its parent work item - which isn't a real
    // test link and would otherwise inflate hasLinkedTestCase/iterationPath
    // borrowing with an unrelated test case.
    const testedByRelations = (
        workItem.relations ?? []
    ).filter(
        (r: any) =>
            typeof r.rel === "string" &&
            r.rel.startsWith("Microsoft.VSTS.Common.TestedBy")
    );

    const linkedIds = extractWorkItemIds(
        testedByRelations
    );

    const linkedItems = await getWorkItems(linkedIds);

    return linkedItems
        .filter(
            (item: any) =>
                item.fields["System.WorkItemType"] ===
                "Test Case"
        )
        .map((item: any) => item.id);
}

interface TestCaseLookups {
    iterationByTestCase: Map<number, string>;
    titleByTestCase: Map<number, string>;
    // Test case title -> its suite, restricted to test cases actually living
    // in a genuine Test Factory suite (DSI/Test Agenti/Business excluded) -
    // i.e. the resolution *target* for a title match, never the source.
    suiteByTitle: Map<string, string>;
}

// A bug's own System.IterationPath is preferred (see isSpecificIterationPath
// in buildDefectRecord) - this lookup only backs the fallback for a bug left
// on the project/team root with no sprint set, borrowing the sprint from the
// Test Plan of the test case it's linked to instead. Also builds the
// title/suite lookups buildDefectRecord uses to resolve a Test
// Agenti/Business bug's real suite (see DUPLICATE_SUITE_ORIGINS).
//
// Keyed by test case ID rather than bug ID so lookups can be driven off the
// bug's own confirmed test case links (see getLinkedTestCaseIds) instead of
// requiring the bug to also turn up in the dashboard's own test-case-to-bug
// crawl.
async function getTestCaseLookups(): Promise<TestCaseLookups> {
    const iterationByTestCase = new Map<number, string>();
    const titleByTestCase = new Map<number, string>();
    const suiteByTitle = new Map<string, string>();

    const testCases = await getDashboardData();

    for (const tc of testCases) {
        if (tc.iteration && !iterationByTestCase.has(tc.testCaseId)) {
            iterationByTestCase.set(
                tc.testCaseId,
                tc.iteration
            );
        }

        if (!titleByTestCase.has(tc.testCaseId)) {
            titleByTestCase.set(tc.testCaseId, tc.testCaseTitle);
        }

        const normalizedSuite = normalizeSuiteName(tc.suiteName);

        if (
            normalizedSuite &&
            normalizedSuite !== DSI_SUITE_NAME &&
            !(normalizedSuite in DUPLICATE_SUITE_ORIGINS) &&
            !suiteByTitle.has(tc.testCaseTitle)
        ) {
            suiteByTitle.set(tc.testCaseTitle, normalizedSuite);
        }
    }

    return { iterationByTestCase, titleByTestCase, suiteByTitle };
}

// A root-only value (just the project/team name, no "\" segment beneath it)
// means the bug was never actually assigned to a sprint - anything deeper is
// a real, specific sprint assignment Azure DevOps put there directly on the
// bug, which is more trustworthy than borrowing one from a linked test case.
function isSpecificIterationPath(path: unknown): path is string {
    return typeof path === "string" && path.includes("\\");
}

async function buildDefectRecord(
    bug: any,
    lookups: TestCaseLookups
): Promise<DefectRecord> {
    const [revisions, linkedTestCaseIds] =
        await Promise.all([
            getWorkItemRevisions(bug.id),
            getLinkedTestCaseIds(bug.id),
        ]);

    // Custom.Suite is the sole source for a bug's suite - no more borrowing
    // from a linked test case's suite, since that fallback used a different
    // suite-naming convention and produced duplicate/fragmented bars in the
    // by-suite charts. Also normalized here since Custom.Suite itself is
    // manually typed and inconsistently spelled across bugs (see
    // SUITE_NAME_ALIASES).
    const suiteName: string | undefined = normalizeSuiteName(
        bug.fields["Custom.Suite"]
    );

    // Prefer the bug's own System.IterationPath - only fall back to the
    // linked test case's Test Plan iteration when the bug itself was left
    // untagged (see isSpecificIterationPath).
    let iterationPath: string | undefined = isSpecificIterationPath(
        bug.fields["System.IterationPath"]
    )
        ? bug.fields["System.IterationPath"]
        : undefined;

    if (!iterationPath) {
        for (const tcId of linkedTestCaseIds) {
            iterationPath ??= lookups.iterationByTestCase.get(tcId);
        }
    }

    // Test Agenti/Business test cases are duplicates of Test Factory ones
    // (same title, different work item ID), so their bugs' real suite is
    // resolved by matching the linked test case's title against the
    // equivalently-titled test case in its original Test Factory suite.
    let resolvedSuiteName: string | undefined;

    if (suiteName && suiteName in DUPLICATE_SUITE_ORIGINS) {
        for (const tcId of linkedTestCaseIds) {
            const title = lookups.titleByTestCase.get(tcId);
            const matchedSuite = title
                ? lookups.suiteByTitle.get(title)
                : undefined;

            if (matchedSuite) {
                resolvedSuiteName = matchedSuite;
                break;
            }
        }
    }

    const state = bug.fields["System.State"];
    const reason = bug.fields["System.Reason"];
    const tags = parseTags(bug.fields["System.Tags"]);

    return {
        id: bug.id,
        title: bug.fields["System.Title"],
        state,
        reason,
        tags,
        closureReason: computeClosureReason(state, reason, tags),
        severity:
            bug.fields[
            "Microsoft.VSTS.Common.Severity"
            ],
        priority:
            bug.fields[
            "Microsoft.VSTS.Common.Priority"
            ],
        areaPath: bug.fields["System.AreaPath"],
        iterationPath,
        suiteName,
        resolvedSuiteName,
        environment:
            bug.fields["Microsoft.VSTS.Build.FoundIn"],
        createdDate:
            bug.fields["System.CreatedDate"],
        closedDate:
            bug.fields[
            "Microsoft.VSTS.Common.ClosedDate"
            ],
        changedDate:
            bug.fields["System.ChangedDate"],
        estimatedResolutionDate:
            bug.fields["Custom.EstimatedResolutionDate"],
        reopenedCount: countReopenings(revisions),
        hasLinkedTestCase: linkedTestCaseIds.length > 0,
        url: buildWorkItemUrl(bug.id),
        creator: bug.fields["System.CreatedBy"]?.displayName,
        assignedTo: bug.fields["System.AssignedTo"]
            ? {
                displayName: bug.fields["System.AssignedTo"].displayName,
                uniqueName: bug.fields["System.AssignedTo"].uniqueName,
            }
            : undefined,
    };
}

export async function buildDefectRecords(): Promise<DefectRecord[]> {
    const [bugs, lookups] = await Promise.all([
        getAllBugFields(),
        getTestCaseLookups(),
    ]);

    return Promise.all(
        bugs.map((bug) =>
            buildDefectRecord(bug, lookups)
        )
    );
}

export async function getDefectData(): Promise<DefectRecord[]> {
    const now = Date.now();

    if (defectCache && now - defectCache.timestamp < CACHE_DURATION_MS) {
        return defectCache.data;
    }

    const data = await buildDefectRecords();

    defectCache = { data, timestamp: now };

    return data;
}

export function clearDefectCache(): void {
    defectCache = null;
    storyPointsCache = null;
    suiteNamesCache = null;
}

function groupCount(
    records: DefectRecord[],
    keyFn: (r: DefectRecord) => string | undefined
): Record<string, number> {
    const result: Record<string, number> = {};

    for (const record of records) {
        const key = keyFn(record) ?? "Unspecified";

        result[key] = (result[key] ?? 0) + 1;
    }

    return result;
}

// Like groupCount, but seeded with every known suite name at 0 first, so
// suites with no bugs still show up in the chart instead of being omitted.
function computeByTestSuite(
    records: DefectRecord[],
    allSuiteNames: string[]
): Record<string, number> {
    const result: Record<string, number> = {};

    for (const suite of allSuiteNames) {
        result[suite] = 0;
    }

    for (const record of records) {
        const key = record.suiteName ?? "Unspecified";

        result[key] = (result[key] ?? 0) + 1;
    }

    return result;
}

function computeTrend(
    records: DefectRecord[]
): DefectTrendPoint[] {
    const weekStart = (date: Date): string => {
        const d = new Date(date);
        const day = d.getUTCDay();
        const diff = (day + 6) % 7;

        d.setUTCDate(d.getUTCDate() - diff);

        return d.toISOString().slice(0, 10);
    };

    const twelveWeeksAgo = new Date();

    twelveWeeksAgo.setUTCDate(
        twelveWeeksAgo.getUTCDate() - 12 * 7
    );

    const buckets = new Map<
        string,
        { opened: number; closed: number }
    >();

    for (const record of records) {
        const createdWeek = weekStart(
            new Date(record.createdDate)
        );
        const createdBucket = buckets.get(
            createdWeek
        ) ?? { opened: 0, closed: 0 };

        createdBucket.opened++;
        buckets.set(createdWeek, createdBucket);

        if (record.closedDate) {
            const closedWeek = weekStart(
                new Date(record.closedDate)
            );
            const closedBucket = buckets.get(
                closedWeek
            ) ?? { opened: 0, closed: 0 };

            closedBucket.closed++;
            buckets.set(closedWeek, closedBucket);
        }
    }

    const sortedWeeks = [...buckets.keys()]
        .filter(
            (week) =>
                new Date(week) >= twelveWeeksAgo
        )
        .sort((a, b) => a.localeCompare(b));

    let openTotal = 0;

    return sortedWeeks.map((week): DefectTrendPoint => {
        const bucket = buckets.get(week)!;

        openTotal += bucket.opened - bucket.closed;

        return {
            weekStart: week,
            opened: bucket.opened,
            closed: bucket.closed,
            openTotal,
        };
    });
}

function computeMttrDays(
    records: DefectRecord[]
): number | null {
    const resolutionTimes = records
        .filter((r) => r.closedDate)
        .map(
            (r) =>
                (new Date(r.closedDate!).getTime() -
                    new Date(
                        r.createdDate
                    ).getTime()) /
                (1000 * 60 * 60 * 24)
        );

    if (resolutionTimes.length === 0) {
        return null;
    }

    const total = resolutionTimes.reduce(
        (sum, days) => sum + days,
        0
    );

    return (
        Math.round(
            (total / resolutionTimes.length) * 10
        ) / 10
    );
}

function computeAgingBuckets(
    records: DefectRecord[]
): AgingBucket[] {
    const now = Date.now();

    const bucketDefs = [
        { bucket: "0-7 days", min: 0, max: 7 },
        { bucket: "8-14 days", min: 8, max: 14 },
        { bucket: "15-30 days", min: 15, max: 30 },
        {
            bucket: "31+ days",
            min: 31,
            max: Infinity,
        },
    ];

    const counts = bucketDefs.map((def) => ({
        bucket: def.bucket,
        count: 0,
    }));

    for (const record of records) {
        if (record.state === "Closed") {
            continue;
        }

        const ageDays =
            (now -
                new Date(
                    record.createdDate
                ).getTime()) /
            (1000 * 60 * 60 * 24);

        const index = bucketDefs.findIndex(
            (def) =>
                ageDays >= def.min &&
                ageDays <= def.max
        );

        if (index >= 0) {
            counts[index].count++;
        }
    }

    return counts;
}

// How many times each bug was reopened - not just whether it was reopened
// at all (that's reopenedBugCount/reopenRate). Bucketed rather than one bar
// per exact count since a handful of chronically-reopened bugs would
// otherwise fragment the chart into a long tail of single-bug bars.
function computeReopenDistribution(
    records: DefectRecord[]
): AgingBucket[] {
    const bucketDefs = [
        { bucket: "1", min: 1, max: 1 },
        { bucket: "2", min: 2, max: 2 },
        { bucket: "3+", min: 3, max: Infinity },
    ];

    const counts = bucketDefs.map((def) => ({
        bucket: def.bucket,
        count: 0,
    }));

    for (const record of records) {
        if (record.reopenedCount < 1) {
            continue;
        }

        const index = bucketDefs.findIndex(
            (def) =>
                record.reopenedCount >= def.min &&
                record.reopenedCount <= def.max
        );

        if (index >= 0) {
            counts[index].count++;
        }
    }

    return counts;
}

function computeRejectionRate(
    records: DefectRecord[]
): number {
    if (records.length === 0) {
        return 0;
    }

    const rejectedCount = records.filter(
        (r) => r.reason && REJECTED_REASONS.has(r.reason)
    ).length;

    return (
        Math.round(
            (rejectedCount / records.length) * 1000
        ) / 10
    );
}

function computeRegressionRate(
    records: DefectRecord[]
): number {
    if (records.length === 0) {
        return 0;
    }

    const regressionCount = records.filter((r) =>
        r.tags.includes(REGRESSION_TAG)
    ).length;

    return (
        Math.round(
            (regressionCount / records.length) * 1000
        ) / 10
    );
}

function computeRejectionReasons(
    records: DefectRecord[]
): Record<string, number> {
    return groupCount(
        records.filter(
            (r) =>
                r.reason && REJECTED_REASONS.has(r.reason)
        ),
        (r) => r.reason
    );
}

function computeClosureReasonBreakdown(
    records: DefectRecord[]
): Record<string, number> {
    return groupCount(
        records.filter((r) => r.closureReason),
        (r) => r.closureReason
    );
}

function computeOutOfScopeRate(
    records: DefectRecord[]
): number {
    if (records.length === 0) {
        return 0;
    }

    const outOfScopeCount = records.filter(
        (r) => r.closureReason === "OutOfScope"
    ).length;

    return (
        Math.round(
            (outOfScopeCount / records.length) * 1000
        ) / 10
    );
}

function computeOutOfScopeBySuite(
    records: DefectRecord[]
): Record<string, number> {
    return groupCount(
        records.filter((r) => r.closureReason === "OutOfScope"),
        (r) => r.suiteName
    );
}

// "Resolved" gets its own bucket (fixed by dev, pending QA/DSI retest) since
// it's a meaningfully different state of work than "New" or actively being
// worked on; anything else non-terminal (Active, Committed, ...) still
// collapses into "In Progress".
function statusBucket(
    state: string
): "New" | "Resolved" | "Closed" | "In Progress" {
    if (state === "New") {
        return "New";
    }

    if (state === "Resolved") {
        return "Resolved";
    }

    if (state === "Closed") {
        return "Closed";
    }

    return "In Progress";
}

// Every real Test Factory suite name, i.e. the full catalog minus the
// suites that aren't "content" suites in their own right (DSI has its own
// origin bucket; Test Agenti/Business bugs get resolved to one of these
// suites instead of appearing as their own box).
function realTestFactorySuites(allSuiteNames: string[]): string[] {
    return allSuiteNames.filter(
        (suite) =>
            suite !== DSI_SUITE_NAME && !(suite in DUPLICATE_SUITE_ORIGINS)
    );
}

// Like computeByTestSuite, but scoped to effective (in-scope) bugs whose own
// Custom.Suite is a real Test Factory suite, and zero-seeded from the full
// suite catalog (not just suites with bugs) so the breakdown always shows
// every suite.
function computeTestFactoryBySuite(
    effectiveRecords: DefectRecord[],
    allSuiteNames: string[]
): Record<string, number> {
    const result: Record<string, number> = {};

    for (const suite of realTestFactorySuites(allSuiteNames)) {
        result[suite] = 0;
    }

    for (const record of effectiveRecords) {
        if (
            !record.suiteName ||
            record.suiteName === DSI_SUITE_NAME ||
            record.suiteName in DUPLICATE_SUITE_ORIGINS
        ) {
            continue;
        }

        result[record.suiteName] = (result[record.suiteName] ?? 0) + 1;
    }

    return result;
}

// Test Agenti/Business bugs don't carry a real suite on Custom.Suite (see
// DUPLICATE_SUITE_ORIGINS) - their suite comes from resolvedSuiteName,
// computed in buildDefectRecord by matching the linked test case's title
// against its Test Factory original. A bug whose test case couldn't be
// matched (no link, or no equivalently-titled Test Factory test case) still
// counts toward the origin's total but falls outside every seeded box.
function computeDuplicateSuiteBySuite(
    effectiveRecords: DefectRecord[],
    allSuiteNames: string[],
    duplicateSuiteName: string
): Record<string, number> {
    const result: Record<string, number> = {};

    for (const suite of realTestFactorySuites(allSuiteNames)) {
        result[suite] = 0;
    }

    for (const record of effectiveRecords) {
        if (record.suiteName !== duplicateSuiteName) {
            continue;
        }

        const suite = record.resolvedSuiteName ?? "Unspecified";

        result[suite] = (result[suite] ?? 0) + 1;
    }

    return result;
}

export function computeSprintDefectReport(
    records: DefectRecord[],
    allSuiteNames: string[] = []
): SprintDefectReport {
    const outOfScope = records.filter(isOutOfScope);
    const effective = records.filter((r) => !isOutOfScope(r));
    const originOf = (r: DefectRecord) => {
        if (r.suiteName === DSI_SUITE_NAME) {
            return "DSI";
        }

        if (r.suiteName && r.suiteName in DUPLICATE_SUITE_ORIGINS) {
            return DUPLICATE_SUITE_ORIGINS[r.suiteName];
        }

        return "Test Factory";
    };

    return {
        total: records.length,
        effectiveCount: effective.length,
        outOfScopeCount: outOfScope.length,
        byOrigin: groupCount(effective, originOf),
        byOriginDetected: groupCount(records, originOf),
        testFactoryBySuite: computeTestFactoryBySuite(
            effective,
            allSuiteNames
        ),
        testAgentiBySuite: computeDuplicateSuiteBySuite(
            effective,
            allSuiteNames,
            "Test Agenti"
        ),
        testBusinessBySuite: computeDuplicateSuiteBySuite(
            effective,
            allSuiteNames,
            "Test Business"
        ),
        byStatus: groupCount(effective, (r) => statusBucket(r.state)),
        // Unlike byStatus (scoped to in-scope/effective bugs, for the
        // defect-rate-facing chart), this covers every detected bug
        // including out-of-scope ones - out-of-scope bugs still need to be
        // tracked to closure, so the status card's "still open" count is
        // measured against all of them, not just the effective subset.
        byStatusAll: groupCount(records, (r) => statusBucket(r.state)),
        bySeverity: groupCount(effective, (r) => r.severity),
        // Carried through so the UI can drill down from a status/severity bar
        // to the underlying bug list without a second round trip.
        effectiveDefects: effective.map((r) => ({
            id: r.id,
            title: r.title,
            state: r.state,
            priority: r.priority,
            severity: r.severity,
            url: r.url,
            creator: r.creator,
            assignee: r.assignedTo,
        })),
        reopenedCount: records.filter((r) => r.reopenedCount > 0).length,
        mttrDays: computeMttrDays(records),
        withoutResolutionDateCount: records.filter(
            (r) => !r.estimatedResolutionDate
        ).length,
    };
}

function computeFirstTimeFixRate(
    records: DefectRecord[]
): number | null {
    const resolved = records.filter(
        (r) => r.closedDate
    );

    if (resolved.length === 0) {
        return null;
    }

    const fixedFirstTry = resolved.filter(
        (r) => r.reopenedCount === 0
    ).length;

    return (
        Math.round(
            (fixedFirstTry / resolved.length) * 1000
        ) / 10
    );
}

function computeLeakageRate(
    records: DefectRecord[]
): number | null {
    const withEnvironment = records.filter(
        (r) => r.environment
    );

    if (withEnvironment.length === 0) {
        return null;
    }

    const foundInProd = withEnvironment.filter((r) =>
        r.environment!.toLowerCase().includes("prod")
    ).length;

    return (
        Math.round(
            (foundInProd / withEnvironment.length) * 1000
        ) / 10
    );
}

function computeDensityByComponent(
    records: DefectRecord[],
    storyPointsByArea: Record<string, number>
): Record<string, number | null> {
    const bugCounts = groupCount(
        records,
        (r) => r.areaPath
    );
    const result: Record<string, number | null> = {};

    for (const [area, count] of Object.entries(
        bugCounts
    )) {
        const points = storyPointsByArea[area];

        result[area] =
            points && points > 0
                ? Math.round((count / points) * 100) /
                100
                : null;
    }

    return result;
}

function computeSlaBreaches(
    records: DefectRecord[]
): DefectSummary[] {
    const now = Date.now();

    return records
        .filter((r) => r.state !== "Closed")
        .map((r) => {
            const ageDays =
                (now -
                    new Date(
                        r.createdDate
                    ).getTime()) /
                (1000 * 60 * 60 * 24);
            const threshold =
                SLA_THRESHOLD_DAYS[r.severity ?? ""] ??
                SLA_THRESHOLD_DAYS.default;

            return { record: r, ageDays, threshold };
        })
        .filter(({ ageDays, threshold }) => ageDays > threshold)
        .sort(
            (a, b) =>
                (b.ageDays - b.threshold) -
                (a.ageDays - a.threshold)
        )
        .map(({ record, ageDays }) => ({
            id: record.id,
            title: record.title,
            state: record.state,
            priority: record.priority,
            severity: record.severity,
            ageDays: Math.round(ageDays),
            url: record.url,
            creator: record.creator,
            assignee: record.assignedTo,
        }));
}

function computeBacklogTrend(
    trend: DefectTrendPoint[]
): BacklogTrendPoint[] {
    return trend.map((point) => ({
        ...point,
        delta: point.opened - point.closed,
    }));
}

function computeBacklogDirection(
    backlogTrend: BacklogTrendPoint[]
): BacklogDirection {
    const recent = backlogTrend.slice(-4);

    if (recent.length === 0) {
        return "stable";
    }

    const avgDelta =
        recent.reduce((sum, p) => sum + p.delta, 0) /
        recent.length;

    if (avgDelta > 0.5) {
        return "growing";
    }

    if (avgDelta < -0.5) {
        return "shrinking";
    }

    return "stable";
}

function computeStoryPointsByArea(
    stories: any[]
): Record<string, number> {
    const result: Record<string, number> = {};

    for (const story of stories) {
        const area = story.fields["System.AreaPath"];
        const points =
            story.fields[
            "Microsoft.VSTS.Scheduling.StoryPoints"
            ];

        if (!area || !points) {
            continue;
        }

        result[area] = (result[area] ?? 0) + points;
    }

    return result;
}

export function filterRecords(
    records: DefectRecord[],
    params: DefectFilterParams
): DefectRecord[] {
    return records.filter((r) => {
        if (
            params.iteration &&
            r.iterationPath !== params.iteration
        ) {
            return false;
        }

        if (
            params.area &&
            r.areaPath !== params.area
        ) {
            return false;
        }

        if (
            params.environment &&
            r.environment !== params.environment
        ) {
            return false;
        }

        if (
            params.suites &&
            params.suites.length > 0 &&
            (!r.suiteName || !params.suites.includes(r.suiteName))
        ) {
            return false;
        }

        return true;
    });
}

function computeAvailableFilters(
    records: DefectRecord[],
    allSuiteNames: string[] = []
): DefectFilterOptions {
    const iterations = new Set<string>();
    const areas = new Set<string>();
    const environments = new Set<string>();
    const suites = new Set<string>();

    for (const r of records) {
        if (r.iterationPath) {
            iterations.add(r.iterationPath);
        }

        if (r.areaPath) {
            areas.add(r.areaPath);
        }

        if (r.environment) {
            environments.add(r.environment);
        }

        if (r.suiteName) {
            suites.add(r.suiteName);
        }
    }

    return {
        iterations: [...iterations].sort((a, b) => a.localeCompare(b)),
        areas: [...areas].sort((a, b) => a.localeCompare(b)),
        environments: [...environments].sort((a, b) => a.localeCompare(b)),
        targetVersions: [],
        suites: [...suites].sort((a, b) => a.localeCompare(b)),
    };
}

let storyPointsCache: {
    data: Record<string, number>;
    timestamp: number;
} | null = null;

export async function getStoryPointsByArea(): Promise<
    Record<string, number>
> {
    const now = Date.now();

    if (
        storyPointsCache &&
        now - storyPointsCache.timestamp < CACHE_DURATION_MS
    ) {
        return storyPointsCache.data;
    }

    const stories = await getStoriesWithFields();
    const data = computeStoryPointsByArea(stories);

    storyPointsCache = { data, timestamp: now };

    return data;
}

let suiteNamesCache: { data: string[]; timestamp: number } | null =
    null;

// Full set of test suite names for the project, independent of whether any
// bug is currently linked to them - needed so suites with zero bugs still
// render as a zero bar instead of disappearing from the chart.
export async function getAllSuiteNames(): Promise<string[]> {
    const now = Date.now();

    if (
        suiteNamesCache &&
        now - suiteNamesCache.timestamp < CACHE_DURATION_MS
    ) {
        return suiteNamesCache.data;
    }

    const suites = new Set<string>();
    const testCases = await getDashboardData();

    for (const tc of testCases) {
        const normalized = normalizeSuiteName(tc.suiteName);

        if (normalized) {
            suites.add(normalized);
        }
    }

    const data = [...suites].sort((a, b) => a.localeCompare(b));

    suiteNamesCache = { data, timestamp: now };

    return data;
}

export function computeDefectStats(
    records: DefectRecord[],
    storyCount: number,
    storyPointsByArea: Record<string, number> = {},
    allRecordsForFilterOptions: DefectRecord[] = records,
    allSuiteNames: string[] = []
): DefectStats {
    const totalClosed = records.filter(
        (r) => r.state === "Closed"
    ).length;

    const totalOpen = records.length - totalClosed;

    const duplicateCount = records.filter(
        (r) => r.state === "Duplicate"
    ).length;

    const reopenedBugCount = records.filter(
        (r) => r.reopenedCount > 0
    ).length;

    const defectsWithoutLinkedTestCase: DefectSummary[] =
        records
            .filter((r) => !r.hasLinkedTestCase)
            .map((r) => ({
                id: r.id,
                title: r.title,
                state: r.state,
                priority: r.priority,
                url: r.url,
                creator: r.creator,
                assignee: r.assignedTo,
            }))
            .sort((a, b) => {
                if (a.priority == null) {
                    return b.priority == null ? 0 : 1;
                }

                if (b.priority == null) {
                    return -1;
                }

                return a.priority - b.priority;
            });

    // Bugs missing Custom.Suite (and with no linked test case to borrow a
    // suite from) are the ones that surface as "Unspecified" in the by-suite
    // charts - surfaced here so they can be triaged and the field backfilled.
    const defectsWithoutSuite: DefectSummary[] =
        records
            .filter((r) => !r.suiteName)
            .map((r) => ({
                id: r.id,
                title: r.title,
                state: r.state,
                priority: r.priority,
                url: r.url,
                creator: r.creator,
                assignee: r.assignedTo,
            }))
            .sort((a, b) => {
                if (a.priority == null) {
                    return b.priority == null ? 0 : 1;
                }

                if (b.priority == null) {
                    return -1;
                }

                return a.priority - b.priority;
            });

    const trend = computeTrend(records);
    const backlogTrend = computeBacklogTrend(trend);

    return {
        totalOpen,
        totalClosed,
        bySeverity: groupCount(
            records,
            (r) => r.severity
        ),
        byPriority: groupCount(records, (r) =>
            r.priority != null
                ? String(r.priority)
                : undefined
        ),
        byComponent: groupCount(
            records,
            (r) => r.areaPath
        ),
        byTeam: groupCount(
            records,
            (r) => r.areaPath
        ),
        byTestSuite: computeByTestSuite(
            records,
            allSuiteNames
        ),
        byAssignee: groupCount(
            records,
            (r) => r.assignedTo?.displayName
        ),
        trend,
        mttrDays: computeMttrDays(records),
        agingBuckets: computeAgingBuckets(records),
        reopenDistribution: computeReopenDistribution(records),
        reopenedBugCount,
        reopenRate: records.length
            ? Math.round(
                (reopenedBugCount / records.length) *
                1000
            ) / 10
            : 0,
        duplicateRate: records.length
            ? Math.round(
                (duplicateCount / records.length) *
                1000
            ) / 10
            : 0,
        bugsPerStory: storyCount
            ? Math.round(
                (records.length / storyCount) * 100
            ) / 100
            : null,
        defectsWithoutLinkedTestCase,
        defectsWithoutSuite,
        defectLeakageRate: computeLeakageRate(records),
        defectRejectionRate: computeRejectionRate(records),
        regressionRate: computeRegressionRate(records),
        rejectionReasons: computeRejectionReasons(records),
        closureReasonBreakdown: computeClosureReasonBreakdown(records),
        outOfScopeRate: computeOutOfScopeRate(records),
        outOfScopeBySuite: computeOutOfScopeBySuite(records),
        sprintDefectReport: computeSprintDefectReport(records, allSuiteNames),
        firstTimeFixRate: computeFirstTimeFixRate(records),
        densityByComponent: computeDensityByComponent(
            records,
            storyPointsByArea
        ),
        backlogTrend,
        backlogDirection: computeBacklogDirection(backlogTrend),
        slaBreaches: computeSlaBreaches(records),
        availableFilters: computeAvailableFilters(
            allRecordsForFilterOptions,
            allSuiteNames
        ),
    };
}

export { getStoryCount };
