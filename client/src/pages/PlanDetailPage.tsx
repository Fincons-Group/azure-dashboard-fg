import { useParams, useLocation, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Accordion,
    Button,
    Card,
    Badge,
    Text,
    Title3,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowLeftRegular,
    OpenRegular,
    MapRegular,
    BranchRegular,
    PersonRegular,
} from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { SuiteTreeItem } from "../components/SuiteTreeItem";
import { ExportMenu, type ExportFormat } from "../components/ExportMenu";
import { fetchPlanSuites } from "../api/client";
import { exportToCsv, exportToExcel, exportToPdf } from "../utils/export";
import type { ExportableRow } from "../utils/export";
import type { TestPlanSummary, TestSuiteSummary } from "../types";

function flattenSuiteRows(
    suites: TestSuiteSummary[],
    testPlan: string
): ExportableRow[] {
    return suites.flatMap((suite) => [
        ...suite.testCases.map((tc) => ({
            testPlan,
            suiteName: suite.name,
            testCaseTitle: tc.title,
        })),
        ...flattenSuiteRows(suite.children, testPlan),
    ]);
}

const useStyles = makeStyles({
    toolbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    backLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        padding: `${tokens.spacingVerticalSNudge} ${tokens.spacingHorizontalS}`,
        borderRadius: tokens.borderRadiusMedium,
        color: tokens.colorNeutralForeground2,
        textDecorationLine: "none",
        fontWeight: tokens.fontWeightMedium,
        ":hover": {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
    },
    metaCard: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalL,
        flexWrap: "wrap",
    },
    metaItem: {
        display: "inline-flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        color: tokens.colorNeutralForeground2,
    },
    suitesCard: {
        padding: tokens.spacingHorizontalM,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
});

export function PlanDetailPage() {
    const styles = useStyles();
    const { t } = useTranslation();
    const { planId } = useParams<{ planId: string }>();
    const location = useLocation();
    const plan = (
        location.state as { plan?: TestPlanSummary } | undefined
    )?.plan;

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["plan-suites", planId],
        queryFn: () => fetchPlanSuites(Number(planId)),
    });

    const title = plan?.name ?? t("planDetailPage.title", { id: planId });

    const handleExport = (format: ExportFormat) => {
        if (!data) {
            return;
        }

        const rows = flattenSuiteRows(data, title);
        const filename = `plan-${planId}-export-${Date.now()}`;

        if (format === "csv") {
            exportToCsv(filename, rows);
        } else if (format === "excel") {
            void exportToExcel(filename, rows);
        } else {
            exportToPdf(filename, title, rows);
        }
    };

    return (
        <PageLayout title={title}>
            <div className={styles.toolbar}>
                <Link to="/plans" className={styles.backLink}>
                    <ArrowLeftRegular />
                    {t("planDetailPage.backToPlans")}
                </Link>

                <ExportMenu
                    onExport={handleExport}
                    disabled={!data || data.length === 0}
                />

                {plan?.url && (
                    <Button
                        as="a"
                        href={plan.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        appearance="secondary"
                        icon={<OpenRegular />}
                    >
                        {t("planDetailPage.openInAzureDevOps")}
                    </Button>
                )}
            </div>

            {plan &&
                (plan.state || plan.areaPath || plan.iteration || plan.owner) && (
                    <Card className={styles.metaCard}>
                        {plan.state && (
                            <Badge appearance="tint" color="brand">
                                {plan.state}
                            </Badge>
                        )}

                        {plan.areaPath && (
                            <Text className={styles.metaItem}>
                                <MapRegular aria-hidden="true" />
                                {plan.areaPath}
                            </Text>
                        )}

                        {plan.iteration && (
                            <Text className={styles.metaItem}>
                                <BranchRegular aria-hidden="true" />
                                {plan.iteration}
                            </Text>
                        )}

                        {plan.owner && (
                            <Text className={styles.metaItem}>
                                <PersonRegular aria-hidden="true" />
                                {plan.owner}
                            </Text>
                        )}
                    </Card>
                )}

            {isLoading && <LoadingCardGrid count={4} />}

            {isError && (
                <ErrorState message={error.message} onRetry={refetch} />
            )}

            {data &&
                (data.length === 0 ? (
                    <EmptyState message={t("planDetailPage.empty")} />
                ) : (
                    <Card className={styles.suitesCard}>
                        <Title3 as="h2">
                            {t("planDetailPage.suitesTitle")}
                        </Title3>

                        <Accordion collapsible multiple>
                            {data.map((suite) => (
                                <SuiteTreeItem key={suite.id} suite={suite} />
                            ))}
                        </Accordion>
                    </Card>
                ))}
        </PageLayout>
    );
}
