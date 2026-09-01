import type { DataBarRuleType, Workbook, Worksheet } from "exceljs";
import type {
    BugInfo,
    DefectStats,
    Outcome,
    PlanOverviewResponse,
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
    summary: string;
    bugs: string;
    bugsBySuite: string;
    dsi: string;
    suites: string;
    plans: string;
    assignees: string;
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
        [names.dsi, tr("sheetDsi")],
        [names.suites, tr("sheetSuites")],
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
    sheet.addRow([tr("bugsByUs"), report.total - bugsByDsi]);
    sheet.addRow([tr("bugsByDsi"), bugsByDsi]);
    sheet.addRow([tr("bugsByBusiness"), report.byOriginDetected["Business"] ?? 0]);
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
        { header: tr("link"), width: 10 },
    ];
    styleHeaderRow(sheet, 1, 8);

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
            row.getCell(8).value = { text: tr("open"), hyperlink: bug.url };
            row.getCell(8).font = { ...LINK_FONT };
        }
    }

    zebra(sheet, 2, sheet.rowCount, 8);
    autoFitColumns(sheet);
    sheet.getColumn(2).width = Math.min(sheet.getColumn(2).width ?? 70, 90);
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
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
        { header: tr("assignee"), width: 26 },
        { header: tr("creator"), width: 26 },
        { header: tr("link"), width: 10 },
    ];
    styleHeaderRow(sheet, 1, 9);

    for (const plan of data.plans) {
        for (const suite of plan.overview?.suites ?? []) {
            for (const bug of suite.bugs) {
                const row = sheet.addRow([
                    plan.name,
                    suite.suiteName,
                    suite.suiteId,
                    bug.id,
                    bug.title,
                    bug.state,
                    assigneeName(bug.assignee, t),
                    bug.creator ?? "-",
                    bug.url ? tr("open") : "-",
                ]);
                const stateHex = STATUS_HEX[bug.state];
                if (stateHex) {
                    row.getCell(6).font = {
                        color: { argb: `FF${stateHex.slice(1)}` },
                        bold: true,
                    };
                }
                if (bug.url) {
                    row.getCell(9).value = { text: tr("open"), hyperlink: bug.url };
                    row.getCell(9).font = { ...LINK_FONT };
                }
            }
        }
    }

    if (sheet.rowCount === 1) {
        sheet.addRow([tr("noData")]);
    }
    zebra(sheet, 2, sheet.rowCount, 9);
    autoFitColumns(sheet);
    sheet.getColumn(5).width = Math.min(sheet.getColumn(5).width ?? 60, 80);
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
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
        { width: 10 },
    ];

    const report = data.stats.sprintDefectReport;
    const detected = report.byOriginDetected["DSI"] ?? 0;
    const accepted = report.byOrigin["DSI"] ?? 0;
    const open = dsiBugs.filter(isOpenBug).length;

    const titleRow = sheet.addRow([tr("dsiSection")]);
    sheet.mergeCells(titleRow.number, 1, titleRow.number, 7);
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
    addSectionTitle(sheet, tr("dsiBugListSection"), 7);
    const headerRow = sheet.addRow([
        tr("bugId"),
        tr("bugTitle"),
        tr("bugDescription"),
        tr("status"),
        tr("assignee"),
        tr("creator"),
        tr("link"),
    ]);
    styleHeaderRow(sheet, headerRow.number, 7);
    const listStart = sheet.rowCount + 1;

    for (const bug of dsiBugs) {
        const row = sheet.addRow([
            bug.id,
            bug.title,
            bug.description ?? "-",
            bug.state,
            assigneeName(bug.assignee, t),
            bug.creator ?? "-",
            bug.url ? tr("open") : "-",
        ]);
        row.getCell(3).alignment = { wrapText: true, vertical: "top" };
        const stateHex = STATUS_HEX[bug.state];
        if (stateHex) {
            row.getCell(4).font = { color: { argb: `FF${stateHex.slice(1)}` }, bold: true };
        }
        if (bug.url) {
            row.getCell(7).value = { text: tr("open"), hyperlink: bug.url };
            row.getCell(7).font = { ...LINK_FONT };
        }
    }

    if (dsiBugs.length === 0) {
        sheet.addRow([tr("noData")]);
    } else {
        zebra(sheet, listStart, sheet.rowCount, 7);
        sheet.autoFilter = {
            from: { row: headerRow.number, column: 1 },
            to: { row: headerRow.number, column: 7 },
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
            8,
            2,
            entries.length
        );
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

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function exportDynamicSprintReportToExcel(
    filename: string,
    data: DynamicSprintReportExcelData,
    t: TranslateFn
): Promise<void> {
    const names: SheetNames = {
        summary: t("dynamicSprintReportPage.excel.sheetSummary"),
        bugs: t("dynamicSprintReportPage.excel.sheetBugs"),
        bugsBySuite: t("dynamicSprintReportPage.excel.sheetBugsBySuite"),
        dsi: t("dynamicSprintReportPage.excel.sheetDsi"),
        suites: t("dynamicSprintReportPage.excel.sheetSuites"),
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

    buildSummarySheet(wb, names, data, dsiBugs, t);
    buildBugsSheet(wb, names, data, t);
    buildBugsBySuiteSheet(wb, names, data, t);
    buildDsiSheet(wb, names, data, dsiBugs, t);
    buildSuitesSheet(wb, names, data, t);
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

function capRows(rows: PreviewCell[][]): Pick<PreviewTable, "rows" | "hiddenRowCount"> {
    if (rows.length <= PREVIEW_ROW_CAP) {
        return { rows };
    }
    return {
        rows: rows.slice(0, PREVIEW_ROW_CAP),
        hiddenRowCount: rows.length - PREVIEW_ROW_CAP,
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
                    [txt(tr("bugsByUs")), numCell(report.total - bugsByDsi)],
                    [txt(tr("bugsByDsi")), numCell(bugsByDsi)],
                    [
                        txt(tr("bugsByBusiness")),
                        numCell(report.byOriginDetected["Business"] ?? 0),
                    ],
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
                ],
                ...capRows(bugRows),
            },
        ],
    };

    /* -------- Bugs by suite -------- */
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
                    txt(assigneeName(bug.assignee, t)),
                    txt(bug.creator ?? "-"),
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
                    tr("assignee"),
                    tr("creator"),
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
                ],
                ...capRows(
                    dsiBugs.map((bug) => [
                        linkCell(String(bug.id), bug.url),
                        txt(bug.title),
                        txt(bug.description ?? "-"),
                        { value: bug.state, kind: "status" as const },
                        txt(assigneeName(bug.assignee, t)),
                        txt(bug.creator ?? "-"),
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
        summary,
        bugsSheet,
        bugsBySuiteSheet,
        dsiSheet,
        suitesSheet,
        plansSheet,
        assigneesSheet,
    ];
}
