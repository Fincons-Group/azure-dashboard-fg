import type { DataBarRuleType, Workbook, Worksheet } from "exceljs";
import type {
    BugInfo,
    DefectStats,
    Outcome,
    PlanOverviewResponse,
    PlanOverviewTestCase,
} from "../types";
import type { TranslateFn } from "./export";

// exceljs' own internal-hyperlink support (a `{ text, hyperlink: "#Sheet!A1" }`
// cell) still emits an External relationship for the link, which makes Excel
// show a "repair" prompt on open. A `HYPERLINK("#...")` formula cell needs no
// relationship at all, so every in-workbook "jump to the detail sheet" link
// here is built that way instead - see linkFormula() below.
function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    // Deferred - see the matching comment in export.ts: revoking synchronously
    // races the browser's read of the blob and truncates larger .xlsx files.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const HEADER_FILL = "FF1F3864";
const SECTION_FILL = "FFD9E2F3";
const ZEBRA_FILL = "FFF2F5FB";
const PANEL_FILL = "FFEAF1FB";
const LINK_FONT = { color: { argb: "FF0563C1" }, underline: true } as const;

// Traffic-light fills for percentage cells (Excel's own "good/neutral/bad"
// palette) - applied directly rather than via conditional formatting so the
// colours survive in viewers that don't evaluate CF.
const PCT_GOOD = { fill: "FFC6EFCE", font: "FF006100" };
const PCT_WARN = { fill: "FFFFEB9C", font: "FF9C6500" };
const PCT_BAD = { fill: "FFFFC7CE", font: "FF9C0006" };

const OUTCOME_ORDER: Outcome[] = [
    "Passed",
    "Failed",
    "Blocked",
    "NotApplicable",
    "Paused",
    "InProgress",
    "NotRun",
];

const OUTCOME_HEX: Record<Outcome, string> = {
    Passed: "#2E7D32",
    Failed: "#C62828",
    Blocked: "#F0A500",
    NotApplicable: "#9E9E9E",
    Paused: "#8E5CD9",
    InProgress: "#1565C0",
    NotRun: "#BDBDBD",
};

const STATUS_HEX: Record<string, string> = {
    Closed: "#2E7D32",
    "Da verificare": "#1565C0",
    "In verifica": "#0097A7",
    "In Progress": "#F0A500",
    New: "#C62828",
    Reopened: "#AD1457",
    "Not Applicable": "#9E9E9E",
};

const ORIGIN_HEX: Record<string, string> = {
    "Test Factory": "#1F3864",
    "Test Agenti": "#2E7D32",
    "Test Business": "#B45309",
    DSI: "#AD1457",
};

export interface DynamicSprintReportPlan {
    id: number;
    name: string;
    url?: string;
    overview?: PlanOverviewResponse;
}

export interface DynamicSprintReportExcelData {
    meta: {
        title: string;
        project: string;
        areaPath: string;
        sprint: string;
        generatedAt: Date;
    };
    stats: DefectStats;
    plans: DynamicSprintReportPlan[];
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function assigneeName(assignee: BugInfo["assignee"], t: TranslateFn): string {
    return (
        assignee?.displayName?.trim() ||
        t("dynamicSprintReportPage.excel.unassigned")
    );
}

// "Open" for a manager overview means anything not already resolved/closed -
// Azure DevOps' terminal bug states in this org are "Closed" and "Removed".
function isOpenBug(bug: BugInfo): boolean {
    return bug.state !== "Closed" && bug.state !== "Removed";
}

function severityRank(raw?: string): number {
    const match = /^(\d+)\s*-/.exec(raw ?? "");
    return match ? Number(match[1]) : 99;
}

function formatTimestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

// Number format Excel applies to the date columns - keeps the cell a real,
// sortable/filterable date while showing it as gg/mm/aaaa hh:mm.
const DATE_NUM_FMT = "dd/mm/yyyy hh:mm";

// A real Date for exceljs (so the cell is a genuine date), or "-" when the
// timestamp is missing or unparseable so the column still reads cleanly.
function dateCell(iso?: string): Date | string {
    if (!iso) {
        return "-";
    }
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "-" : date;
}

// Same idea for the style-free on-screen preview, which has no date cell kind.
function formatDate(iso?: string): string {
    if (!iso) {
        return "-";
    }
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "-" : formatTimestamp(date);
}

function emptyOutcomeCounts(): Record<Outcome, number> {
    return {
        Passed: 0,
        Failed: 0,
        Blocked: 0,
        NotApplicable: 0,
        Paused: 0,
        InProgress: 0,
        NotRun: 0,
    };
}

function addOutcomeCounts(
    target: Record<Outcome, number>,
    source: Record<Outcome, number>
): void {
    for (const outcome of OUTCOME_ORDER) {
        target[outcome] += source[outcome] ?? 0;
    }
}

interface OutcomeAggregate {
    total: number;
    counts: Record<Outcome, number>;
}

function aggregatePlans(plans: DynamicSprintReportPlan[]): OutcomeAggregate {
    const counts = emptyOutcomeCounts();
    let total = 0;

    for (const plan of plans) {
        if (!plan.overview) {
            continue;
        }
        total += plan.overview.totalTestCases;
        addOutcomeCounts(counts, plan.overview.outcomeCounts);
    }

    return { total, counts };
}

// Executed = tests that reached a verdict (Passed/Failed/Blocked). Mirrors
// computeStatusCardKpis() in export.ts so this workbook and the PDF/email
// status card never disagree on the number.
function executedCount(counts: Record<Outcome, number>): number {
    return counts.Passed + counts.Failed + counts.Blocked;
}

function pct(part: number, whole: number): number {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function sortedEntries(record: Record<string, number>): [string, number][] {
    return Object.entries(record).sort((a, b) => b[1] - a[1]);
}

// The DSI bug list comes straight from the sprint defect report
// (report.dsiDefects) - the DSI suite is the bug's own Custom.Suite field, not
// a node in any selected test plan's suite tree, so it can't be found by
// walking plan.overview.suites.
function dsiBugsFrom(data: DynamicSprintReportExcelData): BugInfo[] {
    return [...(data.stats.sprintDefectReport.dsiDefects ?? [])].sort(
        (a, b) => a.id - b.id
    );
}

// Business-origin bugs (Custom.Suite = "Test Business"), open ones first then
// by severity - the "Bug Business" sheet is a triage list for them.
function businessBugsFrom(
    data: DynamicSprintReportExcelData
): (BugInfo & { severity?: string; outOfScope?: boolean })[] {
    return [...(data.stats.sprintDefectReport.businessDefects ?? [])].sort(
        (a, b) =>
            Number(!isOpenBug(a)) - Number(!isOpenBug(b)) ||
            severityRank(a.severity) - severityRank(b.severity) ||
            a.id - b.id
    );
}


/* ------------------------------------------------------------------ */
/* Worksheet styling helpers                                           */
/* ------------------------------------------------------------------ */

function solid(argb: string) {
    return { type: "pattern", pattern: "solid", fgColor: { argb } } as const;
}

function styleHeaderRow(sheet: Worksheet, rowNumber: number, colCount: number): void {
    const row = sheet.getRow(rowNumber);
    for (let col = 1; col <= colCount; col += 1) {
        const cell = row.getCell(col);
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = solid(HEADER_FILL);
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { bottom: { style: "thin", color: { argb: "FFB4C6E7" } } };
    }
    row.height = 26;
}

function addSectionTitle(sheet: Worksheet, title: string, span: number): void {
    const row = sheet.addRow([title]);
    sheet.mergeCells(row.number, 1, row.number, span);
    const cell = row.getCell(1);
    cell.font = { bold: true, size: 12, color: { argb: HEADER_FILL } };
    cell.fill = solid(SECTION_FILL);
    row.height = 20;
}

// A `HYPERLINK("#'Sheet'!A1", "label")` formula - a genuine in-workbook jump
// that, unlike exceljs' `{ hyperlink }` cell, needs no worksheet relationship
// and so never triggers Excel's repair prompt.
function linkFormula(sheetName: string, label: string, ref = "A1") {
    return {
        formula: `HYPERLINK("#'${sheetName.replace(/'/g, "''")}'!${ref}","${label.replace(
            /"/g,
            '""'
        )}")`,
        result: label,
    };
}

function zebra(
    sheet: Worksheet,
    fromRow: number,
    toRow: number,
    colCount: number
): void {
    for (let r = fromRow; r <= toRow; r += 1) {
        if ((r - fromRow) % 2 !== 1) {
            continue;
        }
        const row = sheet.getRow(r);
        for (let c = 1; c <= colCount; c += 1) {
            const cell = row.getCell(c);
            const fill = cell.fill as { type?: string; fgColor?: unknown } | undefined;
            // Leave semantically-coloured cells (percentages, severity, ...) alone.
            if (fill && fill.type === "pattern" && fill.fgColor) {
                continue;
            }
            cell.fill = solid(ZEBRA_FILL);
        }
    }
}

// Widens every column of a data sheet to fit its longest value (headers
// included), within sane bounds - fixes the "columns not wide enough" look of
// a fixed-width sheet.
function autoFitColumns(sheet: Worksheet, minWidth = 10, maxWidth = 80): void {
    sheet.columns?.forEach((column) => {
        let widest = minWidth;
        column.eachCell?.({ includeEmpty: false }, (cell) => {
            const value = cell.value as unknown;
            let text = "";

            if (value == null) {
                text = "";
            } else if (typeof value === "object") {
                const obj = value as Record<string, unknown>;
                if (typeof obj.text === "string") {
                    text = obj.text;
                } else if (obj.result != null) {
                    text = String(obj.result);
                } else if (Array.isArray(obj.richText)) {
                    text = (obj.richText as { text: string }[])
                        .map((run) => run.text)
                        .join("");
                }
            } else {
                text = String(value);
            }

            const longestLine = text
                .split("\n")
                .reduce((max, line) => Math.max(max, line.length), 0);
            // +3 pad: header cells are bold, which reads slightly wider.
            widest = Math.max(widest, longestLine + 3);
        });
        // exceljs treats width === 9 as "not custom" and drops the <col>; the
        // minWidth of 10 keeps every column explicitly sized.
        column.width = Math.max(minWidth, Math.min(maxWidth, widest));
    });
}

function setPercentCell(
    cell: { value: unknown; numFmt: string; fill: unknown; font: unknown },
    value: number,
    higherIsBetter = true
): void {
    cell.value = value;
    cell.numFmt = '0"%"';

    const good = higherIsBetter ? value >= 80 : value <= 20;
    const bad = higherIsBetter ? value < 50 : value > 50;
    const palette = good ? PCT_GOOD : bad ? PCT_BAD : PCT_WARN;

    cell.fill = solid(palette.fill);
    cell.font = { color: { argb: palette.font }, bold: true };
}

// A green -> amber -> red 3-colour scale across the given cell range. Layered
// on top of the direct fills for viewers (Excel) that render CF.
function addPercentColorScale(sheet: Worksheet, ref: string): void {
    sheet.addConditionalFormatting({
        ref,
        rules: [
            {
                type: "colorScale",
                priority: 1,
                cfvo: [
                    { type: "num", value: 0 },
                    { type: "num", value: 50 },
                    { type: "num", value: 100 },
                ],
                color: [
                    { argb: "FFF8696B" },
                    { argb: "FFFFEB84" },
                    { argb: "FF63BE7B" },
                ],
            },
        ],
    });
}

function addDataBar(sheet: Worksheet, ref: string, argb = "FF4472C4"): void {
    sheet.addConditionalFormatting({
        ref,
        rules: [
            {
                // exceljs' DataBarRuleType omits `color` from its typings, but
                // its runtime xform does read model.color - hence the cast.
                type: "dataBar",
                priority: 1,
                cfvo: [{ type: "min" }, { type: "max" }],
                color: { argb },
                gradient: false,
            } as unknown as DataBarRuleType,
        ],
    });
}

/* ------------------------------------------------------------------ */
/* Chart images (exceljs cannot emit native charts, so these are PNGs) */
/* ------------------------------------------------------------------ */

interface ChartDatum {
    label: string;
    value: number;
    color?: string;
}

const CHART_W = 460;

function chartHeight(rows: number): number {
    return 44 + rows * 26 + 14;
}

function renderBarChartPng(
    title: string,
    data: ChartDatum[],
    accent = "#4472C4"
): string {
    const height = chartHeight(Math.max(data.length, 1));
    const canvas = document.createElement("canvas");
    const dpr = 2;
    canvas.width = CHART_W * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
        return "";
    }

    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, CHART_W, height);
    ctx.textBaseline = "middle";

    ctx.fillStyle = "#1F3864";
    ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(title, 12, 20);

    const maxValue = Math.max(1, ...data.map((d) => d.value));
    const labelWidth = 128;
    const barX = labelWidth + 14;
    const barMaxWidth = CHART_W - barX - 44;

    data.forEach((datum, index) => {
        const y = 44 + index * 26 + 10;

        ctx.fillStyle = "#333333";
        ctx.font = "12px 'Segoe UI', Arial, sans-serif";
        ctx.textAlign = "left";
        const label =
            datum.label.length > 20 ? `${datum.label.slice(0, 19)}…` : datum.label;
        ctx.fillText(label, 12, y);

        const width = Math.max(2, (datum.value / maxValue) * barMaxWidth);
        ctx.fillStyle = datum.color ?? accent;
        ctx.fillRect(barX, y - 8, width, 16);

        ctx.fillStyle = "#333333";
        ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
        ctx.fillText(String(datum.value), barX + width + 6, y);
    });

    return canvas.toDataURL("image/png");
}

function placeChart(
    wb: Workbook,
    sheet: Worksheet,
    dataUri: string,
    col: number,
    row: number,
    rows: number
): void {
    if (!dataUri) {
        return;
    }
    const imageId = wb.addImage({ base64: dataUri, extension: "png" });
    sheet.addImage(imageId, {
        tl: { col, row },
        ext: { width: CHART_W, height: chartHeight(rows) },
    });
}

/* ------------------------------------------------------------------ */
/* Sheet builders                                                      */
/* ------------------------------------------------------------------ */

interface SheetNames {
    guide: string;
    summary: string;
    bugs: string;
    bugsBySuite: string;
    todaysBugs: string;
    dsi: string;
    business: string;
    suites: string;
    testCases: string;
    plans: string;
    assignees: string;
}

/* ------------------------------------------------------------------ */
/* Test-case rows (shared by single- and multi-scope builders)         */
/* ------------------------------------------------------------------ */

const YES = "true";
const NO = "false";

// Column headers for the test-case sheet, in order. `leading` is prepended
// (e.g. an "Ambito" column for the combined workbook).
function testCaseColumns(
    tr: (key: string) => string,
    leading: { header: string; width: number }[]
) {
    return [
        ...leading,
        { header: tr("plan"), width: 26 },
        { header: tr("suite"), width: 30 },
        { header: tr("tcId"), width: 10 },
        { header: tr("tcTitle"), width: 60 },
        { header: tr("tcState"), width: 12 },
        { header: tr("priority"), width: 9 },
        { header: tr("tcOutcome"), width: 14 },
        { header: tr("tcExecuted"), width: 11 },
        { header: tr("tcNotRun"), width: 12 },
        { header: tr("tcNeedsRetest"), width: 13 },
        { header: tr("tcAutomation"), width: 14 },
        { header: tr("assignee"), width: 22 },
        { header: tr("tcTester"), width: 22 },
        { header: tr("tcLastRunBy"), width: 22 },
        {
            header: tr("tcLastRunAt"),
            width: 18,
            style: { numFmt: DATE_NUM_FMT },
        },
        { header: tr("tcDaysSinceRun"), width: 12 },
        { header: tr("tcConfiguration"), width: 16 },
        { header: tr("tcTags"), width: 24 },
        { header: tr("bugCount"), width: 9 },
        { header: tr("openBugsShort"), width: 11 },
        { header: tr("tcBugIds"), width: 20 },
        { header: tr("areaPath"), width: 26 },
        { header: tr("link"), width: 8 },
    ];
}

// The value cells for one test case (after any `leading` cells), matching
// testCaseColumns order.
function testCaseValueCells(
    planName: string,
    tc: PlanOverviewTestCase,
    tr: (key: string) => string
): (string | number | Date)[] {
    return [
        planName,
        tc.suiteName,
        tc.testCaseId,
        tc.title,
        tc.state ?? "-",
        tc.priority,
        tc.outcome,
        tc.executed ? YES : NO,
        tc.notRun ? YES : NO,
        tc.needsRetest ? YES : NO,
        tc.automationStatus ?? "-",
        tc.assignedTo ?? "-",
        tc.tester ?? "-",
        tc.lastRunBy ?? "-",
        dateCell(tc.lastRunAt),
        tc.daysSinceLastRun ?? "-",
        tc.configuration ?? "-",
        tc.tags.join(", ") || "-",
        tc.bugCount,
        tc.hasOpenBugs ? YES : NO,
        tc.bugIds.join(", ") || "-",
        tc.areaPath ?? "-",
        tc.url ? tr("open") : "-",
    ];
}

// Colours the Esito cell + the Da-rieseguire flag on a just-added row.
// `base` is the 1-based column of the first test-case value cell (plan name);
// outcome sits at base+6, needsRetest at base+9, link at base+22.
function styleTestCaseRow(
    row: ExcelRow,
    base: number,
    tc: PlanOverviewTestCase,
    linkLabel: string
): void {
    const hex = OUTCOME_HEX[tc.outcome];
    if (hex) {
        row.getCell(base + 6).font = {
            color: { argb: `FF${hex.slice(1)}` },
            bold: true,
        };
    }
    if (tc.needsRetest) {
        row.getCell(base + 9).font = { color: { argb: "FFC62828" }, bold: true };
    }
    if (tc.url) {
        const cell = row.getCell(base + 22);
        cell.value = { text: linkLabel, hyperlink: tc.url };
        cell.font = { ...LINK_FONT };
    }
}

interface TestCaseEntry {
    scopeName?: string;
    planName: string;
    tc: PlanOverviewTestCase;
}

function collectTestCases(
    data: DynamicSprintReportExcelData,
    scopeName?: string
): TestCaseEntry[] {
    const out: TestCaseEntry[] = [];
    for (const plan of data.plans) {
        for (const tc of plan.overview?.testCases ?? []) {
            out.push({ scopeName, planName: plan.name, tc });
        }
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* "Guida" sheet - documents every other sheet + legends               */
/* ------------------------------------------------------------------ */

interface GuideMeta {
    project: string;
    areaPath: string;
    sprint: string;
    generatedAt: Date;
    scopeNames?: string[];
}

interface GuideEntry {
    label: string;
    text: string;
    section?: boolean;
}

// The guide content as an ordered list, consumed both by the styled Excel
// sheet and the on-screen preview.
function guideEntries(meta: GuideMeta, t: TranslateFn): GuideEntry[] {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const g = (key: string) => tr(`guide.${key}`);
    const multi = (meta.scopeNames?.length ?? 0) > 1;
    const srcPrefix = g("sourcePrefix");

    const out: GuideEntry[] = [];
    const section = (label: string) =>
        out.push({ label, text: "", section: true });
    const row = (label: string, text: string) => out.push({ label, text });
    const doc = (sheetKey: string, whatKey: string, sourceKey: string) => {
        row(tr(sheetKey), g(whatKey));
        row("", `${srcPrefix}: ${g(sourceKey)}`);
    };

    section(g("metaTitle"));
    row(tr("project"), meta.project || "-");
    row(tr("areaPath"), meta.areaPath || "-");
    row(tr("sprint"), meta.sprint || "-");
    row(tr("generatedAt"), formatTimestamp(meta.generatedAt));
    if (multi) row(tr("scope"), (meta.scopeNames ?? []).join(", "));

    section(g("howTitle"));
    row("", g("how"));
    if (multi) row("", g("multiScopeNote"));

    section(g("sheetsTitle"));
    doc("sheetSummary", "summaryWhat", "summarySource");
    doc("sheetBugs", "bugsWhat", "bugsSource");
    doc("sheetBugsBySuite", "bugsBySuiteWhat", "bugsBySuiteSource");
    doc("sheetTodaysBugs", "todaysBugsWhat", "todaysBugsSource");
    doc("sheetDsi", "dsiWhat", "dsiSource");
    doc("sheetBusiness", "businessWhat", "businessSource");
    doc("sheetSuites", "suitesWhat", "suitesSource");
    doc("sheetTestCases", "testCasesWhat", "testCasesSource");
    doc("sheetPlans", "plansWhat", "plansSource");
    doc("sheetAssignees", "assigneesWhat", "assigneesSource");

    section(g("legendOutcomeTitle"));
    row("", g("legendOutcome"));
    section(g("legendFlagsTitle"));
    row("", g("legendFlags"));
    section(g("legendColorsTitle"));
    row("", g("legendColors"));
    section(g("legendCalcTitle"));
    row("", g("legendCalc"));

    return out;
}

function writeGuideSheet(
    sheet: Worksheet,
    meta: GuideMeta,
    t: TranslateFn
): void {
    const g = (key: string) => t(`dynamicSprintReportPage.excel.guide.${key}`);
    sheet.columns = [{ width: 26 }, { width: 120 }];

    const titleRow = sheet.addRow([g("title")]);
    sheet.mergeCells(titleRow.number, 1, titleRow.number, 2);
    titleRow.getCell(1).font = {
        bold: true,
        size: 16,
        color: { argb: "FFFFFFFF" },
    };
    titleRow.getCell(1).fill = solid(HEADER_FILL);
    titleRow.height = 24;
    sheet.addRow(["", g("generatedWith")]).getCell(2).font = {
        italic: true,
        color: { argb: "FF6B7280" },
    };

    for (const entry of guideEntries(meta, t)) {
        if (entry.section) {
            sheet.addRow([]);
            addSectionTitle(sheet, entry.label, 2);
            continue;
        }
        const r = sheet.addRow([entry.label, entry.text]);
        if (entry.label) {
            r.getCell(1).font = { bold: true };
        } else {
            r.getCell(2).font = { color: { argb: "FF4B5563" } };
        }
        r.getCell(2).alignment = { wrapText: true, vertical: "top" };
        const lines =
            (entry.text.match(/\n/g)?.length ?? 0) +
            Math.max(1, Math.ceil(entry.text.length / 115));
        if (lines > 1) {
            r.height = 14 * lines + 4;
        }
    }
}

function buildGuideSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const sheet = wb.addWorksheet(names.guide, {
        views: [{ showGridLines: false }],
    });
    writeGuideSheet(
        sheet,
        {
            project: data.meta.project,
            areaPath: data.meta.areaPath,
            sprint: data.meta.sprint,
            generatedAt: data.meta.generatedAt,
        },
        t
    );
}

function guidePreviewSheet(meta: GuideMeta, t: TranslateFn): PreviewSheet {
    const g = (key: string) => t(`dynamicSprintReportPage.excel.guide.${key}`);
    const rows: PreviewCell[][] = guideEntries(meta, t).map((entry) =>
        entry.section
            ? [{ value: `— ${entry.label} —` }, { value: "" }]
            : [{ value: entry.label || "·" }, { value: entry.text }]
    );
    return {
        name: g("sheetName"),
        tables: [
            {
                title: g("title"),
                columns: [g("colProperty"), g("colValue")],
                rows,
            },
        ],
    };
}

function buildSummarySheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    dsiBugs: BugInfo[],
    t: TranslateFn
): void {
    const tr = (key: string, opts?: Record<string, unknown>) =>
        t(`dynamicSprintReportPage.excel.${key}`, opts);
    const sheet = wb.addWorksheet(names.summary, {
        views: [{ showGridLines: false }],
    });
    sheet.columns = [
        { width: 42 },
        { width: 18 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
    ];

    const report = data.stats.sprintDefectReport;
    const agg = aggregatePlans(data.plans);
    const executed = executedCount(agg.counts);
    const decided = agg.total - agg.counts.NotApplicable;

    // Title block
    const titleRow = sheet.addRow([data.meta.title]);
    sheet.mergeCells(titleRow.number, 1, titleRow.number, 6);
    titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER_FILL },
    };
    titleRow.height = 26;

    sheet.addRow([tr("project"), data.meta.project]);
    sheet.addRow([tr("areaPath"), data.meta.areaPath]);
    sheet.addRow([tr("sprint"), data.meta.sprint]);
    sheet.addRow([tr("generatedAt"), formatTimestamp(data.meta.generatedAt)]);
    for (let r = 2; r <= 5; r += 1) {
        sheet.getRow(r).getCell(1).font = { bold: true };
    }
    sheet.addRow([]);

    // Index / navigation
    addSectionTitle(sheet, tr("index"), 6);
    const indexTargets: [string, string][] = [
        [names.bugs, tr("sheetBugs")],
        [names.bugsBySuite, tr("sheetBugsBySuite")],
        [names.todaysBugs, tr("sheetTodaysBugs")],
        [names.dsi, tr("sheetDsi")],
        [names.business, tr("sheetBusiness")],
        [names.suites, tr("sheetSuites")],
        [names.testCases, tr("sheetTestCases")],
        [names.plans, tr("sheetPlans")],
        [names.assignees, tr("sheetAssignees")],
    ];
    for (const [target, label] of indexTargets) {
        const row = sheet.addRow([label]);
        row.getCell(2).value = linkFormula(target, tr("goToSheet"));
        row.getCell(2).font = { ...LINK_FONT };
    }
    sheet.addRow([]);

    // KPI - test execution
    addSectionTitle(sheet, tr("kpiTestSection"), 6);
    const testHeader = sheet.addRow([tr("metric"), tr("value")]);
    styleHeaderRow(sheet, testHeader.number, 2);
    const testStart = sheet.rowCount + 1;
    sheet.addRow([tr("totalTestCases"), agg.total]);
    sheet.addRow([tr("executed"), executed]);
    setPercentCell(
        sheet.addRow([tr("executedPct"), 0]).getCell(2),
        pct(executed, agg.total)
    );
    setPercentCell(
        sheet.addRow([tr("passRate"), 0]).getCell(2),
        pct(agg.counts.Passed, decided)
    );
    sheet.addRow([tr("notApplicable"), agg.counts.NotApplicable]);
    sheet.addRow([tr("notRun"), agg.counts.NotRun]);
    zebra(sheet, testStart, sheet.rowCount, 2);
    sheet.addRow([]);

    // KPI - bugs
    addSectionTitle(sheet, tr("kpiBugSection"), 6);
    const bugHeader = sheet.addRow([tr("metric"), tr("value")]);
    styleHeaderRow(sheet, bugHeader.number, 2);
    const bugStart = sheet.rowCount + 1;
    const closedAll = report.byStatusAll.Closed ?? 0;
    const openBugs = report.total - closedAll;
    const criticalOpen = report.effectiveDefects.filter(
        (bug) => bug.state !== "Closed" && /^1\s*-/.test(bug.severity ?? "")
    ).length;
    const bugsByDsi = report.byOriginDetected["DSI"] ?? 0;
    const bugsByBusiness = report.byOriginDetected["Business"] ?? 0;

    sheet.addRow([tr("totalBugs"), report.total]);
    sheet.addRow([tr("effectiveBugs"), report.effectiveCount]);
    sheet.addRow([tr("outOfScopeBugs"), report.outOfScopeCount]);
    sheet.addRow([tr("closedBugs"), closedAll]);
    setPercentCell(
        sheet.addRow([tr("closedPct"), 0]).getCell(2),
        pct(closedAll, report.total)
    );
    sheet.addRow([tr("openBugs"), openBugs]);
    sheet.addRow([tr("criticalOpen"), criticalOpen]);
    sheet.addRow([tr("reopened"), report.reopenedCount]);
    sheet.addRow([
        tr("avgClosureDays"),
        report.mttrDays != null ? Math.round(report.mttrDays) : "-",
    ]);
    sheet.addRow([tr("withoutResolutionDate"), report.withoutResolutionDateCount]);
    sheet.addRow([tr("bugsByUs"), report.total - bugsByDsi - bugsByBusiness]);
    sheet.addRow([tr("bugsByDsi"), bugsByDsi]);
    sheet.addRow([tr("bugsByBusiness"), bugsByBusiness]);
    zebra(sheet, bugStart, sheet.rowCount, 2);
    sheet.addRow([]);

    // DSI panorama panel
    addSectionTitle(sheet, tr("dsiSection"), 6);
    const dsiHeader = sheet.addRow([tr("metric"), tr("value")]);
    styleHeaderRow(sheet, dsiHeader.number, 2);
    const dsiStart = sheet.rowCount + 1;
    const dsiDetected = report.byOriginDetected["DSI"] ?? 0;
    const dsiAccepted = report.byOrigin["DSI"] ?? 0;
    const dsiOpen = dsiBugs.filter(isOpenBug).length;
    const dsiPending = data.stats.verificaActivitySummary.dsiPendingCount;

    sheet.addRow([tr("dsiDetected"), dsiDetected]);
    sheet.addRow([tr("dsiAccepted"), dsiAccepted]);
    setPercentCell(
        sheet.addRow([tr("dsiShareOfTotal"), 0]).getCell(2),
        pct(dsiDetected, report.total),
        false
    );
    sheet.addRow([tr("dsiOpen"), dsiOpen]);
    sheet.addRow([tr("dsiClosed"), Math.max(dsiBugs.length - dsiOpen, 0)]);
    sheet.addRow([tr("dsiPendingVerification"), dsiPending]);
    zebra(sheet, dsiStart, sheet.rowCount, 2);
    sheet.addRow([]);

    // Bug by status
    addSectionTitle(sheet, tr("byStatusSection"), 6);
    const statusHeader = sheet.addRow([tr("status"), tr("count")]);
    styleHeaderRow(sheet, statusHeader.number, 2);
    const statusStart = sheet.rowCount + 1;
    const statusEntries = sortedEntries(report.byStatusAll);
    statusEntries.forEach(([name, count]) => {
        const row = sheet.addRow([name, count]);
        const hex = STATUS_HEX[name];
        if (hex) {
            row.getCell(1).fill = solid(`FF${hex.slice(1)}`);
            row.getCell(1).font = { color: { argb: "FFFFFFFF" }, bold: true };
        }
    });
    if (sheet.rowCount >= statusStart) {
        addDataBar(sheet, `B${statusStart}:B${sheet.rowCount}`, "FF1F3864");
    }
    sheet.addRow([]);

    // Bug by severity
    addSectionTitle(sheet, tr("bySeveritySection"), 6);
    const sevHeader = sheet.addRow([tr("severity"), tr("count")]);
    styleHeaderRow(sheet, sevHeader.number, 2);
    const sevStart = sheet.rowCount + 1;
    const sevEntries = Object.entries(report.bySeverity).sort(
        (a, b) => severityRank(a[0]) - severityRank(b[0])
    );
    sevEntries.forEach(([name, count]) => {
        const row = sheet.addRow([name, count]);
        row.getCell(1).fill = solid(severityFillArgb(name));
        row.getCell(1).font = { color: { argb: "FFFFFFFF" }, bold: true };
    });
    if (sheet.rowCount >= sevStart) {
        addDataBar(sheet, `B${sevStart}:B${sheet.rowCount}`, "FFC62828");
    }
    sheet.addRow([]);

    // Bug by origin
    addSectionTitle(sheet, tr("byOriginSection"), 6);
    const originHeader = sheet.addRow([tr("origin"), tr("detected"), tr("accepted")]);
    styleHeaderRow(sheet, originHeader.number, 3);
    const originStart = sheet.rowCount + 1;
    const originNames = Array.from(
        new Set([
            ...Object.keys(report.byOriginDetected),
            ...Object.keys(report.byOrigin),
        ])
    ).sort((a, b) => a.localeCompare(b));
    originNames.forEach((name) =>
        sheet.addRow([
            name,
            report.byOriginDetected[name] ?? 0,
            report.byOrigin[name] ?? 0,
        ])
    );
    if (sheet.rowCount >= originStart) {
        zebra(sheet, originStart, sheet.rowCount, 3);
        addDataBar(sheet, `B${originStart}:B${sheet.rowCount}`, "FF1F3864");
    }
    sheet.addRow([]);

    // Plans mini-table (linked)
    addSectionTitle(sheet, tr("plansSection"), 6);
    const planHeader = sheet.addRow([
        tr("planName"),
        tr("totalTestCases"),
        tr("bugCount"),
    ]);
    styleHeaderRow(sheet, planHeader.number, 3);
    const planStart = sheet.rowCount + 1;
    for (const plan of data.plans) {
        const row = sheet.addRow([
            plan.name,
            plan.overview?.totalTestCases ?? 0,
            plan.overview?.totalBugs ?? 0,
        ]);
        row.getCell(1).value = linkFormula(names.suites, plan.name, "A1");
        row.getCell(1).font = { ...LINK_FONT };
    }
    if (sheet.rowCount >= planStart) {
        zebra(sheet, planStart, sheet.rowCount, 3);
    }

    // Charts (right-hand column)
    const chartCol = 4;
    let chartRow = 1;
    const stack = (uri: string, rows: number) => {
        placeChart(wb, sheet, uri, chartCol, chartRow, rows);
        // ~15px default row height; leave a 2-row gap between charts.
        chartRow += Math.ceil(chartHeight(rows) / 15) + 2;
    };

    stack(
        renderBarChartPng(tr("chartTestExecution"), [
            { label: tr("passed"), value: agg.counts.Passed, color: OUTCOME_HEX.Passed },
            { label: tr("failed"), value: agg.counts.Failed, color: OUTCOME_HEX.Failed },
            {
                label: tr("blocked"),
                value: agg.counts.Blocked,
                color: OUTCOME_HEX.Blocked,
            },
            {
                label: tr("notApplicable"),
                value: agg.counts.NotApplicable,
                color: OUTCOME_HEX.NotApplicable,
            },
            {
                label: tr("notRun"),
                value: agg.counts.NotRun,
                color: OUTCOME_HEX.NotRun,
            },
        ]),
        5
    );

    if (statusEntries.length > 0) {
        stack(
            renderBarChartPng(
                tr("byStatusSection"),
                statusEntries.map(([name, value]) => ({
                    label: name,
                    value,
                    color: STATUS_HEX[name] ?? "#4472C4",
                }))
            ),
            statusEntries.length
        );
    }

    if (sevEntries.length > 0) {
        stack(
            renderBarChartPng(
                tr("bySeveritySection"),
                sevEntries.map(([name, value]) => ({
                    label: name,
                    value,
                    color: `#${severityFillArgb(name).slice(2)}`,
                }))
            ),
            sevEntries.length
        );
    }

    if (originNames.length > 0) {
        stack(
            renderBarChartPng(
                tr("byOriginSection"),
                originNames.map((name) => ({
                    label: name,
                    value: report.byOriginDetected[name] ?? 0,
                    color: ORIGIN_HEX[name] ?? "#4472C4",
                }))
            ),
            originNames.length
        );
    }
}

function severityFillArgb(raw: string): string {
    switch (severityRank(raw)) {
        case 1:
            return "FFC00000";
        case 2:
            return "FFED7D31";
        case 3:
            return "FFFFC000";
        default:
            return "FF808080";
    }
}

function buildBugsSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.bugs, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 70 },
        { header: tr("status"), width: 16 },
        { header: tr("severity"), width: 16 },
        { header: tr("priority"), width: 10 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("link"), width: 10 },
    ];
    styleHeaderRow(sheet, 1, 11);

    const bugs = [...data.stats.sprintDefectReport.effectiveDefects].sort(
        (a, b) =>
            severityRank(a.severity) - severityRank(b.severity) || a.id - b.id
    );

    for (const bug of bugs) {
        const row = sheet.addRow([
            bug.id,
            bug.title,
            bug.state,
            bug.severity ?? "-",
            bug.priority ?? "-",
            assigneeName(bug.assignee, t),
            bug.creator ?? "-",
            dateCell(bug.createdDate),
            dateCell(bug.changedDate),
            dateCell(bug.closedDate),
            bug.url ? tr("open") : "-",
        ]);

        const sevCell = row.getCell(4);
        if (bug.severity && severityRank(bug.severity) <= 3) {
            sevCell.fill = solid(severityFillArgb(bug.severity));
            sevCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
        }

        const stateHex = STATUS_HEX[bug.state];
        if (stateHex) {
            row.getCell(3).font = { color: { argb: `FF${stateHex.slice(1)}` }, bold: true };
        }

        if (bug.url) {
            row.getCell(11).value = { text: tr("open"), hyperlink: bug.url };
            row.getCell(11).font = { ...LINK_FONT };
        }
    }

    zebra(sheet, 2, sheet.rowCount, 11);
    autoFitColumns(sheet);
    sheet.getColumn(2).width = Math.min(sheet.getColumn(2).width ?? 70, 90);
    for (const col of [8, 9, 10]) {
        sheet.getColumn(col).width = 18;
    }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
}


// bug id -> severity, from the sprint's canonical defect list (the per-suite
// BugInfo objects don't carry severity themselves).
function severityByBugId(data: DynamicSprintReportExcelData): Map<number, string> {
    const map = new Map<number, string>();
    for (const bug of data.stats.sprintDefectReport.effectiveDefects) {
        if (bug.severity) map.set(bug.id, bug.severity);
    }
    for (const list of [
        data.stats.sprintDefectReport.dsiDefects,
        data.stats.sprintDefectReport.todaysDefects,
    ]) {
        for (const bug of list ?? []) {
            if (bug.severity && !map.has(bug.id)) map.set(bug.id, bug.severity);
        }
    }
    return map;
}

function buildBugsBySuiteSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.bugsBySuite, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
        { header: tr("plan"), width: 30 },
        { header: tr("suite"), width: 34 },
        { header: tr("suiteId"), width: 10 },
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 60 },
        { header: tr("status"), width: 16 },
        { header: tr("severity"), width: 16 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("link"), width: 10 },
    ];
    styleHeaderRow(sheet, 1, 13);

    const sevById = severityByBugId(data);

    for (const plan of data.plans) {
        for (const suite of plan.overview?.suites ?? []) {
            for (const bug of suite.bugs) {
                const severity = sevById.get(bug.id);
                const row = sheet.addRow([
                    plan.name,
                    suite.suiteName,
                    suite.suiteId,
                    bug.id,
                    bug.title,
                    bug.state,
                    severity ?? "-",
                    assigneeName(bug.assignee, t),
                    bug.creator ?? "-",
                    dateCell(bug.createdDate),
                    dateCell(bug.changedDate),
                    dateCell(bug.closedDate),
                    bug.url ? tr("open") : "-",
                ]);
                const stateHex = STATUS_HEX[bug.state];
                if (stateHex) {
                    row.getCell(6).font = {
                        color: { argb: `FF${stateHex.slice(1)}` },
                        bold: true,
                    };
                }
                if (severity && severityRank(severity) <= 3) {
                    const sevCell = row.getCell(7);
                    sevCell.fill = solid(severityFillArgb(severity));
                    sevCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
                }
                if (bug.url) {
                    row.getCell(13).value = { text: tr("open"), hyperlink: bug.url };
                    row.getCell(13).font = { ...LINK_FONT };
                }
            }
        }
    }

    if (sheet.rowCount === 1) {
        sheet.addRow([tr("noData")]);
    }
    zebra(sheet, 2, sheet.rowCount, 13);
    autoFitColumns(sheet);
    sheet.getColumn(5).width = Math.min(sheet.getColumn(5).width ?? 60, 80);
    for (const col of [10, 11, 12]) {
        sheet.getColumn(col).width = 18;
    }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };
}

// Every detected bug (any origin, in- or out-of-scope) created or last changed
// today in the report timezone - the list comes pre-filtered and pre-sorted
// (newest activity first) from the server as report.todaysDefects.
function buildTodaysBugsSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.todaysBugs, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 70 },
        { header: tr("origin"), width: 16 },
        { header: tr("scope"), width: 16 },
        { header: tr("status"), width: 16 },
        { header: tr("severity"), width: 16 },
        { header: tr("priority"), width: 10 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("link"), width: 10 },
    ];
    styleHeaderRow(sheet, 1, 13);

    const bugs = data.stats.sprintDefectReport.todaysDefects ?? [];

    for (const bug of bugs) {
        const row = sheet.addRow([
            bug.id,
            bug.title,
            bug.origin ?? "-",
            bug.outOfScope ? tr("outOfScope") : tr("inScope"),
            bug.state,
            bug.severity ?? "-",
            bug.priority ?? "-",
            assigneeName(bug.assignee, t),
            bug.creator ?? "-",
            dateCell(bug.createdDate),
            dateCell(bug.changedDate),
            dateCell(bug.closedDate),
            bug.url ? tr("open") : "-",
        ]);

        const sevCell = row.getCell(6);
        if (bug.severity && severityRank(bug.severity) <= 3) {
            sevCell.fill = solid(severityFillArgb(bug.severity));
            sevCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
        }

        const stateHex = STATUS_HEX[bug.state];
        if (stateHex) {
            row.getCell(5).font = { color: { argb: `FF${stateHex.slice(1)}` }, bold: true };
        }

        if (bug.url) {
            row.getCell(13).value = { text: tr("open"), hyperlink: bug.url };
            row.getCell(13).font = { ...LINK_FONT };
        }
    }

    if (bugs.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, 13);
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };
    }

    autoFitColumns(sheet);
    sheet.getColumn(2).width = Math.min(sheet.getColumn(2).width ?? 70, 90);
    for (const col of [10, 11, 12]) {
        sheet.getColumn(col).width = 18;
    }
}

function buildDsiSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    dsiBugs: BugInfo[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.dsi, {
        views: [{ showGridLines: false }],
    });
    sheet.columns = [
        { width: 12 },
        { width: 44 },
        { width: 80 },
        { width: 16 },
        { width: 26 },
        { width: 26 },
        { width: 18, style: { numFmt: DATE_NUM_FMT } },
        { width: 18, style: { numFmt: DATE_NUM_FMT } },
        { width: 18, style: { numFmt: DATE_NUM_FMT } },
        { width: 10 },
    ];

    const report = data.stats.sprintDefectReport;
    const detected = report.byOriginDetected["DSI"] ?? 0;
    const accepted = report.byOrigin["DSI"] ?? 0;
    const open = dsiBugs.filter(isOpenBug).length;

    const titleRow = sheet.addRow([tr("dsiSection")]);
    sheet.mergeCells(titleRow.number, 1, titleRow.number, 10);
    titleRow.getCell(1).font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).fill = solid("FFAD1457");
    titleRow.height = 24;
    sheet.addRow([]);

    // Panel
    const panelStart = sheet.rowCount + 1;
    const dsiByStatus = new Map<string, number>();
    for (const bug of dsiBugs) {
        dsiByStatus.set(bug.state, (dsiByStatus.get(bug.state) ?? 0) + 1);
    }
    const panelRows: [string, string | number][] = [
        [tr("dsiDetected"), detected],
        [tr("dsiAccepted"), accepted],
        [tr("dsiShareOfTotal"), `${pct(detected, report.total)}%`],
        [tr("dsiOpen"), open],
        [tr("dsiClosed"), Math.max(dsiBugs.length - open, 0)],
        [tr("dsiPendingVerification"), data.stats.verificaActivitySummary.dsiPendingCount],
    ];
    panelRows.forEach(([label, value]) => {
        const row = sheet.addRow([label, value]);
        row.getCell(1).font = { bold: true };
        row.getCell(1).fill = solid(PANEL_FILL);
    });
    zebra(sheet, panelStart, sheet.rowCount, 2);
    sheet.addRow([]);

    // Detail table - description / assignee / state front and centre
    addSectionTitle(sheet, tr("dsiBugListSection"), 10);
    const headerRow = sheet.addRow([
        tr("bugId"),
        tr("bugTitle"),
        tr("bugDescription"),
        tr("status"),
        tr("assignee"),
        tr("creator"),
        tr("createdDate"),
        tr("changedDate"),
        tr("closedDate"),
        tr("link"),
    ]);
    styleHeaderRow(sheet, headerRow.number, 10);
    const listStart = sheet.rowCount + 1;

    for (const bug of dsiBugs) {
        const row = sheet.addRow([
            bug.id,
            bug.title,
            bug.description ?? "-",
            bug.state,
            assigneeName(bug.assignee, t),
            bug.creator ?? "-",
            dateCell(bug.createdDate),
            dateCell(bug.changedDate),
            dateCell(bug.closedDate),
            bug.url ? tr("open") : "-",
        ]);
        row.getCell(3).alignment = { wrapText: true, vertical: "top" };
        const stateHex = STATUS_HEX[bug.state];
        if (stateHex) {
            row.getCell(4).font = { color: { argb: `FF${stateHex.slice(1)}` }, bold: true };
        }
        if (bug.url) {
            row.getCell(10).value = { text: tr("open"), hyperlink: bug.url };
            row.getCell(10).font = { ...LINK_FONT };
        }
    }

    if (dsiBugs.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, listStart, sheet.rowCount, 10);
        sheet.autoFilter = {
            from: { row: headerRow.number, column: 1 },
            to: { row: headerRow.number, column: 10 },
        };
    }

    // DSI status chart
    if (dsiByStatus.size > 0) {
        const entries = [...dsiByStatus.entries()].sort((a, b) => b[1] - a[1]);
        placeChart(
            wb,
            sheet,
            renderBarChartPng(
                tr("dsiByStatusChart"),
                entries.map(([name, value]) => ({
                    label: name,
                    value,
                    color: STATUS_HEX[name] ?? "#AD1457",
                }))
            ),
            11,
            2,
            entries.length
        );
    }
}

const BUSINESS_HEADER_KEYS = [
    "bugId",
    "bugTitle",
    "status",
    "bugOpen",
    "severity",
    "priority",
    "assignee",
    "creator",
    "createdDate",
    "changedDate",
    "closedDate",
    "bugDescription",
] as const;

function businessValueCells(
    bug: BugInfo & { severity?: string },
    t: TranslateFn
): (string | number | Date)[] {
    return [
        bug.id,
        bug.title,
        bug.state,
        isOpenBug(bug) ? YES : NO,
        bug.severity ?? "-",
        bug.priority ?? "-",
        assigneeName(bug.assignee, t),
        bug.creator ?? "-",
        dateCell(bug.createdDate),
        dateCell(bug.changedDate),
        dateCell(bug.closedDate),
        bug.description ?? "-",
    ];
}

// `base` = 1-based column of the bug id. status at base+2, severity at base+4,
// description at base+11, link at base+12.
function styleBusinessRow(
    row: ExcelRow,
    base: number,
    bug: BugInfo & { severity?: string },
    linkLabel: string
): void {
    const stateHex = STATUS_HEX[bug.state];
    if (stateHex) {
        row.getCell(base + 2).font = {
            color: { argb: `FF${stateHex.slice(1)}` },
            bold: true,
        };
    }
    if (bug.severity && severityRank(bug.severity) <= 3) {
        const sevCell = row.getCell(base + 4);
        sevCell.fill = solid(severityFillArgb(bug.severity));
        sevCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    }
    row.getCell(base + 11).alignment = { wrapText: true, vertical: "top" };
    if (bug.url) {
        const linkCell = row.getCell(base + 12);
        linkCell.value = { text: linkLabel, hyperlink: bug.url };
        linkCell.font = { ...LINK_FONT };
    }
}

function buildBusinessSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.business, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 60 },
        { header: tr("status"), width: 16 },
        { header: tr("bugOpen"), width: 10 },
        { header: tr("severity"), width: 16 },
        { header: tr("priority"), width: 10 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("bugDescription"), width: 70 },
        { header: tr("link"), width: 10 },
    ];
    styleHeaderRow(sheet, 1, 13);

    const bugs = businessBugsFrom(data);
    for (const bug of bugs) {
        const row = sheet.addRow([
            ...businessValueCells(bug, t),
            bug.url ? tr("open") : "-",
        ]);
        styleBusinessRow(row, 1, bug, tr("open"));
    }

    if (bugs.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, 13);
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 13 } };
    }
    autoFitColumns(sheet);
    sheet.getColumn(2).width = Math.min(sheet.getColumn(2).width ?? 60, 80);
    sheet.getColumn(12).width = 70;
    for (const col of [9, 10, 11]) {
        sheet.getColumn(col).width = 18;
    }
}

function buildSuitesSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.suites, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
        { header: tr("plan"), width: 30 },
        { header: tr("suite"), width: 38 },
        { header: tr("suiteId"), width: 10 },
        { header: tr("totalTestCases"), width: 14 },
        { header: tr("passed"), width: 12 },
        { header: tr("failed"), width: 12 },
        { header: tr("blocked"), width: 12 },
        { header: tr("notApplicable"), width: 14 },
        { header: tr("notRun"), width: 14 },
        { header: tr("executedPct"), width: 14 },
        { header: tr("passRate"), width: 12 },
        { header: tr("openBugsShort"), width: 12 },
    ];
    styleHeaderRow(sheet, 1, 12);

    for (const plan of data.plans) {
        for (const suite of plan.overview?.suites ?? []) {
            const c = suite.outcomeCounts;
            const executed = executedCount(c);
            const decided = suite.totalTestCases - c.NotApplicable;
            const row = sheet.addRow([
                plan.name,
                suite.suiteName,
                suite.suiteId,
                suite.totalTestCases,
                c.Passed,
                c.Failed,
                c.Blocked,
                c.NotApplicable,
                c.NotRun,
                0,
                0,
                suite.bugs.filter(isOpenBug).length,
            ]);
            setPercentCell(row.getCell(10), pct(executed, suite.totalTestCases));
            setPercentCell(row.getCell(11), pct(c.Passed, decided));
        }
    }

    if (sheet.rowCount === 1) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, 12);
        addPercentColorScale(sheet, `J2:K${sheet.rowCount}`);
        addDataBar(sheet, `L2:L${sheet.rowCount}`, "FFC62828");
        addDataBar(sheet, `E2:E${sheet.rowCount}`, "FF2E7D32");
        addDataBar(sheet, `F2:F${sheet.rowCount}`, "FFC62828");
    }
    autoFitColumns(sheet);
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 12 } };
}

function fillTestCaseSheet(
    sheet: Worksheet,
    entries: TestCaseEntry[],
    withScope: boolean,
    tr: (key: string) => string
): void {
    const leading = withScope
        ? [{ header: tr("scope"), width: 22 }]
        : [];
    const columns = testCaseColumns(tr, leading);
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    const base = leading.length + 1; // 1-based col of the first tc value cell
    const titleCol = base + 3;

    const sorted = [...entries].sort(
        (a, b) =>
            (a.scopeName ?? "").localeCompare(b.scopeName ?? "") ||
            a.planName.localeCompare(b.planName) ||
            a.tc.suiteName.localeCompare(b.tc.suiteName) ||
            a.tc.testCaseId - b.tc.testCaseId
    );

    for (const { scopeName, planName, tc } of sorted) {
        const cells = testCaseValueCells(planName, tc, tr);
        const row = sheet.addRow(withScope ? [scopeName ?? "-", ...cells] : cells);
        if (withScope) {
            row.getCell(1).font = { bold: true };
        }
        styleTestCaseRow(row, base, tc, tr("open"));
    }

    if (sorted.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, columns.length);
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length },
        };
    }
    autoFitColumns(sheet);
    sheet.getColumn(titleCol).width = Math.min(
        sheet.getColumn(titleCol).width ?? 60,
        80
    );
}

function buildTestCasesSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.testCases, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    fillTestCaseSheet(sheet, collectTestCases(data), false, tr);
}

function buildMultiScopeTestCasesSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetTestCases"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const all = entries.flatMap((entry) =>
        collectTestCases(entry.data, entry.scopeName)
    );
    fillTestCaseSheet(sheet, all, true, tr);
}

function buildPlansSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.plans, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
        { header: tr("planId"), width: 10 },
        { header: tr("planName"), width: 40 },
        { header: tr("suiteCount"), width: 12 },
        { header: tr("totalTestCases"), width: 14 },
        { header: tr("executed"), width: 12 },
        { header: tr("executedPct"), width: 14 },
        { header: tr("passRate"), width: 12 },
        { header: tr("bugCount"), width: 12 },
        { header: tr("azureLink"), width: 10 },
    ];
    styleHeaderRow(sheet, 1, 9);

    for (const plan of data.plans) {
        const overview = plan.overview;
        const executed = overview ? executedCount(overview.outcomeCounts) : 0;
        const decided = overview
            ? overview.totalTestCases - overview.outcomeCounts.NotApplicable
            : 0;
        const row = sheet.addRow([
            plan.id,
            plan.name,
            overview ? overview.suites.length : 0,
            overview ? overview.totalTestCases : 0,
            executed,
            0,
            0,
            overview ? overview.totalBugs : 0,
            plan.url ? tr("open") : "-",
        ]);
        setPercentCell(
            row.getCell(6),
            overview ? pct(executed, overview.totalTestCases) : 0
        );
        setPercentCell(
            row.getCell(7),
            overview ? pct(overview.outcomeCounts.Passed, decided) : 0
        );
        if (plan.url) {
            row.getCell(9).value = { text: tr("open"), hyperlink: plan.url };
            row.getCell(9).font = { ...LINK_FONT };
        }
    }

    if (sheet.rowCount === 1) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, 9);
        addDataBar(sheet, `H2:H${sheet.rowCount}`, "FFC62828");
    }
    autoFitColumns(sheet);
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
}

function buildAssigneesSheet(
    wb: Workbook,
    names: SheetNames,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(names.assignees, {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
        { header: tr("assignee"), width: 34 },
        { header: tr("bugCount"), width: 12 },
    ];
    styleHeaderRow(sheet, 1, 2);

    const entries = sortedEntries(data.stats.byAssignee);
    if (entries.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        entries.forEach(([name, count]) => sheet.addRow([name, count]));
        zebra(sheet, 2, sheet.rowCount, 2);
        addDataBar(sheet, `B2:B${sheet.rowCount}`, "FF1F3864");

        placeChart(
            wb,
            sheet,
            renderBarChartPng(
                tr("byAssigneeChart"),
                entries.slice(0, 12).map(([name, value]) => ({ label: name, value }))
            ),
            4,
            1,
            Math.min(entries.length, 12)
        );
    }
    autoFitColumns(sheet);
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 2 } };
}

/* ================================================================== */
/* Multi-scope (combined) workbook                                     */
/* ================================================================== */
/* Built when the Excel Export page has more than one scope preset     */
/* selected (or "Tutto"). Every scope's own DynamicSprintReportExcelData */
/* is assembled exactly as the single-scope export does; these builders */
/* only stitch them together - each bug/suite/plan sheet gains a        */
/* leading "Ambito" column (inside the autofilter) and the summary      */
/* becomes metric-rows x scope-columns + a Totale column.              */

export interface MultiScopeReportEntry {
    scopeName: string;
    data: DynamicSprintReportExcelData;
}

type ExcelRow = ReturnType<Worksheet["getRow"]>;

function colLetter(n: number): string {
    let s = "";
    let x = n;
    while (x > 0) {
        const m = (x - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        x = Math.floor((x - 1) / 26);
    }
    return s;
}

function sumMaps(maps: Record<string, number>[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const map of maps) {
        for (const [key, value] of Object.entries(map)) {
            out[key] = (out[key] ?? 0) + value;
        }
    }
    return out;
}

// The standard 10 bug cells shared by every bug sheet (id -> closed date),
// in the same order buildBugsSheet uses.
function bugValueCells(
    bug: BugInfo & { severity?: string },
    t: TranslateFn
): (string | number | Date)[] {
    return [
        bug.id,
        bug.title,
        bug.state,
        bug.severity ?? "-",
        bug.priority ?? "-",
        assigneeName(bug.assignee, t),
        bug.creator ?? "-",
        dateCell(bug.createdDate),
        dateCell(bug.changedDate),
        dateCell(bug.closedDate),
    ];
}

// Applies severity fill + state colour + the "Apri" hyperlink to a just-added
// bug row. `base` is the 1-based column of the first bug cell (the bug id);
// state sits at base+2, severity at base+3, the link at base+10.
function styleBugRow(
    row: ExcelRow,
    base: number,
    bug: BugInfo & { severity?: string },
    linkLabel: string
): void {
    if (bug.severity && severityRank(bug.severity) <= 3) {
        const sevCell = row.getCell(base + 3);
        sevCell.fill = solid(severityFillArgb(bug.severity));
        sevCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    }

    const stateHex = STATUS_HEX[bug.state];
    if (stateHex) {
        row.getCell(base + 2).font = {
            color: { argb: `FF${stateHex.slice(1)}` },
            bold: true,
        };
    }

    if (bug.url) {
        const linkCell = row.getCell(base + 10);
        linkCell.value = { text: linkLabel, hyperlink: bug.url };
        linkCell.font = { ...LINK_FONT };
    }
}

interface SummaryMetrics {
    totalTestCases: number;
    executed: number;
    decided: number;
    notApplicable: number;
    notRun: number;
    passed: number;
    totalBugs: number;
    effectiveBugs: number;
    outOfScopeBugs: number;
    closedBugs: number;
    openBugs: number;
    criticalOpen: number;
    reopened: number;
    withoutResolutionDate: number;
    mttrDays: number | null;
    bugsByUs: number;
    bugsByDsi: number;
    bugsByBusiness: number;
    dsiDetected: number;
    dsiAccepted: number;
    dsiOpen: number;
    dsiClosed: number;
    dsiPending: number;
    byStatusAll: Record<string, number>;
    bySeverity: Record<string, number>;
    byOriginDetected: Record<string, number>;
}

// Same numbers buildSummarySheet computes inline, but as a plain object so
// the combined summary can lay them out per scope and re-derive the Totale.
function computeSummaryMetrics(data: DynamicSprintReportExcelData): SummaryMetrics {
    const report = data.stats.sprintDefectReport;
    const agg = aggregatePlans(data.plans);
    const closedAll = report.byStatusAll.Closed ?? 0;
    const bugsByDsi = report.byOriginDetected["DSI"] ?? 0;
    const bugsByBusiness = report.byOriginDetected["Business"] ?? 0;
    const dsiBugs = dsiBugsFrom(data);
    const dsiOpen = dsiBugs.filter(isOpenBug).length;

    return {
        totalTestCases: agg.total,
        executed: executedCount(agg.counts),
        decided: agg.total - agg.counts.NotApplicable,
        notApplicable: agg.counts.NotApplicable,
        notRun: agg.counts.NotRun,
        passed: agg.counts.Passed,
        totalBugs: report.total,
        effectiveBugs: report.effectiveCount,
        outOfScopeBugs: report.outOfScopeCount,
        closedBugs: closedAll,
        openBugs: report.total - closedAll,
        criticalOpen: report.effectiveDefects.filter(
            (bug) => bug.state !== "Closed" && /^1\s*-/.test(bug.severity ?? "")
        ).length,
        reopened: report.reopenedCount,
        withoutResolutionDate: report.withoutResolutionDateCount,
        mttrDays: report.mttrDays,
        bugsByUs: report.total - bugsByDsi - bugsByBusiness,
        bugsByDsi,
        bugsByBusiness,
        dsiDetected: bugsByDsi,
        dsiAccepted: report.byOrigin["DSI"] ?? 0,
        dsiOpen,
        dsiClosed: Math.max(dsiBugs.length - dsiOpen, 0),
        dsiPending: data.stats.verificaActivitySummary.dsiPendingCount,
        byStatusAll: report.byStatusAll,
        bySeverity: report.bySeverity,
        byOriginDetected: report.byOriginDetected,
    };
}

function multiScopeGuideMeta(entries: MultiScopeReportEntry[]): GuideMeta {
    const uniq = (values: string[]) =>
        [...new Set(values.filter(Boolean))].join(", ") || "-";
    return {
        project: uniq(entries.map((e) => e.data.meta.project)),
        areaPath: uniq(entries.map((e) => e.data.meta.areaPath)),
        sprint: uniq(entries.map((e) => e.data.meta.sprint)),
        generatedAt: entries[0]?.data.meta.generatedAt ?? new Date(),
        scopeNames: entries.map((e) => e.scopeName),
    };
}

function buildMultiScopeGuideSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const sheet = wb.addWorksheet(
        t("dynamicSprintReportPage.excel.guide.sheetName"),
        { views: [{ showGridLines: false }] }
    );
    writeGuideSheet(sheet, multiScopeGuideMeta(entries), t);
}

function buildMultiScopeSummarySheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string, opts?: Record<string, unknown>) =>
        t(`dynamicSprintReportPage.excel.${key}`, opts);
    const sheet = wb.addWorksheet(tr("sheetSummary"), {
        views: [{ showGridLines: false }],
    });

    const metrics = entries.map((entry) => computeSummaryMetrics(entry.data));
    const totalCol = entries.length + 2; // label + N scopes + Totale
    const colCount = totalCol;
    const totalLetter = colLetter(totalCol);

    sheet.columns = [
        { width: 34 },
        ...entries.map(() => ({ width: 18 })),
        { width: 16 },
    ];

    const titleRow = sheet.addRow([tr("combinedTitle")]);
    sheet.mergeCells(titleRow.number, 1, titleRow.number, colCount);
    titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).fill = solid(HEADER_FILL);
    titleRow.height = 26;

    const metaValue = (values: string[]) => {
        const uniq = [...new Set(values.filter(Boolean))];
        if (uniq.length === 0) return "-";
        if (uniq.length === 1) return uniq[0];
        return tr("multiScopeValue");
    };
    sheet.addRow([tr("project"), metaValue(entries.map((e) => e.data.meta.project))]);
    sheet.addRow([tr("areaPath"), metaValue(entries.map((e) => e.data.meta.areaPath))]);
    sheet.addRow([tr("sprint"), metaValue(entries.map((e) => e.data.meta.sprint))]);
    sheet.addRow([tr("generatedAt"), formatTimestamp(new Date())]);
    for (let r = 2; r <= 5; r += 1) {
        sheet.getRow(r).getCell(1).font = { bold: true };
    }
    sheet.addRow([]);

    const addGroupHeader = (firstLabel: string) => {
        const row = sheet.addRow([
            firstLabel,
            ...entries.map((entry) => entry.scopeName),
            tr("total"),
        ]);
        styleHeaderRow(sheet, row.number, colCount);
    };

    const numRow = (label: string, pick: (m: SummaryMetrics) => number) => {
        const values = metrics.map(pick);
        const row = sheet.addRow([
            label,
            ...values,
            values.reduce((a, b) => a + b, 0),
        ]);
        row.getCell(1).font = { bold: true };
    };

    const pctRow = (
        label: string,
        parts: (m: SummaryMetrics) => [number, number],
        higherIsBetter = true
    ) => {
        const perScope = metrics.map(parts);
        const totalNum = perScope.reduce((a, [n]) => a + n, 0);
        const totalDen = perScope.reduce((a, [, d]) => a + d, 0);
        const row = sheet.addRow([
            label,
            ...perScope.map(([n, d]) => pct(n, d)),
            pct(totalNum, totalDen),
        ]);
        row.getCell(1).font = { bold: true };
        for (let c = 2; c <= colCount; c += 1) {
            setPercentCell(
                row.getCell(c),
                Number(row.getCell(c).value),
                higherIsBetter
            );
        }
    };

    // KPI - test execution
    addSectionTitle(sheet, tr("kpiTestSection"), colCount);
    addGroupHeader(tr("metric"));
    let sectionStart = sheet.rowCount + 1;
    numRow(tr("totalTestCases"), (m) => m.totalTestCases);
    numRow(tr("executed"), (m) => m.executed);
    pctRow(tr("executedPct"), (m) => [m.executed, m.totalTestCases]);
    pctRow(tr("passRate"), (m) => [m.passed, m.decided]);
    numRow(tr("notApplicable"), (m) => m.notApplicable);
    numRow(tr("notRun"), (m) => m.notRun);
    zebra(sheet, sectionStart, sheet.rowCount, colCount);
    sheet.addRow([]);

    // KPI - bugs
    addSectionTitle(sheet, tr("kpiBugSection"), colCount);
    addGroupHeader(tr("metric"));
    sectionStart = sheet.rowCount + 1;
    numRow(tr("totalBugs"), (m) => m.totalBugs);
    numRow(tr("effectiveBugs"), (m) => m.effectiveBugs);
    numRow(tr("outOfScopeBugs"), (m) => m.outOfScopeBugs);
    numRow(tr("closedBugs"), (m) => m.closedBugs);
    pctRow(tr("closedPct"), (m) => [m.closedBugs, m.totalBugs]);
    numRow(tr("openBugs"), (m) => m.openBugs);
    numRow(tr("criticalOpen"), (m) => m.criticalOpen);
    numRow(tr("reopened"), (m) => m.reopened);
    const mttrRow = sheet.addRow([
        tr("avgClosureDays"),
        ...metrics.map((m) => (m.mttrDays != null ? Math.round(m.mttrDays) : "-")),
        "-",
    ]);
    mttrRow.getCell(1).font = { bold: true };
    numRow(tr("withoutResolutionDate"), (m) => m.withoutResolutionDate);
    numRow(tr("bugsByUs"), (m) => m.bugsByUs);
    numRow(tr("bugsByDsi"), (m) => m.bugsByDsi);
    numRow(tr("bugsByBusiness"), (m) => m.bugsByBusiness);
    zebra(sheet, sectionStart, sheet.rowCount, colCount);
    sheet.addRow([]);

    // DSI
    addSectionTitle(sheet, tr("dsiSection"), colCount);
    addGroupHeader(tr("metric"));
    sectionStart = sheet.rowCount + 1;
    numRow(tr("dsiDetected"), (m) => m.dsiDetected);
    numRow(tr("dsiAccepted"), (m) => m.dsiAccepted);
    pctRow(tr("dsiShareOfTotal"), (m) => [m.dsiDetected, m.totalBugs], false);
    numRow(tr("dsiOpen"), (m) => m.dsiOpen);
    numRow(tr("dsiClosed"), (m) => m.dsiClosed);
    numRow(tr("dsiPendingVerification"), (m) => m.dsiPending);
    zebra(sheet, sectionStart, sheet.rowCount, colCount);
    sheet.addRow([]);

    const breakdown = (
        titleKey: string,
        firstHeader: string,
        map: (m: SummaryMetrics) => Record<string, number>,
        sortKeys: (keys: string[]) => string[],
        labelFill?: (name: string) => string | undefined
    ) => {
        addSectionTitle(sheet, tr(titleKey), colCount);
        addGroupHeader(firstHeader);
        const start = sheet.rowCount + 1;
        const merged = sumMaps(metrics.map(map));
        for (const name of sortKeys(Object.keys(merged))) {
            const values = metrics.map((m) => map(m)[name] ?? 0);
            const row = sheet.addRow([
                name,
                ...values,
                values.reduce((a, b) => a + b, 0),
            ]);
            const fill = labelFill?.(name);
            if (fill) {
                row.getCell(1).fill = solid(fill);
                row.getCell(1).font = { color: { argb: "FFFFFFFF" }, bold: true };
            }
        }
        if (sheet.rowCount >= start) {
            zebra(sheet, start, sheet.rowCount, colCount);
            addDataBar(
                sheet,
                `${totalLetter}${start}:${totalLetter}${sheet.rowCount}`,
                "FF1F3864"
            );
        }
        sheet.addRow([]);
    };

    breakdown(
        "byStatusSection",
        tr("status"),
        (m) => m.byStatusAll,
        (keys) =>
            keys.sort(
                (a, b) => (sumMaps(metrics.map((m) => m.byStatusAll))[b] ?? 0) -
                    (sumMaps(metrics.map((m) => m.byStatusAll))[a] ?? 0)
            ),
        (name) => {
            const hex = STATUS_HEX[name];
            return hex ? `FF${hex.slice(1)}` : undefined;
        }
    );
    breakdown(
        "bySeveritySection",
        tr("severity"),
        (m) => m.bySeverity,
        (keys) => keys.sort((a, b) => severityRank(a) - severityRank(b)),
        (name) => severityFillArgb(name)
    );
    breakdown(
        "byOriginSection",
        tr("origin"),
        (m) => m.byOriginDetected,
        (keys) => keys.sort((a, b) => a.localeCompare(b))
    );
}

function multiScopeBugColumns(
    tr: (key: string) => string,
    leading: { header: string; width: number }[]
) {
    return [
        ...leading,
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 70 },
        { header: tr("status"), width: 16 },
        { header: tr("severity"), width: 16 },
        { header: tr("priority"), width: 10 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("link"), width: 10 },
    ];
}

function finishBugSheet(sheet: Worksheet, rowCount: number, colCount: number, tr: (k: string) => string, titleCol: number) {
    if (rowCount === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, colCount);
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
    }
    autoFitColumns(sheet);
    sheet.getColumn(titleCol).width = Math.min(sheet.getColumn(titleCol).width ?? 70, 90);
}

function buildMultiScopeBugsSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetBugs"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const columns = multiScopeBugColumns(tr, [{ header: tr("scope"), width: 22 }]);
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    const rows = entries.flatMap((entry) =>
        entry.data.stats.sprintDefectReport.effectiveDefects.map((bug) => ({
            scope: entry.scopeName,
            bug,
        }))
    );
    rows.sort(
        (a, b) =>
            a.scope.localeCompare(b.scope) ||
            severityRank(a.bug.severity) - severityRank(b.bug.severity) ||
            a.bug.id - b.bug.id
    );

    for (const { scope, bug } of rows) {
        const row = sheet.addRow([
            scope,
            ...bugValueCells(bug, t),
            bug.url ? tr("open") : "-",
        ]);
        row.getCell(1).font = { bold: true };
        styleBugRow(row, 2, bug, tr("open"));
    }

    finishBugSheet(sheet, rows.length, columns.length, tr, 3);
}

function buildMultiScopeBugsBySuiteSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetBugsBySuite"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const columns = [
        { header: tr("scope"), width: 22 },
        { header: tr("plan"), width: 30 },
        { header: tr("suite"), width: 34 },
        { header: tr("suiteId"), width: 10 },
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 60 },
        { header: tr("status"), width: 16 },
        { header: tr("severity"), width: 16 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("link"), width: 10 },
    ];
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    let count = 0;
    for (const entry of entries) {
        const sevById = severityByBugId(entry.data);
        for (const plan of entry.data.plans) {
            for (const suite of plan.overview?.suites ?? []) {
                for (const bug of suite.bugs) {
                    const severity = sevById.get(bug.id);
                    const row = sheet.addRow([
                        entry.scopeName,
                        plan.name,
                        suite.suiteName,
                        suite.suiteId,
                        bug.id,
                        bug.title,
                        bug.state,
                        severity ?? "-",
                        assigneeName(bug.assignee, t),
                        bug.creator ?? "-",
                        dateCell(bug.createdDate),
                        dateCell(bug.changedDate),
                        dateCell(bug.closedDate),
                        bug.url ? tr("open") : "-",
                    ]);
                    row.getCell(1).font = { bold: true };
                    const stateHex = STATUS_HEX[bug.state];
                    if (stateHex) {
                        row.getCell(7).font = {
                            color: { argb: `FF${stateHex.slice(1)}` },
                            bold: true,
                        };
                    }
                    if (severity && severityRank(severity) <= 3) {
                        const sevCell = row.getCell(8);
                        sevCell.fill = solid(severityFillArgb(severity));
                        sevCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
                    }
                    if (bug.url) {
                        row.getCell(14).value = {
                            text: tr("open"),
                            hyperlink: bug.url,
                        };
                        row.getCell(14).font = { ...LINK_FONT };
                    }
                    count += 1;
                }
            }
        }
    }

    finishBugSheet(sheet, count, columns.length, tr, 6);
}

function buildMultiScopeTodaysBugsSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetTodaysBugs"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const columns = [
        { header: tr("scope"), width: 22 },
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 70 },
        { header: tr("origin"), width: 16 },
        { header: tr("status"), width: 16 },
        { header: tr("severity"), width: 16 },
        { header: tr("priority"), width: 10 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("link"), width: 10 },
    ];
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    let count = 0;
    for (const entry of entries) {
        for (const bug of entry.data.stats.sprintDefectReport.todaysDefects ?? []) {
            const row = sheet.addRow([
                entry.scopeName,
                bug.id,
                bug.title,
                bug.origin ?? "-",
                bug.state,
                bug.severity ?? "-",
                bug.priority ?? "-",
                assigneeName(bug.assignee, t),
                bug.creator ?? "-",
                dateCell(bug.createdDate),
                dateCell(bug.changedDate),
                dateCell(bug.closedDate),
                bug.url ? tr("open") : "-",
            ]);
            row.getCell(1).font = { bold: true };
            if (bug.severity && severityRank(bug.severity) <= 3) {
                const sevCell = row.getCell(6);
                sevCell.fill = solid(severityFillArgb(bug.severity));
                sevCell.font = { color: { argb: "FFFFFFFF" }, bold: true };
            }
            const stateHex = STATUS_HEX[bug.state];
            if (stateHex) {
                row.getCell(5).font = {
                    color: { argb: `FF${stateHex.slice(1)}` },
                    bold: true,
                };
            }
            if (bug.url) {
                row.getCell(13).value = { text: tr("open"), hyperlink: bug.url };
                row.getCell(13).font = { ...LINK_FONT };
            }
            count += 1;
        }
    }

    finishBugSheet(sheet, count, columns.length, tr, 3);
}

function buildMultiScopeDsiSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetDsi"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const columns = [
        { header: tr("scope"), width: 22 },
        { header: tr("bugId"), width: 12 },
        { header: tr("bugTitle"), width: 44 },
        { header: tr("bugDescription"), width: 70 },
        { header: tr("status"), width: 16 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("link"), width: 10 },
    ];
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    let count = 0;
    for (const entry of entries) {
        for (const bug of dsiBugsFrom(entry.data)) {
            const row = sheet.addRow([
                entry.scopeName,
                bug.id,
                bug.title,
                bug.description ?? "-",
                bug.state,
                assigneeName(bug.assignee, t),
                bug.creator ?? "-",
                dateCell(bug.createdDate),
                dateCell(bug.changedDate),
                dateCell(bug.closedDate),
                bug.url ? tr("open") : "-",
            ]);
            row.getCell(1).font = { bold: true };
            row.getCell(4).alignment = { wrapText: true, vertical: "top" };
            const stateHex = STATUS_HEX[bug.state];
            if (stateHex) {
                row.getCell(5).font = {
                    color: { argb: `FF${stateHex.slice(1)}` },
                    bold: true,
                };
            }
            if (bug.url) {
                row.getCell(11).value = { text: tr("open"), hyperlink: bug.url };
                row.getCell(11).font = { ...LINK_FONT };
            }
            count += 1;
        }
    }

    finishBugSheet(sheet, count, columns.length, tr, 3);
}

function buildMultiScopeBusinessSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetBusiness"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const columns = [
        { header: tr("scope"), width: 22 },
        { header: tr("bugId"), width: 10 },
        { header: tr("bugTitle"), width: 60 },
        { header: tr("status"), width: 16 },
        { header: tr("bugOpen"), width: 10 },
        { header: tr("severity"), width: 16 },
        { header: tr("priority"), width: 10 },
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("createdDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("changedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("closedDate"), width: 18, style: { numFmt: DATE_NUM_FMT } },
        { header: tr("bugDescription"), width: 70 },
        { header: tr("link"), width: 10 },
    ];
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    const rows = entries.flatMap((entry) =>
        businessBugsFrom(entry.data).map((bug) => ({
            scope: entry.scopeName,
            bug,
        }))
    );
    rows.sort(
        (a, b) =>
            a.scope.localeCompare(b.scope) ||
            Number(!isOpenBug(a.bug)) - Number(!isOpenBug(b.bug)) ||
            severityRank(a.bug.severity) - severityRank(b.bug.severity) ||
            a.bug.id - b.bug.id
    );

    for (const { scope, bug } of rows) {
        const row = sheet.addRow([
            scope,
            ...businessValueCells(bug, t),
            bug.url ? tr("open") : "-",
        ]);
        row.getCell(1).font = { bold: true };
        styleBusinessRow(row, 2, bug, tr("open"));
    }

    if (rows.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, columns.length);
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length },
        };
    }
    autoFitColumns(sheet);
    sheet.getColumn(3).width = Math.min(sheet.getColumn(3).width ?? 60, 80);
    sheet.getColumn(13).width = 70;
}

function buildMultiScopeSuitesSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetSuites"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const columns = [
        { header: tr("scope"), width: 22 },
        { header: tr("plan"), width: 30 },
        { header: tr("suite"), width: 38 },
        { header: tr("suiteId"), width: 10 },
        { header: tr("totalTestCases"), width: 14 },
        { header: tr("passed"), width: 12 },
        { header: tr("failed"), width: 12 },
        { header: tr("blocked"), width: 12 },
        { header: tr("notApplicable"), width: 14 },
        { header: tr("notRun"), width: 14 },
        { header: tr("executedPct"), width: 14 },
        { header: tr("passRate"), width: 12 },
        { header: tr("openBugsShort"), width: 12 },
    ];
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    let count = 0;
    for (const entry of entries) {
        for (const plan of entry.data.plans) {
            for (const suite of plan.overview?.suites ?? []) {
                const c = suite.outcomeCounts;
                const executed = executedCount(c);
                const decided = suite.totalTestCases - c.NotApplicable;
                const row = sheet.addRow([
                    entry.scopeName,
                    plan.name,
                    suite.suiteName,
                    suite.suiteId,
                    suite.totalTestCases,
                    c.Passed,
                    c.Failed,
                    c.Blocked,
                    c.NotApplicable,
                    c.NotRun,
                    0,
                    0,
                    suite.bugs.filter(isOpenBug).length,
                ]);
                row.getCell(1).font = { bold: true };
                setPercentCell(row.getCell(11), pct(executed, suite.totalTestCases));
                setPercentCell(row.getCell(12), pct(c.Passed, decided));
                count += 1;
            }
        }
    }

    if (count === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, columns.length);
        addDataBar(sheet, `M2:M${sheet.rowCount}`, "FFC62828");
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length },
        };
    }
    autoFitColumns(sheet);
}

function buildMultiScopePlansSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetPlans"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const columns = [
        { header: tr("scope"), width: 22 },
        { header: tr("planId"), width: 10 },
        { header: tr("planName"), width: 40 },
        { header: tr("suiteCount"), width: 12 },
        { header: tr("totalTestCases"), width: 14 },
        { header: tr("executed"), width: 12 },
        { header: tr("executedPct"), width: 14 },
        { header: tr("passRate"), width: 12 },
        { header: tr("bugCount"), width: 12 },
    ];
    sheet.columns = columns;
    styleHeaderRow(sheet, 1, columns.length);

    let count = 0;
    for (const entry of entries) {
        for (const plan of entry.data.plans) {
            const overview = plan.overview;
            const executed = overview ? executedCount(overview.outcomeCounts) : 0;
            const decided = overview
                ? overview.totalTestCases - overview.outcomeCounts.NotApplicable
                : 0;
            const row = sheet.addRow([
                entry.scopeName,
                plan.id,
                plan.name,
                overview ? overview.suites.length : 0,
                overview ? overview.totalTestCases : 0,
                executed,
                0,
                0,
                overview ? overview.totalBugs : 0,
            ]);
            row.getCell(1).font = { bold: true };
            setPercentCell(
                row.getCell(7),
                overview ? pct(executed, overview.totalTestCases) : 0
            );
            setPercentCell(
                row.getCell(8),
                overview ? pct(overview.outcomeCounts.Passed, decided) : 0
            );
            count += 1;
        }
    }

    if (count === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, columns.length);
        addDataBar(sheet, `I2:I${sheet.rowCount}`, "FFC62828");
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length },
        };
    }
    autoFitColumns(sheet);
}

function buildMultiScopeAssigneesSheet(
    wb: Workbook,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): void {
    const tr = (key: string) => t(`dynamicSprintReportPage.excel.${key}`);
    const sheet = wb.addWorksheet(tr("sheetAssignees"), {
        views: [{ state: "frozen", ySplit: 1 }],
    });
    const colCount = entries.length + 2;
    sheet.columns = [
        { header: tr("assignee"), width: 34 },
        ...entries.map((entry) => ({ header: entry.scopeName, width: 18 })),
        { header: tr("total"), width: 12 },
    ];
    styleHeaderRow(sheet, 1, colCount);

    const perScope = entries.map((entry) => entry.data.stats.byAssignee);
    const names = sortedEntries(sumMaps(perScope)).map(([name]) => name);

    for (const name of names) {
        const values = perScope.map((map) => map[name] ?? 0);
        sheet.addRow([name, ...values, values.reduce((a, b) => a + b, 0)]);
    }

    if (names.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, 2, sheet.rowCount, colCount);
        addDataBar(
            sheet,
            `${colLetter(colCount)}2:${colLetter(colCount)}${sheet.rowCount}`,
            "FF1F3864"
        );
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
    }
    autoFitColumns(sheet);
}

export async function exportMultiScopeReportToExcel(
    filename: string,
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): Promise<void> {
    if (entries.length === 0) {
        return;
    }
    if (entries.length === 1) {
        return exportDynamicSprintReportToExcel(filename, entries[0].data, t);
    }

    const excelModule = (await import("exceljs")) as typeof import("exceljs") & {
        default?: typeof import("exceljs");
    };
    const Workbook = excelModule.Workbook ?? excelModule.default?.Workbook;

    if (!Workbook) {
        throw new Error("exceljs failed to load");
    }

    const wb = new Workbook();
    wb.creator = "Azure QA Dashboard";
    wb.created = new Date();

    buildMultiScopeGuideSheet(wb, entries, t);
    buildMultiScopeSummarySheet(wb, entries, t);
    buildMultiScopeBugsSheet(wb, entries, t);
    buildMultiScopeBugsBySuiteSheet(wb, entries, t);
    buildMultiScopeTodaysBugsSheet(wb, entries, t);
    buildMultiScopeDsiSheet(wb, entries, t);
    buildMultiScopeBusinessSheet(wb, entries, t);
    buildMultiScopeSuitesSheet(wb, entries, t);
    buildMultiScopeTestCasesSheet(wb, entries, t);
    buildMultiScopePlansSheet(wb, entries, t);
    buildMultiScopeAssigneesSheet(wb, entries, t);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(
        new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        filename
    );
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function exportDynamicSprintReportToExcel(
    filename: string,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): Promise<void> {
    const names: SheetNames = {
        guide: t("dynamicSprintReportPage.excel.guide.sheetName"),
        summary: t("dynamicSprintReportPage.excel.sheetSummary"),
        bugs: t("dynamicSprintReportPage.excel.sheetBugs"),
        bugsBySuite: t("dynamicSprintReportPage.excel.sheetBugsBySuite"),
        todaysBugs: t("dynamicSprintReportPage.excel.sheetTodaysBugs"),
        dsi: t("dynamicSprintReportPage.excel.sheetDsi"),
        business: t("dynamicSprintReportPage.excel.sheetBusiness"),
        suites: t("dynamicSprintReportPage.excel.sheetSuites"),
        testCases: t("dynamicSprintReportPage.excel.sheetTestCases"),
        plans: t("dynamicSprintReportPage.excel.sheetPlans"),
        assignees: t("dynamicSprintReportPage.excel.sheetAssignees"),
    };

    // Dynamically imported so exceljs (~1 MB) only loads when a report is
    // actually exported, rather than being pulled into this route's eager
    // chunk alongside jspdf/pptxgenjs. The `default` fallback covers bundlers
    // that expose the CJS module only under the default interop key.
    const excelModule = (await import("exceljs")) as typeof import("exceljs") & {
        default?: typeof import("exceljs");
    };
    const Workbook = excelModule.Workbook ?? excelModule.default?.Workbook;

    if (!Workbook) {
        throw new Error("exceljs failed to load");
    }

    const dsiBugs = dsiBugsFrom(data);

    const wb = new Workbook();
    wb.creator = "Azure QA Dashboard";
    wb.created = data.meta.generatedAt;

    buildGuideSheet(wb, names, data, t);
    buildSummarySheet(wb, names, data, dsiBugs, t);
    buildBugsSheet(wb, names, data, t);
    buildBugsBySuiteSheet(wb, names, data, t);
    buildTodaysBugsSheet(wb, names, data, t);
    buildDsiSheet(wb, names, data, dsiBugs, t);
    buildBusinessSheet(wb, names, data, t);
    buildSuitesSheet(wb, names, data, t);
    buildTestCasesSheet(wb, names, data, t);
    buildPlansSheet(wb, names, data, t);
    buildAssigneesSheet(wb, names, data, t);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(
        new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        filename
    );
}

/* ================================================================== */
/* On-screen preview model                                             */
/* ================================================================== */
/* A lightweight, style-free mirror of the workbook's tabular content, */
/* rendered in-app (see ExcelReportPreview.tsx) so a manager can check  */
/* the numbers before downloading. It reuses every computation helper   */
/* above; only the column selection is restated.                       */

export type PreviewCellKind =
    | "text"
    | "number"
    | "percent"
    | "percentInverse"
    | "link"
    | "severity"
    | "status";

export interface PreviewCell {
    value: string | number | null;
    kind?: PreviewCellKind;
    href?: string;
}

export interface PreviewTable {
    title: string;
    columns: string[];
    rows: PreviewCell[][];
    // Set when the row list was capped for display - the real file has them all.
    hiddenRowCount?: number;
}

export interface PreviewSheet {
    name: string;
    tables: PreviewTable[];
}

// Keeps the preview responsive even for a sprint with hundreds of bugs; the
// downloaded workbook is never capped.
const PREVIEW_ROW_CAP = 100;

// The multi-scope preview feeds the embedded Univer spreadsheet (UniverSheet)
// rather than a static table, so it keeps far more rows - still bounded so a
// huge combined report can't lock the browser.
const MULTI_SCOPE_PREVIEW_CAP = 3000;

const txt = (value: string | number | null | undefined): PreviewCell => ({
    value: value ?? "-",
});
const numCell = (value: number | null | undefined): PreviewCell => ({
    value: value ?? 0,
    kind: "number",
});
const pctCell = (value: number, inverse = false): PreviewCell => ({
    value,
    kind: inverse ? "percentInverse" : "percent",
});
const linkCell = (label: string, href?: string): PreviewCell =>
    href ? { value: label, kind: "link", href } : { value: label };

function capRows(
    rows: PreviewCell[][],
    cap = PREVIEW_ROW_CAP
): Pick<PreviewTable, "rows" | "hiddenRowCount"> {
    if (rows.length <= cap) {
        return { rows };
    }
    return {
        rows: rows.slice(0, cap),
        hiddenRowCount: rows.length - cap,
    };
}

export function buildReportPreview(
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): PreviewSheet[] {
    const tr = (key: string, opts?: Record<string, unknown>) =>
        t(`dynamicSprintReportPage.excel.${key}`, opts);
    const report = data.stats.sprintDefectReport;
    const agg = aggregatePlans(data.plans);
    const executed = executedCount(agg.counts);
    const decided = agg.total - agg.counts.NotApplicable;
    const dsiBugs = dsiBugsFrom(data);

    const metricCols = [tr("metric"), tr("value")];

    /* -------- Summary -------- */
    const closedAll = report.byStatusAll.Closed ?? 0;
    const bugsByDsi = report.byOriginDetected["DSI"] ?? 0;
    const bugsByBusiness = report.byOriginDetected["Business"] ?? 0;
    const criticalOpen = report.effectiveDefects.filter(
        (bug) => bug.state !== "Closed" && severityRank(bug.severity) === 1
    ).length;
    const dsiOpen = dsiBugs.filter(isOpenBug).length;

    const originNames = Array.from(
        new Set([
            ...Object.keys(report.byOriginDetected),
            ...Object.keys(report.byOrigin),
        ])
    ).sort((a, b) => a.localeCompare(b));

    const summary: PreviewSheet = {
        name: tr("sheetSummary"),
        tables: [
            {
                title: tr("index"),
                columns: [tr("metric"), tr("value")],
                rows: [
                    [txt(tr("project")), txt(data.meta.project)],
                    [txt(tr("areaPath")), txt(data.meta.areaPath)],
                    [txt(tr("sprint")), txt(data.meta.sprint)],
                    [txt(tr("generatedAt")), txt(formatTimestamp(data.meta.generatedAt))],
                ],
            },
            {
                title: tr("kpiTestSection"),
                columns: metricCols,
                rows: [
                    [txt(tr("totalTestCases")), numCell(agg.total)],
                    [txt(tr("executed")), numCell(executed)],
                    [txt(tr("executedPct")), pctCell(pct(executed, agg.total))],
                    [txt(tr("passRate")), pctCell(pct(agg.counts.Passed, decided))],
                    [txt(tr("notApplicable")), numCell(agg.counts.NotApplicable)],
                    [txt(tr("notRun")), numCell(agg.counts.NotRun)],
                ],
            },
            {
                title: tr("kpiBugSection"),
                columns: metricCols,
                rows: [
                    [txt(tr("totalBugs")), numCell(report.total)],
                    [txt(tr("effectiveBugs")), numCell(report.effectiveCount)],
                    [txt(tr("outOfScopeBugs")), numCell(report.outOfScopeCount)],
                    [txt(tr("closedBugs")), numCell(closedAll)],
                    [txt(tr("closedPct")), pctCell(pct(closedAll, report.total))],
                    [txt(tr("openBugs")), numCell(report.total - closedAll)],
                    [txt(tr("criticalOpen")), numCell(criticalOpen)],
                    [txt(tr("reopened")), numCell(report.reopenedCount)],
                    [
                        txt(tr("avgClosureDays")),
                        report.mttrDays != null
                            ? numCell(Math.round(report.mttrDays))
                            : txt("-"),
                    ],
                    [
                        txt(tr("withoutResolutionDate")),
                        numCell(report.withoutResolutionDateCount),
                    ],
                    [
                        txt(tr("bugsByUs")),
                        numCell(report.total - bugsByDsi - bugsByBusiness),
                    ],
                    [txt(tr("bugsByDsi")), numCell(bugsByDsi)],
                    [txt(tr("bugsByBusiness")), numCell(bugsByBusiness)],
                ],
            },
            {
                title: tr("dsiSection"),
                columns: metricCols,
                rows: [
                    [txt(tr("dsiDetected")), numCell(report.byOriginDetected["DSI"] ?? 0)],
                    [txt(tr("dsiAccepted")), numCell(report.byOrigin["DSI"] ?? 0)],
                    [
                        txt(tr("dsiShareOfTotal")),
                        pctCell(pct(bugsByDsi, report.total), true),
                    ],
                    [txt(tr("dsiOpen")), numCell(dsiOpen)],
                    [txt(tr("dsiClosed")), numCell(Math.max(dsiBugs.length - dsiOpen, 0))],
                    [
                        txt(tr("dsiPendingVerification")),
                        numCell(data.stats.verificaActivitySummary.dsiPendingCount),
                    ],
                ],
            },
            {
                title: tr("byStatusSection"),
                columns: [tr("status"), tr("count")],
                rows: sortedEntries(report.byStatusAll).map(([name, count]) => [
                    { value: name, kind: "status" as const },
                    numCell(count),
                ]),
            },
            {
                title: tr("bySeveritySection"),
                columns: [tr("severity"), tr("count")],
                rows: Object.entries(report.bySeverity)
                    .sort((a, b) => severityRank(a[0]) - severityRank(b[0]))
                    .map(([name, count]) => [
                        { value: name, kind: "severity" as const },
                        numCell(count),
                    ]),
            },
            {
                title: tr("byOriginSection"),
                columns: [tr("origin"), tr("detected"), tr("accepted")],
                rows: originNames.map((name) => [
                    txt(name),
                    numCell(report.byOriginDetected[name] ?? 0),
                    numCell(report.byOrigin[name] ?? 0),
                ]),
            },
            {
                title: tr("plansSection"),
                columns: [tr("planName"), tr("totalTestCases"), tr("bugCount")],
                rows: data.plans.map((plan) => [
                    txt(plan.name),
                    numCell(plan.overview?.totalTestCases ?? 0),
                    numCell(plan.overview?.totalBugs ?? 0),
                ]),
            },
        ],
    };

    /* -------- Sprint bugs -------- */
    const bugRows: PreviewCell[][] = [...report.effectiveDefects]
        .sort(
            (a, b) =>
                severityRank(a.severity) - severityRank(b.severity) || a.id - b.id
        )
        .map((bug) => [
            linkCell(String(bug.id), bug.url),
            txt(bug.title),
            { value: bug.state, kind: "status" as const },
            { value: bug.severity ?? "-", kind: "severity" as const },
            txt(bug.priority ?? "-"),
            txt(assigneeName(bug.assignee, t)),
            txt(bug.creator ?? "-"),
            txt(formatDate(bug.createdDate)),
            txt(formatDate(bug.changedDate)),
            txt(formatDate(bug.closedDate)),
        ]);

    const bugsSheet: PreviewSheet = {
        name: tr("sheetBugs"),
        tables: [
            {
                title: tr("sheetBugs"),
                columns: [
                    tr("bugId"),
                    tr("bugTitle"),
                    tr("status"),
                    tr("severity"),
                    tr("priority"),
                    tr("assignee"),
                    tr("creator"),
                    tr("createdDate"),
                    tr("changedDate"),
                    tr("closedDate"),
                ],
                ...capRows(bugRows),
            },
        ],
    };


    /* -------- Today's bugs -------- */
    const todaysBugsRows: PreviewCell[][] = (
        report.todaysDefects ?? []
    ).map((bug) => [
        linkCell(String(bug.id), bug.url),
        txt(bug.title),
        txt(bug.origin ?? "-"),
        txt(bug.outOfScope ? tr("outOfScope") : tr("inScope")),
        { value: bug.state, kind: "status" as const },
        { value: bug.severity ?? "-", kind: "severity" as const },
        txt(bug.priority ?? "-"),
        txt(assigneeName(bug.assignee, t)),
        txt(bug.creator ?? "-"),
        txt(formatDate(bug.createdDate)),
        txt(formatDate(bug.changedDate)),
        txt(formatDate(bug.closedDate)),
    ]);

    const todaysBugsSheet: PreviewSheet = {
        name: tr("sheetTodaysBugs"),
        tables: [
            {
                title: tr("sheetTodaysBugs"),
                columns: [
                    tr("bugId"),
                    tr("bugTitle"),
                    tr("origin"),
                    tr("scope"),
                    tr("status"),
                    tr("severity"),
                    tr("priority"),
                    tr("assignee"),
                    tr("creator"),
                    tr("createdDate"),
                    tr("changedDate"),
                    tr("closedDate"),
                ],
                ...capRows(todaysBugsRows),
            },
        ],
    };

    /* -------- Bugs by suite -------- */
    const sevBySuiteBug = severityByBugId(data);
    const bugsBySuiteRows: PreviewCell[][] = [];
    for (const plan of data.plans) {
        for (const suite of plan.overview?.suites ?? []) {
            for (const bug of suite.bugs) {
                bugsBySuiteRows.push([
                    txt(plan.name),
                    txt(suite.suiteName),
                    txt(suite.suiteId),
                    linkCell(String(bug.id), bug.url),
                    txt(bug.title),
                    { value: bug.state, kind: "status" },
                    {
                        value: sevBySuiteBug.get(bug.id) ?? "-",
                        kind: "severity",
                    },
                    txt(assigneeName(bug.assignee, t)),
                    txt(bug.creator ?? "-"),
                    txt(formatDate(bug.createdDate)),
                    txt(formatDate(bug.changedDate)),
                    txt(formatDate(bug.closedDate)),
                ]);
            }
        }
    }

    const bugsBySuiteSheet: PreviewSheet = {
        name: tr("sheetBugsBySuite"),
        tables: [
            {
                title: tr("sheetBugsBySuite"),
                columns: [
                    tr("plan"),
                    tr("suite"),
                    tr("suiteId"),
                    tr("bugId"),
                    tr("bugTitle"),
                    tr("status"),
                    tr("severity"),
                    tr("assignee"),
                    tr("creator"),
                    tr("createdDate"),
                    tr("changedDate"),
                    tr("closedDate"),
                ],
                ...capRows(bugsBySuiteRows),
            },
        ],
    };

    /* -------- DSI -------- */
    const dsiSheet: PreviewSheet = {
        name: tr("sheetDsi"),
        tables: [
            {
                title: tr("dsiSection"),
                columns: metricCols,
                rows: [
                    [txt(tr("dsiDetected")), numCell(report.byOriginDetected["DSI"] ?? 0)],
                    [txt(tr("dsiAccepted")), numCell(report.byOrigin["DSI"] ?? 0)],
                    [
                        txt(tr("dsiShareOfTotal")),
                        pctCell(pct(bugsByDsi, report.total), true),
                    ],
                    [txt(tr("dsiOpen")), numCell(dsiOpen)],
                    [txt(tr("dsiClosed")), numCell(Math.max(dsiBugs.length - dsiOpen, 0))],
                    [
                        txt(tr("dsiPendingVerification")),
                        numCell(data.stats.verificaActivitySummary.dsiPendingCount),
                    ],
                ],
            },
            {
                title: tr("dsiBugListSection"),
                columns: [
                    tr("bugId"),
                    tr("bugTitle"),
                    tr("bugDescription"),
                    tr("status"),
                    tr("assignee"),
                    tr("creator"),
                    tr("createdDate"),
                    tr("changedDate"),
                    tr("closedDate"),
                ],
                ...capRows(
                    dsiBugs.map((bug) => [
                        linkCell(String(bug.id), bug.url),
                        txt(bug.title),
                        txt(bug.description ?? "-"),
                        { value: bug.state, kind: "status" as const },
                        txt(assigneeName(bug.assignee, t)),
                        txt(bug.creator ?? "-"),
                        txt(formatDate(bug.createdDate)),
                        txt(formatDate(bug.changedDate)),
                        txt(formatDate(bug.closedDate)),
                    ])
                ),
            },
        ],
    };

    /* -------- Business -------- */
    const businessSheet: PreviewSheet = {
        name: tr("sheetBusiness"),
        tables: [
            {
                title: tr("sheetBusiness"),
                columns: BUSINESS_HEADER_KEYS.map((k) => tr(k)),
                ...capRows(
                    businessBugsFrom(data).map((bug) => [
                        linkCell(String(bug.id), bug.url),
                        txt(bug.title),
                        { value: bug.state, kind: "status" as const },
                        txt(isOpenBug(bug) ? YES : NO),
                        { value: bug.severity ?? "-", kind: "severity" as const },
                        txt(bug.priority ?? "-"),
                        txt(assigneeName(bug.assignee, t)),
                        txt(bug.creator ?? "-"),
                        txt(formatDate(bug.createdDate)),
                        txt(formatDate(bug.changedDate)),
                        txt(formatDate(bug.closedDate)),
                        txt(bug.description ?? "-"),
                    ])
                ),
            },
        ],
    };

    /* -------- Suites -------- */
    const suiteRows: PreviewCell[][] = [];
    for (const plan of data.plans) {
        for (const suite of plan.overview?.suites ?? []) {
            const c = suite.outcomeCounts;
            const suiteExecuted = executedCount(c);
            const suiteDecided = suite.totalTestCases - c.NotApplicable;
            suiteRows.push([
                txt(plan.name),
                txt(suite.suiteName),
                txt(suite.suiteId),
                numCell(suite.totalTestCases),
                numCell(c.Passed),
                numCell(c.Failed),
                numCell(c.Blocked),
                numCell(c.NotApplicable),
                numCell(c.NotRun),
                pctCell(pct(suiteExecuted, suite.totalTestCases)),
                pctCell(pct(c.Passed, suiteDecided)),
                numCell(suite.bugs.filter(isOpenBug).length),
            ]);
        }
    }

    const suitesSheet: PreviewSheet = {
        name: tr("sheetSuites"),
        tables: [
            {
                title: tr("sheetSuites"),
                columns: [
                    tr("plan"),
                    tr("suite"),
                    tr("suiteId"),
                    tr("totalTestCases"),
                    tr("passed"),
                    tr("failed"),
                    tr("blocked"),
                    tr("notApplicable"),
                    tr("notRun"),
                    tr("executedPct"),
                    tr("passRate"),
                    tr("openBugsShort"),
                ],
                ...capRows(suiteRows),
            },
        ],
    };

    /* -------- Test cases -------- */
    const testCaseRows: PreviewCell[][] = collectTestCases(data)
        .sort(
            (a, b) =>
                a.planName.localeCompare(b.planName) ||
                a.tc.suiteName.localeCompare(b.tc.suiteName) ||
                a.tc.testCaseId - b.tc.testCaseId
        )
        .map(({ planName, tc }) => [
            txt(planName),
            txt(tc.suiteName),
            linkCell(String(tc.testCaseId), tc.url),
            txt(tc.title),
            txt(tc.state ?? "-"),
            numCell(tc.priority),
            txt(tc.outcome),
            txt(tc.executed ? YES : NO),
            txt(tc.notRun ? YES : NO),
            txt(tc.needsRetest ? YES : NO),
            txt(tc.automationStatus ?? "-"),
            txt(tc.assignedTo ?? "-"),
            txt(tc.tester ?? "-"),
            txt(tc.lastRunBy ?? "-"),
            txt(formatDate(tc.lastRunAt)),
            tc.daysSinceLastRun != null
                ? numCell(tc.daysSinceLastRun)
                : txt("-"),
            txt(tc.configuration ?? "-"),
            txt(tc.tags.join(", ") || "-"),
            numCell(tc.bugCount),
            txt(tc.hasOpenBugs ? YES : NO),
            txt(tc.bugIds.join(", ") || "-"),
            txt(tc.areaPath ?? "-"),
        ]);

    const testCasesSheet: PreviewSheet = {
        name: tr("sheetTestCases"),
        tables: [
            {
                title: tr("sheetTestCases"),
                columns: [
                    tr("plan"),
                    tr("suite"),
                    tr("tcId"),
                    tr("tcTitle"),
                    tr("tcState"),
                    tr("priority"),
                    tr("tcOutcome"),
                    tr("tcExecuted"),
                    tr("tcNotRun"),
                    tr("tcNeedsRetest"),
                    tr("tcAutomation"),
                    tr("assignee"),
                    tr("tcTester"),
                    tr("tcLastRunBy"),
                    tr("tcLastRunAt"),
                    tr("tcDaysSinceRun"),
                    tr("tcConfiguration"),
                    tr("tcTags"),
                    tr("bugCount"),
                    tr("openBugsShort"),
                    tr("tcBugIds"),
                    tr("areaPath"),
                ],
                ...capRows(testCaseRows),
            },
        ],
    };

    /* -------- Plans -------- */
    const plansSheet: PreviewSheet = {
        name: tr("sheetPlans"),
        tables: [
            {
                title: tr("sheetPlans"),
                columns: [
                    tr("planId"),
                    tr("planName"),
                    tr("suiteCount"),
                    tr("totalTestCases"),
                    tr("executed"),
                    tr("executedPct"),
                    tr("passRate"),
                    tr("bugCount"),
                ],
                rows: data.plans.map((plan) => {
                    const overview = plan.overview;
                    const planExecuted = overview
                        ? executedCount(overview.outcomeCounts)
                        : 0;
                    const planDecided = overview
                        ? overview.totalTestCases - overview.outcomeCounts.NotApplicable
                        : 0;
                    return [
                        txt(plan.id),
                        linkCell(plan.name, plan.url),
                        numCell(overview ? overview.suites.length : 0),
                        numCell(overview ? overview.totalTestCases : 0),
                        numCell(planExecuted),
                        pctCell(
                            overview ? pct(planExecuted, overview.totalTestCases) : 0
                        ),
                        pctCell(
                            overview
                                ? pct(overview.outcomeCounts.Passed, planDecided)
                                : 0
                        ),
                        numCell(overview ? overview.totalBugs : 0),
                    ];
                }),
            },
        ],
    };

    /* -------- Assignees -------- */
    const assigneesSheet: PreviewSheet = {
        name: tr("sheetAssignees"),
        tables: [
            {
                title: tr("byAssigneeSection"),
                columns: [tr("assignee"), tr("bugCount")],
                rows: sortedEntries(data.stats.byAssignee).map(([name, count]) => [
                    txt(name),
                    numCell(count),
                ]),
            },
        ],
    };

    return [
        guidePreviewSheet(
            {
                project: data.meta.project,
                areaPath: data.meta.areaPath,
                sprint: data.meta.sprint,
                generatedAt: data.meta.generatedAt,
            },
            t
        ),
        summary,
        bugsSheet,
        bugsBySuiteSheet,
        todaysBugsSheet,
        dsiSheet,
        businessSheet,
        suitesSheet,
        testCasesSheet,
        plansSheet,
        assigneesSheet,
    ];
}

/* ================================================================== */
/* Multi-scope on-screen preview                                       */
/* ================================================================== */

export function buildMultiScopePreview(
    entries: MultiScopeReportEntry[],
    t: TranslateFn
): PreviewSheet[] {
    if (entries.length === 1) {
        return buildReportPreview(entries[0].data, t);
    }

    const tr = (key: string, opts?: Record<string, unknown>) =>
        t(`dynamicSprintReportPage.excel.${key}`, opts);
    const cap = (list: PreviewCell[][]) =>
        capRows(list, MULTI_SCOPE_PREVIEW_CAP);
    const scopeNames = entries.map((entry) => entry.scopeName);
    const metrics = entries.map((entry) => computeSummaryMetrics(entry.data));

    const numRow = (label: string, pick: (m: SummaryMetrics) => number): PreviewCell[] => {
        const values = metrics.map(pick);
        return [
            txt(label),
            ...values.map((v) => numCell(v)),
            numCell(values.reduce((a, b) => a + b, 0)),
        ];
    };
    const pctRow = (
        label: string,
        parts: (m: SummaryMetrics) => [number, number],
        inverse = false
    ): PreviewCell[] => {
        const perScope = metrics.map(parts);
        const totalNum = perScope.reduce((a, [n]) => a + n, 0);
        const totalDen = perScope.reduce((a, [, d]) => a + d, 0);
        return [
            txt(label),
            ...perScope.map(([n, d]) => pctCell(pct(n, d), inverse)),
            pctCell(pct(totalNum, totalDen), inverse),
        ];
    };
    const mapRows = (
        pick: (m: SummaryMetrics) => Record<string, number>,
        sortKeys: (keys: string[]) => string[]
    ): PreviewCell[][] => {
        const merged = sumMaps(metrics.map(pick));
        return sortKeys(Object.keys(merged)).map((name) => {
            const values = metrics.map((m) => pick(m)[name] ?? 0);
            return [
                txt(name),
                ...values.map((v) => numCell(v)),
                numCell(values.reduce((a, b) => a + b, 0)),
            ];
        });
    };

    const metricCols = [tr("metric"), ...scopeNames, tr("total")];

    const summarySheet: PreviewSheet = {
        name: tr("sheetSummary"),
        tables: [
            {
                title: tr("kpiTestSection"),
                columns: metricCols,
                rows: [
                    numRow(tr("totalTestCases"), (m) => m.totalTestCases),
                    numRow(tr("executed"), (m) => m.executed),
                    pctRow(tr("executedPct"), (m) => [m.executed, m.totalTestCases]),
                    pctRow(tr("passRate"), (m) => [m.passed, m.decided]),
                    numRow(tr("notApplicable"), (m) => m.notApplicable),
                    numRow(tr("notRun"), (m) => m.notRun),
                ],
            },
            {
                title: tr("kpiBugSection"),
                columns: metricCols,
                rows: [
                    numRow(tr("totalBugs"), (m) => m.totalBugs),
                    numRow(tr("effectiveBugs"), (m) => m.effectiveBugs),
                    numRow(tr("outOfScopeBugs"), (m) => m.outOfScopeBugs),
                    numRow(tr("closedBugs"), (m) => m.closedBugs),
                    pctRow(tr("closedPct"), (m) => [m.closedBugs, m.totalBugs]),
                    numRow(tr("openBugs"), (m) => m.openBugs),
                    numRow(tr("criticalOpen"), (m) => m.criticalOpen),
                    numRow(tr("reopened"), (m) => m.reopened),
                    [
                        txt(tr("avgClosureDays")),
                        ...metrics.map((m) =>
                            m.mttrDays != null ? numCell(Math.round(m.mttrDays)) : txt("-")
                        ),
                        txt("-"),
                    ],
                    numRow(tr("withoutResolutionDate"), (m) => m.withoutResolutionDate),
                    numRow(tr("bugsByUs"), (m) => m.bugsByUs),
                    numRow(tr("bugsByDsi"), (m) => m.bugsByDsi),
                    numRow(tr("bugsByBusiness"), (m) => m.bugsByBusiness),
                ],
            },
            {
                title: tr("dsiSection"),
                columns: metricCols,
                rows: [
                    numRow(tr("dsiDetected"), (m) => m.dsiDetected),
                    numRow(tr("dsiAccepted"), (m) => m.dsiAccepted),
                    pctRow(tr("dsiShareOfTotal"), (m) => [m.dsiDetected, m.totalBugs], true),
                    numRow(tr("dsiOpen"), (m) => m.dsiOpen),
                    numRow(tr("dsiClosed"), (m) => m.dsiClosed),
                    numRow(tr("dsiPendingVerification"), (m) => m.dsiPending),
                ],
            },
            {
                title: tr("byStatusSection"),
                columns: [tr("status"), ...scopeNames, tr("total")],
                rows: mapRows(
                    (m) => m.byStatusAll,
                    (keys) => {
                        const merged = sumMaps(metrics.map((m) => m.byStatusAll));
                        return keys.sort((a, b) => (merged[b] ?? 0) - (merged[a] ?? 0));
                    }
                ),
            },
            {
                title: tr("bySeveritySection"),
                columns: [tr("severity"), ...scopeNames, tr("total")],
                rows: mapRows(
                    (m) => m.bySeverity,
                    (keys) => keys.sort((a, b) => severityRank(a) - severityRank(b))
                ),
            },
            {
                title: tr("byOriginSection"),
                columns: [tr("origin"), ...scopeNames, tr("total")],
                rows: mapRows(
                    (m) => m.byOriginDetected,
                    (keys) => keys.sort((a, b) => a.localeCompare(b))
                ),
            },
        ],
    };

    const bugCells = (bug: BugInfo & { severity?: string }): PreviewCell[] => [
        linkCell(String(bug.id), bug.url),
        txt(bug.title),
        { value: bug.state, kind: "status" as const },
        { value: bug.severity ?? "-", kind: "severity" as const },
        txt(bug.priority ?? "-"),
        txt(assigneeName(bug.assignee, t)),
        txt(bug.creator ?? "-"),
        txt(formatDate(bug.createdDate)),
        txt(formatDate(bug.changedDate)),
        txt(formatDate(bug.closedDate)),
    ];
    const bugCols = [
        tr("bugId"),
        tr("bugTitle"),
        tr("status"),
        tr("severity"),
        tr("priority"),
        tr("assignee"),
        tr("creator"),
        tr("createdDate"),
        tr("changedDate"),
        tr("closedDate"),
    ];

    const bugsRows = entries
        .flatMap((entry) =>
            entry.data.stats.sprintDefectReport.effectiveDefects.map((bug) => ({
                scope: entry.scopeName,
                bug,
            }))
        )
        .sort(
            (a, b) =>
                a.scope.localeCompare(b.scope) ||
                severityRank(a.bug.severity) - severityRank(b.bug.severity) ||
                a.bug.id - b.bug.id
        )
        .map(({ scope, bug }) => [txt(scope), ...bugCells(bug)]);

    const bugsSheet: PreviewSheet = {
        name: tr("sheetBugs"),
        tables: [
            {
                title: tr("sheetBugs"),
                columns: [tr("scope"), ...bugCols],
                ...cap(bugsRows),
            },
        ],
    };

    const bySuiteRows: PreviewCell[][] = [];
    for (const entry of entries) {
        const sevById = severityByBugId(entry.data);
        for (const plan of entry.data.plans) {
            for (const suite of plan.overview?.suites ?? []) {
                for (const bug of suite.bugs) {
                    bySuiteRows.push([
                        txt(entry.scopeName),
                        txt(plan.name),
                        txt(suite.suiteName),
                        txt(suite.suiteId),
                        linkCell(String(bug.id), bug.url),
                        txt(bug.title),
                        { value: bug.state, kind: "status" },
                        {
                            value: sevById.get(bug.id) ?? "-",
                            kind: "severity",
                        },
                        txt(assigneeName(bug.assignee, t)),
                        txt(bug.creator ?? "-"),
                        txt(formatDate(bug.createdDate)),
                        txt(formatDate(bug.changedDate)),
                        txt(formatDate(bug.closedDate)),
                    ]);
                }
            }
        }
    }

    const bugsBySuiteSheet: PreviewSheet = {
        name: tr("sheetBugsBySuite"),
        tables: [
            {
                title: tr("sheetBugsBySuite"),
                columns: [
                    tr("scope"),
                    tr("plan"),
                    tr("suite"),
                    tr("suiteId"),
                    tr("bugId"),
                    tr("bugTitle"),
                    tr("status"),
                    tr("severity"),
                    tr("assignee"),
                    tr("creator"),
                    tr("createdDate"),
                    tr("changedDate"),
                    tr("closedDate"),
                ],
                ...cap(bySuiteRows),
            },
        ],
    };

    const todaysRows: PreviewCell[][] = entries.flatMap((entry) =>
        (entry.data.stats.sprintDefectReport.todaysDefects ?? []).map((bug) => [
            txt(entry.scopeName),
            linkCell(String(bug.id), bug.url),
            txt(bug.title),
            txt(bug.origin ?? "-"),
            { value: bug.state, kind: "status" as const },
            { value: bug.severity ?? "-", kind: "severity" as const },
            txt(bug.priority ?? "-"),
            txt(assigneeName(bug.assignee, t)),
            txt(bug.creator ?? "-"),
            txt(formatDate(bug.createdDate)),
            txt(formatDate(bug.changedDate)),
            txt(formatDate(bug.closedDate)),
        ])
    );
    const todaysSheet: PreviewSheet = {
        name: tr("sheetTodaysBugs"),
        tables: [
            {
                title: tr("sheetTodaysBugs"),
                columns: [
                    tr("scope"),
                    tr("bugId"),
                    tr("bugTitle"),
                    tr("origin"),
                    tr("status"),
                    tr("severity"),
                    tr("priority"),
                    tr("assignee"),
                    tr("creator"),
                    tr("createdDate"),
                    tr("changedDate"),
                    tr("closedDate"),
                ],
                ...cap(todaysRows),
            },
        ],
    };

    const dsiRows: PreviewCell[][] = entries.flatMap((entry) =>
        dsiBugsFrom(entry.data).map((bug) => [
            txt(entry.scopeName),
            linkCell(String(bug.id), bug.url),
            txt(bug.title),
            txt(bug.description ?? "-"),
            { value: bug.state, kind: "status" as const },
            txt(assigneeName(bug.assignee, t)),
            txt(bug.creator ?? "-"),
            txt(formatDate(bug.createdDate)),
            txt(formatDate(bug.changedDate)),
            txt(formatDate(bug.closedDate)),
        ])
    );
    const dsiSheet: PreviewSheet = {
        name: tr("sheetDsi"),
        tables: [
            {
                title: tr("dsiBugListSection"),
                columns: [
                    tr("scope"),
                    tr("bugId"),
                    tr("bugTitle"),
                    tr("bugDescription"),
                    tr("status"),
                    tr("assignee"),
                    tr("creator"),
                    tr("createdDate"),
                    tr("changedDate"),
                    tr("closedDate"),
                ],
                ...cap(dsiRows),
            },
        ],
    };

    const businessRows: PreviewCell[][] = entries
        .flatMap((entry) =>
            businessBugsFrom(entry.data).map((bug) => ({
                scope: entry.scopeName,
                bug,
            }))
        )
        .sort(
            (a, b) =>
                a.scope.localeCompare(b.scope) ||
                Number(!isOpenBug(a.bug)) - Number(!isOpenBug(b.bug)) ||
                severityRank(a.bug.severity) - severityRank(b.bug.severity) ||
                a.bug.id - b.bug.id
        )
        .map(({ scope, bug }) => [
            txt(scope),
            linkCell(String(bug.id), bug.url),
            txt(bug.title),
            { value: bug.state, kind: "status" as const },
            txt(isOpenBug(bug) ? YES : NO),
            { value: bug.severity ?? "-", kind: "severity" as const },
            txt(bug.priority ?? "-"),
            txt(assigneeName(bug.assignee, t)),
            txt(bug.creator ?? "-"),
            txt(formatDate(bug.createdDate)),
            txt(formatDate(bug.changedDate)),
            txt(formatDate(bug.closedDate)),
            txt(bug.description ?? "-"),
        ]);
    const businessSheet: PreviewSheet = {
        name: tr("sheetBusiness"),
        tables: [
            {
                title: tr("sheetBusiness"),
                columns: [tr("scope"), ...BUSINESS_HEADER_KEYS.map((k) => tr(k))],
                ...cap(businessRows),
            },
        ],
    };

    const suiteRows: PreviewCell[][] = [];
    for (const entry of entries) {
        for (const plan of entry.data.plans) {
            for (const suite of plan.overview?.suites ?? []) {
                const c = suite.outcomeCounts;
                const executed = executedCount(c);
                const decided = suite.totalTestCases - c.NotApplicable;
                suiteRows.push([
                    txt(entry.scopeName),
                    txt(plan.name),
                    txt(suite.suiteName),
                    txt(suite.suiteId),
                    numCell(suite.totalTestCases),
                    numCell(c.Passed),
                    numCell(c.Failed),
                    numCell(c.Blocked),
                    numCell(c.NotApplicable),
                    numCell(c.NotRun),
                    pctCell(pct(executed, suite.totalTestCases)),
                    pctCell(pct(c.Passed, decided)),
                    numCell(suite.bugs.filter(isOpenBug).length),
                ]);
            }
        }
    }
    const suitesSheet: PreviewSheet = {
        name: tr("sheetSuites"),
        tables: [
            {
                title: tr("sheetSuites"),
                columns: [
                    tr("scope"),
                    tr("plan"),
                    tr("suite"),
                    tr("suiteId"),
                    tr("totalTestCases"),
                    tr("passed"),
                    tr("failed"),
                    tr("blocked"),
                    tr("notApplicable"),
                    tr("notRun"),
                    tr("executedPct"),
                    tr("passRate"),
                    tr("openBugsShort"),
                ],
                ...cap(suiteRows),
            },
        ],
    };

    const testCaseRows: PreviewCell[][] = entries
        .flatMap((entry) =>
            collectTestCases(entry.data, entry.scopeName)
        )
        .sort(
            (a, b) =>
                (a.scopeName ?? "").localeCompare(b.scopeName ?? "") ||
                a.planName.localeCompare(b.planName) ||
                a.tc.suiteName.localeCompare(b.tc.suiteName) ||
                a.tc.testCaseId - b.tc.testCaseId
        )
        .map(({ scopeName, planName, tc }) => [
            txt(scopeName ?? "-"),
            txt(planName),
            txt(tc.suiteName),
            linkCell(String(tc.testCaseId), tc.url),
            txt(tc.title),
            txt(tc.state ?? "-"),
            numCell(tc.priority),
            txt(tc.outcome),
            txt(tc.executed ? YES : NO),
            txt(tc.notRun ? YES : NO),
            txt(tc.needsRetest ? YES : NO),
            txt(tc.automationStatus ?? "-"),
            txt(tc.assignedTo ?? "-"),
            txt(tc.tester ?? "-"),
            txt(tc.lastRunBy ?? "-"),
            txt(formatDate(tc.lastRunAt)),
            tc.daysSinceLastRun != null
                ? numCell(tc.daysSinceLastRun)
                : txt("-"),
            txt(tc.configuration ?? "-"),
            txt(tc.tags.join(", ") || "-"),
            numCell(tc.bugCount),
            txt(tc.hasOpenBugs ? YES : NO),
            txt(tc.bugIds.join(", ") || "-"),
            txt(tc.areaPath ?? "-"),
        ]);
    const testCasesSheet: PreviewSheet = {
        name: tr("sheetTestCases"),
        tables: [
            {
                title: tr("sheetTestCases"),
                columns: [
                    tr("scope"),
                    tr("plan"),
                    tr("suite"),
                    tr("tcId"),
                    tr("tcTitle"),
                    tr("tcState"),
                    tr("priority"),
                    tr("tcOutcome"),
                    tr("tcExecuted"),
                    tr("tcNotRun"),
                    tr("tcNeedsRetest"),
                    tr("tcAutomation"),
                    tr("assignee"),
                    tr("tcTester"),
                    tr("tcLastRunBy"),
                    tr("tcLastRunAt"),
                    tr("tcDaysSinceRun"),
                    tr("tcConfiguration"),
                    tr("tcTags"),
                    tr("bugCount"),
                    tr("openBugsShort"),
                    tr("tcBugIds"),
                    tr("areaPath"),
                ],
                ...cap(testCaseRows),
            },
        ],
    };

    const planRows: PreviewCell[][] = entries.flatMap((entry) =>
        entry.data.plans.map((plan) => {
            const overview = plan.overview;
            const planExecuted = overview
                ? executedCount(overview.outcomeCounts)
                : 0;
            const planDecided = overview
                ? overview.totalTestCases - overview.outcomeCounts.NotApplicable
                : 0;
            return [
                txt(entry.scopeName),
                txt(plan.id),
                linkCell(plan.name, plan.url),
                numCell(overview ? overview.suites.length : 0),
                numCell(overview ? overview.totalTestCases : 0),
                numCell(planExecuted),
                pctCell(overview ? pct(planExecuted, overview.totalTestCases) : 0),
                pctCell(
                    overview
                        ? pct(overview.outcomeCounts.Passed, planDecided)
                        : 0
                ),
                numCell(overview ? overview.totalBugs : 0),
            ];
        })
    );
    const plansSheet: PreviewSheet = {
        name: tr("sheetPlans"),
        tables: [
            {
                title: tr("sheetPlans"),
                columns: [
                    tr("scope"),
                    tr("planId"),
                    tr("planName"),
                    tr("suiteCount"),
                    tr("totalTestCases"),
                    tr("executed"),
                    tr("executedPct"),
                    tr("passRate"),
                    tr("bugCount"),
                ],
                ...cap(planRows),
            },
        ],
    };

    const assigneesPerScope = entries.map((entry) => entry.data.stats.byAssignee);
    const assigneeNames = sortedEntries(sumMaps(assigneesPerScope)).map(
        ([name]) => name
    );
    const assigneesSheet: PreviewSheet = {
        name: tr("sheetAssignees"),
        tables: [
            {
                title: tr("byAssigneeSection"),
                columns: [tr("assignee"), ...scopeNames, tr("total")],
                rows: assigneeNames.map((name) => {
                    const values = assigneesPerScope.map((map) => map[name] ?? 0);
                    return [
                        txt(name),
                        ...values.map((v) => numCell(v)),
                        numCell(values.reduce((a, b) => a + b, 0)),
                    ];
                }),
            },
        ],
    };

    return [
        guidePreviewSheet(multiScopeGuideMeta(entries), t),
        summarySheet,
        bugsSheet,
        bugsBySuiteSheet,
        todaysSheet,
        dsiSheet,
        businessSheet,
        suitesSheet,
        testCasesSheet,
        plansSheet,
        assigneesSheet,
    ];
}
