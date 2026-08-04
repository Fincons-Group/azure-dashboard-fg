import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Dropdown,
    Option,
    Field,
    Button,
    Spinner,
    Text,
    Title3,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ChevronDownRegular,
    ArrowDownloadRegular,
    MailRegular,
} from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { ProgressSummaryCards } from "../components/ProgressSummaryCards";
import { BugsTable } from "../components/BugsTable";
import { IterationFilter } from "../components/IterationFilter";
import {
    fetchPlans,
    fetchPlanProgress,
    fetchPlanProgressBugs,
    sendEmailReport,
} from "../api/client";
import {
    collectLeafOptions,
    filterProgressTree,
    sumCounts,
    runPercent,
    passedPercent,
    passedPercentExclNA,
} from "../utils/progressReport";
import {
    buildEmailReportHtml,
    buildPlanProgressFilename,
    buildPlanProgressPdfBase64,
    captureChartImage,
    exportPlanProgressToPdf,
} from "../utils/export";
import type { ChartImage, PlanProgressPdfLabels } from "../utils/export";

const emailReportEnabled =
    import.meta.env.VITE_ENABLE_EMAIL_REPORT === "true";

const useStyles = makeStyles({
    toolbar: {
        display: "flex",
        alignItems: "flex-end",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    filterField: {
        maxWidth: "280px",
    },
    suiteFilterField: {
        maxWidth: "360px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    meta: {
        color: tokens.colorNeutralForeground3,
    },
    overlay: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        zIndex: 1000,
    },
});

export function PlanProgressPage() {
    const styles = useStyles();
    const { t } = useTranslation();

    const [selectedPlanId, setSelectedPlanId] = useState<
        number | undefined
    >(undefined);
    const [selectedSuiteIds, setSelectedSuiteIds] = useState<number[]>([]);
    const [iteration, setIteration] = useState("");
    const [isExporting, setIsExporting] = useState(false);

    const runChartRef = useRef<HTMLDivElement>(null);
    const passRateChartRef = useRef<HTMLDivElement>(null);

    const emailReportMutation = useMutation({
        mutationFn: sendEmailReport,
    });

    const { data: plans } = useQuery({
        queryKey: ["plans"],
        queryFn: fetchPlans,
    });

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["plan-progress", selectedPlanId],
        queryFn: () => fetchPlanProgress(selectedPlanId!),
        enabled: selectedPlanId != null,
    });

    const { data: bugs, isLoading: isBugsLoading } = useQuery({
        queryKey: ["plan-progress-bugs", selectedPlanId, selectedSuiteIds],
        queryFn: () =>
            fetchPlanProgressBugs(selectedPlanId!, selectedSuiteIds),
        enabled: selectedPlanId != null,
    });

    const plansInIteration = iteration
        ? plans?.filter((p) => p.iteration === iteration)
        : plans;

    const selectedPlanName = plans?.find(
        (p) => p.id === selectedPlanId
    )?.name;

    const suiteOptions = useMemo(
        () => (data ? collectLeafOptions(data.nodes) : []),
        [data]
    );

    const filteredNodes = useMemo(() => {
        if (!data) {
            return [];
        }

        return filterProgressTree(
            data.nodes,
            new Set(selectedSuiteIds)
        );
    }, [data, selectedSuiteIds]);

    const summaryCounts = useMemo(
        () => sumCounts(filteredNodes),
        [filteredNodes]
    );

    const planTitle = data?.planTitle ?? selectedPlanName ?? "";

    const pdfLabels: PlanProgressPdfLabels = {
        titlePrefix: t("planProgressPage.title"),
        testCases: t("planProgressPage.summary.testPoints"),
        testCasesRun: t("planProgressPage.summary.testPointsRun"),
        passed: t("outcome.Passed"),
        failed: t("outcome.Failed"),
        blocked: t("outcome.Blocked"),
        notApplicable: t("outcome.NotApplicable"),
        passRate: t("planProgressPage.summary.passRate"),
        bugsTitle: t("planProgressPage.bugsSection.title"),
        bugsEmpty: t("planProgressPage.bugsSection.empty"),
        bugColumns: {
            id: t("bugsTable.columns.id"),
            title: t("bugsTable.columns.title"),
            state: t("bugsTable.columns.state"),
            creator: t("bugsTable.columns.creator"),
            assignee: t("bugsTable.columns.assignee"),
        },
    };

    const captureCharts = async (): Promise<ChartImage[]> => {
        const captured = await Promise.all([
            captureChartImage(
                runChartRef.current,
                t("planProgressPage.summary.runChart")
            ),
            captureChartImage(
                passRateChartRef.current,
                t("planProgressPage.summary.passRateChart")
            ),
        ]);

        return captured.filter(
            (chart): chart is ChartImage => chart !== null
        );
    };

    const handleExportPdf = async () => {
        setIsExporting(true);

        try {
            const charts = await captureCharts();

            exportPlanProgressToPdf(
                planTitle,
                summaryCounts,
                bugs ?? [],
                pdfLabels,
                charts
            );
        } finally {
            setIsExporting(false);
        }
    };

    const handleSendEmail = async () => {
        const charts = await captureCharts();

        const executed =
            summaryCounts.total -
            summaryCounts.notExecuted -
            summaryCounts.notApplicable;

        const pdfBase64 = buildPlanProgressPdfBase64(
            planTitle,
            summaryCounts,
            bugs ?? [],
            pdfLabels,
            charts
        );

        emailReportMutation.mutate({
            subject: t("planProgressPage.title") + ": " + planTitle,
            bodyHtml: buildEmailReportHtml(
                `${t("planProgressPage.title")}: ${planTitle}`,
                [
                    [
                        t("planProgressPage.summary.testPoints"),
                        summaryCounts.total,
                    ],
                    [
                        t("planProgressPage.summary.testPointsRun"),
                        `${executed} / ${summaryCounts.total}`,
                    ],
                    [t("outcome.Passed"), summaryCounts.passed],
                    [t("outcome.Failed"), summaryCounts.failed],
                    [t("outcome.Blocked"), summaryCounts.blocked],
                    [
                        t("outcome.NotApplicable"),
                        summaryCounts.notApplicable,
                    ],
                    [
                        t("planProgressPage.summary.runChart"),
                        `${runPercent(summaryCounts)}%`,
                    ],
                    [
                        t("planProgressPage.summary.passRate"),
                        `${passedPercent(summaryCounts)}%`,
                    ],
                    [
                        t("planProgressPage.summary.passRateExclNA"),
                        `${passedPercentExclNA(summaryCounts)}%`,
                    ],
                ],
                t("planOverviewPage.email.metricColumn"),
                t("planOverviewPage.email.valueColumn")
            ),
            pdfBase64,
            filename: buildPlanProgressFilename(planTitle),
            fromName: planTitle,
        });
    };

    return (
        <PageLayout title={t("planProgressPage.title")}>
            {emailReportMutation.isPending && (
                <div className={styles.overlay}>
                    <Spinner label={t("planOverviewPage.emailSending")} />
                </div>
            )}

            <div className={styles.toolbar}>
                <IterationFilter
                    value={iteration}
                    onChange={(value) => {
                        setIteration(value);
                        setSelectedPlanId(undefined);
                        setSelectedSuiteIds([]);
                        emailReportMutation.reset();
                    }}
                    className={styles.filterField}
                />

                <Field
                    label={t("planProgressPage.planFilter.label")}
                    className={styles.filterField}
                >
                    <Dropdown
                        expandIcon={<ChevronDownRegular />}
                        placeholder={t(
                            "planProgressPage.planFilter.placeholder"
                        )}
                        value={selectedPlanName ?? ""}
                        selectedOptions={[
                            selectedPlanId != null
                                ? String(selectedPlanId)
                                : "",
                        ]}
                        onOptionSelect={(_, option) => {
                            const value = option.optionValue;

                            setSelectedPlanId(
                                value ? Number(value) : undefined
                            );
                            setSelectedSuiteIds([]);
                            emailReportMutation.reset();
                        }}
                    >
                        {plansInIteration?.map((plan) => (
                            <Option key={plan.id} value={String(plan.id)}>
                                {plan.name}
                            </Option>
                        ))}
                    </Dropdown>
                </Field>

                {data && suiteOptions.length > 0 && (
                    <Field
                        label={t("planProgressPage.suiteFilter.label")}
                        className={styles.suiteFilterField}
                    >
                        <Dropdown
                            multiselect
                            expandIcon={<ChevronDownRegular />}
                            placeholder={t(
                                "planProgressPage.suiteFilter.placeholder"
                            )}
                            value={
                                selectedSuiteIds.length > 0
                                    ? t(
                                          "planProgressPage.suiteFilter.selectedCount",
                                          { count: selectedSuiteIds.length }
                                      )
                                    : t(
                                          "planProgressPage.suiteFilter.allSuites"
                                      )
                            }
                            selectedOptions={selectedSuiteIds.map(String)}
                            onOptionSelect={(_, option) => {
                                const value = Number(option.optionValue);

                                setSelectedSuiteIds((prev) =>
                                    prev.includes(value)
                                        ? prev.filter((id) => id !== value)
                                        : [...prev, value]
                                );
                                emailReportMutation.reset();
                            }}
                        >
                            {suiteOptions.map((option) => (
                                <Option
                                    key={option.id}
                                    value={String(option.id)}
                                >
                                    {option.path}
                                </Option>
                            ))}
                        </Dropdown>
                    </Field>
                )}

                {data && (
                    <Button
                        appearance="secondary"
                        icon={<ArrowDownloadRegular />}
                        disabled={isExporting}
                        onClick={handleExportPdf}
                    >
                        {isExporting
                            ? t("planOverviewPage.exporting")
                            : t("planOverviewPage.exportPdf")}
                    </Button>
                )}

                {data && emailReportEnabled && (
                    <Button
                        appearance="secondary"
                        icon={<MailRegular />}
                        disabled={emailReportMutation.isPending}
                        onClick={handleSendEmail}
                    >
                        {emailReportMutation.isPending
                            ? t("planOverviewPage.emailSending")
                            : t("planOverviewPage.sendEmail")}
                    </Button>
                )}
            </div>

            {data && emailReportEnabled && emailReportMutation.isSuccess && (
                <Text className={styles.meta}>
                    {t("planOverviewPage.emailSent")}
                </Text>
            )}

            {data && emailReportEnabled && emailReportMutation.isError && (
                <Text
                    role="alert"
                    style={{ color: tokens.colorPaletteRedForeground1 }}
                >
                    {t("planOverviewPage.emailFailed", {
                        message: emailReportMutation.error.message,
                    })}
                </Text>
            )}

            {selectedPlanId == null && (
                <EmptyState
                    message={t("planProgressPage.selectPlanPrompt")}
                />
            )}

            {selectedPlanId != null && isLoading && <LoadingCardGrid />}

            {selectedPlanId != null && isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {selectedPlanId != null && data && (
                filteredNodes.length > 0 ? (
                    <>
                        <div className={styles.section}>
                            <ProgressSummaryCards
                                counts={summaryCounts}
                                runChartRef={runChartRef}
                                passRateChartRef={passRateChartRef}
                            />
                        </div>

                        <div className={styles.section}>
                            <Title3 as="h2">
                                {t("planProgressPage.bugsSection.title")}
                            </Title3>

                            {isBugsLoading ? (
                                <LoadingCardGrid count={3} />
                            ) : bugs && bugs.length > 0 ? (
                                <BugsTable
                                    bugs={bugs}
                                    ariaLabel={t(
                                        "planProgressPage.bugsSection.title"
                                    )}
                                />
                            ) : (
                                <EmptyState
                                    message={t(
                                        "planProgressPage.bugsSection.empty"
                                    )}
                                />
                            )}
                        </div>
                    </>
                ) : (
                    <EmptyState message={t("planProgressPage.empty")} />
                )
            )}
        </PageLayout>
    );
}
