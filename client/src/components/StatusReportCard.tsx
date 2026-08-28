import { forwardRef, useMemo } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, makeStyles } from "@fluentui/react-components";
import { InfoRegular } from "@fluentui/react-icons";
import { SuiteProgressBar } from "./SuiteProgressBar";
import {
  bugsToCloseLabel,
  computeBugStatusData,
  computeStatusCardKpis,
} from "../utils/export";
import type { Outcome, SprintDefectReport } from "../types";

function formatUpdatedTimestamp(date: Date): {
  datePart: string;
  timePart: string;
} {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return {
    datePart: `${day}/${month}`,
    timePart: `${hours}:${minutes}`,
  };
}

export interface SuiteProgressGroup {
  label: string;
  totalTestCases: number;
  outcomeCounts: Record<Outcome, number>;
}

// Severity is stored as "N - Label" (e.g. "1 - Critical"); the leading rank
// number is what drives both sort order and color, same convention used in
// SprintDefectReportTab.tsx and export.ts's severityRank.
function severityRank(raw: string): number {
  const match = /^(\d+)\s*-/.exec(raw);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function severityLabel(raw: string): string {
  const match = /^(\d+)\s*-\s*(.+)$/.exec(raw);
  return match ? match[2] : raw;
}

const SEVERITY_PALETTE = [
  { bg: "#442726", border: "#d13438", text: "#ff9b93" },
  { bg: "#3d3319", border: "#eda100", text: "#f4c669" },
  { bg: "#26313d", border: "#5b8bb0", text: "#9cc7e6" },
];
const SEVERITY_FALLBACK = { bg: "#2d2d2d", border: "#605e5c", text: "#c8c6c4" };

// Colors match the reference status card (green -> blue -> amber -> salmon),
// with "Reopened" (a bug that regressed past QA sign-off, not just unstarted
// work) and the out-of-scope "Not Applicable" bucket trailing at the end -
// see EMAIL_STATUS_ORDER in export.ts for the shared ordering this follows.
const STATUS_COLORS: Record<string, string> = {
  Closed: "#3fb950",
  "Da verificare": "#0078d4",
  "In verifica": "#00b7c3",
  "In Progress": "#eda100",
  New: "#e8746c",
  Reopened: "#d13438",
  "Not Applicable": "#8a8886",
};
const STATUS_LABEL_KEYS: Record<string, string> = {
  Closed: "closed",
  "Da verificare": "daVerificare",
  "In verifica": "inVerifica",
  "In Progress": "inProgress",
  New: "new",
  Reopened: "reopened",
  "Not Applicable": "notApplicable",
};

// Matches the server-side fallback bucket in computeDuplicateSuiteBySuite
// (defectData.ts) for a Test Agenti/Business bug whose linked test case
// couldn't be title-matched to a Test Factory suite - shown as its own
// callout instead of a suite name so it reads as "needs manual review"
// rather than an unlabeled/generic suite.
const UNMATCHED_SUITE_KEY = "Unspecified";

const ACTION_PALETTE = [
  { bg: "#3d3319", border: "#eda100" },
  { bg: "#1f3550", border: "#3aa0f3" },
];

// A line like "DSI: ci sono 10 bug..." gets its "Label:" lead-in bolded,
// matching the reference card - only when the colon shows up early, so it
// doesn't misfire on a sentence that just happens to contain a colon
// further in. Applied per-line (see splitActionLeadInLines below) rather
// than once per paragraph, since an Action box can hold several
// independently-labeled lines (e.g. "Test Management:"/"DSI:"/"System
// Integrator:" all in the same Azione 2 box - see
// buildDefaultActionText2 in SprintDefectReportTab.tsx).
function splitActionLeadIn(line: string): {
  lead: string | null;
  rest: string;
} {
  const match = /^([^:\n]{1,80}:)\s*([\s\S]*)$/.exec(line);

  if (!match) {
    return { lead: null, rest: line };
  }

  return { lead: match[1], rest: match[2] };
}

const useStyles = makeStyles({
  card: {
    // Fixed (not maxWidth) so every card renders the same size
    // regardless of content - a report with fewer suites/shorter
    // actions text would otherwise shrink narrower than one with more,
    // making exported cards visibly inconsistent send to send.
    width: "900px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: "8px",
    overflow: "hidden",
    backgroundColor: "#1f1f1f",
    color: "#f3f2f1",
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    padding: "14px 18px",
    backgroundColor: "#3e4a68",
  },
  headerTitleGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: "0",
  },
  headerTitle: {
    fontSize: "17px",
    fontWeight: 700,
    color: "#ffffff",
  },
  headerSubtitle: {
    fontSize: "12px",
    color: "#c3c9d9",
  },
  headerTimestamp: {
    fontSize: "11px",
    color: "#c3c9d9",
    whiteSpace: "nowrap",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "18px",
  },
  alertBanner: {
    display: "flex",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "6px",
    backgroundColor: "#3d2f14",
    borderLeft: "4px solid #eda100",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  kpiSections: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  kpiSection: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  kpiSectionTitle: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#a0a0a0",
    paddingBottom: "4px",
    borderBottom: "1px solid #3b3a39",
  },
  kpiGrid5: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: "8px",
  },
  kpiGrid6: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: "8px",
  },
  kpiGrid4: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "8px",
  },
  kpiTile: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    padding: "10px 6px",
    // Fixed rather than content-sized so the second-row tile (alone,
    // with a single-line label) matches the height that row 1's grid
    // row is stretched to by its tallest tile (avgClosureTime's
    // two-line label) - otherwise it'd render visibly shorter.
    minHeight: "64px",
    boxSizing: "border-box",
    borderRadius: "6px",
    backgroundColor: "#2d2d2d",
    textAlign: "center",
  },
  kpiValue: {
    fontSize: "20px",
    fontWeight: 700,
  },
  kpiLabel: {
    fontSize: "10px",
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color: "#c8c6c4",
    // Lets \n in translation strings (e.g. kpis.totalTestCases) render
    // as an actual line break instead of collapsing to a space.
    whiteSpace: "pre-line",
  },
  kpiLabelRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "3px",
  },
  kpiHelpIcon: {
    display: "flex",
    flexShrink: 0,
    color: "#8a8886",
    cursor: "help",
  },
  dashboardButton: {
    display: "inline-flex",
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "10px 16px",
    borderRadius: "6px",
    backgroundColor: "#0078d4",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  sectionTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#f3f2f1",
  },
  sectionTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  actionsBox: {
    padding: "10px 12px",
    borderRadius: "6px",
    borderLeft: "4px solid",
    fontSize: "13px",
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
  },
  emptyNote: {
    fontSize: "12px",
    color: "#8a8886",
    fontStyle: "italic",
  },
  sectionHeader: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  sectionSubtitle: {
    fontSize: "11px",
    color: "#8a8886",
  },
  statusSummaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "8px",
    flexWrap: "wrap",
  },
  statusSummaryMain: {
    fontSize: "13px",
    color: "#f3f2f1",
  },
  statusStillOpen: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#e8746c",
    whiteSpace: "nowrap",
  },
  statusTrack: {
    display: "flex",
    width: "100%",
    height: "10px",
    borderRadius: "5px",
    overflow: "hidden",
    backgroundColor: "#3b3a39",
  },
  statusSummary: {
    fontSize: "12px",
    color: "#c8c6c4",
  },
  statusLegend: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "5px",
    fontSize: "12px",
    color: "#c8c6c4",
  },
  swatch: {
    display: "inline-block",
    width: "8px",
    height: "8px",
    borderRadius: "2px",
    marginRight: "3px",
  },
  legendSeparator: {
    color: "#605e5c",
  },
  severityCaption: {
    fontSize: "11px",
    color: "#8a8886",
    textAlign: "center",
  },
  severityRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  severityChip: {
    flex: "1 1 80px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "8px 6px",
    borderRadius: "6px",
    border: "1px solid",
  },
  severityCount: {
    fontSize: "18px",
    fontWeight: 700,
  },
  severityPercent: {
    fontSize: "10px",
    opacity: 0.85,
  },
  severityLabelText: {
    fontSize: "11px",
  },
  originPanel: {
    display: "flex",
    borderRadius: "6px",
    overflow: "hidden",
    border: "1px solid #3b3a39",
  },
  originLabel: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    padding: "6px 0",
    fontSize: "11px",
    fontWeight: 700,
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    whiteSpace: "nowrap",
  },
  originBody: {
    flex: 1,
    display: "flex",
    gap: "6px",
    padding: "8px",
  },
  originSuiteGrid: {
    flex: "2 1 0",
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "6px",
    alignContent: "start",
  },
  originTotals: {
    flex: "1 1 0",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  originTile: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    padding: "8px 4px",
    borderRadius: "6px",
    backgroundColor: "#2d2d2d",
    textAlign: "center",
    minHeight: "44px",
  },
  originValue: {
    fontSize: "17px",
    fontWeight: 700,
    color: "#3aa0f3",
  },
  originCaption: {
    fontSize: "9px",
    color: "#c8c6c4",
    lineHeight: 1.2,
  },
});

export interface StatusReportCardProps {
  headerTitle: string;
  headerSubtitle: string;
  suiteGroups: SuiteProgressGroup[];
  report: SprintDefectReport;
  alertText: string;
  actionsText: string;
  dashboardUrl?: string;
  dashboardLinkRef?: RefObject<HTMLAnchorElement | null>;
  // Off by default - the Test Factory/Test Agenti/Business breakdown is
  // still being validated, so existing report sends stay unaffected
  // unless someone opts in for a given card.
  showOriginBreakdown?: boolean;
  // On by default (bugs are tracked in DSI org-wide) - a report with no
  // DSI-sourced bugs sets this to false to keep the subtitle from
  // claiming a source that doesn't apply.
  includeDsiSource?: boolean;
}

// Renders one row of severity chips (used for both the "all effective bugs"
// and "still open" breakdowns below, which are identical except for which
// entries/total they're fed).
function SeverityChipsRow({
  entries,
  total,
}: {
  entries: readonly (readonly [string, number])[];
  total: number;
}) {
  const styles = useStyles();

  return (
    <div className={styles.severityRow}>
      {entries.map(([raw, count]) => {
        const rank = severityRank(raw);
        const palette = SEVERITY_PALETTE[rank - 1] ?? SEVERITY_FALLBACK;
        const percent = total ? Math.round((count / total) * 100) : 0;

        return (
          <div
            key={raw}
            className={styles.severityChip}
            style={{
              backgroundColor: palette.bg,
              borderColor: palette.border,
            }}
          >
            <span
              className={styles.severityCount}
              style={{ color: palette.text }}
            >
              {count}
            </span>
            <span
              className={styles.severityPercent}
              style={{ color: palette.text }}
            >
              {percent}%
            </span>
            <span
              className={styles.severityLabelText}
              style={{ color: palette.text }}
            >
              {severityLabel(raw)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// One KPI tile: a value, a label, and an (i) icon whose hover/focus tooltip
// explains in plain language how the value is calculated - the reader
// shouldn't have to guess why a number excludes N/A or only counts open
// bugs. helpKey is a translation key under statusCard.kpisHelp.
function KpiTile({
  value,
  color,
  labelKey,
  label,
  helpKey,
  labelCount,
}: {
  value: ReactNode;
  color: string;
  labelKey?: string;
  label?: string;
  helpKey: string;
  labelCount?: number;
}) {
  const { t } = useTranslation();
  const styles = useStyles();

  // `label` (already-resolved text) wins over the labelKey/labelCount
  // translation lookup - used when the label needs conditional wording
  // that a single translation key can't express (e.g. bugsToCloseLabel).
  const resolvedLabel =
    label ??
    (labelCount === undefined
      ? t(labelKey ?? "")
      : t(labelKey ?? "", { count: labelCount }));

  return (
    <div className={styles.kpiTile}>
      <span className={styles.kpiValue} style={{ color }}>
        {value}
      </span>
      <span className={styles.kpiLabelRow}>
        <span className={styles.kpiLabel}>{resolvedLabel}</span>
        <Tooltip content={t(helpKey)} relationship="description" withArrow>
          <span className={styles.kpiHelpIcon} tabIndex={0}>
            <InfoRegular fontSize={12} />
          </span>
        </Tooltip>
      </span>
    </div>
  );
}

// Same (i) icon/tooltip as KpiTile's helpKey, for a section title rather
// than a single KPI value - covers the parts of the card (Suite Progress,
// Bug Status, Bugs by Suite) that aren't broken into individual tiles, so
// they don't stay unexplained just because they render as one block
// instead of a grid. helpKey is a translation key under
// statusCard.sectionHelp.
function SectionHelp({ helpKey }: { helpKey: string }) {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <Tooltip content={t(helpKey)} relationship="description" withArrow>
      <span className={styles.kpiHelpIcon} tabIndex={0}>
        <InfoRegular fontSize={12} />
      </span>
    </Tooltip>
  );
}

export const StatusReportCard = forwardRef<
  HTMLDivElement,
  StatusReportCardProps
>(function StatusReportCard(
  {
    headerTitle,
    headerSubtitle,
    suiteGroups,
    report,
    alertText,
    actionsText,
    dashboardUrl,
    dashboardLinkRef,
    showOriginBreakdown = false,
    includeDsiSource = true,
  },
  ref,
) {
  const { t } = useTranslation();
  const styles = useStyles();

  // Fixed to when the card first mounts rather than recomputed every
  // render, so it reads as "generated at" and doesn't visibly tick
  // forward while editing the alert/actions text below.
  const { datePart, timePart } = useMemo(
    () => formatUpdatedTimestamp(new Date()),
    [],
  );

  // Shared with export.ts's PDF/PPTX/email renderings so the live card
  // never drifts from what gets exported for the same report.
  const {
    totalTestCases,
    totalPassed,
    totalNotApplicable,
    totalExecuted,
    executedPct,
    totalNotRun,
    passRate,
    notApplicableRate,
    bugsClosed,
    bugsClosedPct,
    bugsToClose,
    toClosePct,
    toCloseOutOfScopeCount,
    stillOpen,
    reopenedPct,
    avgClosureDays,
    bugsByDsi,
    bugsByUs,
    criticalCount,
  } = computeStatusCardKpis(suiteGroups, report);

  const {
    statusEntries,
    closedOutOfScopeCount,
    severityTotal,
    severityEntries,
    openSeverityTotal,
    openSeverityEntries,
  } = computeBugStatusData(report);

  const actionParagraphs = actionsText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const bugSources = [
    ...suiteGroups.map((group) => group.label),
    ...(includeDsiSource ? ["DSI"] : []),
  ].join(", ");

  const originPanels = [
    {
      origin: "Test Factory",
      labelKey: "defectManagementPage.sprintReport.origin.testFactory",
      bySuite: report.testFactoryBySuite,
      labelBg: "#1f3d1f",
      labelText: "#6bcf6b",
    },
    {
      origin: "Test Agenti",
      labelKey: "defectManagementPage.sprintReport.origin.testAgenti",
      bySuite: report.testAgentiBySuite,
      labelBg: "#1f2f4d",
      labelText: "#5b9bd5",
    },
    {
      origin: "Business",
      labelKey: "defectManagementPage.sprintReport.origin.business",
      bySuite: report.testBusinessBySuite,
      labelBg: "#3d3319",
      labelText: "#f2b134",
    },
  ].map((panel) => ({
    ...panel,
    suiteEntries: Object.entries(panel.bySuite).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    detected: report.byOriginDetected[panel.origin] ?? 0,
    accepted: report.byOrigin[panel.origin] ?? 0,
  }));

  return (
    <div ref={ref} className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <span className={styles.headerTitle}>{headerTitle}</span>
          <span className={styles.headerSubtitle}>{headerSubtitle}</span>
        </div>
        <span className={styles.headerTimestamp}>
          {t("defectManagementPage.sprintReport.statusCard.updatedAt", {
            date: datePart,
            time: timePart,
          })}
        </span>
      </div>

      <div className={styles.body}>
        {alertText && (
          <div className={styles.alertBanner}>
            <span>⚠️</span>
            <span>{alertText}</span>
          </div>
        )}

        <div className={styles.kpiSections}>
          {/* Stato casi di test */}
          <div className={styles.kpiSection}>
            <span className={styles.kpiSectionTitle}>
              🧪{" "}
              {t(
                "defectManagementPage.sprintReport.statusCard.kpis.testCasesSection",
              )}
            </span>
            <div className={styles.kpiGrid6}>
              <KpiTile
                value={totalTestCases}
                color="#3aa0f3"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.totalTestCases"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.totalTestCases"
              />
              <KpiTile
                value={`${totalExecuted} (${executedPct}%)`}
                color="#6bcf6b"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.executedCount"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.executedCount"
              />
              <KpiTile
                value={`${totalNotApplicable} (${notApplicableRate}%)`}
                color="#8a8886"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.notApplicable"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.notApplicable"
              />
              <KpiTile
                value={totalNotRun}
                color="#f2b134"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.notRun"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.notRun"
              />
              <KpiTile
                value={totalPassed}
                color="#3fb950"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.totalPassed"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.totalPassed"
              />
              <KpiTile
                value={`${passRate}%`}
                color="#6bcf6b"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.passRate"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.passRate"
              />
            </div>
          </div>

          {/* Stato bug */}
          <div className={styles.kpiSection}>
            <span className={styles.kpiSectionTitle}>
              🐛{" "}
              {t(
                "defectManagementPage.sprintReport.statusCard.kpis.bugsSection",
              )}
            </span>
            <div className={styles.kpiGrid4}>
              <KpiTile
                value={`${report.effectiveCount}/${report.total}`}
                color="#b180d7"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.effectiveBugsDetected"
              />
              <KpiTile
                value={report.outOfScopeCount}
                color="#9e9e9e"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.outOfScopeBugsDetected"
              />
              {includeDsiSource && (
                <>
                  <KpiTile
                    value={bugsByUs}
                    color="#6bcf6b"
                    labelKey="defectManagementPage.sprintReport.statusCard.kpis.bugsByUs"
                    helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.bugsByUs"
                  />
                  <KpiTile
                    value={bugsByDsi}
                    color="#3aa0f3"
                    labelKey="defectManagementPage.sprintReport.statusCard.kpis.bugsByDsi"
                    helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.bugsByDsi"
                  />
                </>
              )}
              <KpiTile
                value={`${bugsClosed}/${report.total} (${bugsClosedPct}%)`}
                color="#f2b134"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.bugsClosedRatio"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.bugsClosedRatio"
                labelCount={closedOutOfScopeCount}
              />
              <KpiTile
                value={`${bugsToClose}/${report.total} (${toClosePct}%)`}
                color="#eda100"
                label={bugsToCloseLabel(t, toCloseOutOfScopeCount)}
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.bugsToClose"
              />
              <KpiTile
                value={criticalCount}
                color="#ff6b6b"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.criticalBugs"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.criticalBugs"
              />
              <KpiTile
                value={`${report.reopenedCount} (${reopenedPct}%)`}
                color="#3aa0f3"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.reopenedBugs"
              />
              <KpiTile
                value={t("defectManagementPage.stats.days", {
                  value: avgClosureDays,
                })}
                color="#6bcf6b"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.avgClosureTime"
              />
              <KpiTile
                value={report.withoutResolutionDateCount}
                color="#8a8886"
                labelKey="defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate"
                helpKey="defectManagementPage.sprintReport.statusCard.kpisHelp.withoutResolutionDate"
              />
            </div>
          </div>
        </div>

        {dashboardUrl && (
          <a
            ref={dashboardLinkRef}
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.dashboardButton}
          >
            {t("defectManagementPage.sprintReport.statusCard.openDashboard")}
          </a>
        )}

        {actionParagraphs.length > 0 && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>
              📌{" "}
              {t("defectManagementPage.sprintReport.statusCard.actionsTitle")}
            </span>
            {actionParagraphs.map((paragraph, index) => {
              const palette = ACTION_PALETTE[index % ACTION_PALETTE.length];
              const lines = paragraph.split("\n");

              return (
                <div
                  key={index}
                  className={styles.actionsBox}
                  style={{
                    backgroundColor: palette.bg,
                    borderLeftColor: palette.border,
                  }}
                >
                  {lines.map((line, lineIndex) => {
                    const { lead, rest } = splitActionLeadIn(line);

                    return (
                      <span key={lineIndex}>
                        {lead && <strong>{lead} </strong>}
                        {rest}
                        {lineIndex < lines.length - 1 && "\n"}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.section}>
          <span className={styles.sectionTitleRow}>
            <span className={styles.sectionTitle}>
              📈{" "}
              {t(
                "defectManagementPage.sprintReport.statusCard.suiteProgressTitle",
              )}
            </span>
            <SectionHelp helpKey="defectManagementPage.sprintReport.statusCard.sectionHelp.suiteProgress" />
          </span>

          {suiteGroups.length > 0 ? (
            suiteGroups.map((group) => (
              <SuiteProgressBar
                key={group.label}
                suiteName={group.label}
                totalTestCases={group.totalTestCases}
                outcomeCounts={group.outcomeCounts}
              />
            ))
          ) : (
            <span className={styles.emptyNote}>
              {t("defectManagementPage.sprintReport.statusCard.noPlanSelected")}
            </span>
          )}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitleRow}>
              <span className={styles.sectionTitle}>
                🐛{" "}
                {t(
                  "defectManagementPage.sprintReport.statusCard.bugStatusTitle",
                )}
              </span>
              <SectionHelp helpKey="defectManagementPage.sprintReport.statusCard.sectionHelp.bugStatus" />
            </span>
            <span className={styles.sectionSubtitle}>
              {t(
                "defectManagementPage.sprintReport.statusCard.bugStatusSubtitle",
                { sources: bugSources },
              )}
            </span>
          </div>

          <div className={styles.statusSummaryRow}>
            <span className={styles.statusSummaryMain}>
              <strong>
                {t(
                  "defectManagementPage.sprintReport.statusCard.bugsDetected",
                  { count: report.total },
                )}
              </strong>{" "}
              –{" "}
              {t(
                "defectManagementPage.sprintReport.statusCard.bugStatusSummary",
                {
                  effective: report.effectiveCount,
                  outOfScope: report.outOfScopeCount,
                },
              )}
            </span>
            <span className={styles.statusStillOpen}>
              {t("defectManagementPage.sprintReport.statusCard.stillOpen", {
                count: stillOpen,
              })}
            </span>
          </div>

          <div className={styles.statusTrack}>
            {statusEntries.map(([name, count]) => (
              <div
                key={name}
                style={{
                  width: `${(count / report.total) * 100}%`,
                  backgroundColor: STATUS_COLORS[name],
                }}
              />
            ))}
          </div>

          <span className={styles.statusLegend}>
            {statusEntries.map(([name, count], index) => (
              <span key={name}>
                {index > 0 && (
                  <span className={styles.legendSeparator}>{" | "}</span>
                )}
                <span
                  className={styles.swatch}
                  style={{ backgroundColor: STATUS_COLORS[name] }}
                />
                {count}{" "}
                {t(
                  `defectManagementPage.sprintReport.statusCard.statusLabels.${STATUS_LABEL_KEYS[name]}`,
                )}
                {name === "Closed" &&
                  closedOutOfScopeCount > 0 &&
                  t(
                    "defectManagementPage.sprintReport.statusCard.closedOutOfScopeNote",
                    { count: closedOutOfScopeCount },
                  )}
              </span>
            ))}
          </span>

          <SeverityChipsRow entries={severityEntries} total={severityTotal} />

          <span className={styles.severityCaption}>
            {t("defectManagementPage.sprintReport.statusCard.severityCaption", {
              count: report.effectiveCount,
            })}
          </span>

          <SeverityChipsRow
            entries={openSeverityEntries}
            total={openSeverityTotal}
          />

          <span className={styles.severityCaption}>
            {t(
              "defectManagementPage.sprintReport.statusCard.openSeverityCaption",
              { count: openSeverityTotal },
            )}
          </span>
        </div>

        {showOriginBreakdown &&
          originPanels.some((panel) => panel.suiteEntries.length > 0) && (
            <div className={styles.section}>
              <span className={styles.sectionTitleRow}>
                <span className={styles.sectionTitle}>
                  {t(
                    "defectManagementPage.sprintReport.statusCard.originBreakdown.title",
                  )}
                </span>
                <SectionHelp helpKey="defectManagementPage.sprintReport.statusCard.sectionHelp.originBreakdown" />
              </span>

              {originPanels
                .filter((panel) => panel.suiteEntries.length > 0)
                .map((panel) => (
                  <div key={panel.origin} className={styles.originPanel}>
                    <span
                      className={styles.originLabel}
                      style={{
                        backgroundColor: panel.labelBg,
                        color: panel.labelText,
                      }}
                    >
                      {t(panel.labelKey)}
                    </span>

                    <div className={styles.originBody}>
                      <div className={styles.originSuiteGrid}>
                        {panel.suiteEntries.map(([suite, count]) => (
                          <div key={suite} className={styles.originTile}>
                            <span className={styles.originValue}>{count}</span>
                            <span className={styles.originCaption}>
                              {suite === UNMATCHED_SUITE_KEY
                                ? t(
                                    "defectManagementPage.sprintReport.statusCard.originBreakdown.unmatched",
                                  )
                                : t(
                                    "defectManagementPage.sprintReport.statusCard.originBreakdown.bugsInSuite",
                                    { suite },
                                  )}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className={styles.originTotals}>
                        <div className={styles.originTile}>
                          <span className={styles.originValue}>
                            {panel.detected}
                          </span>
                          <span className={styles.originCaption}>
                            {t(
                              "defectManagementPage.sprintReport.statusCard.originBreakdown.detected",
                            )}
                          </span>
                        </div>
                        <div className={styles.originTile}>
                          <span className={styles.originValue}>
                            {panel.accepted}
                          </span>
                          <span className={styles.originCaption}>
                            {t(
                              "defectManagementPage.sprintReport.statusCard.originBreakdown.accepted",
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
      </div>
    </div>
  );
});
