import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Card,
    Dropdown,
    Option,
    Tab,
    TabList,
    Text,
    Title2,
    makeStyles,
    mergeClasses,
    tokens,
    type SelectTabData,
    type SelectTabEvent,
} from "@fluentui/react-components";
import {
    AccessibilityCheckmarkRegular,
    ArrowRepeatAllRegular,
    ChevronRightRegular,
    OpenRegular,
    ShieldCheckmarkRegular,
    WrenchRegular,
    type FluentIcon,
} from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { StatusTag } from "../components/StatusTag";
import type { StatusTone } from "../components/statusTone";
import type { RunHistoryPoint } from "../components/RunHistoryStrip";
import { getApiBaseUrl, fetchTestSuites, fetchSignedReportUrl } from "../api/client";
import { CARD_RADIUS } from "../layoutConstants";
import type {
    NrtDomainResult,
    NrtRunDetail,
    NrtTestResult,
    TestEnvironment,
    TestRunStatus,
    TestSuiteKey,
    TestSuiteRun,
    ZapRisk,
    ZapRunDetail,
} from "../types";

type TabKey = "overview" | TestSuiteKey;

const SUITE_ORDER: TestSuiteKey[] = ["nrt", "a11y", "security"];
const ENV_OPTIONS: TestEnvironment[] = ["tst", "pre", "prd"];
const TREND_RUN_COUNT = 6;

const SUITE_ICONS: Record<TestSuiteKey, FluentIcon> = {
    nrt: ArrowRepeatAllRegular,
    a11y: AccessibilityCheckmarkRegular,
    security: ShieldCheckmarkRegular,
};

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    stickyBar: {
        position: "sticky",
        // Set by PageLayout from TopBar+ScopeBar's actual measured height
        // (see its ResizeObserver) - falls back to a rough estimate before
        // that first measurement lands.
        top: "var(--app-header-height, 140px)",
        zIndex: 8,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalS} 0`,
        backgroundColor: tokens.colorNeutralBackground1,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    scopeSelects: {
        display: "flex",
        gap: tokens.spacingHorizontalS,
    },
    scopeDropdown: {
        minWidth: "150px",
    },
    eyebrow: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorBrandForeground1,
    },
    suiteGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    suiteCard: {
        textAlign: "left",
        cursor: "pointer",
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        border: "none",
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
        ":hover": {
            outlineWidth: "1px",
            outlineStyle: "solid",
            outlineColor: tokens.colorBrandStroke1,
        },
    },
    suiteTop: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalS,
    },
    suiteIcon: {
        width: "36px",
        height: "36px",
        borderRadius: tokens.borderRadiusMedium,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        flexShrink: 0,
    },
    suiteName: {
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    suiteFull: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
        display: "block",
    },
    suiteDesc: {
        fontSize: tokens.fontSizeBase300,
        color: tokens.colorNeutralForeground2,
    },
    suiteMeta: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: tokens.spacingVerticalS,
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorNeutralStroke2,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    suiteCta: {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorBrandForeground1,
    },
    placeholderCard: {
        padding: tokens.spacingHorizontalXXL,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: tokens.spacingVerticalS,
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
    },
    placeholderIcon: {
        fontSize: "32px",
        color: tokens.colorNeutralForeground3,
    },
    placeholderBody: {
        color: tokens.colorNeutralForeground3,
        maxWidth: "480px",
    },
    detailHead: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    detailTitle: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
    },
    detailIcon: {
        width: "44px",
        height: "44px",
        borderRadius: tokens.borderRadiusMedium,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "20px",
        flexShrink: 0,
    },
    detailSub: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        flexWrap: "wrap",
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    detailBranch: {
        maxWidth: "320px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    detailNote: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
        maxWidth: "60ch",
    },
    reportCta: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: tokens.spacingVerticalXS,
    },
    reportButtons: {
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: tokens.spacingHorizontalS,
    },
    statRow: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    statTile: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        borderTopWidth: "3px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorBrandStroke1,
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
    },
    statValue: {
        fontSize: "22px",
        fontWeight: 700,
        color: tokens.colorBrandForeground1,
    },
    statLabel: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    gridTwo: {
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        gap: tokens.spacingHorizontalM,
        alignItems: "start",
    },
    card: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        borderRadius: CARD_RADIUS,
        boxShadow: tokens.shadow4,
    },
    cardTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    cardTitleHint: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightRegular,
        color: tokens.colorNeutralForeground3,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    tableHeadCell: {
        textAlign: "left",
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableCell: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
        fontSize: tokens.fontSizeBase200,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableCellNum: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
        fontSize: tokens.fontSizeBase200,
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableRowClickable: {
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
    },
    tableRowSelected: {
        backgroundColor: tokens.colorBrandBackground2,
    },
    trendBars: {
        display: "flex",
        alignItems: "flex-end",
        gap: tokens.spacingHorizontalXS,
        height: "56px",
    },
    trendBar: {
        flex: 1,
        borderTopLeftRadius: tokens.borderRadiusSmall,
        borderTopRightRadius: tokens.borderRadiusSmall,
    },
    findingRow: {
        paddingTop: tokens.spacingVerticalS,
        paddingBottom: tokens.spacingVerticalS,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
        ":last-child": {
            borderBottomWidth: 0,
            paddingBottom: 0,
        },
        ":first-child": {
            paddingTop: 0,
        },
    },
    findingTop: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        flexWrap: "wrap",
        marginBottom: "2px",
    },
    findingTitle: {
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightRegular,
        color: tokens.colorNeutralForeground2,
    },
    findingMeta: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    testHeaderRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
    },
    testTitle: {
        flex: 1,
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightMedium,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    stepsList: {
        margin: 0,
        paddingLeft: tokens.spacingHorizontalXL,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    stepListItem: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        fontSize: tokens.fontSizeBase300,
    },
    testHistorySection: {
        marginTop: tokens.spacingVerticalM,
        paddingTop: tokens.spacingVerticalM,
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorNeutralStroke2,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    runsList: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    runRow: {
        width: "100%",
        textAlign: "left",
        border: "2px solid transparent",
        backgroundColor: "transparent",
        // A plain <button> doesn't inherit the page's text color from the UA
        // stylesheet (defaults to black), which read as unreadable against
        // this card's dark background.
        color: tokens.colorNeutralForeground1,
        borderRadius: tokens.borderRadiusMedium,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground3,
        },
    },
    runRowActive: {
        // colorBrandBackground2 is #082338 in the dark theme - darker than
        // the card itself (colorNeutralBackground1, #292929), so the
        // "selected" row rendered as a near-black hole instead of a
        // highlight. colorNeutralBackground1Selected is the token actually
        // meant for a selected list row and reads as a highlight in both
        // themes.
        backgroundColor: tokens.colorNeutralBackground1Selected,
        // colorBrandStroke2 (the usual subtle-border token) only measures
        // ~1.5:1 against this card's dark backgrounds - well under WCAG
        // 1.4.11's 3:1 minimum for UI-component boundaries. colorBrandStroke1
        // measures ~5:1+ here and is what's actually meant for a boundary
        // that needs to read as a boundary, not a faint tint.
        borderTopColor: tokens.colorBrandStroke1,
        borderRightColor: tokens.colorBrandStroke1,
        borderBottomColor: tokens.colorBrandStroke1,
        borderLeftColor: tokens.colorBrandStroke1,
    },
    runTop: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalS,
    },
    runDate: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    runBadges: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
    },
    runLatestTag: {
        color: tokens.colorBrandForeground1,
    },
    runBranch: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
});

// setup/*.setup.ts specs are Playwright auth scaffolding ("authenticate as
// ..."), not test cases a QA reviewer is checking - they run before the real
// specs and always pass/skip by construction, so counting them only dilutes
// a run's pass rate and inflates its total. NrtRunDetail.totalTests/.passed
// come straight from the run doc and still include them (that's a
// report-generation concern upstream in tst-e2e, out of scope here), so
// every pass-rate/total-tests display in this page is derived from the
// already-filtered test list instead of trusting those fields directly.
// Once the reporter stops emitting setup specs into totalTests/passed, this
// filter becomes a no-op and can stay in place harmlessly.
function realNrtTests(detail: NrtRunDetail): NrtTestResult[] {
    return (detail.tests ?? []).filter((test) => !test.file.startsWith("setup/"));
}

function nrtPassRate(detail: NrtRunDetail): number {
    const tests = realNrtTests(detail);
    if (tests.length === 0) return 0;
    const passed = tests.filter((test) => test.status === "passed").length;
    return Math.round((passed / tests.length) * 1000) / 10;
}

function statusTone(status: TestRunStatus): StatusTone {
    if (status === "good") return "success";
    if (status === "warn") return "warning";
    return "danger";
}

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

// Fallback for when a run has no reportUrl yet (no real CI pipeline exists,
// see TestSuiteRun.reportUrl in types.ts) - points at whatever local tst-e2e
// checkout's reports/ folder the server is statically serving under
// /test-suites-reports (see TEST_SUITES_REPORTS_DIR in src/server.ts), a
// dev-only convenience that 404s everywhere else. reportFile carries the
// path relative to reports/ (e.g. "runs/<id>/smart-report.html",
// "a11y/index.html") - same convention scripts/publish-local-test-runs.js
// writes - so this never re-derives a per-suite subpath itself.
//
// Must be an absolute URL against the API origin, not a plain "/..." path:
// this is a real <a href>, not a fetch through apiFetch's proxy-aware base,
// so a relative path resolves against wherever the link gets clicked from
// (the client's own origin) instead of the server that actually hosts
// /test-suites-reports - it 404s there (or, in dev, hits Vite's SPA
// fallback and lands on whatever the app's default route is).
function reportHref(file: string): string {
    return `${getApiBaseUrl()}/test-suites-reports/${file}`;
}

// Local-dev fallback (no reportUrl) opens straight away. A real reportUrl is
// a gated API path, not a link (see its comment in types.ts) - it has to be
// fetched (carrying the usual PAT header) before there's a URL to open. The
// blank window opens synchronously on click, before that await, so browsers
// don't treat the later navigation as an unrequested popup - it can't pass
// "noopener" as a window.open() feature and keep a reference to navigate
// later, though: browsers return null from window.open() specifically when
// noopener is set (the whole point of the flag is that no such reference
// ever exists), which left the blank tab permanently blank. window.opener
// is nulled out manually instead, right after opening, which blocks the
// same reverse-tabnabbing risk without losing the reference.
// Takes the file/url pair rather than the run so a ZAP run's Italian report
// (reportFileIt/reportUrlIt) opens the same way as its main one.
// Only a dev server with TEST_SUITES_REPORTS_DIR set can serve the no-
// reportUrl fallback above - on the hosted app that link is a guaranteed 404,
// so the button is disabled there instead (the run's HTML was never uploaded
// to Storage; re-publish it with PUBLISH_REPORTS_TO_FIREBASE=true).
function canOpenReport(reportUrl: string | undefined): boolean {
    return !!reportUrl || import.meta.env.DEV;
}

async function openTestSuiteReport(reportFile: string, reportUrl: string | undefined): Promise<void> {
    if (!reportUrl) {
        window.open(reportHref(reportFile), "_blank", "noopener");
        return;
    }

    const win = window.open("", "_blank");
    if (win) win.opener = null;
    let url: string;
    try {
        url = await fetchSignedReportUrl(reportUrl);
    } catch (error) {
        // Don't strand an empty tab - the caller shows the error inline.
        win?.close();
        throw error;
    }
    if (win) win.location.href = url;
}

interface TestHistoryPoint extends RunHistoryPoint {
    runId: string;
    durationMs: number;
}

// Cross-run history for one test, derived entirely from `runs` (already
// fetched for this suite+env, up to 200 per firebaseTestSuiteRunsData.ts) -
// no separate API call or backend change needed. Matched by file+title+
// browser so a test that runs on more than one browser gets its own history
// per browser, not one blended strip. `runs` is already newest-first (see
// runsBySuite in TestSuitesPage), so the result is too.
function historyForTest(test: NrtTestResult, runs: TestSuiteRun[]): TestHistoryPoint[] {
    const points: TestHistoryPoint[] = [];

    for (const run of runs) {
        const match = (run.nrt?.tests ?? []).find(
            (t) => t.file === test.file && t.title === test.title && t.browser === test.browser
        );
        if (match) {
            points.push({
                runId: run.id,
                outcome: match.status,
                date: run.startedAt,
                detail: match.browser,
                durationMs: match.durationMs,
            });
        }
    }

    return points;
}

function StatTile({ value, label }: { value: string | number; label: string }) {
    const styles = useStyles();
    return (
        <Card className={styles.statTile}>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{label}</span>
        </Card>
    );
}


export function TestSuitesPage() {
    const { t } = useTranslation();
    const styles = useStyles();

    const [tab, setTab] = useState<TabKey>("overview");
    const [env, setEnv] = useState<TestEnvironment>("tst");
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["test-suites"],
        queryFn: fetchTestSuites,
    });

    const runs = useMemo(() => data?.runs ?? [], [data]);

    const runsBySuite = useMemo(() => {
        const map = new Map<TestSuiteKey, TestSuiteRun[]>();
        for (const suite of SUITE_ORDER) {
            const matching = runs
                .filter((run) => run.suite === suite && run.env === env)
                // An "nrt" run doc can carry nothing but untagged scaffolding
                // (e.g. auth setup) when it was actually a local check
                // pointed at only the a11y/security tag subset - every
                // domain comes back "other" in that case. Its a11y/security
                // results still matter (see AutomationKpiPage's spec
                // catalog, which reads them from this same doc's tests[]),
                // but showing it here as an NRT run reads as a false
                // all-skipped "bad" result. Hidden from this tab only - the
                // doc itself is untouched.
                .filter(
                    (run) =>
                        suite !== "nrt" ||
                        (run.nrt?.domains ?? []).some((d) => d.domain !== "other")
                )
                .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
            map.set(suite, matching);
        }
        return map;
    }, [runs, env]);

    const handleTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
        setTab(data.value as TabKey);
        setSelectedRunId(null);
    };

    const handleEnvChange = (value: string) => {
        setEnv(value as TestEnvironment);
        setSelectedRunId(null);
    };

    return (
        <PageLayout title={t("testSuitesPage.title")} hideAreaSprintScope wide>
            {data && data.configured && (
                <div className={styles.stickyBar}>
                    <TabList selectedValue={tab} onTabSelect={handleTabSelect}>
                        <Tab value="overview">{t("testSuitesPage.tabs.overview")}</Tab>
                        {SUITE_ORDER.map((suite) => (
                            <Tab key={suite} value={suite}>
                                {t(`testSuitesPage.tabs.${suite}`)}
                            </Tab>
                        ))}
                    </TabList>

                    <div className={styles.scopeSelects}>
                        <Dropdown
                            className={styles.scopeDropdown}
                            value={t(`testSuitesPage.envOptions.${env}`)}
                            selectedOptions={[env]}
                            onOptionSelect={(_, data) => data.optionValue && handleEnvChange(data.optionValue)}
                            aria-label={t("testSuitesPage.envLabel")}
                        >
                            {ENV_OPTIONS.map((option) => (
                                <Option key={option} value={option}>
                                    {t(`testSuitesPage.envOptions.${option}`)}
                                </Option>
                            ))}
                        </Dropdown>
                    </div>
                </div>
            )}

            <Text className={styles.subtitle}>{t("testSuitesPage.subtitle")}</Text>

            {isLoading && <LoadingCardGrid />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && !data.configured && (
                <Card className={styles.placeholderCard}>
                    <WrenchRegular className={styles.placeholderIcon} />
                    <Text weight="semibold">{t("testSuitesPage.notConfiguredTitle")}</Text>
                    <Text className={styles.placeholderBody}>
                        {t("testSuitesPage.notConfiguredBody")}
                    </Text>
                </Card>
            )}

            {data && data.configured && (
            <>
            {tab === "overview" && (
                <>
                    <span className={styles.eyebrow}>{t("testSuitesPage.eyebrow")}</span>
                    <div className={styles.suiteGrid}>
                        {SUITE_ORDER.map((suite) => (
                            <SuiteCard
                                key={suite}
                                suite={suite}
                                runs={runsBySuite.get(suite) ?? []}
                                onOpen={() => {
                                    setTab(suite);
                                    setSelectedRunId(null);
                                }}
                            />
                        ))}
                    </div>
                </>
            )}

            {tab !== "overview" && (
                <SuiteDetail
                    suite={tab}
                    runs={runsBySuite.get(tab) ?? []}
                    selectedRunId={selectedRunId}
                    onSelectRun={setSelectedRunId}
                    env={env}
                />
            )}
            </>
            )}
        </PageLayout>
    );
}

function SuiteCard({
    suite,
    runs,
    onOpen,
}: {
    suite: TestSuiteKey;
    runs: TestSuiteRun[];
    onOpen: () => void;
}) {
    const { t } = useTranslation();
    const styles = useStyles();
    const Icon = SUITE_ICONS[suite];
    const latest = runs[0];

    return (
        <Card className={styles.suiteCard} onClick={onOpen} role="button" tabIndex={0}>
            <div className={styles.suiteTop}>
                <div className={styles.suiteIcon}>
                    <Icon />
                </div>
                {latest && (
                    <StatusTag tone={statusTone(latest.status)}>
                        {t(`testSuitesPage.status.${latest.status}`)}
                    </StatusTag>
                )}
            </div>
            <div>
                <Text className={styles.suiteName} block>
                    {t(`testSuitesPage.suites.${suite}.name`)}
                </Text>
                <Text className={styles.suiteFull}>{t(`testSuitesPage.suites.${suite}.full`)}</Text>
                <Text className={styles.suiteFull}>{t(`testSuitesPage.suites.${suite}.tool`)}</Text>
            </div>
            <Text className={styles.suiteDesc}>{t(`testSuitesPage.suites.${suite}.desc`)}</Text>
            <div className={styles.suiteMeta}>
                <span>{latest ? t("testSuitesPage.ranAt", { time: formatDateTime(latest.startedAt) }) : "—"}</span>
                <span className={styles.suiteCta}>
                    {t("testSuitesPage.viewReports")}
                    <ChevronRightRegular />
                </span>
            </div>
        </Card>
    );
}

function SuiteDetail({
    suite,
    runs,
    selectedRunId,
    onSelectRun,
    env,
}: {
    suite: TestSuiteKey;
    runs: TestSuiteRun[];
    selectedRunId: string | null;
    onSelectRun: (id: string) => void;
    env: TestEnvironment;
}) {
    const { t } = useTranslation();
    const styles = useStyles();
    const Icon = SUITE_ICONS[suite];
    const run = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;
    const [reportError, setReportError] = useState(false);

    if (!run) {
        return (
            <Card className={styles.placeholderCard}>
                <span style={{ fontSize: "32px", color: tokens.colorNeutralForeground3 }}>
                    <Icon />
                </span>
                <Text weight="semibold">{t("testSuitesPage.notWiredTitle")}</Text>
                <Text className={styles.detailNote}>
                    {t("testSuitesPage.notWiredBody", {
                        env: t(`testSuitesPage.envOptions.${env}`),
                    })}
                </Text>
            </Card>
        );
    }

    return (
        <>
            <div className={styles.detailHead}>
                <div className={styles.detailTitle}>
                    <div className={styles.detailIcon}>
                        <Icon />
                    </div>
                    <div>
                        <Title2 as="h2">{t(`testSuitesPage.suites.${suite}.full`)}</Title2>
                        <div className={styles.detailSub}>
                            <StatusTag tone={statusTone(run.status)}>
                                {t(`testSuitesPage.status.${run.status}`)}
                            </StatusTag>
                            <Text font="monospace" size={200} className={styles.detailBranch} title={run.branch}>
                                {run.branch}
                            </Text>
                            {run.commitSha && (
                                <>
                                    <span>&middot;</span>
                                    <Text font="monospace" size={200} title={run.commitSha}>
                                        {run.commitSha.slice(0, 7)}
                                    </Text>
                                </>
                            )}
                            <span>&middot;</span>
                            <span>{formatDateTime(run.startedAt)}</span>
                        </div>
                    </div>
                </div>
                <div className={styles.reportCta}>
                    {run.zap ? (
                        <div className={styles.reportButtons}>
                            <Button
                                appearance="primary"
                                icon={<OpenRegular />}
                                disabled={!canOpenReport(run.reportUrl)}
                                onClick={() => {
                                    setReportError(false);
                                    openTestSuiteReport(run.reportFile, run.reportUrl).catch(() => setReportError(true));
                                }}
                            >
                                {t("testSuitesPage.zap.openReportEn")}
                            </Button>
                            {run.reportFileIt && (
                                <Button
                                    icon={<OpenRegular />}
                                    disabled={!canOpenReport(run.reportUrlIt)}
                                    onClick={() => {
                                        setReportError(false);
                                        openTestSuiteReport(run.reportFileIt!, run.reportUrlIt).catch(() =>
                                            setReportError(true)
                                        );
                                    }}
                                >
                                    {t("testSuitesPage.zap.openReportIt")}
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className={styles.reportButtons}>
                            <Button
                                appearance="primary"
                                icon={<OpenRegular />}
                                disabled={!canOpenReport(run.reportUrl)}
                                onClick={() => {
                                    setReportError(false);
                                    openTestSuiteReport(run.reportFile, run.reportUrl).catch(() => setReportError(true));
                                }}
                            >
                                {t("testSuitesPage.openReport", { file: run.reportFile })}
                            </Button>
                            {run.reportFileA11y && (
                                <Button
                                    icon={<OpenRegular />}
                                    disabled={!canOpenReport(run.reportUrlA11y)}
                                    onClick={() => {
                                        setReportError(false);
                                        openTestSuiteReport(run.reportFileA11y!, run.reportUrlA11y).catch(() =>
                                            setReportError(true)
                                        );
                                    }}
                                >
                                    {t("testSuitesPage.openA11yReport")}
                                </Button>
                            )}
                        </div>
                    )}
                    {!canOpenReport(run.reportUrl) && (
                        <Text className={styles.detailNote}>{t("testSuitesPage.reportNotUploaded")}</Text>
                    )}
                    {reportError && (
                        <Text className={styles.detailNote} style={{ color: tokens.colorPaletteRedForeground1 }}>
                            {t("testSuitesPage.openReportError")}
                        </Text>
                    )}
                    <Text className={styles.detailNote}>{t("testSuitesPage.renderedBy", { tool: run.reportTool })}</Text>
                </div>
            </div>

            <div className={styles.gridTwo}>
                <div>
                    {run.nrt && <NrtDetail run={run} runs={runs} />}
                    {run.zap && <ZapDetail detail={run.zap} />}
                </div>
                <RunsList runs={runs} selectedId={run.id} onSelect={onSelectRun} />
            </div>
        </>
    );
}

const ZAP_RISK_ORDER: ZapRisk[] = ["high", "medium", "low", "informational"];
const ZAP_RISK_TONE: Record<ZapRisk, StatusTone> = {
    high: "danger",
    medium: "warning",
    low: "neutral",
    informational: "neutral",
};

// A ZAP scan run (see scripts/publish-zap-run.js) - alert types per risk
// level plus the full alert list. The scanned app's own alerts come first;
// third-party hosts the browser passed through (Microsoft login) follow.
function ZapDetail({ detail }: { detail: ZapRunDetail }) {
    const { t } = useTranslation();
    const styles = useStyles();
    const alerts = [...detail.alerts].sort(
        (a, b) => Number(b.site === detail.target) - Number(a.site === detail.target)
    );

    return (
        <div>
            <div className={styles.statRow}>
                {ZAP_RISK_ORDER.map((risk) => (
                    <StatTile key={risk} value={detail.alertsByRisk[risk]} label={t(`testSuitesPage.zap.risk.${risk}`)} />
                ))}
            </div>

            <Card className={styles.card}>
                <div className={styles.cardTitle}>
                    <span>{t("testSuitesPage.zap.alertsTitle")}</span>
                    <span className={styles.cardTitleHint}>
                        {t("testSuitesPage.zap.target", { target: detail.target, version: detail.zapVersion })}
                    </span>
                </div>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th className={styles.tableHeadCell}>{t("testSuitesPage.zap.alertCol")}</th>
                            <th className={styles.tableHeadCell}>{t("testSuitesPage.zap.riskCol")}</th>
                            <th className={styles.tableHeadCell}>{t("testSuitesPage.zap.confidenceCol")}</th>
                            <th className={styles.tableHeadCell}>{t("testSuitesPage.zap.siteCol")}</th>
                            <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                {t("testSuitesPage.zap.instancesCol")}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {alerts.map((alert) => (
                            <tr key={`${alert.site}-${alert.pluginId}-${alert.name}`}>
                                <td className={styles.tableCell}>{alert.name}</td>
                                <td className={styles.tableCell}>
                                    <StatusTag tone={ZAP_RISK_TONE[alert.risk]}>
                                        {t(`testSuitesPage.zap.risk.${alert.risk}`)}
                                    </StatusTag>
                                </td>
                                <td className={styles.tableCell}>{alert.confidence}</td>
                                <td className={styles.tableCell}>{alert.site}</td>
                                <td className={styles.tableCellNum}>{alert.instances}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>
        </div>
    );
}

function NrtDetail({ run, runs }: { run: TestSuiteRun; runs: TestSuiteRun[] }) {
    const { t } = useTranslation();
    const styles = useStyles();
    const detail = run.nrt!;
    // a11y/security runs carry team: tag data instead of a meaningful
    // domain breakdown (see buildTeamSummary) - prefer it over domains when
    // present rather than showing both.
    const hasTeams = (detail.teams?.length ?? 0) > 0;
    const durationLabel = `${Math.round(detail.durationMs / 60000)}m ${Math.round((detail.durationMs % 60000) / 1000)}s`;

    const trendRuns = runs.slice(0, TREND_RUN_COUNT).filter((r) => r.nrt).reverse();

    // See realNrtTests/nrtPassRate above for why these exclude setup/*
    // scaffolding specs instead of trusting detail.totalTests/.passed.
    const realTests = realNrtTests(detail);
    const pct = nrtPassRate(detail);

    // Clicking a row in the domain/team breakdown filters the Test list
    // below to just that group - toggled off by clicking the same row again.
    const [rowFilter, setRowFilter] = useState<string | null>(null);
    const filteredTests = realTests.filter(
        (test) => !rowFilter || (hasTeams ? test.app : test.domain) === rowFilter
    );

    return (
        <div>
                <div className={styles.statRow}>
                    <StatTile value={`${pct}%`} label={t("testSuitesPage.nrt.passRate")} />
                    <StatTile value={realTests.length} label={t("testSuitesPage.nrt.totalTests")} />
                    <StatTile value={detail.flaky} label={t("testSuitesPage.nrt.flaky")} />
                    <StatTile value={durationLabel} label={t("testSuitesPage.nrt.duration")} />
                </div>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t("testSuitesPage.nrt.trendTitle", { count: trendRuns.length })}</span>
                    </div>
                    <div className={styles.trendBars}>
                        {trendRuns.map((r) => {
                            const rRatePct = nrtPassRate(r.nrt!);
                            const rPct = Math.max(rRatePct, 8);
                            const color =
                                r.status === "bad"
                                    ? tokens.colorPaletteRedForeground1
                                    : r.status === "warn"
                                      ? tokens.colorPaletteMarigoldForeground1
                                      : tokens.colorPaletteGreenForeground1;
                            return (
                                <div
                                    key={r.id}
                                    className={styles.trendBar}
                                    style={{ height: `${rPct}%`, backgroundColor: color }}
                                    title={`${rRatePct}%`}
                                />
                            );
                        })}
                    </div>
                </Card>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t(hasTeams ? "testSuitesPage.nrt.teamsTitle" : "testSuitesPage.nrt.domainsTitle")}</span>
                        <span className={styles.cardTitleHint}>{detail.totalTests}</span>
                    </div>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.tableHeadCell}>
                                    {t(hasTeams ? "testSuitesPage.nrt.teamCol" : "testSuitesPage.nrt.domainCol")}
                                </th>
                                <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                    {t("testSuitesPage.nrt.passedCol")}
                                </th>
                                <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                    {t("testSuitesPage.nrt.totalCol")}
                                </th>
                                <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                    {t("testSuitesPage.nrt.flakyCol")}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {(hasTeams ? detail.teams! : detail.domains).map((d: NrtDomainResult) => (
                                <tr
                                    key={d.domain}
                                    className={mergeClasses(
                                        styles.tableRowClickable,
                                        rowFilter === d.domain && styles.tableRowSelected
                                    )}
                                    onClick={() => setRowFilter((current) => (current === d.domain ? null : d.domain))}
                                >
                                    <td className={styles.tableCell}>{hasTeams ? d.label : d.domain}</td>
                                    <td className={styles.tableCellNum}>{d.passed}</td>
                                    <td className={styles.tableCellNum}>{d.total}</td>
                                    <td className={styles.tableCellNum}>{d.flaky}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>

                {realTests.length > 0 && (
                    <Card className={styles.card}>
                        <div className={styles.cardTitle}>
                            <span>{t("testSuitesPage.nrt.testsTitle")}</span>
                            <span className={styles.cardTitleHint}>
                                {rowFilter ? `${filteredTests.length} / ${realTests.length}` : realTests.length}
                            </span>
                        </div>
                        <Accordion collapsible>
                            {filteredTests.map((test, i) => {
                                const history = historyForTest(test, runs);
                                return (
                                <AccordionItem key={`${test.title}-${i}`} value={i}>
                                    <AccordionHeader expandIconPosition="end">
                                        <div className={styles.testHeaderRow}>
                                            <StatusTag tone={statusTone(test.status === "failed" ? "bad" : test.status === "skipped" ? "warn" : "good")}>
                                                {t(`testSuitesPage.nrt.testStatus.${test.status}`)}
                                            </StatusTag>
                                            <Text className={styles.testTitle}>{test.title}</Text>
                                            <Text className={styles.findingMeta} font="monospace">
                                                {test.domain}
                                            </Text>
                                        </div>
                                    </AccordionHeader>
                                    <AccordionPanel>
                                        <Text className={styles.findingMeta} font="monospace" block>
                                            {test.file}
                                        </Text>
                                        {test.steps.length === 0 ? (
                                            <Text className={styles.detailNote}>{t("testSuitesPage.nrt.noSteps")}</Text>
                                        ) : (
                                            <ol className={styles.stepsList}>
                                                {test.steps.map((step, j) => (
                                                    <li key={j} className={styles.stepListItem}>
                                                        <span>{step.title}</span>
                                                        <span className={styles.findingMeta}>{(step.durationMs / 1000).toFixed(1)}s</span>
                                                    </li>
                                                ))}
                                            </ol>
                                        )}

                                        {history.length > 0 && (
                                            <div className={styles.testHistorySection}>
                                                <Text weight="semibold" size={200}>
                                                    {t("testSuitesPage.nrt.historyTitle", { count: history.length })}
                                                </Text>
                                                <table className={styles.table}>
                                                    <thead>
                                                        <tr>
                                                            <th className={styles.tableHeadCell}>{t("testSuitesPage.nrt.historyDateCol")}</th>
                                                            <th className={styles.tableHeadCell}>{t("testSuitesPage.nrt.historyOutcomeCol")}</th>
                                                            <th className={styles.tableHeadCell} style={{ textAlign: "right" }}>
                                                                {t("testSuitesPage.nrt.historyDurationCol")}
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {history.map((point) => (
                                                            <tr key={point.runId}>
                                                                <td className={styles.tableCell}>{formatDateTime(point.date)}</td>
                                                                <td className={styles.tableCell}>
                                                                    <StatusTag
                                                                        tone={statusTone(
                                                                            point.outcome === "failed" ? "bad" : point.outcome === "skipped" ? "warn" : "good"
                                                                        )}
                                                                    >
                                                                        {t(`testSuitesPage.nrt.testStatus.${point.outcome}`)}
                                                                    </StatusTag>
                                                                </td>
                                                                <td className={styles.tableCellNum}>{(point.durationMs / 1000).toFixed(1)}s</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </AccordionPanel>
                                </AccordionItem>
                                );
                            })}
                        </Accordion>
                    </Card>
                )}
        </div>
    );
}

function RunsList({
    runs,
    selectedId,
    onSelect,
}: {
    runs: TestSuiteRun[];
    selectedId: string;
    onSelect: (id: string) => void;
}) {
    const { t } = useTranslation();
    const styles = useStyles();

    return (
        <Card className={styles.card}>
            <div className={styles.cardTitle}>
                <span>{t("testSuitesPage.pastRuns")}</span>
                <span className={styles.cardTitleHint}>{t("testSuitesPage.totalRuns", { count: runs.length })}</span>
            </div>
            <div className={styles.runsList}>
                {runs.map((run, i) => (
                    <button
                        key={run.id}
                        type="button"
                        className={mergeClasses(styles.runRow, run.id === selectedId && styles.runRowActive)}
                        onClick={() => onSelect(run.id)}
                    >
                        <div className={styles.runTop}>
                            <span className={styles.runDate}>{formatDateTime(run.startedAt)}</span>
                            <div className={styles.runBadges}>
                                {i === 0 && (
                                    <Text size={200} weight="semibold" className={styles.runLatestTag}>
                                        {t("testSuitesPage.latest")}
                                    </Text>
                                )}
                                <StatusTag tone={statusTone(run.status)}>
                                    {t(`testSuitesPage.status.${run.status}`)}
                                </StatusTag>
                            </div>
                        </div>
                        <Text
                            font="monospace"
                            className={styles.runBranch}
                            title={run.commitSha ? `${run.branch} · ${run.commitSha}` : run.branch}
                        >
                            {run.branch}
                            {run.commitSha ? ` · ${run.commitSha.slice(0, 7)}` : ""}
                        </Text>
                    </button>
                ))}
            </div>
        </Card>
    );
}
