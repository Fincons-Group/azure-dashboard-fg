import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Button,
    Card,
    Dropdown,
    Option,
    Switch,
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
    type FluentIcon,
} from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { getApiBaseUrl } from "../api/client";
import { TEST_SUITE_RUNS } from "../data/testSuitesMockData";
import type {
    A11yRuleViolation,
    DastAlert,
    NrtDomainResult,
    TestAppScope,
    TestEnvironment,
    TestRunStatus,
    TestSuiteKey,
    TestSuiteRun,
} from "../types";

type TabKey = "overview" | TestSuiteKey;

const SUITE_ORDER: TestSuiteKey[] = ["nrt", "a11y", "dast"];
const APP_OPTIONS: TestAppScope[] = ["plurifond", "frontOfficeAuto", "all"];
const ENV_OPTIONS: TestEnvironment[] = ["tst", "pre", "prd"];
const TREND_RUN_COUNT = 6;

const SUITE_ICONS: Record<TestSuiteKey, FluentIcon> = {
    nrt: ArrowRepeatAllRegular,
    a11y: AccessibilityCheckmarkRegular,
    dast: ShieldCheckmarkRegular,
};

// The scope bar (tabs + app/environment pickers) sits directly beneath
// PageLayout's TopBar (sticky at top:0) and ScopeBar (sticky at
// top:NAV_HEIGHT, showing at least the Project chip). 140px is their
// combined rendered height, measured in-browser (TopBar 65px + ScopeBar's
// collapsed row 75px) - there's no shared constant for ScopeBar's height to
// derive this from. Re-measure if either bar's layout changes.
const SCOPE_BAR_TOP = "140px";

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    stickyBar: {
        position: "sticky",
        top: SCOPE_BAR_TOP,
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
    barRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    barLabel: {
        width: "96px",
        flexShrink: 0,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
    },
    barTrack: {
        flex: 1,
        height: "8px",
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground3,
        overflow: "hidden",
    },
    barFill: {
        height: "100%",
    },
    barCount: {
        width: "28px",
        textAlign: "right",
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        flexShrink: 0,
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
    findingId: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorBrandForeground1,
        textDecorationLine: "none",
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
    stepBlock: {
        paddingTop: tokens.spacingVerticalM,
        marginTop: tokens.spacingVerticalM,
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorNeutralStroke2,
        ":first-of-type": {
            paddingTop: 0,
            marginTop: 0,
            borderTopWidth: 0,
        },
    },
    stepHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalS,
        marginBottom: tokens.spacingVerticalM,
        padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalS}`,
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusMedium,
    },
    stepLabel: {
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightBold,
        color: tokens.colorNeutralForeground1,
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
    runBranch: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
    },
});

function statusToBadgeColor(status: TestRunStatus): "success" | "warning" | "danger" {
    if (status === "good") return "success";
    if (status === "warn") return "warning";
    return "danger";
}

function impactToBadgeColor(
    impact: "critical" | "serious" | "moderate" | "minor"
): "danger" | "severe" | "warning" | "informative" {
    if (impact === "critical") return "danger";
    if (impact === "serious") return "severe";
    if (impact === "moderate") return "warning";
    return "informative";
}

function riskToBadgeColor(risk: DastAlert["risk"]): "danger" | "warning" | "informative" | "subtle" {
    if (risk === "High") return "danger";
    if (risk === "Medium") return "warning";
    if (risk === "Low") return "informative";
    return "subtle";
}

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

// Points at whatever a local tst-e2e checkout's reports/ folder the server
// is statically serving under /test-suites-reports (see
// TEST_SUITES_REPORTS_DIR in src/server.ts) - a dev-only convenience, so
// this 404s when that env var isn't set. reportFile/reportFileIt already
// carry the full path relative to reports/ (e.g. "runs/<id>/smart-report.html",
// "a11y/index.html", "zap/<file>.html") - same convention
// scripts/publish-local-test-runs.js writes - so this never re-derives a
// per-suite subpath itself.
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

function StatTile({ value, label }: { value: string | number; label: string }) {
    const styles = useStyles();
    return (
        <Card className={styles.statTile}>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{label}</span>
        </Card>
    );
}

function SeverityBar({
    label,
    count,
    max,
    color,
}: {
    label: string;
    count: number;
    max: number;
    color: string;
}) {
    const styles = useStyles();
    const pct = max > 0 ? Math.max((count / max) * 100, count > 0 ? 4 : 0) : 0;

    return (
        <div className={styles.barRow}>
            <span className={styles.barLabel}>{label}</span>
            <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className={styles.barCount}>{count}</span>
        </div>
    );
}

export function TestSuitesPage() {
    const { t } = useTranslation();
    const styles = useStyles();

    const [tab, setTab] = useState<TabKey>("overview");
    const [appScope, setAppScope] = useState<TestAppScope>("plurifond");
    const [env, setEnv] = useState<TestEnvironment>("tst");
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

    const runsBySuite = useMemo(() => {
        const map = new Map<TestSuiteKey, TestSuiteRun[]>();
        for (const suite of SUITE_ORDER) {
            const matching = TEST_SUITE_RUNS.filter(
                (run) => run.suite === suite && run.app === appScope && run.env === env
            ).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
            map.set(suite, matching);
        }
        return map;
    }, [appScope, env]);

    const handleTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
        setTab(data.value as TabKey);
        setSelectedRunId(null);
    };

    const handleAppChange = (value: string) => {
        setAppScope(value as TestAppScope);
        setSelectedRunId(null);
    };

    const handleEnvChange = (value: string) => {
        setEnv(value as TestEnvironment);
        setSelectedRunId(null);
    };

    return (
        <PageLayout title={t("testSuitesPage.title")} hideAreaSprintScope wide>
            <Text className={styles.subtitle}>{t("testSuitesPage.subtitle")}</Text>

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
                        value={t(`testSuitesPage.appOptions.${appScope}`)}
                        selectedOptions={[appScope]}
                        onOptionSelect={(_, data) => data.optionValue && handleAppChange(data.optionValue)}
                        aria-label={t("testSuitesPage.appLabel")}
                    >
                        {APP_OPTIONS.map((option) => (
                            <Option key={option} value={option}>
                                {t(`testSuitesPage.appOptions.${option}`)}
                            </Option>
                        ))}
                    </Dropdown>

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
                    appScope={appScope}
                    env={env}
                />
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
                    <Badge appearance="filled" color={statusToBadgeColor(latest.status)}>
                        {t(`testSuitesPage.status.${latest.status}`)}
                    </Badge>
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
    appScope,
    env,
}: {
    suite: TestSuiteKey;
    runs: TestSuiteRun[];
    selectedRunId: string | null;
    onSelectRun: (id: string) => void;
    appScope: TestAppScope;
    env: TestEnvironment;
}) {
    const { t } = useTranslation();
    const styles = useStyles();
    const Icon = SUITE_ICONS[suite];
    const run = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;

    if (!run) {
        return (
            <Card className={styles.placeholderCard}>
                <span style={{ fontSize: "32px", color: tokens.colorNeutralForeground3 }}>
                    <Icon />
                </span>
                <Text weight="semibold">{t("testSuitesPage.notWiredTitle")}</Text>
                <Text className={styles.detailNote}>
                    {t("testSuitesPage.notWiredBody", {
                        app: t(`testSuitesPage.appOptions.${appScope}`),
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
                            <Badge appearance="filled" color={statusToBadgeColor(run.status)}>
                                {t(`testSuitesPage.status.${run.status}`)}
                            </Badge>
                            <Text font="monospace" size={200}>
                                {run.branch}
                            </Text>
                            <span>&middot;</span>
                            <Text font="monospace" size={200}>
                                {run.commitSha}
                            </Text>
                            <span>&middot;</span>
                            <Text font="monospace" size={200}>
                                {run.id}
                            </Text>
                            <span>&middot;</span>
                            <span>{formatDateTime(run.startedAt)}</span>
                        </div>
                        {run.linkedRunId && (
                            <Text className={styles.detailNote} block>
                                {suite === "nrt"
                                    ? t("testSuitesPage.linkedNoteNrt")
                                    : t("testSuitesPage.linkedNoteA11y", { runId: run.linkedRunId })}
                            </Text>
                        )}
                    </div>
                </div>
                <div className={styles.reportCta}>
                    <Button
                        as="a"
                        href={reportHref(run.reportFile)}
                        target="_blank"
                        rel="noreferrer"
                        appearance="primary"
                        icon={<OpenRegular />}
                    >
                        {t("testSuitesPage.openReport", { file: run.reportFile })}
                    </Button>
                    {run.reportFileIt && (
                        <Button
                            as="a"
                            href={reportHref(run.reportFileIt)}
                            target="_blank"
                            rel="noreferrer"
                            appearance="secondary"
                            icon={<OpenRegular />}
                        >
                            {t("testSuitesPage.openReportIt", { file: run.reportFileIt })}
                        </Button>
                    )}
                    <Text className={styles.detailNote}>{t("testSuitesPage.renderedBy", { tool: run.reportTool })}</Text>
                </div>
            </div>

            <div className={styles.gridTwo}>
                <div>
                    {suite === "nrt" && run.nrt && <NrtDetail run={run} runs={runs} />}
                    {suite === "a11y" && run.a11y && <A11yDetail detail={run.a11y} />}
                    {suite === "dast" && run.dast && <DastDetail detail={run.dast} />}
                </div>
                <RunsList runs={runs} selectedId={run.id} onSelect={onSelectRun} />
            </div>
        </>
    );
}

function NrtDetail({ run, runs }: { run: TestSuiteRun; runs: TestSuiteRun[] }) {
    const { t } = useTranslation();
    const styles = useStyles();
    const detail = run.nrt!;
    const pct = Math.round((detail.passed / detail.totalTests) * 1000) / 10;
    const durationLabel = `${Math.round(detail.durationMs / 60000)}m ${Math.round((detail.durationMs % 60000) / 1000)}s`;

    const trendRuns = runs.slice(0, TREND_RUN_COUNT).filter((r) => r.nrt).reverse();

    return (
        <div>
                <div className={styles.statRow}>
                    <StatTile value={`${pct}%`} label={t("testSuitesPage.nrt.passRate")} />
                    <StatTile value={detail.totalTests} label={t("testSuitesPage.nrt.totalTests")} />
                    <StatTile value={detail.flaky} label={t("testSuitesPage.nrt.flaky")} />
                    <StatTile value={durationLabel} label={t("testSuitesPage.nrt.duration")} />
                </div>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t("testSuitesPage.nrt.trendTitle", { count: trendRuns.length })}</span>
                    </div>
                    <div className={styles.trendBars}>
                        {trendRuns.map((r) => {
                            const rPct = Math.max((r.nrt!.passed / r.nrt!.totalTests) * 100, 8);
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
                                    title={`${Math.round((r.nrt!.passed / r.nrt!.totalTests) * 1000) / 10}%`}
                                />
                            );
                        })}
                    </div>
                </Card>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t("testSuitesPage.nrt.domainsTitle")}</span>
                        <span className={styles.cardTitleHint}>{detail.totalTests}</span>
                    </div>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.tableHeadCell}>{t("testSuitesPage.nrt.domainCol")}</th>
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
                            {detail.domains.map((d: NrtDomainResult) => (
                                <tr key={d.domain}>
                                    <td className={styles.tableCell}>
                                        {d.domain} — {d.label}
                                    </td>
                                    <td className={styles.tableCellNum}>{d.passed}</td>
                                    <td className={styles.tableCellNum}>{d.total}</td>
                                    <td className={styles.tableCellNum}>{d.flaky}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>

                {detail.tests && detail.tests.length > 0 && (
                    <Card className={styles.card}>
                        <div className={styles.cardTitle}>
                            <span>{t("testSuitesPage.nrt.testsTitle")}</span>
                            <span className={styles.cardTitleHint}>{detail.tests.length}</span>
                        </div>
                        <Accordion collapsible>
                            {detail.tests.map((test, i) => (
                                <AccordionItem key={`${test.title}-${i}`} value={i}>
                                    <AccordionHeader expandIconPosition="end">
                                        <div className={styles.testHeaderRow}>
                                            <Badge appearance="filled" color={statusToBadgeColor(test.status === "failed" ? "bad" : test.status === "skipped" ? "warn" : "good")}>
                                                {t(`testSuitesPage.nrt.testStatus.${test.status}`)}
                                            </Badge>
                                            <Text className={styles.testTitle}>{test.title}</Text>
                                            <Text className={styles.findingMeta} font="monospace">
                                                {test.domain}
                                            </Text>
                                        </div>
                                    </AccordionHeader>
                                    <AccordionPanel>
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
                                    </AccordionPanel>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </Card>
                )}
        </div>
    );
}

function A11yDetail({ detail }: { detail: NonNullable<TestSuiteRun["a11y"]> }) {
    const { t } = useTranslation();
    const styles = useStyles();
    const [onlyFailed, setOnlyFailed] = useState(false);
    const max = Math.max(detail.critical, detail.serious, detail.moderate, detail.minor, 1);
    const failedSteps = detail.steps.filter((s) => s.violations > 0 || s.incomplete > 0);
    const visibleSteps = onlyFailed ? failedSteps : detail.steps;

    return (
        <div>
                <div className={styles.statRow}>
                    <StatTile value={detail.violations} label={t("testSuitesPage.a11y.violations")} />
                    <StatTile value={detail.incomplete} label={t("testSuitesPage.a11y.incomplete")} />
                    {detail.passes != null && <StatTile value={detail.passes} label={t("testSuitesPage.a11y.passes")} />}
                    <StatTile value={detail.stepsScanned} label={t("testSuitesPage.a11y.stepsScanned")} />
                </div>

                {/* This summary only has the counts/rule ids axe-data-*.json
                    carries - no screenshots or DOM context, which only the
                    generated report itself has (see the "Open ..." button
                    above). */}
                <Text className={styles.detailNote} block>
                    {t("testSuitesPage.a11y.moreInfoNote")}
                </Text>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t("testSuitesPage.a11y.impactTitle")}</span>
                    </div>
                    <SeverityBar label={t("testSuitesPage.a11y.impact.critical")} count={detail.critical} max={max} color={tokens.colorPaletteRedForeground1} />
                    <SeverityBar label={t("testSuitesPage.a11y.impact.serious")} count={detail.serious} max={max} color={tokens.colorPaletteRedForeground1} />
                    <SeverityBar label={t("testSuitesPage.a11y.impact.moderate")} count={detail.moderate} max={max} color={tokens.colorPaletteMarigoldForeground1} />
                    <SeverityBar label={t("testSuitesPage.a11y.impact.minor")} count={detail.minor} max={max} color={tokens.colorNeutralForeground3} />
                </Card>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t("testSuitesPage.a11y.stepsTitle")}</span>
                        <span className={styles.cardTitleHint}>
                            {t("testSuitesPage.a11y.stepsShown", { shown: visibleSteps.length, total: detail.steps.length })}
                        </span>
                    </div>
                    <Switch
                        checked={onlyFailed}
                        onChange={(_, data) => setOnlyFailed(data.checked)}
                        label={t("testSuitesPage.a11y.onlyFailedSteps", { count: failedSteps.length })}
                    />
                    {visibleSteps.length === 0 && (
                        <Text className={styles.detailNote}>{t("testSuitesPage.a11y.noFailedSteps")}</Text>
                    )}
                    {visibleSteps.map((step) => {
                        const stepFailed = step.violations > 0 || step.incomplete > 0;
                        return (
                            <div key={step.label} className={styles.stepBlock}>
                                <div className={styles.stepHeader}>
                                    <Text className={styles.stepLabel} font="monospace">{step.label}</Text>
                                    <Badge appearance="filled" color={stepFailed ? "danger" : "success"}>
                                        {stepFailed
                                            ? t("testSuitesPage.a11y.stepFailed", { violations: step.violations, incomplete: step.incomplete })
                                            : t("testSuitesPage.a11y.stepClean")}
                                    </Badge>
                                </div>
                                {step.rules.map((rule: A11yRuleViolation) => (
                                    <div key={rule.ruleId} className={styles.findingRow}>
                                        <div className={styles.findingTop}>
                                            <a
                                                className={styles.findingId}
                                                href={`https://dequeuniversity.com/rules/axe/4.12/${rule.ruleId}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {rule.ruleId}
                                            </a>
                                            <Badge appearance="filled" color={impactToBadgeColor(rule.impact)}>
                                                {t(`testSuitesPage.a11y.impact.${rule.impact}`)}
                                            </Badge>
                                            <span className={styles.findingMeta}>&times; {rule.count}</span>
                                        </div>
                                        <Text className={styles.findingTitle} block>
                                            {rule.description}
                                        </Text>
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </Card>
        </div>
    );
}

function DastDetail({ detail }: { detail: NonNullable<TestSuiteRun["dast"]> }) {
    const { t } = useTranslation();
    const styles = useStyles();
    const max = Math.max(detail.high, detail.medium, detail.low, detail.informational, 1);

    return (
        <div>
                <div className={styles.statRow}>
                    <StatTile value={detail.riskScore} label={t("testSuitesPage.dast.riskScore")} />
                    <StatTile
                        value={detail.high + detail.medium + detail.low + detail.informational}
                        label={t("testSuitesPage.dast.openAlerts")}
                    />
                    <StatTile value={detail.endpointsScanned} label={t("testSuitesPage.dast.endpointsScanned")} />
                    <StatTile value={detail.high} label={t("testSuitesPage.dast.highRisk")} />
                </div>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t("testSuitesPage.dast.riskTitle")}</span>
                    </div>
                    <SeverityBar label={t("testSuitesPage.dast.risk.High")} count={detail.high} max={max} color={tokens.colorPaletteRedForeground1} />
                    <SeverityBar label={t("testSuitesPage.dast.risk.Medium")} count={detail.medium} max={max} color={tokens.colorPaletteMarigoldForeground1} />
                    <SeverityBar label={t("testSuitesPage.dast.risk.Low")} count={detail.low} max={max} color={tokens.colorNeutralForeground3} />
                    <SeverityBar label={t("testSuitesPage.dast.risk.Informational")} count={detail.informational} max={max} color={tokens.colorNeutralForeground3} />
                </Card>

                <Card className={styles.card}>
                    <div className={styles.cardTitle}>
                        <span>{t("testSuitesPage.dast.alertsTitle")}</span>
                        <span className={styles.cardTitleHint}>{detail.alerts.length}</span>
                    </div>
                    {detail.alerts.map((alert: DastAlert, i: number) => (
                        <div key={i} className={styles.findingRow}>
                            <div className={styles.findingTop}>
                                <Badge appearance="filled" color={riskToBadgeColor(alert.risk)}>
                                    {t(`testSuitesPage.dast.risk.${alert.risk}`)}
                                </Badge>
                                <span className={styles.findingMeta}>{alert.target}</span>
                            </div>
                            <Text className={styles.findingTitle} block>
                                {alert.title}
                            </Text>
                        </div>
                    ))}
                </Card>
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
                            {i === 0 ? (
                                <Badge appearance="filled" color="brand">
                                    {t("testSuitesPage.latest")}
                                </Badge>
                            ) : (
                                <Badge appearance="filled" color={statusToBadgeColor(run.status)}>
                                    {t(`testSuitesPage.status.${run.status}`)}
                                </Badge>
                            )}
                        </div>
                        <Text font="monospace" className={styles.runBranch}>
                            {run.branch} &middot; {run.commitSha}
                        </Text>
                    </button>
                ))}
            </div>
        </Card>
    );
}
