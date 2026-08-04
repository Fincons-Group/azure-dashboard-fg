import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Card,
    Badge,
    Text,
    Title3,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ArrowUpRegular, ArrowDownRegular } from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { StatCard } from "../components/StatCard";
import { BugsTable } from "../components/BugsTable";
import { IterationFilter } from "../components/IterationFilter";
import { fetchReleaseReadiness } from "../api/client";
import type { RagStatus, ReleaseGateCriterion } from "../types";

const RAG_BADGE_COLOR: Record<RagStatus, "success" | "warning" | "danger"> = {
    green: "success",
    amber: "warning",
    red: "danger",
};

type CriterionBadgeColor = "success" | "danger" | "warning" | "subtle";

function criterionBadgeColor(c: ReleaseGateCriterion): CriterionBadgeColor {
    if (!c.tracked) {
        return "subtle";
    }

    if (c.passed) {
        return "success";
    }

    return c.action === "block" ? "danger" : "warning";
}

function criterionStatusKey(c: ReleaseGateCriterion): string {
    if (!c.tracked) {
        return "notTracked";
    }

    if (c.passed) {
        return "pass";
    }

    return c.action === "block" ? "block" : "warn";
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    topRow: {
        display: "flex",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
        alignItems: "stretch",
    },
    scoreCard: {
        padding: tokens.spacingHorizontalL,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        flex: "1 1 260px",
    },
    scoreRow: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
    },
    criteriaCard: {
        padding: tokens.spacingHorizontalL,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        flex: "2 1 360px",
    },
    criterionItem: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
    },
    criterionHeader: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    criterionDescription: {
        color: tokens.colorNeutralForeground3,
    },
    criterionValues: {
        color: tokens.colorNeutralForeground3,
        fontStyle: "italic",
    },
    criterionNote: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    statsRow: {
        display: "flex",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
    },
    meta: {
        color: tokens.colorNeutralForeground3,
    },
    deltaUp: {
        color: tokens.colorPaletteGreenForeground1,
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
    },
    deltaDown: {
        color: tokens.colorPaletteRedForeground1,
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
    },
});

function PassRateDeltaValue({
    deltaPct,
    styles,
}: {
    deltaPct: number | null;
    styles: ReturnType<typeof useStyles>;
}) {
    const { t } = useTranslation();

    if (deltaPct == null) {
        return <>{t("releaseReadinessPage.passRateDelta.noPriorSprint")}</>;
    }

    const className = deltaPct >= 0 ? styles.deltaUp : styles.deltaDown;
    const Icon = deltaPct >= 0 ? ArrowUpRegular : ArrowDownRegular;

    return (
        <span className={className}>
            <Icon />
            {Math.abs(deltaPct)}%
        </span>
    );
}

export function ReleaseReadinessPage() {
    const styles = useStyles();
    const { t } = useTranslation();
    const [iteration, setIteration] = useState("");

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["release-readiness", iteration],
        queryFn: () => fetchReleaseReadiness(iteration || undefined),
    });

    return (
        <PageLayout title={t("releaseReadinessPage.title")}>
            <IterationFilter value={iteration} onChange={setIteration} />

            {isLoading && <LoadingCardGrid count={3} />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && (
                <>
                    <Text className={styles.meta}>
                        {t("releaseReadinessPage.sprintLabel", {
                            name: data.sprint.name,
                            start: data.sprint.startDate,
                            end: data.sprint.endDate,
                        })}
                        {data.sprint.hasEnded &&
                            ` — ${t("releaseReadinessPage.sprintEnded")}`}
                    </Text>

                    <div className={styles.topRow}>
                        <Card className={styles.scoreCard}>
                            <Text weight="semibold">
                                {t("releaseReadinessPage.gate.title")}
                            </Text>

                            <div className={styles.scoreRow}>
                                <Badge
                                    size="extra-large"
                                    color={RAG_BADGE_COLOR[data.releaseGate.ragStatus]}
                                    appearance="tint"
                                >
                                    {t(
                                        `releaseReadinessPage.rag.${data.releaseGate.ragStatus}`
                                    )}
                                </Badge>
                            </div>

                            <Text className={styles.meta}>
                                {t("releaseReadinessPage.gate.passingCount", {
                                    passing: data.releaseGate.passingCount,
                                    total: data.releaseGate.trackedCount,
                                })}
                            </Text>
                        </Card>

                        <Card className={styles.criteriaCard}>
                            <Title3 as="h2">
                                {t("releaseReadinessPage.gate.criteriaTitle")}
                            </Title3>

                            {data.releaseGate.criteria.map((criterion) => (
                                <div
                                    key={criterion.id}
                                    className={styles.criterionItem}
                                >
                                    <div className={styles.criterionHeader}>
                                        <Badge
                                            color={criterionBadgeColor(criterion)}
                                            appearance="tint"
                                        >
                                            {t(
                                                `releaseReadinessPage.gate.status.${criterionStatusKey(criterion)}`
                                            )}
                                        </Badge>
                                        <Text weight="semibold">
                                            {t(
                                                `releaseReadinessPage.gate.criteria.${criterion.id}.label`
                                            )}
                                        </Text>
                                    </div>

                                    <Text className={styles.criterionDescription}>
                                        {t(
                                            `releaseReadinessPage.gate.criteria.${criterion.id}.description`
                                        )}
                                    </Text>

                                    <Text className={styles.criterionValues}>
                                        {criterion.actual != null
                                            ? t(
                                                  "releaseReadinessPage.gate.actualTarget",
                                                  {
                                                      actual: criterion.actual,
                                                      target: criterion.target,
                                                  }
                                              )
                                            : t(
                                                  "releaseReadinessPage.gate.notTrackedNote",
                                                  { target: criterion.target }
                                              )}
                                    </Text>

                                    {criterion.id === "testsPassed" && (
                                        <Text className={styles.criterionNote}>
                                            {t(
                                                "releaseReadinessPage.gate.criteria.testsPassed.note"
                                            )}
                                        </Text>
                                    )}
                                </div>
                            ))}
                        </Card>
                    </div>

                    <div className={styles.section}>
                        <Title3 as="h2">
                            {t("releaseReadinessPage.stats.title")}
                        </Title3>

                        <div className={styles.statsRow}>
                            <StatCard
                                label={t(
                                    "releaseReadinessPage.stats.completionRate"
                                )}
                                value={`${data.completion.completionRatePct}%`}
                            />
                            <StatCard
                                label={t(
                                    "releaseReadinessPage.stats.executedOfPlanned"
                                )}
                                value={`${data.completion.executedCount} / ${data.completion.plannedCount}`}
                            />
                            <StatCard
                                label={
                                    data.sprint.hasEnded
                                        ? t("releaseReadinessPage.stats.carryOver")
                                        : t(
                                              "releaseReadinessPage.stats.notYetExecuted"
                                          )
                                }
                                value={data.completion.notExecutedCount}
                            />
                            <StatCard
                                label={t(
                                    "releaseReadinessPage.stats.notApplicable"
                                )}
                                value={data.completion.notApplicableCount}
                            />
                            <StatCard
                                label={t(
                                    "releaseReadinessPage.gate.criteria.testCaseRelevance.label"
                                )}
                                value={`${data.completion.testCaseRelevancePct}%`}
                            />
                            <StatCard
                                label={t(
                                    "releaseReadinessPage.stats.passRateDelta"
                                )}
                                value={
                                    <PassRateDeltaValue
                                        deltaPct={data.passRateDelta.deltaPct}
                                        styles={styles}
                                    />
                                }
                            />
                            <StatCard
                                label={t(
                                    "releaseReadinessPage.stats.blockingDefects"
                                )}
                                value={data.blockingDefects.totalCount}
                            />
                        </div>
                    </div>

                    <div className={styles.section}>
                        <Title3 as="h2">
                            {t("releaseReadinessPage.blockingDefects.title")}
                        </Title3>

                        {data.blockingDefects.items.length > 0 ? (
                            <BugsTable
                                bugs={data.blockingDefects.items}
                                ariaLabel={t(
                                    "releaseReadinessPage.blockingDefects.title"
                                )}
                            />
                        ) : (
                            <EmptyState
                                message={t(
                                    "releaseReadinessPage.blockingDefects.empty"
                                )}
                            />
                        )}
                    </div>
                </>
            )}
        </PageLayout>
    );
}
