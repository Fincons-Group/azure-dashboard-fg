import { useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Button,
    Field,
    Input,
    Spinner,
    Switch,
    Text,
    Textarea,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowDownloadRegular,
    ClipboardCheckmarkRegular,
    ClipboardRegular,
    CodeTextRegular,
    MailRegular,
    SlideTextRegular,
} from "@fluentui/react-icons";
import { ChartCard } from "./ChartCard";
import { StatusReportCard } from "./StatusReportCard";
import type { SuiteProgressGroup } from "./StatusReportCard";
import { fetchPlanOverview, fetchPlans } from "../api/client";
import {
    DEFAULT_REPORT_CC,
    DEFAULT_REPORT_RECIPIENTS,
    parseAddressList,
    sendGraphMailReport,
} from "../api/graphMail";
import {
    buildStatusReportCardEmailBodyHtml,
    buildStatusReportCardEmailDocument,
    buildStatusReportCardFilename,
    copyStatusReportCardEmailHtmlToClipboard,
    downloadStatusReportCardEmailHtml,
    exportStatusReportCardToPdf,
    exportStatusReportCardToPptx,
} from "../utils/export";
import type { DefectStats, Outcome, SprintDefectReport } from "../types";

const MONITORING_DASHBOARD_URL =
    "https://dev.azure.com/ItasMutua/Nuova%20Frontiera/_dashboards/dashboard/4665852c-cb39-4a89-ac4f-1dca396b539a";

const emailReportEnabled =
    import.meta.env.VITE_ENABLE_EMAIL_REPORT === "true";

const ZERO_OUTCOME_COUNTS: Record<Outcome, number> = {
    Passed: 0,
    Failed: 0,
    Blocked: 0,
    NotApplicable: 0,
    Paused: 0,
    InProgress: 0,
    NotRun: 0,
};

export interface SuiteGroupDef {
    label: string;
    // Plan identity is resolved by ID when given directly (bypasses the
    // name-lookup step entirely - used for "Test Factory", whose plan name
    // kept failing to match), otherwise by looking up planName in the
    // plans list.
    planId?: number;
    planName?: string;
    // Omit both suiteIds/suiteNames to match every suite in the plan (a
    // whole-plan alias). When suiteIds is set it takes priority over
    // suiteNames - matching by ID is what "Test Business"/"Test Agenti" use,
    // since Azure DevOps has more than one suite named "Test Agenti" in that
    // plan and name-matching was silently merging them into one row that
    // didn't match what Azure itself shows for that suite.
    suiteIds?: number[];
    suiteNames?: string[];
}

// Each row on the status card is resolved automatically from a specific
// plan rather than picked ad hoc per report. "Test Factory" is just an
// alias for the whole plan 4715 (every suite in it, summed - same shape of
// total/outcome breakdown as the other rows). "Test Business"/"Test Agenti"
// are single suites (by ID, see SuiteGroupDef) living in a different plan
// ("... - UAT").
const AUTO_SUITE_GROUP_DEFS: SuiteGroupDef[] = [
    {
        label: "Test Factory",
        planId: 4715,
    },
    {
        label: "Test Business",
        planName: "Front Office Auto - Sprint 1 - UAT",
        suiteIds: [6181],
    },
    {
        label: "Test Agenti",
        planName: "Front Office Auto - Sprint 1 - UAT",
        suiteIds: [6179],
    },
];

const useStyles = makeStyles({
    note: {
        color: tokens.colorNeutralForeground3,
    },
    statusCardControls: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalM,
        alignItems: "flex-start",
    },
    statusCardField: {
        minWidth: "220px",
        flex: "1 1 220px",
    },
    statusCardFieldWide: {
        minWidth: "260px",
        flex: "2 1 320px",
    },
    statusCardFieldFull: {
        minWidth: "260px",
        flex: "1 1 100%",
    },
    emailCardActions: {
        display: "flex",
        flexWrap: "wrap",
        gap: tokens.spacingHorizontalM,
        alignItems: "flex-end",
        justifyContent: "space-between",
    },
    statusCardPreviewRow: {
        display: "flex",
        justifyContent: "center",
        overflowX: "auto",
        padding: tokens.spacingVerticalS,
    },
    warningText: {
        color: tokens.colorPaletteRedForeground1,
    },
    warningList: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
});

// Counts Mon-Fri days strictly after `from` up to and including `to`
// (weekends never count), so "today" itself is never included - e.g. from
// a Thursday to the following Monday counts Friday + Monday = 2, matching
// how "N working days remain until the deadline" reads.
function countBusinessDaysRemaining(from: Date, to: Date): number {
    const cursor = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate() + 1
    );
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());

    let count = 0;

    while (cursor <= end) {
        const day = cursor.getDay();

        if (day !== 0 && day !== 6) {
            count++;
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    return Math.max(count, 0);
}

function formatDDMM(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}`;
}

export function SprintDefectReportTab({
    stats,
    suiteGroupDefs = AUTO_SUITE_GROUP_DEFS,
    defaultHeaderTitle = "UAT Sprint 1 – Auto",
    defaultHeaderSubtitle = "Stato avanzamento test funzionali / UAT – Progetto Nuova Frontiera",
    defaultActionsText,
    includeDsiSource = true,
    includeDeadline = true,
}: {
    stats: DefectStats;
    suiteGroupDefs?: SuiteGroupDef[];
    defaultHeaderTitle?: string;
    defaultHeaderSubtitle?: string;
    defaultActionsText?: (report: SprintDefectReport) => string;
    // Off for Plurifond (no DSI-sourced bugs yet) - see StatusReportCard.tsx.
    includeDsiSource?: boolean;
    // Off for Plurifond (no shared UAT deadline for this report yet).
    includeDeadline?: boolean;
}) {
    const { t } = useTranslation();
    const styles = useStyles();
    const report = stats.sprintDefectReport;

    const [headerTitle, setHeaderTitle] = useState(defaultHeaderTitle);
    const [headerSubtitle, setHeaderSubtitle] = useState(defaultHeaderSubtitle);
    const [uatDeadline, setUatDeadline] = useState("2026-07-20");
    const [actionsText, setActionsText] = useState(
        defaultActionsText
            ? defaultActionsText(report)
            : "Yellow section text content\n\n" +
              "Blue section text content\n\n"
    );
    const [groupLabels, setGroupLabels] = useState<string[]>(
        suiteGroupDefs.map((def) => def.label)
    );
    const [isExportingCard, setIsExportingCard] = useState(false);
    const [isExportingPptx, setIsExportingPptx] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    // Off by default: the Test Factory/Test Agenti/Business breakdown is
    // still being validated, so regular report sends shouldn't include it
    // until someone opts in for a given card.
    const [showOriginBreakdown, setShowOriginBreakdown] = useState(false);
    const [toInput, setToInput] = useState(DEFAULT_REPORT_RECIPIENTS.join(", "));
    const [ccInput, setCcInput] = useState(DEFAULT_REPORT_CC.join(", "));
    const [fromDisplayName, setFromDisplayName] = useState("");
    const statusCardRef = useRef<HTMLDivElement>(null);
    const dashboardLinkRef = useRef<HTMLAnchorElement>(null);

    // Recomputed on every render (cheap) so "days remaining" is always
    // relative to the moment the card is viewed/exported, not frozen at
    // whatever date the deadline field was last edited.
    const deadlineDate = uatDeadline ? new Date(`${uatDeadline}T00:00:00`) : null;
    const alertText =
        includeDeadline && deadlineDate && !Number.isNaN(deadlineDate.getTime())
            ? t("defectManagementPage.sprintReport.statusCard.alertTemplate", {
                date: formatDDMM(deadlineDate),
                count: countBusinessDaysRemaining(new Date(), deadlineDate),
            })
            : "";

    // Same per-plan endpoint Plan Overview uses (uncached, fetched fresh by
    // plan ID) rather than the whole-org /api/dashboard, which is cached
    // for 5 minutes and can lag behind a plan that was just populated.
    const { data: plans, isLoading: plansLoading } = useQuery({
        queryKey: ["plans"],
        queryFn: fetchPlans,
    });

    const planIdByName = new Map(
        (plans ?? []).map((plan) => [plan.name, plan.id])
    );

    // Each def's plan is identified either directly by planId (bypasses
    // name lookup entirely) or by resolving planName against the plans
    // list. Queried by the distinct resolved IDs, in parallel.
    const resolvedPlanIds = suiteGroupDefs.map(
        (def) => def.planId ?? planIdByName.get(def.planName ?? "")
    );
    const distinctPlanIds = [
        ...new Set(
            resolvedPlanIds.filter((id): id is number => id != null)
        ),
    ];

    const planOverviewQueries = useQueries({
        queries: distinctPlanIds.map((planId) => ({
            queryKey: ["plan-overview", planId],
            queryFn: () => fetchPlanOverview(planId),
        })),
    });

    const overviewByPlanId = new Map(
        distinctPlanIds.map((planId, index) => [
            planId,
            planOverviewQueries[index].data,
        ])
    );

    // While any of this is still in flight, every group looks "unmatched"
    // (no overview yet to match suites against) - without this flag that
    // transient state renders as the suiteGroupsWarning below, which reads
    // like a real configuration error instead of a normal loading moment.
    const suiteDataLoading =
        plansLoading || planOverviewQueries.some((query) => query.isLoading);

    const updateGroupLabel = (index: number, label: string) => {
        setGroupLabels((prev) =>
            prev.map((current, i) => (i === index ? label : current))
        );
    };

    // Each group merges raw Azure DevOps suites from a specific plan into
    // one named row - either every suite in the plan (suiteNames omitted,
    // e.g. "Test Factory" is just an alias for the whole plan, using its
    // own pre-aggregated totals) or specific suites within it (summed from
    // the plan's suite list).
    const resolvedGroups = suiteGroupDefs.map((def, index) => {
        const planId = resolvedPlanIds[index];
        const overview = planId != null ? overviewByPlanId.get(planId) : undefined;

        if (!overview) {
            return {
                label: groupLabels[index],
                totalTestCases: 0,
                outcomeCounts: { ...ZERO_OUTCOME_COUNTS },
                planFound: false,
                availableSuiteNames: [] as string[],
            };
        }

        if (!def.suiteIds && !def.suiteNames) {
            return {
                label: groupLabels[index],
                totalTestCases: overview.totalTestCases,
                outcomeCounts: overview.outcomeCounts,
                planFound: true,
                availableSuiteNames: overview.suites.map(
                    (suite) => `${suite.suiteName} (id ${suite.suiteId})`
                ),
            };
        }

        const matchedSuites = def.suiteIds
            ? overview.suites.filter((suite) =>
                def.suiteIds!.includes(suite.suiteId)
            )
            : overview.suites.filter((suite) =>
                def.suiteNames!.includes(suite.suiteName)
            );

        const totalTestCases = matchedSuites.reduce(
            (sum, suite) => sum + suite.totalTestCases,
            0
        );

        const outcomeCounts = matchedSuites.reduce((acc, suite) => {
            (Object.keys(acc) as Outcome[]).forEach((outcome) => {
                acc[outcome] += suite.outcomeCounts[outcome];
            });
            return acc;
        }, { ...ZERO_OUTCOME_COUNTS });

        return {
            label: groupLabels[index],
            totalTestCases,
            outcomeCounts,
            planFound: true,
            availableSuiteNames: overview.suites.map(
                (suite) => suite.suiteName
            ),
        };
    });

    const suiteGroups: SuiteProgressGroup[] = resolvedGroups.map(
        ({ label, totalTestCases, outcomeCounts }) => ({
            label,
            totalTestCases,
            outcomeCounts,
        })
    );

    // Diagnostics only (not shown in the exported card) - hardcoded
    // plan/suite names are brittle against renames in Azure DevOps, so when
    // nothing matches, surface the real names found instead of silently
    // rendering an empty row.
    const unmatchedGroups = resolvedGroups
        .filter((group) => group.totalTestCases === 0)
        .map((group) => ({
            label: group.label,
            hint: group.planFound
                ? `plan found but 0 test cases matched; suites in this plan: ${group.availableSuiteNames.join(", ") || "(none)"}`
                : `plan not found (id ${resolvedPlanIds[resolvedGroups.indexOf(group)] ?? "unresolved"}); available plans: ${(plans ?? []).map((plan) => `${plan.name} (id ${plan.id})`).join(", ") || "(none)"}`,
        }));

    const handleExportStatusCard = () => {
        setIsExportingCard(true);

        try {
            exportStatusReportCardToPdf(
                buildStatusReportCardFilename(headerTitle, "pdf"),
                {
                    headerTitle,
                    headerSubtitle,
                    suiteGroups,
                    report,
                    alertText,
                    actionsText,
                    dashboardUrl: MONITORING_DASHBOARD_URL,
                    showOriginBreakdown,
                    includeDsiSource,
                },
                t
            );
        } finally {
            setIsExportingCard(false);
        }
    };

    const handleExportStatusCardPptx = async () => {
        setIsExportingPptx(true);

        try {
            await exportStatusReportCardToPptx(
                buildStatusReportCardFilename(headerTitle, "pptx"),
                {
                    headerTitle,
                    headerSubtitle,
                    suiteGroups,
                    report,
                    alertText,
                    actionsText,
                    dashboardUrl: MONITORING_DASHBOARD_URL,
                    showOriginBreakdown,
                    includeDsiSource,
                },
                t
            );
        } finally {
            setIsExportingPptx(false);
        }
    };

    const handleDownloadStatusCardHtml = () => {
        downloadStatusReportCardEmailHtml(
            buildStatusReportCardFilename(headerTitle, "html"),
            {
                headerTitle,
                headerSubtitle,
                suiteGroups,
                report,
                alertText,
                actionsText,
                dashboardUrl: MONITORING_DASHBOARD_URL,
                showOriginBreakdown,
                includeDsiSource,
            },
            t
        );
    };

    const handleCopyStatusCardHtml = async () => {
        await copyStatusReportCardEmailHtmlToClipboard(
            {
                headerTitle,
                headerSubtitle,
                suiteGroups,
                report,
                alertText,
                actionsText,
                dashboardUrl: MONITORING_DASHBOARD_URL,
                showOriginBreakdown,
                includeDsiSource,
            },
            t
        );

        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const emailReportMutation = useMutation({
        mutationFn: sendGraphMailReport,
    });

    const toAddresses = parseAddressList(toInput);
    const ccAddresses = parseAddressList(ccInput);

    const handleSendStatusCardEmail = () => {
        const cardData = {
            headerTitle,
            headerSubtitle,
            suiteGroups,
            report,
            alertText,
            actionsText,
            dashboardUrl: MONITORING_DASHBOARD_URL,
            showOriginBreakdown,
            includeDsiSource,
        };

        const bodyHtml = buildStatusReportCardEmailDocument(
            buildStatusReportCardEmailBodyHtml(cardData, t)
        );

        emailReportMutation.mutate({
            subject: headerTitle,
            bodyHtml,
            to: toAddresses,
            cc: ccAddresses,
            fromDisplayName: fromDisplayName.trim() || undefined,
        });
    };

    return (
        <>
            {emailReportEnabled && (
                <ChartCard
                    title={t(
                        "defectManagementPage.sprintReport.statusCard.emailSectionTitle"
                    )}
                >
                    <Text className={styles.note}>
                        {t(
                            "defectManagementPage.sprintReport.statusCard.emailSectionDescription"
                        )}
                    </Text>

                    <div className={styles.statusCardControls}>
                        <Field
                            label={t(
                                "defectManagementPage.sprintReport.statusCard.emailToLabel"
                            )}
                            className={styles.statusCardFieldFull}
                        >
                            <Input
                                value={toInput}
                                placeholder={t(
                                    "defectManagementPage.sprintReport.statusCard.emailAddressPlaceholder"
                                )}
                                onChange={(_, data) => setToInput(data.value)}
                            />
                        </Field>
                    </div>

                    <div className={styles.statusCardControls}>
                        <Field
                            label={t(
                                "defectManagementPage.sprintReport.statusCard.emailCcLabel"
                            )}
                            className={styles.statusCardFieldFull}
                        >
                            <Input
                                value={ccInput}
                                placeholder={t(
                                    "defectManagementPage.sprintReport.statusCard.emailAddressPlaceholder"
                                )}
                                onChange={(_, data) => setCcInput(data.value)}
                            />
                        </Field>
                    </div>

                    <div className={styles.emailCardActions}>
                        <Field
                            label={t(
                                "defectManagementPage.sprintReport.statusCard.emailFromNameLabel"
                            )}
                            className={styles.statusCardField}
                        >
                            <Input
                                value={fromDisplayName}
                                placeholder={t(
                                    "defectManagementPage.sprintReport.statusCard.emailFromNamePlaceholder"
                                )}
                                onChange={(_, data) =>
                                    setFromDisplayName(data.value)
                                }
                            />
                        </Field>

                        <Button
                            appearance="primary"
                            icon={<MailRegular />}
                            disabled={
                                emailReportMutation.isPending ||
                                toAddresses.length === 0
                            }
                            onClick={handleSendStatusCardEmail}
                        >
                            {emailReportMutation.isPending
                                ? t("planOverviewPage.emailSending")
                                : t("planOverviewPage.sendEmail")}
                        </Button>
                    </div>

                    {emailReportMutation.isSuccess && (
                        <Text className={styles.note}>
                            {t("planOverviewPage.emailSent")}
                        </Text>
                    )}

                    {emailReportMutation.isError && (
                        <Text className={styles.warningText}>
                            {t("planOverviewPage.emailFailed", {
                                message: emailReportMutation.error.message,
                            })}
                        </Text>
                    )}
                </ChartCard>
            )}

            <ChartCard
                title={t("defectManagementPage.sprintReport.statusCard.title")}
            >
            <div className={styles.statusCardControls}>
                <Field
                    label={t(
                        "defectManagementPage.sprintReport.statusCard.headerTitleLabel"
                    )}
                    className={styles.statusCardField}
                >
                    <Input
                        value={headerTitle}
                        onChange={(_, data) =>
                            setHeaderTitle(data.value)
                        }
                    />
                </Field>

                <Field
                    label={t(
                        "defectManagementPage.sprintReport.statusCard.headerSubtitleLabel"
                    )}
                    className={styles.statusCardFieldWide}
                >
                    <Input
                        value={headerSubtitle}
                        onChange={(_, data) =>
                            setHeaderSubtitle(data.value)
                        }
                    />
                </Field>
            </div>

            <div className={styles.statusCardControls}>
                {includeDeadline && (
                    <Field
                        label={t(
                            "defectManagementPage.sprintReport.statusCard.uatDeadlineLabel"
                        )}
                        className={styles.statusCardField}
                    >
                        <Input
                            type="date"
                            value={uatDeadline}
                            onChange={(_, data) =>
                                setUatDeadline(data.value)
                            }
                        />
                    </Field>
                )}

                <Field
                    label={t(
                        "defectManagementPage.sprintReport.statusCard.actionsLabel"
                    )}
                    className={styles.statusCardFieldWide}
                >
                    <Textarea
                        value={actionsText}
                        placeholder={t(
                            "defectManagementPage.sprintReport.statusCard.actionsPlaceholder"
                        )}
                        rows={3}
                        resize="vertical"
                        onChange={(_, data) => setActionsText(data.value)}
                    />
                </Field>
            </div>

            <Text weight="semibold">
                {t(
                    "defectManagementPage.sprintReport.statusCard.suiteGroupsLabel"
                )}
            </Text>

            <div className={styles.statusCardControls}>
                {groupLabels.map((label, index) => (
                    <Field key={index} className={styles.statusCardField}>
                        <Input
                            value={label}
                            onChange={(_, data) =>
                                updateGroupLabel(index, data.value)
                            }
                        />
                    </Field>
                ))}
            </div>

            {suiteDataLoading ? (
                <Spinner
                    size="tiny"
                    label={t(
                        "defectManagementPage.sprintReport.statusCard.suiteGroupsLoading"
                    )}
                />
            ) : (
                unmatchedGroups.length > 0 && (
                    <div className={styles.warningList}>
                        {unmatchedGroups.map((group) => (
                            <Text
                                key={group.label}
                                className={styles.warningText}
                            >
                                {t(
                                    "defectManagementPage.sprintReport.statusCard.suiteGroupsWarning",
                                    { group: group.label, hint: group.hint }
                                )}
                            </Text>
                        ))}
                    </div>
                )
            )}

            <div className={styles.statusCardPreviewRow}>
                <StatusReportCard
                    ref={statusCardRef}
                    headerTitle={headerTitle}
                    headerSubtitle={headerSubtitle}
                    suiteGroups={suiteGroups}
                    report={report}
                    alertText={alertText}
                    actionsText={actionsText}
                    dashboardUrl={MONITORING_DASHBOARD_URL}
                    dashboardLinkRef={dashboardLinkRef}
                    showOriginBreakdown={showOriginBreakdown}
                    includeDsiSource={includeDsiSource}
                />
            </div>

            <div className={styles.statusCardControls}>
                <Button
                    appearance="secondary"
                    icon={<ArrowDownloadRegular />}
                    disabled={isExportingCard}
                    onClick={handleExportStatusCard}
                >
                    {isExportingCard
                        ? t("planOverviewPage.exporting")
                        : t(
                            "defectManagementPage.sprintReport.statusCard.exportButton"
                        )}
                </Button>

                <Button
                    appearance="secondary"
                    icon={<SlideTextRegular />}
                    disabled={isExportingPptx}
                    onClick={handleExportStatusCardPptx}
                >
                    {isExportingPptx
                        ? t("planOverviewPage.exporting")
                        : t(
                            "defectManagementPage.sprintReport.statusCard.exportPptxButton"
                        )}
                </Button>

                <Button
                    appearance="secondary"
                    icon={<CodeTextRegular />}
                    onClick={handleDownloadStatusCardHtml}
                >
                    {t(
                        "defectManagementPage.sprintReport.statusCard.downloadHtmlButton"
                    )}
                </Button>

                <Button
                    appearance="secondary"
                    icon={
                        isCopied ? (
                            <ClipboardCheckmarkRegular />
                        ) : (
                            <ClipboardRegular />
                        )
                    }
                    onClick={handleCopyStatusCardHtml}
                >
                    {t(
                        isCopied
                            ? "defectManagementPage.sprintReport.statusCard.copyHtmlButtonCopied"
                            : "defectManagementPage.sprintReport.statusCard.copyHtmlButton"
                    )}
                </Button>

                <Switch
                    checked={showOriginBreakdown}
                    onChange={(_, data) =>
                        setShowOriginBreakdown(data.checked)
                    }
                    label={t(
                        "defectManagementPage.sprintReport.statusCard.originBreakdown.toggleLabel"
                    )}
                />
            </div>
            </ChartCard>
        </>
    );
}
