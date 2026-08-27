import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import PptxGenJS from "pptxgenjs";
import type { Outcome, SprintDefectReport } from "../types";
import type { SuiteProgressGroup } from "../components/StatusReportCard";

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  // Revoking synchronously right after click() races the browser's actual
  // read of the blob for the download - for larger binary files (.xlsx in
  // particular) that race can truncate the saved file, which is exactly
  // what makes Office prompt to "repair" it on open. Deferring the revoke
  // gives the download a moment to actually start reading first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PDF_MARGIN = 14;
const PDF_MAX_Y = 297 - PDF_MARGIN;

function ensurePdfSpace(
  doc: jsPDF,
  currentY: number,
  neededHeight: number,
): number {
  if (currentY + neededHeight > PDF_MAX_Y) {
    doc.addPage();
    return 15;
  }

  return currentY;
}

// jspdf-autotable augments the doc instance with `lastAutoTable` at runtime
// without a typed declaration, hence the cast - centralized here so every
// "position the next block below the table I just drew" call reads the same.
function getLastAutoTableY(doc: jsPDF, offset: number): number {
  return (
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + offset
  );
}

// Severity is stored as e.g. "1 - Critical", so sorting by the leading rank
// number naturally orders Critical, High, Medium, ... to match the chart.
// Exported so StatusReportCard.tsx uses the same ranking as every export.
export function severityRank(raw: string): number {
  const match = /^(\d+)\s*-/.exec(raw);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

// Shared by every Status Card export (PDF, HTML, emailed PDF attachment) so
// they all name the file after the card's own title rather than a fixed
// generic string - e.g. "UAT Sprint 1 - Auto_16-07-2026.pdf".
export function buildStatusReportCardFilename(
  headerTitle: string,
  extension: string,
): string {
  return `${sanitizeFilenamePart(headerTitle)}_${formatDateDDMMYYYY(new Date())}.${extension}`;
}

export type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface StatusReportCardEmailData {
  headerTitle: string;
  headerSubtitle: string;
  suiteGroups: SuiteProgressGroup[];
  report: SprintDefectReport;
  alertText: string;
  actionsText: string;
  dashboardUrl?: string;
  // Off by default - see StatusReportCard.tsx's prop of the same name.
  showOriginBreakdown?: boolean;
  // On by default - see StatusReportCard.tsx's prop of the same name.
  includeDsiSource?: boolean;
}

const EMAIL_CARD_WIDTH = 900;

const EMAIL_STATUS_ORDER = [
  "Closed",
  "Da verificare",
  "In verifica",
  "In Progress",
  "New",
  "Reopened",
  "Not Applicable",
];
const EMAIL_STATUS_LABEL_KEYS: Record<string, string> = {
  Closed: "closed",
  "Da verificare": "daVerificare",
  "In verifica": "inVerifica",
  "In Progress": "inProgress",
  New: "new",
  Reopened: "reopened",
  "Not Applicable": "notApplicable",
};

const EMAIL_OUTCOME_ORDER: Outcome[] = [
  "Passed",
  "Failed",
  "Blocked",
  "Paused",
  "InProgress",
  "NotApplicable",
  "NotRun",
];

function outcomeCountLabel(
  t: TranslateFn,
  outcome: Outcome,
  count: number,
): string {
  const label = t(`outcome.${outcome}`);
  return `${count} ${label}`;
}

function statusCountLabel(
  t: TranslateFn,
  name: string,
  count: number,
  closedOutOfScopeCount = 0,
): string {
  const label = t(
    `defectManagementPage.sprintReport.statusCard.statusLabels.${EMAIL_STATUS_LABEL_KEYS[name]}`,
  );
  const suffix =
    name === "Closed" && closedOutOfScopeCount > 0
      ? t("defectManagementPage.sprintReport.statusCard.closedOutOfScopeNote", {
          count: closedOutOfScopeCount,
        })
      : "";
  return `${count} ${label}${suffix}`;
}

// "Bug da chiudere" KPI label - the out-of-scope note only shows up when
// there actually are open out-of-scope bugs (in practice rare, since
// out-of-scope bugs tend to get closed as soon as they're triaged - see
// computeBugStatusData's closedOutOfScopeCount comment), unlike the "Bug
// chiusi" tile's note which is basically always shown.
export function bugsToCloseLabel(
  t: TranslateFn,
  toCloseOutOfScopeCount: number,
): string {
  return toCloseOutOfScopeCount > 0
    ? t("defectManagementPage.sprintReport.statusCard.kpis.bugsToCloseRatio", {
        count: toCloseOutOfScopeCount,
      })
    : t("defectManagementPage.sprintReport.statusCard.kpis.bugsToClose");
}

function formatEmailTimestamp(date: Date): {
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

function emailSeverityLabel(raw: string): string {
  const match = /^(\d+)\s*-\s*(.+)$/.exec(raw);
  return match ? match[2] : raw;
}

// Applied per-line (an Action box can hold several independently-labeled
// lines, e.g. "Test Management:"/"DSI:"/"System Integrator:" all in the
// same Azione 2 box - see buildDefaultActionText2 in SprintDefectReportTab.tsx),
// mirroring StatusReportCard.tsx's splitActionLeadIn.
function splitEmailActionLeadIn(line: string): {
  lead: string | null;
  rest: string;
} {
  const match = /^([^:\n]{1,80}:)\s*([\s\S]*)$/.exec(line);

  if (!match) {
    return { lead: null, rest: line };
  }

  return { lead: match[1], rest: match[2] };
}

const EMAIL_FONT_FAMILY = "'Segoe UI', Arial, sans-serif";

// The emailed HTML card uses a light palette - NOT the same EMAIL_* dark
// constants above, which are still shared with the on-screen card. These
// values aren't invented: they're the light-mode originals the reference
// email itself carried in Outlook's data-ogsb/data-ogsc attributes (what
// OWA reverts to when its dark-mode auto-conversion is switched off), so
// this matches the template's actual intended look.
const LIGHT_PAGE_BG = "#f4f5f7";
const LIGHT_CARD_BG = "#ffffff";
const LIGHT_RULE = "#e3e7ee";
const LIGHT_INK = "#262626";
const LIGHT_INK_MUTED = "#5a6a85";
const LIGHT_HEADER_BG = "#1f3864";
// Sits on the dark LIGHT_HEADER_BG bar (subtitle + "Aggiornato" timestamp),
// unlike every other *_SUB/_MUTED color here which sits on a light card
// background - so it needs a light tint, not LIGHT_INK_MUTED's dark one.
const LIGHT_HEADER_SUB = "#c3c9d9";
const LIGHT_ALERT_BG = "#fdecea";
const LIGHT_ALERT_BORDER = "#c62828";
const LIGHT_ALERT_TEXT = "#7a1f1f";
const LIGHT_BUTTON_BG = "#1f3864";
const LIGHT_STILL_OPEN = "#c62828";
const LIGHT_KPI = [
  { bg: "#f4f6fa", accent: "#1f3864" },
  { bg: "#f1f8f2", accent: "#2e7d32" },
  { bg: "#fdf6e7", accent: "#b45309" },
  { bg: "#fdecea", accent: "#c62828" },
  { bg: "#eef7f6", accent: "#0e7c72" },
  { bg: "#eef0fa", accent: "#3730a3" },
  { bg: "#f6effa", accent: "#6b3fa0" },
  { bg: "#f3f4f6", accent: "#4b5563" },
  { bg: "#eceef0", accent: "#78716c" },
  { bg: "#eef1f2", accent: "#5f6b7a" },
];
const LIGHT_ACTION_PALETTE = [
  { bg: "#fff8e6", border: "#f0a500" },
  { bg: "#eef3fb", border: "#1f3864" },
];

// PPT-only richer variants of LIGHT_KPI/LIGHT_ACTION_PALETTE - the near-white
// email/PDF tints read as too flat once printed on an actual slide, so the
// PPT export uses more saturated backgrounds plus a matching outline instead.
const PPTX_KPI = [
  { bg: "#dbe6f6", accent: "#1f3864" },
  { bg: "#daf0dd", accent: "#2e7d32" },
  { bg: "#fbe7bf", accent: "#b45309" },
  { bg: "#fad9d5", accent: "#c62828" },
  { bg: "#d2ece8", accent: "#0e7c72" },
  { bg: "#dcdff6", accent: "#3730a3" },
  { bg: "#e9d9f2", accent: "#6b3fa0" },
  { bg: "#e2e4e8", accent: "#4b5563" },
  { bg: "#e5e3e0", accent: "#78716c" },
  { bg: "#d9dee3", accent: "#5f6b7a" },
];
const PPTX_ACTION_PALETTE = [
  { bg: "#fceeba", border: "#f0a500" },
  { bg: "#d7e2f4", border: "#1f3864" },
];
const LIGHT_OUTCOME_COLORS: Record<Outcome, string> = {
  Passed: "#2e7d32",
  Failed: "#e53935",
  Blocked: "#f0a500",
  Paused: "#8e5cd9",
  InProgress: "#1565c0",
  NotApplicable: "#9e9e9e",
  NotRun: "#d9dee7",
};
const LIGHT_STATUS_COLORS: Record<string, string> = {
  Closed: "#2e7d32",
  "Da verificare": "#1565c0",
  "In verifica": "#0099a8",
  "In Progress": "#f0a500",
  New: "#e53935",
  Reopened: "#ad1457",
  "Not Applicable": "#9e9e9e",
};
const LIGHT_SEVERITY_PALETTE = [
  { bg: "#fdecea", border: "#f0c7c3", text: "#7a1f1f" },
  { bg: "#fff8e6", border: "#efd9a5", text: "#7a5308" },
  { bg: "#eef3fb", border: "#c6d4ea", text: "#1f3864" },
];
const LIGHT_SEVERITY_FALLBACK = {
  bg: LIGHT_PAGE_BG,
  border: LIGHT_RULE,
  text: LIGHT_INK_MUTED,
};

// The three severities this card always shows a chip for, even when a
// severity has zero bugs - mirrors SEVERITY_KEYS in StatusReportCard.tsx.
const EMAIL_SEVERITY_KEYS = ["1 - Critical", "2 - High", "3 - Medium"];

function lightExecutedColor(pct: number): string {
  if (pct >= 90) {
    return LIGHT_OUTCOME_COLORS.Passed;
  }

  if (pct < 30) {
    return LIGHT_STILL_OPEN;
  }

  return LIGHT_KPI[2].accent;
}

function lightKpiTile(
  value: string,
  kpiIndex: number,
  label: string,
  widthPct = "16.66%",
): string {
  const { bg, accent } = LIGHT_KPI[kpiIndex];

  return (
    `<td width="${widthPct}" style="padding:4px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background-color:${bg};border-radius:6px;border-top:3px solid ${accent};">` +
    // Fixed height (rather than content-sized) so a tile with a
    // one-line label - like the standalone 2nd-row "total bugs" tile -
    // still matches row 1's height, which is set by its tallest label
    // (avgClosureTime wraps to 2 lines).
    `<tr><td align="center" height="64" style="padding:10px 4px;font-family:${EMAIL_FONT_FAMILY};">` +
    `<div style="font-size:20px;font-weight:700;color:${accent};line-height:1.2;">${escapeHtml(value)}</div>` +
    `<div style="font-size:10px;letter-spacing:0.02em;text-transform:uppercase;color:${LIGHT_INK_MUTED};margin-top:2px;">${escapeHtml(label)}</div>` +
    `</td></tr></table></td>`
  );
}

// Renders a horizontal stacked bar as a single-row table, one <td> per
// segment sized by width % - the same "colored table cells" trick the
// reference OWA email itself uses, since flexbox/grid segments (as used by
// the live SuiteProgressBar/StatusReportCard components) aren't supported by
// Outlook's Word rendering engine.
function lightProgressTrack(
  segments: { color: string; pct: number }[],
  heightPx: number,
): string {
  const cells = segments
    .filter((segment) => segment.pct > 0)
    .map(
      (segment) =>
        `<td width="${segment.pct}%" bgcolor="${segment.color}" style="background-color:${segment.color};font-size:1px;line-height:${heightPx}px;">&nbsp;</td>`,
    )
    .join("");

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT_RULE}" style="background-color:${LIGHT_RULE};border-radius:${heightPx / 2}px;">` +
    `<tr>${cells}</tr></table>`
  );
}

// A plain colored glyph rather than a `display:inline-block` sized box:
// Outlook's forward/reply path re-renders HTML through its Word engine,
// which doesn't support inline-block sizing - the box collapses and the
// legend item it's attached to drops onto its own line (this is what was
// happening to the "N Passed | N Failed | ..." legend once forwarded). A
// character sized only via font-size/color has no layout box to break on.
function lightSwatch(color: string): string {
  return `<span style="color:${color};font-size:14px;line-height:1;">■</span> `;
}

function lightSuiteRow(group: SuiteProgressGroup, t: TranslateFn): string {
  const { totalTestCases, outcomeCounts, label } = group;
  // Counts NotApplicable as executed - see the comment on totalExecuted
  // in StatusReportCard.tsx for why this differs from that KPI.
  const executed = totalTestCases - outcomeCounts.NotRun;
  const executedPct = totalTestCases
    ? Math.round((executed / totalTestCases) * 100)
    : 0;
  const decided = totalTestCases - outcomeCounts.NotApplicable;
  const passRate = decided
    ? Math.round((outcomeCounts.Passed / decided) * 100)
    : 0;

  const legendEntries = EMAIL_OUTCOME_ORDER.filter(
    (outcome) => outcomeCounts[outcome] > 0,
  );
  const segments = legendEntries.map((outcome) => ({
    color: LIGHT_OUTCOME_COLORS[outcome],
    pct: totalTestCases ? (outcomeCounts[outcome] / totalTestCases) * 100 : 0,
  }));

  const legendText = legendEntries
    .map(
      (outcome) =>
        lightSwatch(LIGHT_OUTCOME_COLORS[outcome]) +
        `${outcomeCounts[outcome]} ${escapeHtml(t(`outcome.${outcome}`))}`,
    )
    .join(`<span style="color:${LIGHT_RULE};"> | </span>`);

  return (
    `<div style="margin-top:12px;font-family:${EMAIL_FONT_FAMILY};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-weight:600;font-size:13px;color:${LIGHT_INK};" align="left">${escapeHtml(label)} – ${escapeHtml(t("defectManagementPage.sprintReport.statusCard.casesCount", { count: totalTestCases }))}</td>` +
    `<td style="font-size:12px;font-weight:700;color:${lightExecutedColor(executedPct)};white-space:nowrap;" align="right">${executedPct}% ${escapeHtml(t("defectManagementPage.sprintReport.statusCard.executed"))}</td>` +
    `</tr></table>` +
    `<div style="margin-top:4px;">${lightProgressTrack(segments, 9)}</div>` +
    `<div style="font-size:12px;color:${LIGHT_INK_MUTED};margin-top:4px;">${legendText}<span style="color:${LIGHT_RULE};"> | </span><strong style="color:${LIGHT_INK};">${escapeHtml(t("defectManagementPage.sprintReport.statusCard.passRate"))}: ${passRate}%</strong></div>` +
    `</div>`
  );
}

// Matches the server-side fallback bucket in computeDuplicateSuiteBySuite
// (defectData.ts) for a Test Agenti/Business bug whose linked test case
// couldn't be title-matched to a Test Factory suite - shown as its own
// callout instead of a suite name so it reads as "needs manual review"
// rather than an unlabeled/generic suite.
const UNMATCHED_SUITE_KEY = "Unspecified";

function suiteCaption(t: TranslateFn, suite: string): string {
  return suite === UNMATCHED_SUITE_KEY
    ? t(
        "defectManagementPage.sprintReport.statusCard.originBreakdown.unmatched",
      )
    : t(
        "defectManagementPage.sprintReport.statusCard.originBreakdown.bugsInSuite",
        { suite },
      );
}

function lightOriginTile(value: number, caption: string): string {
  const { bg, accent } = LIGHT_KPI[0];

  return (
    `<td width="33%" style="padding:3px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background-color:${bg};border-radius:6px;">` +
    `<tr><td align="center" style="padding:8px 4px;font-family:${EMAIL_FONT_FAMILY};">` +
    `<div style="font-size:16px;font-weight:700;color:${accent};">${value}</div>` +
    `<div style="font-size:9px;color:${LIGHT_INK_MUTED};margin-top:2px;">${escapeHtml(caption)}</div>` +
    `</td></tr></table></td>`
  );
}

// Renders an origin's suite-count tiles plus its detected/accepted totals as
// a bordered panel with a rotated side label. The rotation is plain CSS
// (writing-mode + transform) - it renders correctly when this file is opened
// in a browser (the intended flow, see buildStatusReportCardEmailDocument),
// but degrades to horizontal text if pasted into a client that strips it,
// which is an acceptable fallback rather than a broken layout.
function lightOriginPanel(
  label: string,
  tiles: { value: number; caption: string }[],
  labelBg: string,
  labelText: string,
): string {
  const rowsHtml: string[] = [];

  for (let i = 0; i < tiles.length; i += 3) {
    const rowTiles = tiles
      .slice(i, i + 3)
      .map((tile) => lightOriginTile(tile.value, tile.caption))
      .join("");
    rowsHtml.push(`<tr>${rowTiles}</tr>`);
  }

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LIGHT_RULE};border-radius:6px;margin-top:8px;"><tr>` +
    `<td width="24" bgcolor="${labelBg}" style="background-color:${labelBg};" valign="middle" align="center">` +
    `<div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;font-weight:700;color:${labelText};font-family:${EMAIL_FONT_FAMILY};padding:6px 0;white-space:nowrap;">${escapeHtml(label)}</div>` +
    `</td>` +
    `<td style="padding:8px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml.join("")}</table>` +
    `</td>` +
    `</tr></table>`
  );
}

// "Bulletproof" VML button: Outlook re-renders forwarded HTML through its
// Word engine, which doesn't support display:inline-block and (on a
// width-less table) let a filled <td> background-color bleed across the
// whole forwarded email instead of staying on the button. The mso branch
// draws a native VML shape - which Word's engine renders predictably on
// both first open and forward - while every other client falls through to
// the plain HTML <a> button below it. The mso conditional comments are
// inert (parsed as regular HTML comments) outside Outlook, so
// Gmail/webmail/etc. only ever see the <a> version. Centralized here (one
// definition) rather than inlined, since every card export that offers a
// dashboard link should get the same forward-safe markup.
function lightDashboardButton(dashboardUrl: string, label: string): string {
  return (
    `<div style="margin-top:14px;">` +
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(dashboardUrl)}" style="height:38px;v-text-anchor:middle;width:300px;" arcsize="16%" stroke="f" fillcolor="${LIGHT_BUTTON_BG}">` +
    `<w:anchorlock/>` +
    `<center style="color:#ffffff;font-family:${EMAIL_FONT_FAMILY};font-size:13px;font-weight:600;">${escapeHtml(label)}</center>` +
    `</v:roundrect>` +
    `<![endif]-->` +
    `<!--[if !mso]><!-->` +
    `<a href="${escapeHtml(dashboardUrl)}" target="_blank" rel="noreferrer" style="background-color:${LIGHT_BUTTON_BG};border-radius:6px;color:#ffffff;display:inline-block;font-family:${EMAIL_FONT_FAMILY};font-size:13px;font-weight:600;line-height:38px;text-align:center;text-decoration:none;padding:0 20px;">${escapeHtml(label)}</a>` +
    `<!--<![endif]-->` +
    `</div>`
  );
}

// Builds the sprint status card as genuine HTML tables with inline styles
// (rather than an html2canvas screenshot embedded via <img>, the previous
// approach), so it renders as crisp, selectable text/links in Outlook,
// Gmail, etc. Mirrors StatusReportCard.tsx's layout/math field-for-field so
// the emailed card and the on-screen preview stay visually consistent (the
// on-screen card is still fixed-dark by design; only this emailed copy uses
// the light palette).
export function buildStatusReportCardEmailBodyHtml(
  data: StatusReportCardEmailData,
  t: TranslateFn,
): string {
  const {
    headerTitle,
    headerSubtitle,
    suiteGroups,
    report,
    alertText,
    actionsText,
    dashboardUrl,
    showOriginBreakdown = false,
    includeDsiSource = true,
  } = data;

  const { datePart, timePart } = formatEmailTimestamp(new Date());

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
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const bugSources = [
    ...suiteGroups.map((group) => group.label),
    ...(includeDsiSource ? ["DSI"] : []),
  ].join(", ");

  const emailOriginPanelDefs = showOriginBreakdown
    ? [
        {
          origin: "Test Factory",
          labelKey: "defectManagementPage.sprintReport.origin.testFactory",
          bySuite: report.testFactoryBySuite,
          labelBg: "#eaf7ea",
          labelText: "#2e7d32",
        },
        {
          origin: "Test Agenti",
          labelKey: "defectManagementPage.sprintReport.origin.testAgenti",
          bySuite: report.testAgentiBySuite,
          labelBg: "#eef3fb",
          labelText: "#1f3864",
        },
        {
          origin: "Business",
          labelKey: "defectManagementPage.sprintReport.origin.business",
          bySuite: report.testBusinessBySuite,
          labelBg: "#fff8e6",
          labelText: "#7a5308",
        },
      ]
    : [];

  const originPanelsHtml = emailOriginPanelDefs
    .map((def) => {
      const suiteEntries = Object.entries(def.bySuite).sort(([a], [b]) =>
        a.localeCompare(b),
      );

      if (suiteEntries.length === 0) {
        return "";
      }

      return lightOriginPanel(
        t(def.labelKey),
        [
          ...suiteEntries.map(([suite, count]) => ({
            value: count,
            caption: suiteCaption(t, suite),
          })),
          {
            value: report.byOriginDetected[def.origin] ?? 0,
            caption: t(
              "defectManagementPage.sprintReport.statusCard.originBreakdown.detected",
            ),
          },
          {
            value: report.byOrigin[def.origin] ?? 0,
            caption: t(
              "defectManagementPage.sprintReport.statusCard.originBreakdown.accepted",
            ),
          },
        ],
        def.labelBg,
        def.labelText,
      );
    })
    .join("");

  const originBreakdownHtml = originPanelsHtml
    ? `<div style="font-size:14px;font-weight:600;color:${LIGHT_INK};margin-top:18px;font-family:${EMAIL_FONT_FAMILY};">${escapeHtml(t("defectManagementPage.sprintReport.statusCard.originBreakdown.title"))}</div>` +
      originPanelsHtml
    : "";

  const alertHtml = alertText
    ? `<tr><td style="padding:14px 20px 0 20px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT_ALERT_BG}" style="background-color:${LIGHT_ALERT_BG};border-radius:6px;">` +
      `<tr><td style="border-left:4px solid ${LIGHT_ALERT_BORDER};padding:10px 12px;font-size:13px;line-height:1.4;color:${LIGHT_ALERT_TEXT};font-family:${EMAIL_FONT_FAMILY};">⚠️ ${escapeHtml(alertText)}</td></tr>` +
      `</table></td></tr>`
    : "";

  const kpiSectionTitle = (label: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="padding:6px 4px 2px 4px;font-size:10px;font-weight:700;letter-spacing:0.08em;` +
    `text-transform:uppercase;color:${LIGHT_INK_MUTED};border-bottom:1px solid ${LIGHT_RULE};` +
    `font-family:${EMAIL_FONT_FAMILY};">${escapeHtml(label)}</td></tr></table>`;

  const kpiHtml =
    kpiSectionTitle(
      `🧪 ${t("defectManagementPage.sprintReport.statusCard.kpis.testCasesSection")}`,
    ) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;"><tr>` +
    lightKpiTile(
      String(totalTestCases),
      0,
      t("defectManagementPage.sprintReport.statusCard.kpis.totalTestCases"),
      "16.66%",
    ) +
    lightKpiTile(
      `${totalExecuted} (${executedPct}%)`,
      1,
      t("defectManagementPage.sprintReport.statusCard.kpis.executedCount"),
      "16.66%",
    ) +
    lightKpiTile(
      `${totalNotApplicable} (${notApplicableRate}%)`,
      5,
      t("defectManagementPage.sprintReport.statusCard.kpis.notApplicable"),
      "16.66%",
    ) +
    lightKpiTile(
      String(totalNotRun),
      2,
      t("defectManagementPage.sprintReport.statusCard.kpis.notRun"),
      "16.66%",
    ) +
    lightKpiTile(
      String(totalPassed),
      1,
      t("defectManagementPage.sprintReport.statusCard.kpis.totalPassed"),
      "16.66%",
    ) +
    lightKpiTile(
      `${passRate}%`,
      4,
      t("defectManagementPage.sprintReport.statusCard.kpis.passRate"),
      "16.66%",
    ) +
    `</tr></table>` +
    kpiSectionTitle(
      `🐛 ${t("defectManagementPage.sprintReport.statusCard.kpis.bugsSection")}`,
    ) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;"><tr>` +
    lightKpiTile(
      `${report.effectiveCount}/${report.total}`,
      6,
      t(
        "defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected",
      ),
      "25%",
    ) +
    lightKpiTile(
      String(report.outOfScopeCount),
      8,
      t(
        "defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected",
      ),
      "25%",
    ) +
    lightKpiTile(
      `${bugsClosed}/${report.total} (${bugsClosedPct}%)`,
      2,
      t("defectManagementPage.sprintReport.statusCard.kpis.bugsClosedRatio", {
        count: closedOutOfScopeCount,
      }),
      "25%",
    ) +
    lightKpiTile(
      `${bugsToClose}/${report.total} (${toClosePct}%)`,
      5,
      bugsToCloseLabel(t, toCloseOutOfScopeCount),
      "25%",
    ) +
    `</tr></table>` +
    (includeDsiSource
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>` +
        lightKpiTile(
          String(bugsByUs),
          4,
          t("defectManagementPage.sprintReport.statusCard.kpis.bugsByUs"),
          "50%",
        ) +
        lightKpiTile(
          String(bugsByDsi),
          0,
          t("defectManagementPage.sprintReport.statusCard.kpis.bugsByDsi"),
          "50%",
        ) +
        `</tr></table>`
      : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>` +
    lightKpiTile(
      String(openSeverityEntries[0][1]),
      3,
      t("defectManagementPage.sprintReport.statusCard.kpis.criticalBugs"),
      "25%",
    ) +
    lightKpiTile(
      `${report.reopenedCount} (${reopenedPct}%)`,
      4,
      t("defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs"),
      "25%",
    ) +
    lightKpiTile(
      t("defectManagementPage.stats.days", { value: avgClosureDays }),
      9,
      t("defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime"),
      "25%",
    ) +
    lightKpiTile(
      String(report.withoutResolutionDateCount),
      7,
      t(
        "defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate",
      ),
      "25%",
    ) +
    `</tr></table>`;

  const dashboardHtml = dashboardUrl
    ? lightDashboardButton(
        dashboardUrl,
        t("defectManagementPage.sprintReport.statusCard.openDashboard"),
      )
    : "";

  const actionsHtml = actionParagraphs.length
    ? `<div style="font-size:14px;font-weight:600;color:${LIGHT_INK};margin-top:18px;font-family:${EMAIL_FONT_FAMILY};">📌 ${escapeHtml(t("defectManagementPage.sprintReport.statusCard.actionsTitle"))}</div>` +
      actionParagraphs
        .map((paragraph, index) => {
          const palette =
            LIGHT_ACTION_PALETTE[index % LIGHT_ACTION_PALETTE.length];
          const linesHtml = paragraph
            .split("\n")
            .map((line) => {
              const { lead, rest } = splitEmailActionLeadIn(line);

              return (
                (lead ? `<strong>${escapeHtml(lead)}</strong> ` : "") +
                escapeHtml(rest)
              );
            })
            .join("<br>");

          return (
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.bg}" style="background-color:${palette.bg};border-radius:6px;margin-top:8px;">` +
            `<tr><td style="border-left:4px solid ${palette.border};padding:10px 12px;font-size:13px;line-height:1.4;color:${LIGHT_INK};font-family:${EMAIL_FONT_FAMILY};">` +
            `${linesHtml}</td></tr></table>`
          );
        })
        .join("")
    : "";

  const suiteProgressHtml =
    `<div style="font-size:14px;font-weight:600;color:${LIGHT_INK};margin-top:18px;font-family:${EMAIL_FONT_FAMILY};">📈 ${escapeHtml(t("defectManagementPage.sprintReport.statusCard.suiteProgressTitle"))}</div>` +
    (suiteGroups.length > 0
      ? suiteGroups.map((group) => lightSuiteRow(group, t)).join("")
      : `<div style="font-size:12px;color:${LIGHT_INK_MUTED};font-style:italic;margin-top:8px;font-family:${EMAIL_FONT_FAMILY};">${escapeHtml(t("defectManagementPage.sprintReport.statusCard.noPlanSelected"))}</div>`);

  const statusLegendHtml = statusEntries
    .map(
      ([name, count]) =>
        lightSwatch(LIGHT_STATUS_COLORS[name]) +
        escapeHtml(statusCountLabel(t, name, count, closedOutOfScopeCount)),
    )
    .join(`<span style="color:${LIGHT_RULE};"> | </span>`);

  const statusSegments = statusEntries.map(([name, count]) => ({
    color: LIGHT_STATUS_COLORS[name],
    pct: report.total ? (count / report.total) * 100 : 0,
  }));

  const lightSeverityRowHtml = (
    entries: readonly (readonly [string, number])[],
    total: number,
    caption: string,
  ): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr>` +
    entries
      .map(([raw, count]) => {
        const rank = severityRank(raw);
        const palette =
          LIGHT_SEVERITY_PALETTE[rank - 1] ?? LIGHT_SEVERITY_FALLBACK;
        const width = Math.floor(100 / entries.length);
        const percent = total ? Math.round((count / total) * 100) : 0;

        return (
          `<td width="${width}%" style="padding:3px;">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.bg}" style="background-color:${palette.bg};border:1px solid ${palette.border};border-radius:6px;">` +
          `<tr><td align="center" style="padding:8px 4px;font-family:${EMAIL_FONT_FAMILY};">` +
          `<div style="font-size:18px;font-weight:700;color:${palette.text};">${count}</div>` +
          `<div style="font-size:10px;color:${palette.text};opacity:0.85;">${percent}%</div>` +
          `<div style="font-size:11px;color:${palette.text};">${escapeHtml(emailSeverityLabel(raw))}</div>` +
          `</td></tr></table></td>`
        );
      })
      .join("") +
    `</tr></table>` +
    `<div style="font-size:11px;color:${LIGHT_INK_MUTED};text-align:center;margin-top:4px;font-family:${EMAIL_FONT_FAMILY};">${escapeHtml(caption)}</div>`;

  const severityHtml =
    lightSeverityRowHtml(
      severityEntries,
      severityTotal,
      t("defectManagementPage.sprintReport.statusCard.severityCaption", {
        count: report.effectiveCount,
      }),
    ) +
    lightSeverityRowHtml(
      openSeverityEntries,
      openSeverityTotal,
      t("defectManagementPage.sprintReport.statusCard.openSeverityCaption", {
        count: openSeverityTotal,
      }),
    );

  const bugStatusHtml =
    `<div style="margin-top:18px;font-family:${EMAIL_FONT_FAMILY};">` +
    `<div style="font-size:14px;font-weight:600;color:${LIGHT_INK};">🐛 ${escapeHtml(t("defectManagementPage.sprintReport.statusCard.bugStatusTitle"))}</div>` +
    `<div style="font-size:11px;color:${LIGHT_INK_MUTED};margin-top:2px;">${escapeHtml(t("defectManagementPage.sprintReport.statusCard.bugStatusSubtitle", { sources: bugSources }))}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>` +
    `<td style="font-size:13px;color:${LIGHT_INK};" align="left"><strong>${escapeHtml(t("defectManagementPage.sprintReport.statusCard.bugsDetected", { count: report.total }))}</strong> – ${escapeHtml(t("defectManagementPage.sprintReport.statusCard.bugStatusSummary", { effective: report.effectiveCount, outOfScope: report.outOfScopeCount }))}</td>` +
    `<td style="font-size:13px;font-weight:700;color:${LIGHT_STILL_OPEN};white-space:nowrap;" align="right">${escapeHtml(t("defectManagementPage.sprintReport.statusCard.stillOpen", { count: stillOpen }))}</td>` +
    `</tr></table>` +
    `<div style="margin-top:6px;">${lightProgressTrack(statusSegments, 10)}</div>` +
    `<div style="font-size:12px;color:${LIGHT_INK_MUTED};margin-top:4px;">${statusLegendHtml}</div>` +
    severityHtml +
    `</div>`;

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT_PAGE_BG}" style="background-color:${LIGHT_PAGE_BG};padding:16px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="${EMAIL_CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT_CARD_BG}" style="width:${EMAIL_CARD_WIDTH}px;max-width:100%;background-color:${LIGHT_CARD_BG};border-radius:8px;color:${LIGHT_INK};border:1px solid ${LIGHT_RULE};">` +
    `<tr><td bgcolor="${LIGHT_HEADER_BG}" style="background-color:${LIGHT_HEADER_BG};padding:16px 20px;border-radius:7px 7px 0 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-size:17px;font-weight:700;color:#ffffff;font-family:${EMAIL_FONT_FAMILY};" align="left">${escapeHtml(headerTitle)}</td>` +
    `<td style="font-size:11px;color:${LIGHT_HEADER_SUB};white-space:nowrap;font-family:${EMAIL_FONT_FAMILY};" align="right">${escapeHtml(t("defectManagementPage.sprintReport.statusCard.updatedAt", { date: datePart, time: timePart }))}</td>` +
    `</tr><tr><td colspan="2" style="font-size:12px;color:${LIGHT_HEADER_SUB};padding-top:2px;font-family:${EMAIL_FONT_FAMILY};">${escapeHtml(headerSubtitle)}</td></tr>` +
    `</table></td></tr>` +
    alertHtml +
    `<tr><td style="padding:18px 20px;">` +
    kpiHtml +
    dashboardHtml +
    actionsHtml +
    suiteProgressHtml +
    bugStatusHtml +
    originBreakdownHtml +
    `</td></tr>` +
    `</table></td></tr></table>`
  );
}

// Renders an optional free-text note the sender can add above or below the
// status card (e.g. "Hi team, see below for this week's update", or a
// closing signature) - kept as its own fragment, separate from the card
// table itself, so it only ever appears in the emailed message and never
// leaks into the PDF/PPTX/HTML exports of the card. Blank-line-separated
// paragraphs, single newlines become <br/> - mirrors how actionsText is
// split elsewhere in this file.
export function buildEmailPrefaceHtml(prefaceText: string): string {
  const paragraphs = prefaceText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  const paragraphsHtml = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 10px 0;">${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LIGHT_PAGE_BG}" style="background-color:${LIGHT_PAGE_BG};padding:16px 0 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="${EMAIL_CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_CARD_WIDTH}px;max-width:100%;">` +
    `<tr><td style="font-size:13px;line-height:1.5;color:${LIGHT_INK};font-family:${EMAIL_FONT_FAMILY};">${paragraphsHtml}</td></tr>` +
    `</table></td></tr></table>`
  );
}

// Wraps the fragment as a standalone document so it opens/renders correctly
// on its own (fonts, background) when the downloaded file is opened directly
// in a browser - the intended flow is: open the file, select-all, copy, then
// paste into the email client's rich-text compose box, which carries the
// table markup/inline styles over as real HTML rather than plain text.
//
// The color-scheme/supported-color-schemes meta pair is what actually keeps
// this light-palette card light once it lands in an inbox: Gmail and
// Outlook.com both auto-recolor HTML email that doesn't declare a scheme,
// repainting the near-white backgrounds/dark text here as if they were
// unstyled - inline bgcolor/style alone (all this markup had before) doesn't
// stop that. Declaring "light" opts the whole message out of that
// auto-darkening. This must wrap whatever HTML actually gets sent/saved, not
// just the in-app preview - buildStatusReportCardEmailBodyHtml's return value
// is a bare <table> fragment with no <head> of its own to carry these tags.
export function buildStatusReportCardEmailDocument(bodyHtml: string): string {
  return (
    `<!doctype html>` +
    `<html><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<meta name="color-scheme" content="light" />` +
    `<meta name="supported-color-schemes" content="light" />` +
    `<title>Sprint Status Card</title></head>` +
    `<body style="margin:0;padding:0;">${bodyHtml}</body></html>`
  );
}

function pdfProgressTrack(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  segments: { color: string; pct: number }[],
): void {
  doc.setFillColor(LIGHT_RULE);
  doc.roundedRect(x, y, width, height, height / 2, height / 2, "F");

  let cursor = x;

  for (const segment of segments) {
    const segmentWidth = (segment.pct / 100) * width;

    if (segmentWidth <= 0) {
      continue;
    }

    doc.setFillColor(segment.color);
    doc.rect(cursor, y, segmentWidth, height, "F");
    cursor += segmentWidth;
  }
}

function pdfSeverityChipsRow(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  entries: readonly (readonly [string, number])[],
  total: number,
  caption: string,
): number {
  const gap = 3;
  const chipWidth = (width - gap * (entries.length - 1)) / entries.length;
  const chipHeight = 18;

  entries.forEach(([raw, count], index) => {
    const rank = severityRank(raw);
    const palette = LIGHT_SEVERITY_PALETTE[rank - 1] ?? LIGHT_SEVERITY_FALLBACK;
    const percent = total ? Math.round((count / total) * 100) : 0;
    const chipX = x + index * (chipWidth + gap);

    doc.setFillColor(palette.bg);
    doc.setDrawColor(palette.border);
    doc.roundedRect(chipX, y, chipWidth, chipHeight, 1.5, 1.5, "FD");

    doc.setTextColor(palette.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(String(count), chipX + chipWidth / 2, y + 7, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`${percent}%`, chipX + chipWidth / 2, y + 11.5, {
      align: "center",
    });
    doc.text(emailSeverityLabel(raw), chipX + chipWidth / 2, y + 15.5, {
      align: "center",
    });
  });

  const rowBottom = y + chipHeight + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(LIGHT_INK_MUTED);
  doc.text(caption, x + width / 2, rowBottom, { align: "center" });

  return rowBottom + 6;
}

export interface StatusCardKpis {
  totalTestCases: number;
  totalPassed: number;
  totalNotApplicable: number;
  totalDecided: number;
  totalExecuted: number;
  executedPct: number;
  totalNotRun: number;
  passRate: number;
  notApplicableRate: number;
  bugsClosed: number;
  bugsClosedPct: number;
  bugsToClose: number;
  toClosePct: number;
  toCloseOutOfScopeCount: number;
  stillOpen: number;
  reopenedPct: number;
  avgClosureDays: number;
  bugsByDsi: number;
  bugsByUs: number;
  criticalCount: number;
}

// Shared by the on-screen card, PDF/PPTX exports, and email body so all four
// renderings never drift apart on how a rate/percentage is derived from the
// raw report.
export function computeStatusCardKpis(
  suiteGroups: SuiteProgressGroup[],
  report: SprintDefectReport,
): StatusCardKpis {
  const totalTestCases = suiteGroups.reduce(
    (sum, group) => sum + group.totalTestCases,
    0,
  );
  const totalPassed = suiteGroups.reduce(
    (sum, group) => sum + group.outcomeCounts.Passed,
    0,
  );
  const totalNotApplicable = suiteGroups.reduce(
    (sum, group) => sum + group.outcomeCounts.NotApplicable,
    0,
  );
  const totalDecided = totalTestCases - totalNotApplicable;
  const passRate = totalDecided
    ? Math.round((totalPassed / totalDecided) * 100)
    : 0;
  const notApplicableRate = totalTestCases
    ? Math.round((totalNotApplicable / totalTestCases) * 100)
    : 0;

  const totalFailed = suiteGroups.reduce(
    (sum, group) => sum + group.outcomeCounts.Failed,
    0,
  );
  const totalBlocked = suiteGroups.reduce(
    (sum, group) => sum + group.outcomeCounts.Blocked,
    0,
  );
  // Excludes NotApplicable on purpose - see the matching comment on
  // totalExecuted in StatusReportCard.tsx for why, and for the different
  // (more inclusive) definition SuiteProgressBar uses.
  const totalExecuted = totalPassed + totalFailed + totalBlocked;
  const executedPct = totalTestCases
    ? Math.round((totalExecuted / totalTestCases) * 100)
    : 0;
  const totalNotRun = totalTestCases - totalExecuted - totalNotApplicable;

  const bugsClosed = report.byStatusAll.Closed ?? 0;
  const bugsClosedPct = report.total
    ? Math.round((bugsClosed / report.total) * 100)
    : 0;
  const bugsToClose = report.total - bugsClosed;
  const toClosePct = report.total
    ? Math.round((bugsToClose / report.total) * 100)
    : 0;
  // Out-of-scope bugs still open - mirrors computeBugStatusData's
  // closedOutOfScopeCount (total out-of-scope minus the closed subset),
  // just for the not-yet-closed side instead.
  const closedOutOfScope = bugsClosed - (report.byStatus.Closed ?? 0);
  const toCloseOutOfScopeCount = report.outOfScopeCount - closedOutOfScope;
  // Effective (in-scope) bugs only, not report.total - byStatusAll.Closed -
  // so this matches computeBugStatusData's openSeverityTotal exactly (the
  // severity chips right below it on the card only ever break down
  // effective bugs, never out-of-scope ones), rather than showing two
  // different "still open" numbers on the same card.
  const stillOpen = report.effectiveCount - (report.byStatus.Closed ?? 0);
  const reopenedPct = report.total
    ? Math.round((report.reopenedCount / report.total) * 1000) / 10
    : 0;
  const avgClosureDays = Math.round(report.mttrDays ?? 0);
  const bugsByDsi = report.byOriginDetected["DSI"] ?? 0;
  const bugsByUs = report.total - bugsByDsi;

  // Only non-closed bugs count here - a closed critical bug isn't
  // something the reader still needs to act on. Mirrors
  // StatusReportCard.tsx's criticalCount so the live card, PDF, PPTX and
  // email export never drift apart on this number.
  const criticalCount = report.effectiveDefects.filter(
    (bug) => bug.state !== "Closed" && severityRank(bug.severity ?? "") === 1,
  ).length;

  return {
    totalTestCases,
    totalPassed,
    totalNotApplicable,
    totalDecided,
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
  };
}

export interface BugStatusData {
  statusEntries: (readonly [string, number])[];
  statusSegments: { color: string; pct: number }[];
  // Closed bugs that are also out-of-scope - byStatusAll.Closed includes
  // them but byStatus.Closed (effective-only) doesn't, so this is exactly
  // that gap. Folded into the Closed legend entry as a "(of which N out
  // of scope)" suffix rather than kept as its own "Not Applicable"
  // segment, since that segment only ever showed this same subset in
  // practice (out-of-scope bugs are closed once triaged).
  closedOutOfScopeCount: number;
  severityTotal: number;
  severityEntries: (readonly [string, number])[];
  openSeverityTotal: number;
  openSeverityEntries: (readonly [string, number])[];
}

// Shared by the PDF, PPTX, and email bug status sections, plus the on-screen
// card - all render the same status/severity breakdown, just with a
// different renderer underneath.
export function computeBugStatusData(
  report: SprintDefectReport,
): BugStatusData {
  const closedTotal = report.byStatusAll.Closed ?? 0;
  const closedEffective = report.byStatus.Closed ?? 0;
  const closedOutOfScopeCount = closedTotal - closedEffective;

  const statusEntries = EMAIL_STATUS_ORDER.filter(
    (name) => name !== "Not Applicable",
  )
    .map(
      (name) =>
        [
          name,
          name === "Closed" ? closedTotal : (report.byStatus[name] ?? 0),
        ] as const,
    )
    .filter(([, count]) => count > 0);
  const statusSegments = statusEntries.map(([name, count]) => ({
    color: LIGHT_STATUS_COLORS[name],
    pct: report.total ? (count / report.total) * 100 : 0,
  }));

  const severityTotal = Object.values(report.bySeverity).reduce(
    (sum, count) => sum + count,
    0,
  );
  const severityEntries: (readonly [string, number])[] = [
    ...EMAIL_SEVERITY_KEYS.map(
      (key) => [key, report.bySeverity[key] ?? 0] as const,
    ),
    ...Object.entries(report.bySeverity)
      .filter(([key, count]) => !EMAIL_SEVERITY_KEYS.includes(key) && count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => [key, count] as const),
  ];

  const openSeverityCounts = report.effectiveDefects.reduce<
    Record<string, number>
  >((acc, bug) => {
    if (bug.state === "Closed") {
      return acc;
    }

    const key = bug.severity ?? "Unspecified";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const openSeverityTotal = Object.values(openSeverityCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const openSeverityEntries: (readonly [string, number])[] = [
    ...EMAIL_SEVERITY_KEYS.map(
      (key) => [key, openSeverityCounts[key] ?? 0] as const,
    ),
    ...Object.entries(openSeverityCounts)
      .filter(([key, count]) => !EMAIL_SEVERITY_KEYS.includes(key) && count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => [key, count] as const),
  ];

  return {
    statusEntries,
    statusSegments,
    closedOutOfScopeCount,
    severityTotal,
    severityEntries,
    openSeverityTotal,
    openSeverityEntries,
  };
}

interface SuiteProgressRowData {
  executedPct: number;
  groupPassRate: number;
  segments: { color: string; pct: number }[];
  legendEntries: Outcome[];
}

// Shared by the PDF and PPTX suite-progress rows - both render the same
// executed/pass-rate figures, just with a different renderer underneath.
function computeSuiteProgressRowData(
  group: SuiteProgressGroup,
): SuiteProgressRowData {
  // Counts NotApplicable as executed - see the comment on totalExecuted
  // in StatusReportCard.tsx for why this differs from that KPI.
  const executed = group.totalTestCases - group.outcomeCounts.NotRun;
  const executedPct = group.totalTestCases
    ? Math.round((executed / group.totalTestCases) * 100)
    : 0;
  const decided = group.totalTestCases - group.outcomeCounts.NotApplicable;
  const groupPassRate = decided
    ? Math.round((group.outcomeCounts.Passed / decided) * 100)
    : 0;

  const legendEntries = EMAIL_OUTCOME_ORDER.filter(
    (outcome) => group.outcomeCounts[outcome] > 0,
  );
  const segments = legendEntries.map((outcome) => ({
    color: LIGHT_OUTCOME_COLORS[outcome],
    pct: group.totalTestCases
      ? (group.outcomeCounts[outcome] / group.totalTestCases) * 100
      : 0,
  }));

  return { executedPct, groupPassRate, segments, legendEntries };
}

interface PdfDrawCtx {
  doc: jsPDF;
  pageWidth: number;
  innerWidth: number;
  t: TranslateFn;
}

function pdfDrawAlertBanner(
  ctx: PdfDrawCtx,
  y: number,
  alertText: string,
): number {
  if (!alertText) {
    return y;
  }

  const { doc, innerWidth } = ctx;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(alertText, innerWidth - 10);
  const boxHeight = lines.length * 5 + 6;
  const boxY = ensurePdfSpace(doc, y, boxHeight + 8);

  doc.setFillColor(LIGHT_ALERT_BG);
  doc.rect(PDF_MARGIN, boxY, innerWidth, boxHeight, "F");
  doc.setFillColor(LIGHT_ALERT_BORDER);
  doc.rect(PDF_MARGIN, boxY, 1.2, boxHeight, "F");
  doc.setTextColor(LIGHT_ALERT_TEXT);
  doc.text(lines, PDF_MARGIN + 6, boxY + 5);

  return boxY + boxHeight + 8;
}

function buildPdfBugRow1KpiDefs(
  kpis: StatusCardKpis,
  report: SprintDefectReport,
  closedOutOfScopeCount: number,
  t: TranslateFn,
): { kpi: (typeof LIGHT_KPI)[number]; label: string; value: string }[] {
  return [
    {
      kpi: LIGHT_KPI[6],
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected",
      ),
      value: `${report.effectiveCount}/${report.total}`,
    },
    {
      kpi: LIGHT_KPI[8],
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected",
      ),
      value: String(report.outOfScopeCount),
    },
    {
      kpi: LIGHT_KPI[2],
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.bugsClosedRatio",
        {
          count: closedOutOfScopeCount,
        },
      ),
      value: `${kpis.bugsClosed}/${report.total} (${kpis.bugsClosedPct}%)`,
    },
    {
      kpi: LIGHT_KPI[5],
      label: bugsToCloseLabel(t, kpis.toCloseOutOfScopeCount),
      value: `${kpis.bugsToClose}/${report.total} (${kpis.toClosePct}%)`,
    },
  ];
}

function buildPdfBugRow2KpiDefs(
  kpis: StatusCardKpis,
  report: SprintDefectReport,
  t: TranslateFn,
): { kpi: (typeof LIGHT_KPI)[number]; label: string; value: string }[] {
  return [
    {
      kpi: LIGHT_KPI[3],
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.criticalBugs",
      ),
      value: String(kpis.criticalCount),
    },
    {
      kpi: LIGHT_KPI[4],
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs",
      ),
      value: `${report.reopenedCount} (${kpis.reopenedPct}%)`,
    },
    {
      kpi: LIGHT_KPI[9],
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime",
      ),
      value: t("defectManagementPage.stats.days", {
        value: kpis.avgClosureDays,
      }),
    },
    {
      kpi: LIGHT_KPI[7],
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate",
      ),
      value: String(report.withoutResolutionDateCount),
    },
  ];
}

function pdfDrawDashboardButton(
  ctx: PdfDrawCtx,
  y: number,
  dashboardUrl: string | undefined,
): number {
  if (!dashboardUrl) {
    return y;
  }

  const { doc, pageWidth, innerWidth, t } = ctx;
  const buttonY = ensurePdfSpace(doc, y, 14);
  const label = t("defectManagementPage.sprintReport.statusCard.openDashboard");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);

  const buttonHeight = 9;

  doc.setFillColor(LIGHT_BUTTON_BG);
  doc.roundedRect(PDF_MARGIN, buttonY, innerWidth, buttonHeight, 2, 2, "F");
  doc.setTextColor("#ffffff");
  doc.text(label, pageWidth / 2, buttonY + buttonHeight / 2 + 1.2, {
    align: "center",
  });
  doc.link(PDF_MARGIN, buttonY, innerWidth, buttonHeight, {
    url: dashboardUrl,
  });

  return buttonY + buttonHeight + 8;
}

function pdfDrawActionsSection(
  ctx: PdfDrawCtx,
  y: number,
  actionsText: string,
): number {
  const actionParagraphs = actionsText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (actionParagraphs.length === 0) {
    return y;
  }

  const { doc, innerWidth, t } = ctx;
  let cursorY = ensurePdfSpace(doc, y, 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(LIGHT_INK);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.actionsTitle"),
    PDF_MARGIN,
    cursorY,
  );
  cursorY += 6;

  for (const [index, paragraph] of actionParagraphs.entries()) {
    const palette = LIGHT_ACTION_PALETTE[index % LIGHT_ACTION_PALETTE.length];
    const { lead, rest } = splitEmailActionLeadIn(paragraph);
    const bodyText = lead ? `${lead} ${rest}` : rest;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(bodyText, innerWidth - 10);
    const boxHeight = lines.length * 4.5 + 5;

    cursorY = ensurePdfSpace(doc, cursorY, boxHeight + 4);

    doc.setFillColor(palette.bg);
    doc.rect(PDF_MARGIN, cursorY, innerWidth, boxHeight, "F");
    doc.setFillColor(palette.border);
    doc.rect(PDF_MARGIN, cursorY, 1.2, boxHeight, "F");
    doc.setTextColor(LIGHT_INK);
    doc.text(lines, PDF_MARGIN + 6, cursorY + 4.5);

    cursorY += boxHeight + 4;
  }

  return cursorY + 4;
}

function pdfDrawSuiteProgressRow(
  ctx: PdfDrawCtx,
  y: number,
  group: SuiteProgressGroup,
): number {
  const { doc, pageWidth, innerWidth, t } = ctx;
  const { executedPct, groupPassRate, segments, legendEntries } =
    computeSuiteProgressRowData(group);
  const legendText = legendEntries
    .map((outcome) =>
      outcomeCountLabel(t, outcome, group.outcomeCounts[outcome]),
    )
    .join("   |   ");

  let cursorY = ensurePdfSpace(doc, y, 18);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(LIGHT_INK);
  doc.text(
    `${group.label} – ${t(
      "defectManagementPage.sprintReport.statusCard.casesCount",
      {
        count: group.totalTestCases,
      },
    )}`,
    PDF_MARGIN,
    cursorY,
  );
  doc.text(
    `${executedPct}% ${t("defectManagementPage.sprintReport.statusCard.executed")}`,
    pageWidth - PDF_MARGIN,
    cursorY,
    { align: "right" },
  );
  cursorY += 3;

  pdfProgressTrack(doc, PDF_MARGIN, cursorY, innerWidth, 3, segments);
  cursorY += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(LIGHT_INK_MUTED);
  doc.text(
    `${legendText}   |   ${t("defectManagementPage.sprintReport.statusCard.passRate")}: ${groupPassRate}%`,
    PDF_MARGIN,
    cursorY,
  );
  cursorY += 8;

  return cursorY;
}

function pdfDrawSuiteProgressSection(
  ctx: PdfDrawCtx,
  y: number,
  suiteGroups: SuiteProgressGroup[],
): number {
  const { doc, t } = ctx;
  let cursorY = ensurePdfSpace(doc, y, 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(LIGHT_INK);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.suiteProgressTitle"),
    PDF_MARGIN,
    cursorY,
  );
  cursorY += 6;

  if (suiteGroups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(LIGHT_INK_MUTED);
    doc.text(
      t("defectManagementPage.sprintReport.statusCard.noPlanSelected"),
      PDF_MARGIN,
      cursorY,
    );
    return cursorY + 6;
  }

  for (const group of suiteGroups) {
    cursorY = pdfDrawSuiteProgressRow(ctx, cursorY, group);
  }

  return cursorY;
}

function pdfDrawBugStatusSection(
  ctx: PdfDrawCtx,
  y: number,
  report: SprintDefectReport,
  kpis: StatusCardKpis,
  suiteGroups: SuiteProgressGroup[],
  includeDsiSource: boolean,
): number {
  const { doc, pageWidth, innerWidth, t } = ctx;
  const {
    statusEntries,
    statusSegments,
    closedOutOfScopeCount,
    severityTotal,
    severityEntries,
    openSeverityTotal,
    openSeverityEntries,
  } = computeBugStatusData(report);

  let cursorY = ensurePdfSpace(doc, y, 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(LIGHT_INK);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.bugStatusTitle"),
    PDF_MARGIN,
    cursorY,
  );
  cursorY += 5;

  const bugSources = [
    ...suiteGroups.map((group) => group.label),
    ...(includeDsiSource ? ["DSI"] : []),
  ].join(", ");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(LIGHT_INK_MUTED);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.bugStatusSubtitle", {
      sources: bugSources,
    }),
    PDF_MARGIN,
    cursorY,
  );
  cursorY += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(LIGHT_INK);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.bugsDetected", {
      count: report.total,
    }),
    PDF_MARGIN,
    cursorY,
  );
  doc.setFont("helvetica", "normal");
  doc.text(
    ` – ${t("defectManagementPage.sprintReport.statusCard.bugStatusSummary", {
      effective: report.effectiveCount,
      outOfScope: report.outOfScopeCount,
    })}`,
    PDF_MARGIN +
      doc.getTextWidth(
        t("defectManagementPage.sprintReport.statusCard.bugsDetected", {
          count: report.total,
        }),
      ),
    cursorY,
  );
  doc.setFont("helvetica", "bold");
  doc.setTextColor(LIGHT_STILL_OPEN);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.stillOpen", {
      count: kpis.stillOpen,
    }),
    pageWidth - PDF_MARGIN,
    cursorY,
    { align: "right" },
  );
  cursorY += 4;

  pdfProgressTrack(doc, PDF_MARGIN, cursorY, innerWidth, 3.5, statusSegments);
  cursorY += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(LIGHT_INK_MUTED);
  doc.text(
    statusEntries
      .map(([name, count]) =>
        statusCountLabel(t, name, count, closedOutOfScopeCount),
      )
      .join("   |   "),
    PDF_MARGIN,
    cursorY,
  );
  cursorY += 6;

  cursorY = ensurePdfSpace(doc, cursorY, 24);
  cursorY = pdfSeverityChipsRow(
    doc,
    PDF_MARGIN,
    cursorY,
    innerWidth,
    severityEntries,
    severityTotal,
    t("defectManagementPage.sprintReport.statusCard.severityCaption", {
      count: report.effectiveCount,
    }),
  );

  cursorY = ensurePdfSpace(doc, cursorY, 24);
  cursorY = pdfSeverityChipsRow(
    doc,
    PDF_MARGIN,
    cursorY,
    innerWidth,
    openSeverityEntries,
    openSeverityTotal,
    t("defectManagementPage.sprintReport.statusCard.openSeverityCaption", {
      count: openSeverityTotal,
    }),
  );

  return cursorY;
}

function pdfDrawOriginBreakdownSection(
  ctx: PdfDrawCtx,
  y: number,
  report: SprintDefectReport,
  showOriginBreakdown: boolean,
): void {
  const { doc, t } = ctx;
  const { originDefs, originRowsData } = computeOriginBreakdown(
    report,
    showOriginBreakdown,
    t,
  );

  if (originDefs.length === 0) {
    return;
  }

  const titleY = ensurePdfSpace(doc, y, 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(LIGHT_INK);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.originBreakdown.title"),
    PDF_MARGIN,
    titleY,
  );

  autoTable(doc, {
    startY: titleY + 4,
    head: [["Origin", "Suite", "Count"]],
    body: originRowsData,
    styles: { fontSize: 8 },
    headStyles: { fillColor: LIGHT_HEADER_BG },
  });
}

// Real jsPDF text/tables (like every other report PDF in this file), not a
// screenshot of the on-screen card - so the exported text is selectable,
// copyable and searchable. Deliberately reuses the card's light palette
// (see buildStatusReportCardEmailBodyHtml) since a screen-accurate dark
// capture isn't the point here; a legible, quotable document is.
export function buildStatusReportCardPdfDocument(
  data: StatusReportCardEmailData,
  t: TranslateFn,
): jsPDF {
  const {
    headerTitle,
    headerSubtitle,
    suiteGroups,
    report,
    alertText,
    actionsText,
    dashboardUrl,
    showOriginBreakdown = false,
    includeDsiSource = true,
  } = data;

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const innerWidth = pageWidth - PDF_MARGIN * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(LIGHT_INK);
  doc.text(headerTitle, PDF_MARGIN, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(LIGHT_INK_MUTED);
  doc.text(headerSubtitle, PDF_MARGIN, 22);

  const { datePart, timePart } = formatEmailTimestamp(new Date());
  doc.setFontSize(8);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.updatedAt", {
      date: datePart,
      time: timePart,
    }),
    pageWidth - PDF_MARGIN,
    12,
    { align: "right" },
  );

  const ctx: PdfDrawCtx = { doc, pageWidth, innerWidth, t };

  let y = pdfDrawAlertBanner(ctx, 30, alertText);

  const kpis = computeStatusCardKpis(suiteGroups, report);
  const { closedOutOfScopeCount } = computeBugStatusData(report);

  y = ensurePdfSpace(doc, y, 24);

  // Section label: test cases
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(LIGHT_INK_MUTED);
  doc.text(
    t(
      "defectManagementPage.sprintReport.statusCard.kpis.testCasesSection",
    ).toUpperCase(),
    PDF_MARGIN,
    y + 3,
  );
  y += 6;

  const testKpiPalette = [
    LIGHT_KPI[0],
    LIGHT_KPI[1],
    LIGHT_KPI[5],
    LIGHT_KPI[2],
    LIGHT_KPI[1],
    LIGHT_KPI[4],
  ];

  autoTable(doc, {
    startY: y,
    theme: "plain",
    head: [
      [
        t("defectManagementPage.sprintReport.statusCard.kpis.totalTestCases"),
        t("defectManagementPage.sprintReport.statusCard.kpis.executedCount"),
        t("defectManagementPage.sprintReport.statusCard.kpis.notApplicable"),
        t("defectManagementPage.sprintReport.statusCard.kpis.notRun"),
        t("defectManagementPage.sprintReport.statusCard.kpis.totalPassed"),
        t("defectManagementPage.sprintReport.statusCard.kpis.passRate"),
      ],
    ],
    body: [
      [
        String(kpis.totalTestCases),
        `${kpis.totalExecuted} (${kpis.executedPct}%)`,
        `${kpis.totalNotApplicable} (${kpis.notApplicableRate}%)`,
        String(kpis.totalNotRun),
        String(kpis.totalPassed),
        `${kpis.passRate}%`,
      ],
    ],
    tableWidth: innerWidth,
    styles: {
      fontSize: 7,
      halign: "center",
      cellPadding: 2,
      textColor: LIGHT_INK_MUTED,
    },
    headStyles: { textColor: LIGHT_INK_MUTED, fontStyle: "normal" },
    bodyStyles: { fontSize: 12, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      testKpiPalette.map((kpi, index) => [
        index,
        { fillColor: kpi.bg, textColor: kpi.accent, cellWidth: innerWidth / 6 },
      ]),
    ),
    didParseCell: (hookData) => {
      if (hookData.section === "head") {
        hookData.cell.styles.fillColor =
          testKpiPalette[hookData.column.index].bg;
        hookData.cell.styles.textColor = LIGHT_INK_MUTED;
      }
    },
  });

  y =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 4;

  // Section label: bugs
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(LIGHT_INK_MUTED);
  doc.text(
    t(
      "defectManagementPage.sprintReport.statusCard.kpis.bugsSection",
    ).toUpperCase(),
    PDF_MARGIN,
    y + 3,
  );
  y += 6;

  const bugRow1Defs = buildPdfBugRow1KpiDefs(
    kpis,
    report,
    closedOutOfScopeCount,
    t,
  );

  autoTable(doc, {
    startY: y,
    theme: "plain",
    tableWidth: innerWidth,
    margin: { left: PDF_MARGIN },
    head: [bugRow1Defs.map((d) => d.label)],
    body: [bugRow1Defs.map((d) => d.value)],
    styles: {
      fontSize: 7,
      halign: "center",
      cellPadding: 2,
      textColor: LIGHT_INK_MUTED,
    },
    headStyles: { textColor: LIGHT_INK_MUTED, fontStyle: "normal" },
    bodyStyles: { fontSize: 12, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      bugRow1Defs.map((d, index) => [
        index,
        {
          fillColor: d.kpi.bg,
          textColor: d.kpi.accent,
          cellWidth: innerWidth / 4,
        },
      ]),
    ),
    didParseCell: (hookData) => {
      if (hookData.section === "head") {
        hookData.cell.styles.fillColor =
          bugRow1Defs[hookData.column.index].kpi.bg;
        hookData.cell.styles.textColor = LIGHT_INK_MUTED;
      }
    },
  });

  y =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 2;

  const bugRow2Defs = buildPdfBugRow2KpiDefs(kpis, report, t);

  autoTable(doc, {
    startY: y,
    theme: "plain",
    tableWidth: innerWidth,
    margin: { left: PDF_MARGIN },
    head: [bugRow2Defs.map((d) => d.label)],
    body: [bugRow2Defs.map((d) => d.value)],
    styles: {
      fontSize: 7,
      halign: "center",
      cellPadding: 2,
      textColor: LIGHT_INK_MUTED,
    },
    headStyles: { textColor: LIGHT_INK_MUTED, fontStyle: "normal" },
    bodyStyles: { fontSize: 12, fontStyle: "bold" },
    columnStyles: Object.fromEntries(
      bugRow2Defs.map((d, index) => [
        index,
        {
          fillColor: d.kpi.bg,
          textColor: d.kpi.accent,
          cellWidth: innerWidth / 4,
        },
      ]),
    ),
    didParseCell: (hookData) => {
      if (hookData.section === "head") {
        hookData.cell.styles.fillColor =
          bugRow2Defs[hookData.column.index].kpi.bg;
        hookData.cell.styles.textColor = LIGHT_INK_MUTED;
      }
    },
  });

  y =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 6;

  y = pdfDrawDashboardButton(ctx, y, dashboardUrl);
  y = pdfDrawActionsSection(ctx, y, actionsText);
  y = pdfDrawSuiteProgressSection(ctx, y, suiteGroups);
  y = pdfDrawBugStatusSection(
    ctx,
    y,
    report,
    kpis,
    suiteGroups,
    includeDsiSource,
  );
  pdfDrawOriginBreakdownSection(ctx, y, report, showOriginBreakdown);

  return doc;
}

export function exportStatusReportCardToPdf(
  filename: string,
  data: StatusReportCardEmailData,
  t: TranslateFn,
): void {
  const doc = buildStatusReportCardPdfDocument(data, t);
  doc.save(filename);
}

interface KpiLegendEntry {
  labelKey: string;
  helpKey: string;
}

// Same key sets/order as the "Casi di test"/"Stato bug" tile grids in
// StatusReportCard.tsx (KpiTile usages) and the kpis/kpisHelp translation
// objects, so this legend never lists a tile the live card doesn't have (or
// vice versa).
const KPI_LEGEND_TEST_CASES: KpiLegendEntry[] = [
  { labelKey: "totalTestCases", helpKey: "totalTestCases" },
  { labelKey: "executedCount", helpKey: "executedCount" },
  { labelKey: "notApplicable", helpKey: "notApplicable" },
  { labelKey: "notRun", helpKey: "notRun" },
  { labelKey: "totalPassed", helpKey: "totalPassed" },
  { labelKey: "passRate", helpKey: "passRate" },
];

const KPI_LEGEND_BUGS: KpiLegendEntry[] = [
  { labelKey: "effectiveBugsDetected", helpKey: "effectiveBugsDetected" },
  { labelKey: "outOfScopeBugsDetected", helpKey: "outOfScopeBugsDetected" },
  { labelKey: "bugsByUs", helpKey: "bugsByUs" },
  { labelKey: "bugsByDsi", helpKey: "bugsByDsi" },
  { labelKey: "bugsClosedRatio", helpKey: "bugsClosedRatio" },
  { labelKey: "bugsToClose", helpKey: "bugsToClose" },
  { labelKey: "criticalBugs", helpKey: "criticalBugs" },
  { labelKey: "reopenedBugs", helpKey: "reopenedBugs" },
  { labelKey: "avgClosureTime", helpKey: "avgClosureTime" },
  { labelKey: "withoutResolutionDate", helpKey: "withoutResolutionDate" },
];

function pdfDrawKpiLegendSection(
  doc: jsPDF,
  innerWidth: number,
  startY: number,
  sectionTitle: string,
  entries: KpiLegendEntry[],
  t: TranslateFn,
): number {
  let y = ensurePdfSpace(doc, startY, 20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(LIGHT_HEADER_BG);
  doc.text(sectionTitle, PDF_MARGIN, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [
      [
        t(
          "defectManagementPage.sprintReport.statusCard.kpiLegend.columnIndicator",
        ),
        t(
          "defectManagementPage.sprintReport.statusCard.kpiLegend.columnExplanation",
        ),
      ],
    ],
    body: entries.map((entry) => [
      // Some kpis.* labels carry a "\n(...)" line-wrap hint for the
      // narrow on-screen tile (e.g. bugsClosedCount) - not meaningful
      // in a table cell, so it's flattened to a single line here. Some
      // also carry a "({{count}} ...)" clause meant to be filled in
      // with a live report figure (e.g. bugsClosedRatio's out-of-scope
      // count) - this legend isn't tied to any report, so that clause
      // is dropped rather than left showing the raw placeholder.
      t(`defectManagementPage.sprintReport.statusCard.kpis.${entry.labelKey}`)
        .replace(/\n/g, " ")
        .replace(/\s*\([^)]*\{\{count\}\}[^)]*\)/g, ""),
      t(
        `defectManagementPage.sprintReport.statusCard.kpisHelp.${entry.helpKey}`,
      ),
    ]),
    tableWidth: innerWidth,
    margin: { left: PDF_MARGIN },
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: LIGHT_INK,
      valign: "top",
    },
    headStyles: {
      fillColor: LIGHT_HEADER_BG,
      textColor: "#ffffff",
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: innerWidth * 0.32, fontStyle: "bold" },
      1: { cellWidth: innerWidth * 0.68 },
    },
  });

  return getLastAutoTableY(doc, 8);
}

// A standalone "how do I read this card" one-pager - independent of any
// specific sprint's report data, so it can be generated once and shared
// alongside report sends without needing to regenerate it every sprint.
export function buildKpiLegendPdfDocument(t: TranslateFn): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const innerWidth = pageWidth - PDF_MARGIN * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(LIGHT_INK);
  doc.text(
    t("defectManagementPage.sprintReport.statusCard.kpiLegend.title"),
    PDF_MARGIN,
    16,
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(LIGHT_INK_MUTED);
  const subtitleLines = doc.splitTextToSize(
    t("defectManagementPage.sprintReport.statusCard.kpiLegend.subtitle"),
    innerWidth,
  );
  doc.text(subtitleLines, PDF_MARGIN, 23);

  let y = 23 + subtitleLines.length * 5 + 6;

  y = pdfDrawKpiLegendSection(
    doc,
    innerWidth,
    y,
    t("defectManagementPage.sprintReport.statusCard.kpis.testCasesSection"),
    KPI_LEGEND_TEST_CASES,
    t,
  );

  pdfDrawKpiLegendSection(
    doc,
    innerWidth,
    y,
    t("defectManagementPage.sprintReport.statusCard.kpis.bugsSection"),
    KPI_LEGEND_BUGS,
    t,
  );

  return doc;
}

export function exportKpiLegendToPdf(filename: string, t: TranslateFn): void {
  const doc = buildKpiLegendPdfDocument(t);
  doc.save(filename);
}

export function downloadStatusReportCardEmailHtml(
  filename: string,
  data: StatusReportCardEmailData,
  t: TranslateFn,
): void {
  const bodyHtml = buildStatusReportCardEmailBodyHtml(data, t);
  const documentHtml = buildStatusReportCardEmailDocument(bodyHtml);
  const blob = new Blob([documentHtml], { type: "text/html;charset=utf-8;" });
  downloadBlob(blob, filename);
}

// pptxgenjs colors are hex without the leading '#'.
function pptxHex(color: string): string {
  return color.replace("#", "");
}

// No text-measurement API exists for pptxgenjs (unlike jsPDF's
// splitTextToSize used by buildStatusReportCardPdfDocument), so free-text
// fields (the alert banner, each action paragraph) are measured with a
// scratch canvas instead, purely to size their box before drawing - actual
// on-slide wrapping is still done by PowerPoint itself (wrap: true).
function estimateWrappedLineCount(
  text: string,
  maxWidthIn: number,
  fontSizePt: number,
): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return 1;
  }

  ctx.font = `${fontSizePt}pt Arial`;

  const maxWidthPx = maxWidthIn * 96;
  const spaceWidth = ctx.measureText(" ").width;
  const words = text.split(/\s+/).filter(Boolean);

  let lines = 1;
  let lineWidth = 0;

  for (const word of words) {
    const wordWidth = ctx.measureText(word).width;

    if (lineWidth > 0 && lineWidth + spaceWidth + wordWidth > maxWidthPx) {
      lines++;
      lineWidth = wordWidth;
    } else {
      lineWidth += (lineWidth > 0 ? spaceWidth : 0) + wordWidth;
    }
  }

  return Math.max(lines, 1);
}

function pptxProgressTrack(
  slide: PptxGenJS.PresSlide,
  x: number,
  y: number,
  width: number,
  height: number,
  segments: { color: string; pct: number }[],
): void {
  slide.addShape("roundRect", {
    x,
    y,
    w: width,
    h: height,
    rectRadius: 0.5,
    fill: { color: pptxHex(LIGHT_RULE) },
    line: { type: "none" },
  });

  let cursor = x;

  for (const segment of segments) {
    const segmentWidth = (segment.pct / 100) * width;

    if (segmentWidth <= 0) {
      continue;
    }

    slide.addShape("rect", {
      x: cursor,
      y,
      w: segmentWidth,
      h: height,
      fill: { color: pptxHex(segment.color) },
      line: { type: "none" },
    });
    cursor += segmentWidth;
  }
}

// Renders "■ 11 Passed   |   ■ 6 Failed   |   ..." as pptxgenjs text runs so
// each count gets a colored square swatch matching the on-screen legend
// (SuiteProgressBar / StatusReportCard), instead of a flat color-less list.
function pptxLegendRuns(
  entries: { color: string; label: string }[],
  textColor: string,
  fontSize: number,
): PptxGenJS.TextProps[] {
  return entries.flatMap((entry, index) => {
    const separator: PptxGenJS.TextProps[] =
      index > 0
        ? [
            {
              text: "   |   ",
              options: { color: pptxHex(textColor), fontSize },
            },
          ]
        : [];

    return [
      ...separator,
      { text: "■ ", options: { color: pptxHex(entry.color), fontSize } },
      { text: entry.label, options: { color: pptxHex(textColor), fontSize } },
    ];
  });
}

const PPTX_SEVERITY_CHIP_HEIGHT = 0.55;
const PPTX_SEVERITY_ROW_HEIGHT = PPTX_SEVERITY_CHIP_HEIGHT + 0.22;

function pptxSeverityChipsRow(
  slide: PptxGenJS.PresSlide,
  rect: { x: number; y: number; width: number },
  entries: readonly (readonly [string, number])[],
  total: number,
  caption: string,
  scale = 1,
): void {
  const { x, y, width } = rect;
  const chipHeight = PPTX_SEVERITY_CHIP_HEIGHT * scale;
  const gap = 0.06;
  const chipWidth = (width - gap * (entries.length - 1)) / entries.length;

  entries.forEach(([raw, count], index) => {
    const rank = severityRank(raw);
    const palette = LIGHT_SEVERITY_PALETTE[rank - 1] ?? LIGHT_SEVERITY_FALLBACK;
    const percent = total ? Math.round((count / total) * 100) : 0;
    const chipX = x + index * (chipWidth + gap);

    slide.addText(
      [
        {
          text: String(count),
          options: { fontSize: 14 * scale, bold: true, breakLine: true },
        },
        {
          text: `${percent}%`,
          options: { fontSize: 9 * scale, breakLine: true },
        },
        { text: emailSeverityLabel(raw), options: { fontSize: 9 * scale } },
      ],
      {
        x: chipX,
        y,
        w: chipWidth,
        h: chipHeight,
        align: "center",
        valign: "middle",
        color: pptxHex(palette.text),
        fontFace: "Arial",
        fill: { color: pptxHex(palette.bg) },
        line: { color: pptxHex(palette.border), width: 0.75 },
        rectRadius: 0.08,
        shape: "roundRect",
      },
    );
  });

  slide.addText(caption, {
    x,
    y: y + chipHeight + 0.03 * scale,
    w: width,
    h: 0.18 * scale,
    align: "center",
    fontSize: 9 * scale,
    color: pptxHex(LIGHT_INK_MUTED),
    fontFace: "Arial",
  });
}

function computeOriginBreakdown(
  report: SprintDefectReport,
  showOriginBreakdown: boolean,
  t: TranslateFn,
): {
  originDefs: {
    origin: string;
    labelKey: string;
    bySuite: Record<string, number>;
  }[];
  originRowsData: string[][];
} {
  const originDefs = showOriginBreakdown
    ? [
        {
          origin: "Test Factory",
          labelKey: "defectManagementPage.sprintReport.origin.testFactory",
          bySuite: report.testFactoryBySuite,
        },
        {
          origin: "Test Agenti",
          labelKey: "defectManagementPage.sprintReport.origin.testAgenti",
          bySuite: report.testAgentiBySuite,
        },
        {
          origin: "Business",
          labelKey: "defectManagementPage.sprintReport.origin.business",
          bySuite: report.testBusinessBySuite,
        },
      ].filter((def) => Object.keys(def.bySuite).length > 0)
    : [];
  const originRowsData = originDefs.flatMap((def) => {
    const suiteEntries = Object.entries(def.bySuite).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    return [
      ...suiteEntries.map(([suite, count]) => [
        t(def.labelKey),
        suiteCaption(t, suite),
        String(count),
      ]),
      [
        t(def.labelKey),
        t(
          "defectManagementPage.sprintReport.statusCard.originBreakdown.detected",
        ),
        String(report.byOriginDetected[def.origin] ?? 0),
      ],
      [
        t(def.labelKey),
        t(
          "defectManagementPage.sprintReport.statusCard.originBreakdown.accepted",
        ),
        String(report.byOrigin[def.origin] ?? 0),
      ],
    ];
  });

  return { originDefs, originRowsData };
}

interface PptxNaturalHeights {
  naturalAlertBlock: number;
  naturalKpiBlock: number;
  naturalDashboardBlock: number;
  naturalActionsBlock: number;
  naturalSuiteBlock: number;
  naturalBugStatusBlock: number;
  naturalOriginBlock: number;
  naturalBodyTotal: number;
}

// Measures every section's height up front (mirrors the drawing logic below
// section-for-section) so the slide can be created at exactly the right
// size - pptxgenjs has no auto-growing page, unlike jsPDF's page breaks.
function computePptxNaturalHeights(params: {
  hasAlert: boolean;
  alertText: string;
  innerW: number;
  actionParagraphs: string[];
  suiteGroups: SuiteProgressGroup[];
  hasDashboard: boolean;
  originDefs: unknown[];
  originRowsData: unknown[];
}): PptxNaturalHeights {
  const {
    hasAlert,
    alertText,
    innerW,
    actionParagraphs,
    suiteGroups,
    hasDashboard,
    originDefs,
    originRowsData,
  } = params;

  const naturalAlertLineCount = hasAlert
    ? estimateWrappedLineCount(`⚠ ${alertText}`, innerW - 0.35, 11)
    : 0;
  const naturalAlertBlock = hasAlert
    ? naturalAlertLineCount * 0.2 + 0.14 + 0.18
    : 0;

  const naturalKpiBlock = 0.62 + 0.08 + 0.62 + 0.08 + 0.62 + 0.15;

  const naturalDashboardBlock = hasDashboard ? 0.32 + 0.2 : 0;

  const naturalActionLineCounts = actionParagraphs.map((paragraph) => {
    const { lead, rest } = splitEmailActionLeadIn(paragraph);
    const bodyText = lead ? `${lead} ${rest}` : rest;
    return estimateWrappedLineCount(bodyText, innerW - 0.35, 10);
  });
  const naturalActionsBlock =
    actionParagraphs.length > 0
      ? 0.32 +
        naturalActionLineCounts.reduce(
          (sum, lineCount) => sum + (lineCount * 0.18 + 0.12) + 0.08,
          0,
        )
      : 0;

  const naturalSuiteBlock =
    0.32 + (suiteGroups.length > 0 ? suiteGroups.length * 0.5 : 0.28);

  const naturalBugStatusBlock =
    0.32 + 0.2 + 0.24 + 0.1 + 0.2 + PPTX_SEVERITY_ROW_HEIGHT * 2 + 0.1;

  const naturalOriginBlock =
    originDefs.length > 0 ? 0.32 + originRowsData.length * 0.24 + 0.15 : 0;

  const naturalBodyTotal =
    naturalAlertBlock +
    naturalKpiBlock +
    naturalDashboardBlock +
    naturalActionsBlock +
    naturalSuiteBlock +
    naturalBugStatusBlock +
    naturalOriginBlock;

  return {
    naturalAlertBlock,
    naturalKpiBlock,
    naturalDashboardBlock,
    naturalActionsBlock,
    naturalSuiteBlock,
    naturalBugStatusBlock,
    naturalOriginBlock,
    naturalBodyTotal,
  };
}

function buildPptxKpiDefs(
  kpis: StatusCardKpis,
  _report: SprintDefectReport,
  t: TranslateFn,
): { value: string; label: string }[] {
  return [
    {
      value: String(kpis.totalTestCases),
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.totalTestCases",
      ),
    },
    {
      value: `${kpis.totalExecuted} (${kpis.executedPct}%)`,
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.executedCount",
      ),
    },
    {
      value: `${kpis.totalNotApplicable} (${kpis.notApplicableRate}%)`,
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.notApplicable",
      ),
    },
    {
      value: String(kpis.totalNotRun),
      label: t("defectManagementPage.sprintReport.statusCard.kpis.notRun"),
    },
    {
      value: String(kpis.totalPassed),
      label: t("defectManagementPage.sprintReport.statusCard.kpis.totalPassed"),
    },
    {
      value: `${kpis.passRate}%`,
      label: t("defectManagementPage.sprintReport.statusCard.kpis.passRate"),
    },
  ];
}

function buildPptxRow2KpiDefs(
  kpis: StatusCardKpis,
  report: SprintDefectReport,
  closedOutOfScopeCount: number,
  t: TranslateFn,
): { value: string; label: string }[] {
  return [
    {
      value: `${report.effectiveCount}/${report.total}`,
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected",
      ),
    },
    {
      value: String(report.outOfScopeCount),
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected",
      ),
    },
    {
      value: `${kpis.bugsClosed}/${report.total} (${kpis.bugsClosedPct}%)`,
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.bugsClosedRatio",
        {
          count: closedOutOfScopeCount,
        },
      ),
    },
    {
      value: `${kpis.bugsToClose}/${report.total} (${kpis.toClosePct}%)`,
      label: bugsToCloseLabel(t, kpis.toCloseOutOfScopeCount),
    },
  ];
}

function buildPptxRow3KpiDefs(
  kpis: StatusCardKpis,
  report: SprintDefectReport,
  t: TranslateFn,
): { value: string; label: string }[] {
  return [
    {
      value: String(kpis.criticalCount),
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.criticalBugs",
      ),
    },
    {
      value: `${report.reopenedCount} (${kpis.reopenedPct}%)`,
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs",
      ),
    },
    {
      value: t("defectManagementPage.stats.days", {
        value: kpis.avgClosureDays,
      }),
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime",
      ),
    },
    {
      value: String(report.withoutResolutionDateCount),
      label: t(
        "defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate",
      ),
    },
  ];
}

interface PptxDrawCtx {
  slide: PptxGenJS.PresSlide;
  M: number;
  W: number;
  innerW: number;
  scale: number;
  s: (n: number) => number;
  t: TranslateFn;
}

function pptxDrawAlertBanner(
  ctx: PptxDrawCtx,
  cursorY: number,
  alertText: string,
  naturalAlertBlock: number,
): number {
  if (!alertText) {
    return cursorY;
  }

  const { slide, M, innerW, s } = ctx;
  const lineCount = estimateWrappedLineCount(
    `⚠ ${alertText}`,
    innerW - 0.35,
    s(11),
  );
  const textHeight = s(lineCount * 0.2 + 0.14);

  slide.addShape("rect", {
    x: M,
    y: cursorY,
    w: innerW,
    h: textHeight,
    fill: { color: pptxHex(LIGHT_ALERT_BG) },
    line: { color: pptxHex(LIGHT_ALERT_BORDER), width: 0.5 },
  });
  slide.addShape("rect", {
    x: M,
    y: cursorY,
    w: 0.05,
    h: textHeight,
    fill: { color: pptxHex(LIGHT_ALERT_BORDER) },
    line: { type: "none" },
  });
  slide.addText(`⚠ ${alertText}`, {
    x: M + 0.15,
    y: cursorY,
    w: innerW - 0.3,
    h: textHeight,
    fontSize: s(11),
    color: pptxHex(LIGHT_ALERT_TEXT),
    fontFace: "Arial",
    valign: "middle",
    wrap: true,
  });

  return cursorY + s(naturalAlertBlock);
}

function pptxDrawKpiTiles(
  ctx: PptxDrawCtx,
  cursorY: number,
  kpiDefs: { value: string; label: string }[],
  row2KpiDefs: { value: string; label: string }[],
  row3KpiDefs: { value: string; label: string }[],
): void {
  const { slide, M, innerW, s } = ctx;
  const kpiHeight = s(0.62);
  const kpiGap = 0.06;

  const drawRow = (
    defs: { value: string; label: string }[],
    paletteOffset: number,
    y: number,
  ) => {
    const columns = defs.length;
    const tileWidth = (innerW - kpiGap * (columns - 1)) / columns;
    defs.forEach((kpi, index) => {
      const kpiPalette = PPTX_KPI[(paletteOffset + index) % PPTX_KPI.length];
      const tileX = M + index * (tileWidth + kpiGap);

      slide.addText(
        [
          {
            text: kpi.value,
            options: { fontSize: s(15), bold: true, breakLine: true },
          },
          { text: kpi.label, options: { fontSize: s(7) } },
        ],
        {
          x: tileX,
          y,
          w: tileWidth,
          h: kpiHeight,
          align: "center",
          valign: "middle",
          color: pptxHex(kpiPalette.accent),
          fontFace: "Arial",
          fill: { color: pptxHex(kpiPalette.bg) },
          line: { color: pptxHex(kpiPalette.accent), width: 0.75 },
          shape: "roundRect",
          rectRadius: 0.06,
        },
      );
    });
  };

  drawRow(kpiDefs, 0, cursorY);
  drawRow(row2KpiDefs, 0, cursorY + kpiHeight + s(0.08));
  drawRow(row3KpiDefs, 4, cursorY + (kpiHeight + s(0.08)) * 2);
}

function pptxDrawDashboardButton(
  ctx: PptxDrawCtx,
  cursorY: number,
  dashboardUrl: string | undefined,
  naturalDashboardBlock: number,
): number {
  if (!dashboardUrl) {
    return cursorY;
  }

  const { slide, M, innerW, s, t } = ctx;
  const buttonHeight = s(0.32);

  slide.addText(
    t("defectManagementPage.sprintReport.statusCard.openDashboard"),
    {
      x: M,
      y: cursorY,
      w: innerW,
      h: buttonHeight,
      align: "center",
      valign: "middle",
      fontSize: s(11),
      bold: true,
      color: "FFFFFF",
      fontFace: "Arial",
      fill: { color: pptxHex(LIGHT_BUTTON_BG) },
      line: { type: "none" },
      shape: "roundRect",
      rectRadius: 0.2,
      hyperlink: { url: dashboardUrl },
    },
  );

  return cursorY + s(naturalDashboardBlock);
}

function pptxDrawActionsSection(
  ctx: PptxDrawCtx,
  cursorY: number,
  actionParagraphs: string[],
): number {
  if (actionParagraphs.length === 0) {
    return cursorY;
  }

  const { slide, M, innerW, s, t } = ctx;
  const titleHeight = s(0.32);

  slide.addText(
    `📌 ${t("defectManagementPage.sprintReport.statusCard.actionsTitle")}`,
    {
      x: M,
      y: cursorY,
      w: innerW,
      h: titleHeight,
      fontSize: s(13),
      bold: true,
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
    },
  );

  let rowY = cursorY + titleHeight;

  actionParagraphs.forEach((paragraph, index) => {
    const palette = PPTX_ACTION_PALETTE[index % PPTX_ACTION_PALETTE.length];
    const { lead, rest } = splitEmailActionLeadIn(paragraph);
    const bodyText = lead ? `${lead} ${rest}` : rest;
    const lineCount = estimateWrappedLineCount(bodyText, innerW - 0.35, s(10));
    const boxHeight = s(lineCount * 0.18 + 0.12);

    slide.addShape("rect", {
      x: M,
      y: rowY,
      w: innerW,
      h: boxHeight,
      fill: { color: pptxHex(palette.bg) },
      line: { color: pptxHex(palette.border), width: 0.5 },
    });
    slide.addShape("rect", {
      x: M,
      y: rowY,
      w: 0.05,
      h: boxHeight,
      fill: { color: pptxHex(palette.border) },
      line: { type: "none" },
    });
    slide.addText(bodyText, {
      x: M + 0.15,
      y: rowY,
      w: innerW - 0.3,
      h: boxHeight,
      fontSize: s(10),
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
      valign: "middle",
      wrap: true,
    });

    rowY += boxHeight + s(0.08);
  });

  return rowY + s(0.12);
}

function pptxDrawSuiteProgressRow(
  ctx: PptxDrawCtx,
  y: number,
  group: SuiteProgressGroup,
): void {
  const { slide, M, W, innerW, s, t } = ctx;
  const { executedPct, groupPassRate, segments, legendEntries } =
    computeSuiteProgressRowData(group);
  const legendRuns = pptxLegendRuns(
    legendEntries.map((outcome) => ({
      color: LIGHT_OUTCOME_COLORS[outcome],
      label: outcomeCountLabel(t, outcome, group.outcomeCounts[outcome]),
    })),
    LIGHT_INK_MUTED,
    s(8.5),
  );

  slide.addText(
    `${group.label} – ${t(
      "defectManagementPage.sprintReport.statusCard.casesCount",
      {
        count: group.totalTestCases,
      },
    )}`,
    {
      x: M,
      y,
      w: innerW - 1.3,
      h: s(0.2),
      fontSize: s(10),
      bold: true,
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
    },
  );
  slide.addText(
    `${executedPct}% ${t("defectManagementPage.sprintReport.statusCard.executed")}`,
    {
      x: W - M - 1.3,
      y,
      w: 1.3,
      h: s(0.2),
      fontSize: s(10),
      bold: true,
      align: "right",
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
    },
  );

  pptxProgressTrack(slide, M, y + s(0.2), innerW, s(0.06), segments);

  slide.addText(
    [
      ...legendRuns,
      {
        text: `   |   ${t("defectManagementPage.sprintReport.statusCard.passRate")}: ${groupPassRate}%`,
        options: { color: pptxHex(LIGHT_INK_MUTED), fontSize: s(8.5) },
      },
    ],
    {
      x: M,
      y: y + s(0.28),
      w: innerW,
      h: s(0.18),
      fontSize: s(8.5),
      color: pptxHex(LIGHT_INK_MUTED),
      fontFace: "Arial",
    },
  );
}

function pptxDrawSuiteProgressSection(
  ctx: PptxDrawCtx,
  cursorY: number,
  suiteGroups: SuiteProgressGroup[],
): number {
  const { slide, M, innerW, s, t } = ctx;
  const titleHeight = s(0.32);

  slide.addText(
    `📈 ${t("defectManagementPage.sprintReport.statusCard.suiteProgressTitle")}`,
    {
      x: M,
      y: cursorY,
      w: innerW,
      h: titleHeight,
      fontSize: s(13),
      bold: true,
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
    },
  );

  const rowY = cursorY + titleHeight;

  if (suiteGroups.length === 0) {
    slide.addText(
      t("defectManagementPage.sprintReport.statusCard.noPlanSelected"),
      {
        x: M,
        y: rowY,
        w: innerW,
        h: s(0.24),
        fontSize: s(10),
        italic: true,
        color: pptxHex(LIGHT_INK_MUTED),
        fontFace: "Arial",
      },
    );

    return rowY + s(0.28) + s(0.15);
  }

  const suiteRowHeight = s(0.5);
  let nextRowY = rowY;

  for (const group of suiteGroups) {
    pptxDrawSuiteProgressRow(ctx, nextRowY, group);
    nextRowY += suiteRowHeight;
  }

  return nextRowY + s(0.15);
}

function pptxDrawBugStatusSection(
  ctx: PptxDrawCtx,
  cursorY: number,
  report: SprintDefectReport,
  kpis: StatusCardKpis,
  suiteGroups: SuiteProgressGroup[],
  includeDsiSource: boolean,
  naturalBugStatusBlock: number,
): number {
  const { slide, M, W, innerW, scale, s, t } = ctx;
  const bugSources = [
    ...suiteGroups.map((group) => group.label),
    ...(includeDsiSource ? ["DSI"] : []),
  ].join(", ");
  const {
    statusEntries,
    statusSegments,
    closedOutOfScopeCount,
    severityTotal,
    severityEntries,
    openSeverityTotal,
    openSeverityEntries,
  } = computeBugStatusData(report);

  const y = cursorY;

  slide.addText(
    `🐛 ${t("defectManagementPage.sprintReport.statusCard.bugStatusTitle")}`,
    {
      x: M,
      y,
      w: innerW,
      h: s(0.24),
      fontSize: s(13),
      bold: true,
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
    },
  );
  slide.addText(
    t("defectManagementPage.sprintReport.statusCard.bugStatusSubtitle", {
      sources: bugSources,
    }),
    {
      x: M,
      y: y + s(0.24),
      w: innerW,
      h: s(0.18),
      fontSize: s(8.5),
      color: pptxHex(LIGHT_INK_MUTED),
      fontFace: "Arial",
    },
  );

  let localY = y + s(0.32) + s(0.2);

  slide.addText(
    t("defectManagementPage.sprintReport.statusCard.bugsDetected", {
      count: report.total,
    }) +
      ` – ${t("defectManagementPage.sprintReport.statusCard.bugStatusSummary", {
        effective: report.effectiveCount,
        outOfScope: report.outOfScopeCount,
      })}`,
    {
      x: M,
      y: localY,
      w: innerW - 1.5,
      h: s(0.22),
      fontSize: s(10),
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
    },
  );
  slide.addText(
    t("defectManagementPage.sprintReport.statusCard.stillOpen", {
      count: kpis.stillOpen,
    }),
    {
      x: W - M - 1.5,
      y: localY,
      w: 1.5,
      h: s(0.22),
      fontSize: s(10),
      bold: true,
      align: "right",
      color: pptxHex(LIGHT_STILL_OPEN),
      fontFace: "Arial",
    },
  );

  localY += s(0.24);
  pptxProgressTrack(slide, M, localY, innerW, s(0.07), statusSegments);
  localY += s(0.1);

  slide.addText(
    statusEntries
      .map(([name, count]) =>
        statusCountLabel(t, name, count, closedOutOfScopeCount),
      )
      .join("   |   "),
    {
      x: M,
      y: localY,
      w: innerW,
      h: s(0.2),
      fontSize: s(8.5),
      color: pptxHex(LIGHT_INK_MUTED),
      fontFace: "Arial",
    },
  );
  localY += s(0.24);

  pptxSeverityChipsRow(
    slide,
    { x: M, y: localY, width: innerW },
    severityEntries,
    severityTotal,
    t("defectManagementPage.sprintReport.statusCard.severityCaption", {
      count: report.effectiveCount,
    }),
    scale,
  );
  localY += s(PPTX_SEVERITY_ROW_HEIGHT);

  pptxSeverityChipsRow(
    slide,
    { x: M, y: localY, width: innerW },
    openSeverityEntries,
    openSeverityTotal,
    t("defectManagementPage.sprintReport.statusCard.openSeverityCaption", {
      count: openSeverityTotal,
    }),
    scale,
  );

  return y + s(naturalBugStatusBlock);
}

function pptxDrawOriginBreakdownSection(
  ctx: PptxDrawCtx,
  cursorY: number,
  originDefs: unknown[],
  originRowsData: string[][],
): number {
  if (originDefs.length === 0) {
    return cursorY;
  }

  const { slide, M, innerW, s, t } = ctx;
  const titleHeight = s(0.32);
  const rowHeight = s(0.24);

  slide.addText(
    t("defectManagementPage.sprintReport.statusCard.originBreakdown.title"),
    {
      x: M,
      y: cursorY,
      w: innerW,
      h: titleHeight,
      fontSize: s(13),
      bold: true,
      color: pptxHex(LIGHT_INK),
      fontFace: "Arial",
    },
  );

  let rowY = cursorY + titleHeight;

  for (const row of originRowsData) {
    slide.addTable([row.map((text) => ({ text }))], {
      x: M,
      y: rowY,
      w: innerW,
      colW: [innerW * 0.25, innerW * 0.55, innerW * 0.2],
      rowH: rowHeight,
      fontSize: s(9),
      fontFace: "Arial",
      border: { type: "solid", color: pptxHex(LIGHT_RULE), pt: 0.5 },
      valign: "middle",
    });
    rowY += rowHeight;
  }

  return rowY;
}

// Builds real, editable PowerPoint shapes/text/tables (not a screenshot -
// see exportStatusReportCardToPdf's identical reasoning) using the same
// light palette as the email export, on a single Custom/Landscape slide
// (matches PowerPoint's own "Slide Size" dialog) whose height is measured
// from the actual content and set exactly - no wasted space below a fixed
// page, and no shrinking either: a heavier report (more suites, more action
// paragraphs, more bugs) just makes the slide taller.
export async function exportStatusReportCardToPptx(
  filename: string,
  data: StatusReportCardEmailData,
  t: TranslateFn,
): Promise<void> {
  const {
    headerTitle,
    headerSubtitle,
    suiteGroups,
    report,
    alertText,
    actionsText,
    dashboardUrl,
    showOriginBreakdown = false,
    includeDsiSource = true,
  } = data;

  const M = 0.45;
  const W = 11;
  const innerW = W - M * 2;

  const { datePart, timePart } = formatEmailTimestamp(new Date());

  const headerHeight = 0.85;
  const headerGap = 0.15;
  const bodyTop = M + headerHeight + headerGap;

  const hasAlert = Boolean(alertText);
  const hasDashboard = Boolean(dashboardUrl);
  const actionParagraphs = actionsText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const { originDefs, originRowsData } = computeOriginBreakdown(
    report,
    showOriginBreakdown,
    t,
  );

  const heights = computePptxNaturalHeights({
    hasAlert,
    alertText,
    innerW,
    actionParagraphs,
    suiteGroups,
    hasDashboard,
    originDefs,
    originRowsData,
  });

  // No shrinking - the slide is exactly as tall as the content needs.
  const scale = 1;
  const s = (n: number) => n * scale;
  const H = bodyTop + heights.naturalBodyTotal + M;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "STATUS_CARD", width: W, height: H });
  pptx.layout = "STATUS_CARD";

  const slide = pptx.addSlide();
  slide.background = { color: pptxHex(LIGHT_PAGE_BG) };

  // Header - always drawn at natural size regardless of scale, so the
  // branding bar never shrinks even when the body below it does.
  slide.addShape("rect", {
    x: 0,
    y: M,
    w: W,
    h: headerHeight,
    fill: { color: pptxHex(LIGHT_HEADER_BG) },
    line: { type: "none" },
  });
  slide.addText(headerTitle, {
    x: M,
    y: M + 0.12,
    w: innerW - 1.8,
    h: 0.35,
    fontSize: 17,
    bold: true,
    color: "FFFFFF",
    fontFace: "Arial",
  });
  slide.addText(headerSubtitle, {
    x: M,
    y: M + 0.48,
    w: innerW - 1.8,
    h: 0.28,
    fontSize: 10,
    color: "FFFFFF",
    fontFace: "Arial",
  });
  slide.addText(
    t("defectManagementPage.sprintReport.statusCard.updatedAt", {
      date: datePart,
      time: timePart,
    }),
    {
      x: W - M - 1.8,
      y: M + 0.12,
      w: 1.8,
      h: 0.28,
      fontSize: 9,
      align: "right",
      color: "FFFFFF",
      fontFace: "Arial",
    },
  );

  const ctx: PptxDrawCtx = { slide, M, W, innerW, scale, s, t };

  let cursorY = bodyTop;

  cursorY = pptxDrawAlertBanner(
    ctx,
    cursorY,
    alertText,
    heights.naturalAlertBlock,
  );

  const kpis = computeStatusCardKpis(suiteGroups, report);
  const { closedOutOfScopeCount } = computeBugStatusData(report);
  const kpiDefs = buildPptxKpiDefs(kpis, report, t);
  const row2KpiDefs = buildPptxRow2KpiDefs(
    kpis,
    report,
    closedOutOfScopeCount,
    t,
  );
  const row3KpiDefs = buildPptxRow3KpiDefs(kpis, report, t);

  pptxDrawKpiTiles(ctx, cursorY, kpiDefs, row2KpiDefs, row3KpiDefs);
  cursorY += s(heights.naturalKpiBlock);

  cursorY = pptxDrawDashboardButton(
    ctx,
    cursorY,
    dashboardUrl,
    heights.naturalDashboardBlock,
  );
  cursorY = pptxDrawActionsSection(ctx, cursorY, actionParagraphs);
  cursorY = pptxDrawSuiteProgressSection(ctx, cursorY, suiteGroups);
  cursorY = pptxDrawBugStatusSection(
    ctx,
    cursorY,
    report,
    kpis,
    suiteGroups,
    includeDsiSource,
    heights.naturalBugStatusBlock,
  );
  pptxDrawOriginBreakdownSection(ctx, cursorY, originDefs, originRowsData);

  await pptx.writeFile({ fileName: filename });
}

// Writes the card as a rich-text clipboard entry (text/html, with a
// text/plain fallback for editors that don't accept rich HTML) so it can be
// pasted directly into Outlook/Teams/Gmail compose boxes and render as the
// same formatted table layout as the on-screen card, without the
// download-then-open-then-select-all-then-copy round trip that
// downloadStatusReportCardEmailHtml requires.
export async function copyStatusReportCardEmailHtmlToClipboard(
  data: StatusReportCardEmailData,
  t: TranslateFn,
): Promise<void> {
  const bodyHtml = buildStatusReportCardEmailBodyHtml(data, t);

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([bodyHtml], { type: "text/html" }),
      "text/plain": new Blob([data.headerTitle], { type: "text/plain" }),
    }),
  ]);
}
