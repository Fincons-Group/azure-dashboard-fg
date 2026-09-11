import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
    Badge,
    Card,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { PaginationControls } from "../components/PaginationControls";
import { usePagination } from "../hooks/usePagination";
import { useScope } from "../hooks/useScope";
import { fetchDefects } from "../api/client";
import type { DefectSummary } from "../types";

const TABLE_PAGE_SIZE = 8;

// Mirrors VERIFICA_PENDING_STATES in the server's defectData.ts - the
// combined "Da verificare"/"In verifica" window QA is expected to act on.
const VERIFY_STATES = ["Da verificare", "In verifica"];

// Same domain the server itself gates every PAT against (ALLOWED_EMAIL_DOMAIN
// in src/azdo.ts) - re-applied here to scope each table to Fincons Group
// team members specifically, since a bug's assignee/creator can still be
// anyone in the wider Azure DevOps org (e.g. gruppoitas.it).
const FINCONS_DOMAIN = "finconsgroup.com";

function isFinconsGroupEmail(email: string | undefined): boolean {
    return !!email && email.toLowerCase().endsWith(`@${FINCONS_DOMAIN}`);
}

// Best-effort "same day" check in the viewer's local timezone. The server's
// own todaysDefects is scoped to TEAMS_VERIFICA_TIMEZONE (default
// Europe/Rome) - close enough for this page's purposes, and re-filtering
// here (rather than trusting todaysDefects's own created-or-changed union)
// is what narrows it down to "opened today" specifically.
function isSameLocalDay(dateString: string, reference: Date): boolean {
    const d = new Date(dateString);
    return (
        d.getFullYear() === reference.getFullYear() &&
        d.getMonth() === reference.getMonth() &&
        d.getDate() === reference.getDate()
    );
}

function stateBadgeColor(state: string): "warning" | "brand" | "informative" {
    if (state === "Da verificare") return "warning";
    if (state === "In verifica") return "brand";
    return "informative";
}

const useStyles = makeStyles({
    subtitle: {
        color: tokens.colorNeutralForeground3,
    },
    sectionGrid: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
    },
    tableCardHead: {
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM} 0`,
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    tableCardTitle: {
        fontSize: "14px",
        fontWeight: 600,
    },
    tableCardHint: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    emptyHint: {
        padding: `0 ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
        display: "block",
        color: tokens.colorNeutralForeground3,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    tableHeadCell: {
        textAlign: "left",
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    tableCell: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        fontSize: "13px",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: tokens.colorNeutralStroke2,
    },
    bugLink: {
        color: tokens.colorBrandForegroundLink,
        ":hover": {
            color: tokens.colorBrandForegroundLinkHover,
        },
    },
});

function BugTitleCell({
    bug,
    styles,
}: {
    bug: DefectSummary;
    styles: ReturnType<typeof useStyles>;
}) {
    return bug.url ? (
        <a href={bug.url} target="_blank" rel="noreferrer" className={styles.bugLink}>
            #{bug.id} {bug.title}
        </a>
    ) : (
        <>
            #{bug.id} {bug.title}
        </>
    );
}

export function BugsPage() {
    const { t, i18n } = useTranslation();
    const styles = useStyles();
    // Bug data is project-specific and lives wherever the team actually
    // files bugs (e.g. "Nuova Frontiera") - unlike CoverageRoadmapPage/
    // CycleTimeReportPage (fixed to the separate "Test Factory" automation
    // project), this follows the shared ScopeBar project selector so it
    // tracks whichever project the rest of the Sprint Report is scoped to.
    const scope = useScope();

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["defects-bugs-page", scope.project],
        queryFn: () => fetchDefects(undefined, scope.project),
    });

    const bugsToVerify = useMemo(() => {
        const effective = data?.stats.sprintDefectReport.effectiveDefects ?? [];

        return effective
            .filter((bug) => VERIFY_STATES.includes(bug.state))
            .filter((bug) => isFinconsGroupEmail(bug.assignee?.uniqueName))
            .sort((a, b) => a.title.localeCompare(b.title));
    }, [data]);

    const bugsOpenedToday = useMemo(() => {
        const todays = data?.stats.sprintDefectReport.todaysDefects ?? [];
        const now = new Date();

        return todays
            .filter((bug) => !!bug.createdDate && isSameLocalDay(bug.createdDate, now))
            .filter((bug) => isFinconsGroupEmail(bug.creatorUniqueName))
            .sort((a, b) => (b.createdDate ?? "").localeCompare(a.createdDate ?? ""));
    }, [data]);

    const verifyPagination = usePagination(bugsToVerify, TABLE_PAGE_SIZE);
    const todayPagination = usePagination(bugsOpenedToday, TABLE_PAGE_SIZE);

    return (
        <PageLayout title={t("bugsPage.title")} hideAreaSprintScope>
            <Text className={styles.subtitle}>{t("bugsPage.subtitle")}</Text>

            {isLoading && <LoadingCardGrid />}

            {isError && <ErrorState message={error.message} onRetry={refetch} />}

            {data && (
                <div className={styles.sectionGrid}>
                    <Card>
                        <div className={styles.tableCardHead}>
                            <Text className={styles.tableCardTitle}>
                                {t("bugsPage.toVerify.title", { count: bugsToVerify.length })}
                            </Text>
                            <Text className={styles.tableCardHint}>
                                {t("bugsPage.toVerify.subtitle")}
                            </Text>
                        </div>

                        {bugsToVerify.length === 0 ? (
                            <Text className={styles.emptyHint}>
                                {t("bugsPage.toVerify.empty")}
                            </Text>
                        ) : (
                            <>
                                <div style={{ overflowX: "auto" }}>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th className={styles.tableHeadCell}>
                                                    {t("bugsPage.table.bug")}
                                                </th>
                                                <th className={styles.tableHeadCell}>
                                                    {t("bugsPage.table.state")}
                                                </th>
                                                <th className={styles.tableHeadCell}>
                                                    {t("bugsPage.table.assignee")}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {verifyPagination.pageItems.map((bug) => (
                                                <tr key={bug.id}>
                                                    <td className={styles.tableCell}>
                                                        <BugTitleCell bug={bug} styles={styles} />
                                                    </td>
                                                    <td className={styles.tableCell}>
                                                        <Badge
                                                            appearance="filled"
                                                            color={stateBadgeColor(bug.state)}
                                                        >
                                                            {bug.state}
                                                        </Badge>
                                                    </td>
                                                    <td className={styles.tableCell}>
                                                        {bug.assignee?.displayName ?? "-"}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <PaginationControls
                                    page={verifyPagination.page}
                                    pageCount={verifyPagination.pageCount}
                                    total={bugsToVerify.length}
                                    pageSize={TABLE_PAGE_SIZE}
                                    onPageChange={verifyPagination.setPage}
                                />
                            </>
                        )}
                    </Card>

                    <Card>
                        <div className={styles.tableCardHead}>
                            <Text className={styles.tableCardTitle}>
                                {t("bugsPage.openedToday.title", { count: bugsOpenedToday.length })}
                            </Text>
                            <Text className={styles.tableCardHint}>
                                {t("bugsPage.openedToday.subtitle")}
                            </Text>
                        </div>

                        {bugsOpenedToday.length === 0 ? (
                            <Text className={styles.emptyHint}>
                                {t("bugsPage.openedToday.empty")}
                            </Text>
                        ) : (
                            <>
                                <div style={{ overflowX: "auto" }}>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th className={styles.tableHeadCell}>
                                                    {t("bugsPage.table.bug")}
                                                </th>
                                                <th className={styles.tableHeadCell}>
                                                    {t("bugsPage.table.creator")}
                                                </th>
                                                <th className={styles.tableHeadCell}>
                                                    {t("bugsPage.table.created")}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {todayPagination.pageItems.map((bug) => (
                                                <tr key={bug.id}>
                                                    <td className={styles.tableCell}>
                                                        <BugTitleCell bug={bug} styles={styles} />
                                                    </td>
                                                    <td className={styles.tableCell}>
                                                        {bug.creator ?? "-"}
                                                    </td>
                                                    <td className={styles.tableCell}>
                                                        {bug.createdDate
                                                            ? new Date(bug.createdDate).toLocaleTimeString(
                                                                  i18n.language,
                                                                  { hour: "2-digit", minute: "2-digit" }
                                                              )
                                                            : "-"}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <PaginationControls
                                    page={todayPagination.page}
                                    pageCount={todayPagination.pageCount}
                                    total={bugsOpenedToday.length}
                                    pageSize={TABLE_PAGE_SIZE}
                                    onPageChange={todayPagination.setPage}
                                />
                            </>
                        )}
                    </Card>
                </div>
            )}
        </PageLayout>
    );
}
