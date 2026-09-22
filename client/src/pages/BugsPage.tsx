import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Switch,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from "@fluentui/react-components";
import { PageLayout } from "../components/PageLayout";
import { LoadingCardGrid } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { PaginationControls } from "../components/PaginationControls";
import { StatusTag } from "../components/StatusTag";
import type { StatusTone } from "../components/statusTone";
import { usePagination } from "../hooks/usePagination";
import { fetchDefects } from "../api/client";
import { CARD_RADIUS } from "../layoutConstants";
import type { DefectSummary } from "../types";

const TABLE_PAGE_SIZE = 8;

// Bugs always live in the "Nuova Frontiera" ADO project - fixed here (like
// CoverageRoadmapPage/AutomationKpiPage/CycleTimeReportPage fix "Test
// Factory") rather than following the shared ScopeBar project selector.
const PROJECT = "Nuova Frontiera";

// Every state the Bug work item type can be in for the "Nuova Frontiera"
// project (GET .../_apis/wit/workitemtypes/Bug/states), in workflow order -
// not just VERIFICA_PENDING_STATES' "Da verificare"/"In verifica" pair from
// the server's defectData.ts. Keep in sync if the process template changes.
const VERIFY_STATES = [
  "New",
  "In Lavorazione",
  "Da verificare",
  "In verifica",
  "Riaperto",
  "Pronto per il rilascio",
  "Closed",
] as const;

// "Overview" (every state combined, the previous default) plus one tab per
// individual state - same Panoramica/NRT/A11Y/Security pattern as TestSuitesPage.
type VerifyStateTab = "overview" | (typeof VERIFY_STATES)[number];

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

// "Da verificare" (nobody's picked it up) reads as needing attention,
// "In verifica" (someone's actively on it) reads as progress, everything
// else (New/In Lavorazione/Riaperto/Pronto per il rilascio/Closed) is just
// informational - the closest 3-way split StatusTag's tone set supports.
function bugStateTone(state: string): StatusTone {
  if (state === "Da verificare") return "warning";
  if (state === "In verifica") return "success";
  return "neutral";
}

const useStyles = makeStyles({
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  card: {
    borderRadius: CARD_RADIUS,
    boxShadow: tokens.shadow4,
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
  verifyControls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    padding: `0 ${tokens.spacingHorizontalM}`,
  },
  verifyTabs: {
    flexShrink: 0,
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
    <a
      href={bug.url}
      target="_blank"
      rel="noreferrer"
      className={styles.bugLink}
    >
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

  const [verifyStateTab, setVerifyStateTab] =
    useState<VerifyStateTab>("overview");
  // Off by default - keeps the page's first paint on Overview showing every
  // state right away instead of waiting on an opt-in filter.
  const [excludeClosed, setExcludeClosed] = useState(true);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["defects-bugs-page", PROJECT],
    queryFn: () => fetchDefects(undefined, PROJECT),
  });

  const bugsToVerify = useMemo(() => {
    const effective = data?.stats.sprintDefectReport.effectiveDefects ?? [];

    return effective
      .filter((bug) => (VERIFY_STATES as readonly string[]).includes(bug.state))
      .filter((bug) => isFinconsGroupEmail(bug.assignee?.uniqueName))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [data]);

  const filteredBugsToVerify = useMemo(() => {
    if (verifyStateTab !== "overview") {
      return bugsToVerify.filter((bug) => bug.state === verifyStateTab);
    }

    return excludeClosed
      ? bugsToVerify.filter((bug) => bug.state !== "Closed")
      : bugsToVerify;
  }, [bugsToVerify, verifyStateTab, excludeClosed]);

  const handleVerifyStateTabSelect = (
    _event: SelectTabEvent,
    tabData: SelectTabData,
  ) => {
    setVerifyStateTab(tabData.value as VerifyStateTab);
  };

  const bugsOpenedToday = useMemo(() => {
    const todays = data?.stats.sprintDefectReport.todaysDefects ?? [];
    const now = new Date();

    return todays
      .filter(
        (bug) => !!bug.createdDate && isSameLocalDay(bug.createdDate, now),
      )
      .filter((bug) => isFinconsGroupEmail(bug.creatorUniqueName))
      .sort((a, b) => (b.createdDate ?? "").localeCompare(a.createdDate ?? ""));
  }, [data]);

  const verifyPagination = usePagination(filteredBugsToVerify, TABLE_PAGE_SIZE);
  const todayPagination = usePagination(bugsOpenedToday, TABLE_PAGE_SIZE);

  return (
    <PageLayout title={t("bugsPage.title")} hideAreaSprintScope>
      <Text className={styles.subtitle}>{t("bugsPage.subtitle")}</Text>

      {isLoading && <LoadingCardGrid />}

      {isError && <ErrorState message={error.message} onRetry={refetch} />}

      {data && (
        <div className={styles.sectionGrid}>
          <Card className={styles.card}>
            <div className={styles.tableCardHead}>
              <Text className={styles.tableCardTitle}>
                {t("bugsPage.toVerify.title", {
                  count: filteredBugsToVerify.length,
                })}
              </Text>
              <Text className={styles.tableCardHint}>
                {t("bugsPage.toVerify.subtitle")}
              </Text>
            </div>

            <div className={styles.verifyControls}>
              <TabList
                className={styles.verifyTabs}
                selectedValue={verifyStateTab}
                onTabSelect={handleVerifyStateTabSelect}
                size="small"
              >
                <Tab value="overview">
                  {t("bugsPage.toVerify.tabs.overview")}
                </Tab>
                {VERIFY_STATES.map((state) => (
                  <Tab key={state} value={state}>
                    {state}
                  </Tab>
                ))}
              </TabList>

              {verifyStateTab === "overview" && (
                <Switch
                  label={t("bugsPage.toVerify.excludeClosed")}
                  checked={excludeClosed}
                  onChange={(_, data) => setExcludeClosed(data.checked)}
                />
              )}
            </div>

            {filteredBugsToVerify.length === 0 ? (
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
                            <StatusTag tone={bugStateTone(bug.state)}>
                              {bug.state}
                            </StatusTag>
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
                  total={filteredBugsToVerify.length}
                  pageSize={TABLE_PAGE_SIZE}
                  onPageChange={verifyPagination.setPage}
                />
              </>
            )}
          </Card>

          <Card className={styles.card}>
            <div className={styles.tableCardHead}>
              <Text className={styles.tableCardTitle}>
                {t("bugsPage.openedToday.title", {
                  count: bugsOpenedToday.length,
                })}
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
                                  { hour: "2-digit", minute: "2-digit" },
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
