import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  Switch,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  BookQuestionMarkRegular,
  ChevronDownRegular,
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
  buildEmailPrefaceHtml,
  buildStatusReportCardEmailBodyHtml,
  buildStatusReportCardEmailDocument,
  buildStatusReportCardFilename,
  copyStatusReportCardEmailHtmlToClipboard,
  downloadStatusReportCardEmailHtml,
  exportKpiLegendToPdf,
  exportStatusReportCardToPdf,
  exportStatusReportCardToPptx,
} from "../utils/export";
import type {
  DefectStats,
  Outcome,
  SprintDefectReport,
  VerificaActivitySummary,
} from "../types";

// Fallback only - used when none of the resolved plans for this report have
// a report link saved in their Azure DevOps description (see
// resolvedPlanIds/dashboardUrl below).
const MONITORING_DASHBOARD_URL =
  "https://dev.azure.com/ItasMutua/Nuova%20Frontiera/_dashboards/dashboard/4665852c-cb39-4a89-ac4f-1dca396b539a";

const emailReportEnabled = import.meta.env.VITE_ENABLE_EMAIL_REPORT !== "false";

// Matches StatusReportCard.tsx's own fixed `card` width - kept in sync
// there (not derived from the DOM) since it drives the preview's
// fit-to-monitor scale calculation before the card has necessarily
// rendered/been measured yet.
const STATUS_CARD_WIDTH = 900;

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
  emailPrefaceArea: {
    width: "100%",
    maxWidth: `${STATUS_CARD_WIDTH}px`,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  emailPrefaceTextarea: {
    width: "100%",
  },
  warningText: {
    color: tokens.colorPaletteRedForeground1,
  },
  warningList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  actionFieldBody: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  chevron: {
    color: tokens.colorBrandForeground1,
    fontSize: "18px",
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
    from.getDate() + 1,
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

// Default Azione 2 text - two independent lines (not blank-line separated,
// since Azione 2 is a single textarea and a blank-line split would push a
// second line into a dropped third paragraph - see the split() comment
// below). Each line only appears when it's actually actionable; both empty
// means no default text at all, matching Azione 1's "nothing to say"
// behavior.
function buildDefaultActionText2(activity: VerificaActivitySummary): string {
  const lines: string[] = [];

  const {
    verifiedToday,
    closedToday,
    closedTodayOutOfScopeCount,
    reopenedToday,
    stillPendingVerification,
  } = activity;

  if (verifiedToday > 0 || closedToday > 0 || reopenedToday > 0 || stillPendingVerification > 0) {
    // Only mentioned when there's actually a closed-today bug that's also
    // out-of-scope - same "(N out of scope)" phrasing as the status card's
    // Closed legend entry (see computeBugStatusData in export.ts).
    const closedOutOfScopeNote =
      closedTodayOutOfScopeCount > 0 ? ` (${closedTodayOutOfScopeCount} out of scope)` : "";
    // Dropped entirely (not "0 bug in fase di verifica") when there's
    // nothing left pending - a trailing zero read as noise once verified/
    // closed/reopened already told the actionable part of the story.
    const pendingClause =
      stillPendingVerification > 0
        ? `; restano ancora ${stillPendingVerification} bug in fase di verifica.`
        : ".";
    // Same "drop the zero" reasoning as pendingClause above - "e 0 riaperti"
    // is noise, not a fact worth reporting.
    const reopenedClause =
      reopenedToday > 0 ? ` e ${reopenedToday} riaperti` : "";

    lines.push(
      `Test Management: Test Factory ha verificato ${verifiedToday} bug oggi, di cui ${closedToday} chiusi${closedOutOfScopeNote}${reopenedClause}${pendingClause}`,
    );
  }

  if (activity.dsiPendingCount > 0) {
    lines.push(
      `DSI: ci sono ${activity.dsiPendingCount} bug ancora in fase di verifica.`,
    );
  }

  if (activity.siPendingCount > 0) {
    lines.push(
      `System Integrator: ci sono ${activity.siPendingCount} bug ancora in fase di verifica.`,
    );
  }

  return lines.join("\n");
}

export function SprintDefectReportTab({
  stats,
  suiteGroupDefs = AUTO_SUITE_GROUP_DEFS,
  defaultHeaderTitle = "UAT Sprint 1 – Auto",
  defaultHeaderSubtitle = "Stato avanzamento test funzionali / UAT – Progetto Nuova Frontiera",
  defaultActionsText,
  includeDsiSource = true,
  includeDeadline = true,
  enableEmailPreface = false,
  enableEmailClosing = false,
  project,
}: {
  stats: DefectStats;
  suiteGroupDefs?: SuiteGroupDef[];
  defaultHeaderTitle?: string;
  defaultHeaderSubtitle?: string;
  defaultActionsText?: (report: SprintDefectReport) => string;
  // Off when the current report has no DSI-sourced bugs - see StatusReportCard.tsx.
  includeDsiSource?: boolean;
  // Off when the current report has no shared UAT deadline.
  includeDeadline?: boolean;
  // Lets the sender type a free-text note directly above the card preview,
  // like the compose box above quoted/forwarded content in a mail client.
  enableEmailPreface?: boolean;
  // Lets the sender type a free-text note below the card preview, appended
  // after the report in the sent email only (mirrors enableEmailPreface).
  enableEmailClosing?: boolean;
  // Scopes the plan/plan-overview lookups below to a specific Azure DevOps
  // project.
  project?: string;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const report = stats.sprintDefectReport;

  // Dynamic Sprint Report recomputes defaultHeaderTitle from the selected
  // Test Plans (see DynamicSprintReportPage.tsx) - derived (not seeded
  // once via useState) so the field keeps following that as the selection
  // changes, right up until the user actually types into it themselves;
  // customHeaderTitle then takes over so a manual edit doesn't get
  // clobbered by a later plan-selection change.
  const [customHeaderTitle, setCustomHeaderTitle] = useState<string | null>(
    null,
  );
  const headerTitle = customHeaderTitle ?? defaultHeaderTitle;

  const [headerSubtitle, setHeaderSubtitle] = useState(defaultHeaderSubtitle);
  const [uatDeadline, setUatDeadline] = useState("2026-07-20");

  // Two paragraphs (blank-line separated) so each lands in its own box
  // below - defaultActionsText callers only ever supply one or two
  // paragraphs today, so anything past the second is dropped. The System
  // Integrator note only makes sense when there's actually a bug missing a
  // resolution date to act on. Azione 1/2 themselves start empty (see
  // actionText1/actionText2 below) - this auto text is offered as a preset
  // in each field's dropdown instead of being force-filled, so a report
  // with nothing to say doesn't ship half-written boilerplate by default.
  const [autoActionText1, autoActionText2] = (
    defaultActionsText
      ? defaultActionsText(report)
      : report.withoutResolutionDateCount > 0
        ? `System Integrator: si prega di prendere in carico i ${report.withoutResolutionDateCount} nuovi bug e impostarne la data di risoluzione\n\n` +
          buildDefaultActionText2(stats.verificaActivitySummary)
        : `\n\n${buildDefaultActionText2(stats.verificaActivitySummary)}`
  )
    .split(/\n\s*\n/)
    .map((p) => p.trim());
  const [actionText1, setActionText1] = useState("");
  const [actionText2, setActionText2] = useState("");
  const actionsText = [actionText1, actionText2]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");
  const [groupLabels, setGroupLabels] = useState<string[]>(
    suiteGroupDefs.map((def) => def.label),
  );

  // `suiteGroupDefs` is a static constant on the two hardcoded pages, so
  // this never mattered there - but the dynamic Sprint Report page starts
  // with an empty array (before its plan overview data loads) and
  // populates it asynchronously, and useState's initializer only runs
  // once on mount. Without this, groupLabels would stay stuck at its
  // initial (possibly empty) value forever, leaving every group's label
  // undefined once real defs arrive. Adjusting state during render
  // (rather than in an effect) per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes -
  // comparing against the previous *defs* (not groupLabels itself) is
  // what lets a manually-edited label survive unrelated re-renders
  // instead of being reset back to the default every time.
  const [prevSuiteGroupDefLabels, setPrevSuiteGroupDefLabels] = useState(
    suiteGroupDefs.map((def) => def.label),
  );
  const nextSuiteGroupDefLabels = suiteGroupDefs.map((def) => def.label);
  const suiteGroupDefLabelsChanged =
    prevSuiteGroupDefLabels.length !== nextSuiteGroupDefLabels.length ||
    prevSuiteGroupDefLabels.some(
      (label, i) => label !== nextSuiteGroupDefLabels[i],
    );

  if (suiteGroupDefLabelsChanged) {
    setPrevSuiteGroupDefLabels(nextSuiteGroupDefLabels);
    setGroupLabels(nextSuiteGroupDefLabels);
  }

  const [isExportingCard, setIsExportingCard] = useState(false);
  const [isExportingPptx, setIsExportingPptx] = useState(false);
  const [isExportingLegend, setIsExportingLegend] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  // Off by default: the Test Factory/Test Agenti/Business breakdown is
  // still being validated, so regular report sends shouldn't include it
  // until someone opts in for a given card.
  const [showOriginBreakdown, setShowOriginBreakdown] = useState(false);
  const [toInput, setToInput] = useState(DEFAULT_REPORT_RECIPIENTS.join(", "));
  const [ccInput, setCcInput] = useState(DEFAULT_REPORT_CC.join(", "));
  const [fromDisplayName, setFromDisplayName] = useState("");
  const [emailPrefaceText, setEmailPrefaceText] = useState("");
  const [emailClosingText, setEmailClosingText] = useState("");
  const statusCardRef = useRef<HTMLDivElement>(null);
  const dashboardLinkRef = useRef<HTMLAnchorElement>(null);
  const statusCardPreviewRef = useRef<HTMLDivElement>(null);
  // Purely a visual fit for the on-screen preview - every export (PDF,
  // PPTX, email HTML) is built independently from report data in export.ts
  // rather than by capturing this DOM node, so scaling the preview down to
  // fit a narrower monitor never changes what actually gets sent.
  const [previewWidth, setPreviewWidth] = useState(0);
  // Only height needs measuring - the card's own CSS pins its width to
  // STATUS_CARD_WIDTH, so it never varies; height does, with content.
  const [cardHeight, setCardHeight] = useState(0);

  useEffect(() => {
    const previewEl = statusCardPreviewRef.current;

    if (!previewEl) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setPreviewWidth(entry.contentRect.width);
    });

    observer.observe(previewEl);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cardEl = statusCardRef.current;

    if (!cardEl) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setCardHeight(entry.contentRect.height);
    });

    observer.observe(cardEl);
    return () => observer.disconnect();
  }, []);

  const previewScale = previewWidth ? Math.min(1, previewWidth / STATUS_CARD_WIDTH) : 1;

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

  // Quick-fill templates offered above each action Textarea - selecting one
  // overwrites that field's text (still freely editable after), leaving
  // manual typing and clearing the field untouched as the other two ways to
  // set it. The "missing resolution dates" preset only makes sense - same
  // rule as the default Action 1 text above - when there's actually a bug
  // without one to act on.
  const action1Presets: { key: string; label: string; text: string }[] = [
    ...(autoActionText1.trim()
      ? [
          {
            key: "auto-suggested",
            label: t(
              "defectManagementPage.sprintReport.statusCard.actionsPresetAutoSuggested",
            ),
            text: autoActionText1,
          },
        ]
      : []),
    {
      key: "si-deadline",
      label: t(
        "defectManagementPage.sprintReport.statusCard.actionsPreset1SiDeadline",
      ),
      text:
        "System Integrator: come condiviso nella call odierna, si prega di aggiornare le date di risoluzione dei bug ed effettuare la chiusura degli stessi entro il "
    },
    ...(report.withoutResolutionDateCount > 0
      ? [
          {
            key: "si-missing-dates",
            label: t(
              "defectManagementPage.sprintReport.statusCard.actionsPreset1SiMissingDates",
              { count: report.withoutResolutionDateCount },
            ),
            text: `System Integrator: inserire entro la giornata di domani le date di risoluzione previste per gli ${report.withoutResolutionDateCount} bug ancora sprovvisti.`,
          },
        ]
      : []),
  ];

  const action2Presets: { key: string; label: string; text: string }[] = [
    ...(autoActionText2.trim()
      ? [
          {
            key: "auto-suggested",
            label: t(
              "defectManagementPage.sprintReport.statusCard.actionsPresetAutoSuggested",
            ),
            text: autoActionText2,
          },
        ]
      : []),
    {
      key: "test-management-out-of-scope",
      label: t(
        "defectManagementPage.sprintReport.statusCard.actionsPreset2TestManagementOutOfScope",
      ),
      text: "Test Management: Agente complesso fuori ambito, poiché il ruolo sarà implementato nello Sprint 3.",
    },
    {
      key: "test-funzionali-not-executable",
      label: t(
        "defectManagementPage.sprintReport.statusCard.actionsPreset2TestFunzionaliNotExecutable",
      ),
      text: "Test funzionali: Rilevato un numero significativo di test case non eseguibili, poiché associati a funzionalità non ancora rilasciate ma incluse nel piano di test condiviso.",
    },
  ];

  // Same per-plan endpoint Plan Overview uses (uncached, fetched fresh by
  // plan ID) rather than the whole-org /api/dashboard, which is cached
  // for 5 minutes and can lag behind a plan that was just populated.
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["plans", project],
    queryFn: () => fetchPlans(project),
  });

  const planIdByName = new Map(
    (plans ?? []).map((plan) => [plan.name, plan.id]),
  );

  // Each def's plan is identified either directly by planId (bypasses
  // name lookup entirely) or by resolving planName against the plans
  // list. Queried by the distinct resolved IDs, in parallel.
  const resolvedPlanIds = suiteGroupDefs.map(
    (def) => def.planId ?? planIdByName.get(def.planName ?? ""),
  );
  const distinctPlanIds = [
    ...new Set(resolvedPlanIds.filter((id): id is number => id != null)),
  ];

  const planOverviewQueries = useQueries({
    queries: distinctPlanIds.map((planId) => ({
      queryKey: ["plan-overview", planId, project],
      queryFn: () => fetchPlanOverview(planId, project),
    })),
  });

  const overviewByPlanId = new Map(
    distinctPlanIds.map((planId, index) => [
      planId,
      planOverviewQueries[index].data,
    ]),
  );

  // The "Open Dashboard" link should point at whichever sprint's report is
  // actually selected rather than one fixed org-wide dashboard - each test
  // plan can carry that link in its Azure DevOps description (see
  // extractReportUrlFromDescription server-side), so this picks the first
  // resolved plan (in suiteGroupDefs order, i.e. "Test Factory" first)
  // that has one saved, falling back to the static monitoring dashboard
  // when none of the selected plans have a link configured yet.
  const dashboardUrl =
    resolvedPlanIds
      .map((planId) =>
        planId != null ? overviewByPlanId.get(planId)?.reportUrl : undefined,
      )
      .find((url): url is string => !!url) ?? MONITORING_DASHBOARD_URL;

  // While any of this is still in flight, every group looks "unmatched"
  // (no overview yet to match suites against) - without this flag that
  // transient state renders as the suiteGroupsWarning below, which reads
  // like a real configuration error instead of a normal loading moment.
  const suiteDataLoading =
    plansLoading || planOverviewQueries.some((query) => query.isLoading);

  const updateGroupLabel = (index: number, label: string) => {
    setGroupLabels((prev) =>
      prev.map((current, i) => (i === index ? label : current)),
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
          (suite) => `${suite.suiteName} (id ${suite.suiteId})`,
        ),
      };
    }

    const matchedSuites = def.suiteIds
      ? overview.suites.filter((suite) => def.suiteIds!.includes(suite.suiteId))
      : overview.suites.filter((suite) =>
          def.suiteNames!.includes(suite.suiteName),
        );

    const totalTestCases = matchedSuites.reduce(
      (sum, suite) => sum + suite.totalTestCases,
      0,
    );

    const outcomeCounts = matchedSuites.reduce(
      (acc, suite) => {
        (Object.keys(acc) as Outcome[]).forEach((outcome) => {
          acc[outcome] += suite.outcomeCounts[outcome];
        });
        return acc;
      },
      { ...ZERO_OUTCOME_COUNTS },
    );

    return {
      label: groupLabels[index],
      totalTestCases,
      outcomeCounts,
      planFound: true,
      availableSuiteNames: overview.suites.map((suite) => suite.suiteName),
    };
  });

  const suiteGroups: SuiteProgressGroup[] = resolvedGroups.map(
    ({ label, totalTestCases, outcomeCounts }) => ({
      label,
      totalTestCases,
      outcomeCounts,
    }),
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
          dashboardUrl,
          showOriginBreakdown,
          includeDsiSource,
        },
        t,
      );
    } finally {
      setIsExportingCard(false);
    }
  };

  // Independent of the current report's data (see buildKpiLegendPdfDocument
  // in export.ts) - a "how to read this card" one-pager generated once and
  // shared alongside sprint report sends, not regenerated per sprint.
  const handleExportKpiLegend = () => {
    setIsExportingLegend(true);

    try {
      exportKpiLegendToPdf(
        `${t("defectManagementPage.sprintReport.statusCard.kpiLegend.filename")}.pdf`,
        t,
      );
    } finally {
      setIsExportingLegend(false);
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
          dashboardUrl,
          showOriginBreakdown,
          includeDsiSource,
        },
        t,
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
        dashboardUrl,
        showOriginBreakdown,
        includeDsiSource,
      },
      t,
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
        dashboardUrl,
        showOriginBreakdown,
        includeDsiSource,
      },
      t,
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
      dashboardUrl,
      showOriginBreakdown,
      includeDsiSource,
    };

    const bodyHtml = buildStatusReportCardEmailDocument(
      (enableEmailPreface ? buildEmailPrefaceHtml(emailPrefaceText) : "") +
        buildStatusReportCardEmailBodyHtml(cardData, t) +
        (enableEmailClosing ? buildEmailPrefaceHtml(emailClosingText) : ""),
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
            "defectManagementPage.sprintReport.statusCard.emailSectionTitle",
          )}
        >
          <Text className={styles.note}>
            {t(
              "defectManagementPage.sprintReport.statusCard.emailSectionDescription",
            )}
          </Text>

          <div className={styles.statusCardControls}>
            <Field
              label={t(
                "defectManagementPage.sprintReport.statusCard.emailToLabel",
              )}
              className={styles.statusCardFieldFull}
            >
              <Input
                value={toInput}
                placeholder={t(
                  "defectManagementPage.sprintReport.statusCard.emailAddressPlaceholder",
                )}
                onChange={(_, data) => setToInput(data.value)}
              />
            </Field>
          </div>

          <div className={styles.statusCardControls}>
            <Field
              label={t(
                "defectManagementPage.sprintReport.statusCard.emailCcLabel",
              )}
              className={styles.statusCardFieldFull}
            >
              <Input
                value={ccInput}
                placeholder={t(
                  "defectManagementPage.sprintReport.statusCard.emailAddressPlaceholder",
                )}
                onChange={(_, data) => setCcInput(data.value)}
              />
            </Field>
          </div>

          <div className={styles.emailCardActions}>
            <Field
              label={t(
                "defectManagementPage.sprintReport.statusCard.emailFromNameLabel",
              )}
              className={styles.statusCardField}
            >
              <Input
                value={fromDisplayName}
                placeholder={t(
                  "defectManagementPage.sprintReport.statusCard.emailFromNamePlaceholder",
                )}
                onChange={(_, data) => setFromDisplayName(data.value)}
              />
            </Field>

            <Button
              appearance="primary"
              icon={<MailRegular />}
              disabled={
                emailReportMutation.isPending || toAddresses.length === 0
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

      {enableEmailPreface && (
        <div className={styles.emailPrefaceArea}>
          <Text weight="semibold">
            {t(
              "defectManagementPage.sprintReport.statusCard.emailPrefaceLabel",
            )}
          </Text>
          <Textarea
            className={styles.emailPrefaceTextarea}
            value={emailPrefaceText}
            placeholder={t(
              "defectManagementPage.sprintReport.statusCard.emailPrefacePlaceholder",
            )}
            rows={3}
            resize="vertical"
            onChange={(_, data) => setEmailPrefaceText(data.value)}
          />
        </div>
      )}

      {enableEmailClosing && (
        <div className={styles.emailPrefaceArea}>
          <Text weight="semibold">
            {t(
              "defectManagementPage.sprintReport.statusCard.emailClosingLabel",
            )}
          </Text>
          <Textarea
            className={styles.emailPrefaceTextarea}
            value={emailClosingText}
            placeholder={t(
              "defectManagementPage.sprintReport.statusCard.emailClosingPlaceholder",
            )}
            rows={3}
            resize="vertical"
            onChange={(_, data) => setEmailClosingText(data.value)}
          />
        </div>
      )}

      <ChartCard
        title={t("defectManagementPage.sprintReport.statusCard.title")}
      >
        <div className={styles.statusCardControls}>
          <Field
            label={t(
              "defectManagementPage.sprintReport.statusCard.headerTitleLabel",
            )}
            className={styles.statusCardField}
          >
            <Input
              value={headerTitle}
              onChange={(_, data) => setCustomHeaderTitle(data.value)}
            />
          </Field>

          <Field
            label={t(
              "defectManagementPage.sprintReport.statusCard.headerSubtitleLabel",
            )}
            className={styles.statusCardFieldWide}
          >
            <Input
              value={headerSubtitle}
              onChange={(_, data) => setHeaderSubtitle(data.value)}
            />
          </Field>
        </div>

        <div className={styles.statusCardControls}>
          {includeDeadline && (
            <Field
              label={t(
                "defectManagementPage.sprintReport.statusCard.uatDeadlineLabel",
              )}
              className={styles.statusCardField}
            >
              <Input
                type="date"
                value={uatDeadline}
                onChange={(_, data) => setUatDeadline(data.value)}
              />
            </Field>
          )}

          <Field
            label={t(
              "defectManagementPage.sprintReport.statusCard.actionsLabel1",
            )}
            className={styles.statusCardField}
          >
            <div className={styles.actionFieldBody}>
              <Dropdown
                expandIcon={<ChevronDownRegular className={styles.chevron} />}
                placeholder={t(
                  "defectManagementPage.sprintReport.statusCard.actionsPresetPlaceholder",
                )}
                selectedOptions={[]}
                value=""
                onOptionSelect={(_, data) => {
                  const preset = action1Presets.find(
                    (p) => p.key === data.optionValue,
                  );
                  if (preset) setActionText1(preset.text);
                }}
              >
                {action1Presets.map((preset) => (
                  <Option key={preset.key} value={preset.key} text={preset.label}>
                    {preset.label}
                  </Option>
                ))}
              </Dropdown>
              <Textarea
                value={actionText1}
                placeholder={t(
                  "defectManagementPage.sprintReport.statusCard.actionsPlaceholder",
                )}
                rows={3}
                resize="vertical"
                onChange={(_, data) => setActionText1(data.value)}
              />
            </div>
          </Field>

          <Field
            label={t(
              "defectManagementPage.sprintReport.statusCard.actionsLabel2",
            )}
            className={styles.statusCardField}
          >
            <div className={styles.actionFieldBody}>
              <Dropdown
                expandIcon={<ChevronDownRegular className={styles.chevron} />}
                placeholder={t(
                  "defectManagementPage.sprintReport.statusCard.actionsPresetPlaceholder",
                )}
                selectedOptions={[]}
                value=""
                onOptionSelect={(_, data) => {
                  const preset = action2Presets.find(
                    (p) => p.key === data.optionValue,
                  );
                  if (preset) setActionText2(preset.text);
                }}
              >
                {action2Presets.map((preset) => (
                  <Option key={preset.key} value={preset.key} text={preset.label}>
                    {preset.label}
                  </Option>
                ))}
              </Dropdown>
              <Textarea
                value={actionText2}
                placeholder={t(
                  "defectManagementPage.sprintReport.statusCard.actionsPlaceholder",
                )}
                rows={3}
                resize="vertical"
                onChange={(_, data) => setActionText2(data.value)}
              />
            </div>
          </Field>
        </div>

        <Text weight="semibold">
          {t("defectManagementPage.sprintReport.statusCard.suiteGroupsLabel")}
        </Text>

        <div className={styles.statusCardControls}>
          {groupLabels.map((label, index) => (
            <Field key={index} className={styles.statusCardField}>
              <Input
                value={label}
                onChange={(_, data) => updateGroupLabel(index, data.value)}
              />
            </Field>
          ))}
        </div>

        {suiteDataLoading ? (
          <Spinner
            size="tiny"
            label={t(
              "defectManagementPage.sprintReport.statusCard.suiteGroupsLoading",
            )}
          />
        ) : (
          unmatchedGroups.length > 0 && (
            <div className={styles.warningList}>
              {unmatchedGroups.map((group) => (
                <Text key={group.label} className={styles.warningText}>
                  {t(
                    "defectManagementPage.sprintReport.statusCard.suiteGroupsWarning",
                    { group: group.label, hint: group.hint },
                  )}
                </Text>
              ))}
            </div>
          )
        )}

        <div className={styles.statusCardPreviewRow} ref={statusCardPreviewRef}>
          <div
            style={{
              width: STATUS_CARD_WIDTH * previewScale,
              height: cardHeight ? cardHeight * previewScale : undefined,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: STATUS_CARD_WIDTH,
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
              }}
            >
              <StatusReportCard
                ref={statusCardRef}
                headerTitle={headerTitle}
                headerSubtitle={headerSubtitle}
                suiteGroups={suiteGroups}
                report={report}
                alertText={alertText}
                actionsText={actionsText}
                dashboardUrl={dashboardUrl}
                dashboardLinkRef={dashboardLinkRef}
                showOriginBreakdown={showOriginBreakdown}
                includeDsiSource={includeDsiSource}
              />
            </div>
          </div>
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
              : t("defectManagementPage.sprintReport.statusCard.exportButton")}
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
                  "defectManagementPage.sprintReport.statusCard.exportPptxButton",
                )}
          </Button>

          <Button
            appearance="secondary"
            icon={<CodeTextRegular />}
            onClick={handleDownloadStatusCardHtml}
          >
            {t(
              "defectManagementPage.sprintReport.statusCard.downloadHtmlButton",
            )}
          </Button>

          <Button
            appearance="secondary"
            icon={
              isCopied ? <ClipboardCheckmarkRegular /> : <ClipboardRegular />
            }
            onClick={handleCopyStatusCardHtml}
          >
            {t(
              isCopied
                ? "defectManagementPage.sprintReport.statusCard.copyHtmlButtonCopied"
                : "defectManagementPage.sprintReport.statusCard.copyHtmlButton",
            )}
          </Button>

          <Button
            appearance="secondary"
            icon={<BookQuestionMarkRegular />}
            disabled={isExportingLegend}
            onClick={handleExportKpiLegend}
          >
            {isExportingLegend
              ? t("planOverviewPage.exporting")
              : t(
                  "defectManagementPage.sprintReport.statusCard.kpiLegend.downloadButton",
                )}
          </Button>

          <Switch
            checked={showOriginBreakdown}
            onChange={(_, data) => setShowOriginBreakdown(data.checked)}
            label={t(
              "defectManagementPage.sprintReport.statusCard.originBreakdown.toggleLabel",
            )}
          />
        </div>
      </ChartCard>
    </>
  );
}
