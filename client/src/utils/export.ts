import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";
import html2canvas from "html2canvas";
import PptxGenJS from "pptxgenjs";
import type {
    BugInfo,
    Outcome,
    PlanOverviewResponse,
    PlanOverviewSuiteDetail,
    SprintDefectReport,
    TestCaseRow,
    TestPlanProgressCounts,
} from "../types";
import type { SuiteProgressGroup } from "../components/StatusReportCard";
import { passedPercent } from "./progressReport";

export interface ExportableRow {
    testPlan?: string;
    suiteName?: string;
    testCaseTitle?: string;
    outcome?: string;
    linkedDefects?: string;
}

export interface SuiteBugTotal {
    suiteName: string;
    totalBugs: number;
}

export interface SuiteHeaderStats {
    suiteName: string;
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    notApplicable: number;
    notRun: number;
    openBugs: number;
    closedBugs: number;
}

export function buildSuiteHeaderStats(
    rows: TestCaseRow[]
): SuiteHeaderStats {
    const bugStateById = new Map<number, string>();
    let passed = 0;
    let failed = 0;
    let blocked = 0;
    let notApplicable = 0;
    let notRun = 0;

    for (const row of rows) {
        if (row.outcome === "Passed") {
            passed++;
        } else if (row.outcome === "Failed") {
            failed++;
        } else if (row.outcome === "Blocked") {
            blocked++;
        } else if (row.outcome === "NotApplicable") {
            notApplicable++;
        } else {
            notRun++;
        }

        for (const bug of row.bugs) {
            bugStateById.set(bug.id, bug.state);
        }
    }

    let openBugs = 0;
    let closedBugs = 0;

    for (const state of bugStateById.values()) {
        if (state === "Closed") {
            closedBugs++;
        } else {
            openBugs++;
        }
    }

    return {
        suiteName: rows[0]?.suiteName ?? "",
        total: rows.length,
        passed,
        failed,
        blocked,
        notApplicable,
        notRun,
        openBugs,
        closedBugs,
    };
}

export function buildSuiteBugTotals(rows: TestCaseRow[]): SuiteBugTotal[] {
    const bugIdsBySuite = new Map<string, Set<number>>();

    for (const row of rows) {
        if (!bugIdsBySuite.has(row.suiteName)) {
            bugIdsBySuite.set(row.suiteName, new Set());
        }

        const bugIds = bugIdsBySuite.get(row.suiteName)!;

        for (const bug of row.bugs) {
            bugIds.add(bug.id);
        }
    }

    return [...bugIdsBySuite.entries()]
        .map(([suiteName, bugIds]) => ({
            suiteName,
            totalBugs: bugIds.size,
        }))
        .sort((a, b) => a.suiteName.localeCompare(b.suiteName));
}

interface ColumnDef {
    key: keyof ExportableRow;
    label: string;
}

const ALL_COLUMNS: ColumnDef[] = [
    { key: "testPlan", label: "Test Plan" },
    { key: "suiteName", label: "Suite Name" },
    { key: "testCaseTitle", label: "Test Case" },
    { key: "outcome", label: "Status" },
    { key: "linkedDefects", label: "Linked Defects" },
];

function activeColumns(rows: ExportableRow[]): ColumnDef[] {
    return ALL_COLUMNS.filter((col) =>
        rows.some((row) => row[col.key] !== undefined)
    );
}

export interface ChartImage {
    title: string;
    dataUrl: string;
    width: number;
    height: number;
    // "PNG" unless captureFullCanvas was asked for JPEG (see its jpegQuality
    // option) - jsPDF's addImage() needs to know which codec produced
    // dataUrl, since passing the wrong one corrupts the embedded image.
    format?: "PNG" | "JPEG";
}

// The exported chart image is always placed on a white PDF/email background,
// regardless of the app's current theme. In dark mode, chart text (legend
// labels, etc.) renders in a light color that's invisible once pasted onto
// that white page, so force a fixed dark color on the cloned DOM html2canvas
// captures rather than on the live (theme-aware) page.
const EXPORT_TEXT_COLOR = "#242424";

export async function captureChartImage(
    element: HTMLElement | null,
    title: string
): Promise<ChartImage | null> {
    if (!element) {
        return null;
    }

    const canvas = await html2canvas(element, {
        backgroundColor: "#ffffff",
        scale: 2,
        onclone: (_document, clonedElement) => {
            clonedElement.style.backgroundColor = "#ffffff";
            clonedElement.style.color = EXPORT_TEXT_COLOR;

            clonedElement
                .querySelectorAll<HTMLElement>("*")
                .forEach((node) => {
                    node.style.color = EXPORT_TEXT_COLOR;
                });
        },
    });

    return {
        title,
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
    };
}

function sanitizeFilenamePart(value: string): string {
    return value.replace(/[\\/:*?"<>|]+/g, "_").trim();
}

export function buildPlanOverviewFilename(
    planName: string,
    suiteName?: string
): string {
    const base = sanitizeFilenamePart(planName);
    const suite = suiteName ? `_${sanitizeFilenamePart(suiteName)}` : "";
    return `${base}${suite}.pdf`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function buildEmailReportHtml(
    title: string,
    rows: [string, string | number][],
    metricLabel: string,
    valueLabel: string
): string {
    const rowsHtml = rows
        .map(
            ([label, value]) =>
                `<tr>` +
                `<td style="padding:8px 12px;border:1px solid #d0d0d0;">${escapeHtml(label)}</td>` +
                `<td style="padding:8px 12px;border:1px solid #d0d0d0;">${escapeHtml(String(value))}</td>` +
                `</tr>`
        )
        .join("");

    return (
        `<h2 style="font-family:Arial,sans-serif;color:#005a9e;margin:0 0 12px;">${escapeHtml(title)}</h2>` +
        `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;width:100%;max-width:480px;">` +
        `<thead><tr style="background-color:#005a9e;color:#ffffff;">` +
        `<th style="padding:8px 12px;text-align:left;border:1px solid #d0d0d0;">${escapeHtml(metricLabel)}</th>` +
        `<th style="padding:8px 12px;text-align:left;border:1px solid #d0d0d0;">${escapeHtml(valueLabel)}</th>` +
        `</tr></thead>` +
        `<tbody>${rowsHtml}</tbody>` +
        `</table>`
    );
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

function csvEscape(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportToCsv(
    filename: string,
    rows: ExportableRow[],
    suiteBugTotals?: SuiteBugTotal[]
): void {
    const columns = activeColumns(rows);
    const lines: string[] = [];

    if (rows.length > 0) {
        lines.push(columns.map((col) => csvEscape(col.label)).join(","));

        for (const row of rows) {
            lines.push(
                columns
                    .map((col) => csvEscape(String(row[col.key] ?? "")))
                    .join(",")
            );
        }
    }

    if (suiteBugTotals && suiteBugTotals.length > 0) {
        if (lines.length > 0) {
            lines.push("");
        }
        lines.push("Total bugs by suite");
        lines.push(["Suite Name", "Total Bugs"].map(csvEscape).join(","));

        for (const total of suiteBugTotals) {
            lines.push(
                [csvEscape(total.suiteName), String(total.totalBugs)].join(",")
            );
        }
    }

    const blob = new Blob([lines.join("\n")], {
        type: "text/csv;charset=utf-8;",
    });
    downloadBlob(blob, `${filename}.csv`);
}

export async function exportToExcel(
    filename: string,
    rows: ExportableRow[],
    suiteBugTotals?: SuiteBugTotal[]
): Promise<void> {
    const columns = activeColumns(rows);
    const workbook = new ExcelJS.Workbook();

    if (rows.length > 0) {
        const sheet = workbook.addWorksheet("Results");

        sheet.columns = columns.map((col) => ({
            header: col.label,
            key: col.key,
            width: 30,
            style: { alignment: { wrapText: true, vertical: "top" } },
        }));

        for (const row of rows) {
            sheet.addRow(
                columns.reduce<Record<string, string>>((acc, col) => {
                    acc[col.key] = row[col.key] ?? "";
                    return acc;
                }, {})
            );
        }

        sheet.getRow(1).font = { bold: true };
    }

    if (suiteBugTotals && suiteBugTotals.length > 0) {
        const totalsSheet = workbook.addWorksheet("Bug Totals");
        totalsSheet.columns = [
            { header: "Suite Name", key: "suiteName", width: 30 },
            { header: "Total Bugs", key: "totalBugs", width: 15 },
        ];

        for (const total of suiteBugTotals) {
            totalsSheet.addRow(total);
        }

        totalsSheet.getRow(1).font = { bold: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, `${filename}.xlsx`);
}

function buildPdfDocument(
    title: string,
    rows: ExportableRow[],
    suiteBugTotals?: SuiteBugTotal[],
    suiteHeader?: SuiteHeaderStats
): jsPDF {
    const columns = activeColumns(rows);
    const doc = new jsPDF({
        orientation: columns.length > 2 ? "landscape" : "portrait",
    });

    doc.setFontSize(14);
    doc.text(title, 14, 15);

    let nextY = 22;

    if (suiteHeader) {
        doc.setFontSize(11);
        doc.text(`Suite: ${suiteHeader.suiteName}`, 14, nextY);
        nextY += 5;

        autoTable(doc, {
            startY: nextY,
            head: [
                [
                    "Total Tests",
                    "Passed",
                    "Failed",
                    "Not Run",
                    "Blocked",
                    "Not Applicable",
                    "Bugs Open",
                    "Bugs Closed",
                ],
            ],
            body: [
                [
                    String(suiteHeader.total),
                    String(suiteHeader.passed),
                    String(suiteHeader.failed),
                    String(suiteHeader.notRun),
                    String(suiteHeader.blocked),
                    String(suiteHeader.notApplicable),
                    String(suiteHeader.openBugs),
                    String(suiteHeader.closedBugs),
                ],
            ],
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 90, 158] },
        });

        nextY = (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 10;
    }

    if (rows.length > 0) {
        autoTable(doc, {
            startY: nextY,
            head: [columns.map((col) => col.label)],
            body: rows.map((row) =>
                columns.map((col) => String(row[col.key] ?? ""))
            ),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 90, 158] },
        });

        nextY = (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 10;
    }

    if (!suiteHeader && suiteBugTotals && suiteBugTotals.length > 0) {
        doc.setFontSize(12);
        doc.text("Total bugs by suite", 14, nextY);
        nextY += 4;

        autoTable(doc, {
            startY: nextY,
            head: [["Suite Name", "Total Bugs"]],
            body: suiteBugTotals.map((total) => [
                total.suiteName,
                String(total.totalBugs),
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 90, 158] },
        });
    }

    return doc;
}

export function exportToPdf(
    filename: string,
    title: string,
    rows: ExportableRow[],
    suiteBugTotals?: SuiteBugTotal[],
    suiteHeader?: SuiteHeaderStats
): void {
    const doc = buildPdfDocument(title, rows, suiteBugTotals, suiteHeader);
    doc.save(`${filename}.pdf`);
}

function pdfDocToBase64(doc: jsPDF): string {
    const dataUri = doc.output("datauristring");
    return dataUri.substring(dataUri.indexOf(",") + 1);
}

export function buildPdfBase64(
    title: string,
    rows: ExportableRow[],
    suiteBugTotals?: SuiteBugTotal[],
    suiteHeader?: SuiteHeaderStats
): string {
    const doc = buildPdfDocument(title, rows, suiteBugTotals, suiteHeader);
    return pdfDocToBase64(doc);
}

const PDF_MARGIN = 14;
const PDF_MAX_Y = 297 - PDF_MARGIN;

function ensurePdfSpace(
    doc: jsPDF,
    currentY: number,
    neededHeight: number
): number {
    if (currentY + neededHeight > PDF_MAX_Y) {
        doc.addPage();
        return 15;
    }

    return currentY;
}

const PDF_CHART_GAP = 6;
const PDF_CHART_ROW_MAX_HEIGHT = 55;
const PDF_CHART_TITLE_HEIGHT = 8;
const PDF_CHART_PADDING = 4;

function addChartImagesRow(
    doc: jsPDF,
    charts: ChartImage[],
    startY: number
): number {
    if (charts.length === 0) {
        return startY;
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const innerWidth = pageWidth - PDF_MARGIN * 2;
    const columnWidth =
        (innerWidth - PDF_CHART_GAP * (charts.length - 1)) / charts.length;

    let maxImgHeight = 0;

    const layout = charts.map((chart) => {
        const aspectRatio = chart.height / chart.width;
        let imgWidth = columnWidth - PDF_CHART_PADDING * 2;
        let imgHeight = imgWidth * aspectRatio;

        if (imgHeight > PDF_CHART_ROW_MAX_HEIGHT) {
            imgHeight = PDF_CHART_ROW_MAX_HEIGHT;
            imgWidth = imgHeight / aspectRatio;
        }

        maxImgHeight = Math.max(maxImgHeight, imgHeight);

        return { chart, imgWidth, imgHeight };
    });

    const rowHeight =
        PDF_CHART_TITLE_HEIGHT + maxImgHeight + PDF_CHART_PADDING * 2;
    const y = ensurePdfSpace(doc, startY, rowHeight);

    doc.setDrawColor(200, 200, 200);

    layout.forEach(({ chart, imgWidth, imgHeight }, index) => {
        const cellX = PDF_MARGIN + index * (columnWidth + PDF_CHART_GAP);

        doc.rect(cellX, y, columnWidth, rowHeight);

        doc.setFontSize(10);
        doc.text(chart.title, cellX + PDF_CHART_PADDING, y + PDF_CHART_TITLE_HEIGHT);

        const imgX = cellX + (columnWidth - imgWidth) / 2;
        const imgY = y + PDF_CHART_TITLE_HEIGHT + PDF_CHART_PADDING;

        doc.addImage(chart.dataUrl, "PNG", imgX, imgY, imgWidth, imgHeight);
    });

    return y + rowHeight + 10;
}

interface PlanOverviewSuiteSection {
    suite: PlanOverviewSuiteDetail;
    chart?: ChartImage | null;
}

function buildPlanOverviewPdfDocument(
    data: PlanOverviewResponse,
    charts: ChartImage[] = [],
    suiteSection?: PlanOverviewSuiteSection
): jsPDF {
    const passRate = data.totalTestCases
        ? Math.round(
            (data.outcomeCounts.Passed / data.totalTestCases) * 1000
        ) / 10
        : 0;

    const executionRate = data.totalTestCases
        ? Math.round(
            ((data.totalTestCases -
                data.outcomeCounts.NotRun -
                data.outcomeCounts.NotApplicable) /
                data.totalTestCases) *
                1000
        ) / 10
        : 0;

    const doc = new jsPDF();

    doc.setFontSize(14);
    doc.text(`Plan Overview: ${data.planName}`, PDF_MARGIN, 15);

    autoTable(doc, {
        startY: 22,
        head: [
            [
                "Total Test Cases",
                "Blocked",
                "Not Run",
                "Not Applicable",
                "Total Bugs",
                "Pass Rate",
                "Execution Rate",
            ],
        ],
        body: [
            [
                String(data.totalTestCases),
                String(data.outcomeCounts.Blocked),
                String(data.outcomeCounts.NotRun),
                String(data.outcomeCounts.NotApplicable),
                String(data.totalBugs),
                `${passRate}%`,
                `${executionRate}%`,
            ],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 90, 158] },
    });

    let nextY =
        (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 10;

    nextY = addChartImagesRow(doc, charts, nextY);

    if (data.bugs.length > 0) {
        nextY = ensurePdfSpace(doc, nextY, 20);

        doc.setFontSize(12);
        doc.text("Bugs", 14, nextY);
        nextY += 4;

        autoTable(doc, {
            startY: nextY,
            head: [["ID", "Title", "State", "Creator"]],
            body: data.bugs.map((bug) => [
                String(bug.id),
                bug.title,
                bug.state,
                bug.creator ?? "",
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 90, 158] },
        });

        nextY =
            (doc as unknown as { lastAutoTable: { finalY: number } })
                .lastAutoTable.finalY + 10;
    }

    if (suiteSection) {
        const { suite, chart } = suiteSection;

        nextY = ensurePdfSpace(doc, nextY, 20);

        doc.setFontSize(13);
        doc.text(`Suite: ${suite.suiteName}`, PDF_MARGIN, nextY);
        nextY += 6;

        const suitePassRate = suite.totalTestCases
            ? Math.round(
                (suite.outcomeCounts.Passed / suite.totalTestCases) * 1000
            ) / 10
            : 0;

        const suiteExecutionRate = suite.totalTestCases
            ? Math.round(
                ((suite.totalTestCases -
                    suite.outcomeCounts.NotRun -
                    suite.outcomeCounts.NotApplicable) /
                    suite.totalTestCases) *
                    1000
            ) / 10
            : 0;

        autoTable(doc, {
            startY: nextY,
            head: [
                [
                    "Total Test Cases",
                    "Passed",
                    "Failed",
                    "Blocked",
                    "Not Run",
                    "Not Applicable",
                    "Pass Rate",
                    "Execution Rate",
                ],
            ],
            body: [
                [
                    String(suite.totalTestCases),
                    String(suite.outcomeCounts.Passed),
                    String(suite.outcomeCounts.Failed),
                    String(suite.outcomeCounts.Blocked),
                    String(suite.outcomeCounts.NotRun),
                    String(suite.outcomeCounts.NotApplicable),
                    `${suitePassRate}%`,
                    `${suiteExecutionRate}%`,
                ],
            ],
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 90, 158] },
        });

        nextY =
            (doc as unknown as { lastAutoTable: { finalY: number } })
                .lastAutoTable.finalY + 10;

        if (chart) {
            nextY = addChartImagesRow(doc, [chart], nextY);
        }

        if (suite.bugs.length > 0) {
            nextY = ensurePdfSpace(doc, nextY, 20);

            doc.setFontSize(12);
            doc.text("Bugs", PDF_MARGIN, nextY);
            nextY += 4;

            autoTable(doc, {
                startY: nextY,
                head: [["ID", "Title", "State", "Creator"]],
                body: suite.bugs.map((bug) => [
                    String(bug.id),
                    bug.title,
                    bug.state,
                    bug.creator ?? "",
                ]),
                styles: { fontSize: 8 },
                headStyles: { fillColor: [0, 90, 158] },
            });
        }
    }

    return doc;
}

export function exportPlanOverviewToPdf(
    data: PlanOverviewResponse,
    charts: ChartImage[] = [],
    suiteSection?: PlanOverviewSuiteSection
): void {
    const doc = buildPlanOverviewPdfDocument(data, charts, suiteSection);
    const filename = suiteSection
        ? buildPlanOverviewFilename(data.planName, suiteSection.suite.suiteName)
        : buildPlanOverviewFilename(data.planName);
    doc.save(filename);
}

export function buildPlanOverviewPdfBase64(
    data: PlanOverviewResponse,
    charts: ChartImage[] = []
): string {
    const doc = buildPlanOverviewPdfDocument(data, charts);
    return pdfDocToBase64(doc);
}

export function buildPlanOverviewSuitePdfBase64(
    planName: string,
    suite: PlanOverviewSuiteDetail,
    chart?: ChartImage
): string {
    const doc = new jsPDF();

    doc.setFontSize(14);
    doc.text(`Plan Overview: ${planName} - ${suite.suiteName}`, PDF_MARGIN, 15);

    autoTable(doc, {
        startY: 22,
        head: [
            [
                "Total Test Cases",
                "Passed",
                "Failed",
                "Blocked",
                "Not Run",
                "Not Applicable",
            ],
        ],
        body: [
            [
                String(suite.totalTestCases),
                String(suite.outcomeCounts.Passed),
                String(suite.outcomeCounts.Failed),
                String(suite.outcomeCounts.Blocked),
                String(suite.outcomeCounts.NotRun),
                String(suite.outcomeCounts.NotApplicable),
            ],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 90, 158] },
    });

    let nextY =
        (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 10;

    if (chart) {
        nextY = addChartImagesRow(doc, [chart], nextY);
    }

    if (suite.bugs.length > 0) {
        nextY = ensurePdfSpace(doc, nextY, 20);

        doc.setFontSize(12);
        doc.text("Bugs", PDF_MARGIN, nextY);
        nextY += 4;

        autoTable(doc, {
            startY: nextY,
            head: [["ID", "Title", "State", "Creator"]],
            body: suite.bugs.map((bug) => [
                String(bug.id),
                bug.title,
                bug.state,
                bug.creator ?? "",
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 90, 158] },
        });
    }

    return pdfDocToBase64(doc);
}

export function buildPlanProgressFilename(planTitle: string): string {
    return `${sanitizeFilenamePart(planTitle)}_progress_report.pdf`;
}

export interface PlanProgressPdfLabels {
    titlePrefix: string;
    testCases: string;
    testCasesRun: string;
    passed: string;
    failed: string;
    blocked: string;
    notApplicable: string;
    passRate: string;
    bugsTitle: string;
    bugsEmpty: string;
    bugColumns: {
        id: string;
        title: string;
        state: string;
        creator: string;
        assignee: string;
    };
}

function buildPlanProgressPdfDocument(
    planTitle: string,
    counts: TestPlanProgressCounts,
    bugs: BugInfo[],
    labels: PlanProgressPdfLabels,
    charts: ChartImage[] = []
): jsPDF {
    const executed =
        counts.total - counts.notExecuted - counts.notApplicable;

    const doc = new jsPDF();

    doc.setFontSize(14);
    doc.text(`${labels.titlePrefix}: ${planTitle}`, PDF_MARGIN, 15);

    autoTable(doc, {
        startY: 22,
        head: [
            [
                labels.testCases,
                labels.testCasesRun,
                labels.passed,
                labels.failed,
                labels.blocked,
                labels.notApplicable,
                labels.passRate,
            ],
        ],
        body: [
            [
                String(counts.total),
                `${executed} / ${counts.total}`,
                String(counts.passed),
                String(counts.failed),
                String(counts.blocked),
                String(counts.notApplicable),
                `${passedPercent(counts)}%`,
            ],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 90, 158] },
    });

    let nextY =
        (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 10;

    nextY = addChartImagesRow(doc, charts, nextY);

    nextY = ensurePdfSpace(doc, nextY, 20);

    doc.setFontSize(12);
    doc.text(labels.bugsTitle, PDF_MARGIN, nextY);
    nextY += 4;

    if (bugs.length > 0) {
        autoTable(doc, {
            startY: nextY,
            head: [
                [
                    labels.bugColumns.id,
                    labels.bugColumns.title,
                    labels.bugColumns.state,
                    labels.bugColumns.creator,
                    labels.bugColumns.assignee,
                ],
            ],
            body: bugs.map((bug) => [
                String(bug.id),
                bug.title,
                bug.state,
                bug.creator ?? "",
                bug.assignee?.displayName ?? "",
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 90, 158] },
        });
    } else {
        doc.setFontSize(9);
        doc.text(labels.bugsEmpty, PDF_MARGIN, nextY + 4);
    }

    return doc;
}

// Severity is stored as e.g. "1 - Critical", so sorting by the leading rank
// number naturally orders Critical, High, Medium, ... to match the chart.
function severityRank(raw: string): number {
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
    extension: string
): string {
    return `${sanitizeFilenamePart(headerTitle)}_${formatDateDDMMYYYY(new Date())}.${extension}`;
}

export type TranslateFn = (
    key: string,
    options?: Record<string, unknown>
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

const EMAIL_STATUS_ORDER = ["Closed", "Resolved", "In Progress", "New", "Not Applicable"];
const EMAIL_STATUS_LABEL_KEYS: Record<string, string> = {
    Closed: "closed",
    Resolved: "resolved",
    "In Progress": "inProgress",
    New: "new",
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

function outcomeCountLabel(t: TranslateFn, outcome: Outcome, count: number): string {
    const label = t(`outcome.${outcome}`);
    return `${count} ${label}`;
}

function statusCountLabel(t: TranslateFn, name: string, count: number): string {
    const label = t(
        `defectManagementPage.sprintReport.statusCard.statusLabels.${EMAIL_STATUS_LABEL_KEYS[name]}`
    );
    return `${count} ${label}`;
}

function formatEmailTimestamp(date: Date): { datePart: string; timePart: string } {
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

function splitEmailActionLeadIn(paragraph: string): {
    lead: string | null;
    rest: string;
} {
    const match = /^([^:\n]{1,80}:)\s*([\s\S]*)$/.exec(paragraph);

    if (!match) {
        return { lead: null, rest: paragraph };
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
    Resolved: "#1565c0",
    "In Progress": "#f0a500",
    New: "#e53935",
    "Not Applicable": "#9e9e9e",
};
const LIGHT_SEVERITY_PALETTE = [
    { bg: "#fdecea", border: "#f0c7c3", text: "#7a1f1f" },
    { bg: "#fff8e6", border: "#efd9a5", text: "#7a5308" },
    { bg: "#eef3fb", border: "#c6d4ea", text: "#1f3864" },
];
const LIGHT_SEVERITY_FALLBACK = { bg: LIGHT_PAGE_BG, border: LIGHT_RULE, text: LIGHT_INK_MUTED };

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

function lightKpiTile(value: string, kpiIndex: number, label: string): string {
    const { bg, accent } = LIGHT_KPI[kpiIndex];

    return (
        `<td width="16.66%" style="padding:4px;">` +
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
    heightPx: number
): string {
    const cells = segments
        .filter((segment) => segment.pct > 0)
        .map(
            (segment) =>
                `<td width="${segment.pct}%" bgcolor="${segment.color}" style="background-color:${segment.color};font-size:1px;line-height:${heightPx}px;">&nbsp;</td>`
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
    const executed = totalTestCases - outcomeCounts.NotRun;
    const executedPct = totalTestCases
        ? Math.round((executed / totalTestCases) * 100)
        : 0;
    const decided = totalTestCases - outcomeCounts.NotApplicable;
    const passRate = decided
        ? Math.round((outcomeCounts.Passed / decided) * 100)
        : 0;

    const legendEntries = EMAIL_OUTCOME_ORDER.filter(
        (outcome) => outcomeCounts[outcome] > 0
    );
    const segments = legendEntries.map((outcome) => ({
        color: LIGHT_OUTCOME_COLORS[outcome],
        pct: totalTestCases ? (outcomeCounts[outcome] / totalTestCases) * 100 : 0,
    }));

    const legendText = legendEntries
        .map(
            (outcome) =>
                lightSwatch(LIGHT_OUTCOME_COLORS[outcome]) +
                `${outcomeCounts[outcome]} ${escapeHtml(t(`outcome.${outcome}`))}`
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
        ? t("defectManagementPage.sprintReport.statusCard.originBreakdown.unmatched")
        : t(
              "defectManagementPage.sprintReport.statusCard.originBreakdown.bugsInSuite",
              { suite }
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
    labelText: string
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
    t: TranslateFn
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

    const totalTestCases = suiteGroups.reduce(
        (sum, group) => sum + group.totalTestCases,
        0
    );
    const totalPassed = suiteGroups.reduce(
        (sum, group) => sum + group.outcomeCounts.Passed,
        0
    );
    const totalNotApplicable = suiteGroups.reduce(
        (sum, group) => sum + group.outcomeCounts.NotApplicable,
        0
    );
    const totalDecided = totalTestCases - totalNotApplicable;
    const passRate = totalDecided
        ? Math.round((totalPassed / totalDecided) * 100)
        : 0;
    const notApplicableRate = totalTestCases
        ? Math.round((totalNotApplicable / totalTestCases) * 100)
        : 0;

    const bugsClosed = report.byStatusAll.Closed ?? 0;
    const bugsClosedPct = report.total
        ? Math.round((bugsClosed / report.total) * 100)
        : 0;
    const stillOpen = report.total - bugsClosed;

    const reopenedPct = report.total
        ? Math.round((report.reopenedCount / report.total) * 1000) / 10
        : 0;
    // Always shown as a number - matches StatusReportCard.tsx's
    // avgClosureDays (0 rather than blank when there's no closed bug yet to
    // compute a real average from).
    const avgClosureDays = Math.round(report.mttrDays ?? 0);

    const statusEntries = EMAIL_STATUS_ORDER.map(
        (name) =>
            [
                name,
                name === "Not Applicable"
                    ? report.outOfScopeCount
                    : report.byStatus[name] ?? 0,
            ] as const
    ).filter(([, count]) => count > 0);

    const severityTotal = Object.values(report.bySeverity).reduce(
        (sum, count) => sum + count,
        0
    );
    const severityEntries = EMAIL_SEVERITY_KEYS.map(
        (key) => [key, report.bySeverity[key] ?? 0] as const
    );

    // Same idea as severityEntries above, but scoped to effective bugs that
    // are still open - mirrors StatusReportCard.tsx's openSeverityEntries.
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
        0
    );
    const openSeverityEntries = EMAIL_SEVERITY_KEYS.map(
        (key) => [key, openSeverityCounts[key] ?? 0] as const
    );

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
                a.localeCompare(b)
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
                            "defectManagementPage.sprintReport.statusCard.originBreakdown.detected"
                        ),
                    },
                    {
                        value: report.byOrigin[def.origin] ?? 0,
                        caption: t(
                            "defectManagementPage.sprintReport.statusCard.originBreakdown.accepted"
                        ),
                    },
                ],
                def.labelBg,
                def.labelText
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

    const kpiHtml =
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        lightKpiTile(
            String(totalTestCases),
            0,
            t("defectManagementPage.sprintReport.statusCard.kpis.totalTestCases")
        ) +
        lightKpiTile(
            `${passRate}%`,
            1,
            t("defectManagementPage.sprintReport.statusCard.kpis.passRate")
        ) +
        lightKpiTile(
            `${bugsClosed}/${report.total}`,
            2,
            t("defectManagementPage.sprintReport.statusCard.kpis.bugsClosed", {
                percent: bugsClosedPct,
            })
        ) +
        lightKpiTile(
            String(openSeverityEntries[0][1]),
            3,
            t("defectManagementPage.sprintReport.statusCard.kpis.criticalBugs")
        ) +
        lightKpiTile(
            String(report.reopenedCount),
            4,
            t("defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs", {
                percent: reopenedPct,
            })
        ) +
        lightKpiTile(
            t("defectManagementPage.stats.days", { value: avgClosureDays }),
            5,
            t("defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime")
        ) +
        `</tr></table>` +
        // A couple of <td width="16.66%"> in an otherwise-empty row have
        // nothing to divide the row's width with, so most renderers just
        // stretch them to fill the full table instead of honoring the
        // percentage - hence 4 empty filler cells matching row 1's
        // 6-column split, keeping these tiles the same size as the others
        // instead of spanning full width.
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>` +
        lightKpiTile(
            `${report.effectiveCount}/${report.total}`,
            6,
            t("defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected")
        ) +
        lightKpiTile(
            String(report.withoutResolutionDateCount),
            7,
            t("defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate")
        ) +
        (report.outOfScopeCount > 0
            ? lightKpiTile(
                `${report.outOfScopeCount}/${report.total}`,
                8,
                t("defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected")
            )
            : "") +
        lightKpiTile(
            `${notApplicableRate}%`,
            9,
            t("defectManagementPage.sprintReport.statusCard.kpis.notApplicableRate")
        ) +
        `<td width="16.66%"></td><td width="16.66%"></td>` +
        (report.outOfScopeCount > 0 ? "" : `<td width="16.66%"></td>`) +
        `</tr></table>`;

    const dashboardHtml = dashboardUrl
        ? lightDashboardButton(
              dashboardUrl,
              t("defectManagementPage.sprintReport.statusCard.openDashboard")
          )
        : "";

    const actionsHtml = actionParagraphs.length
        ? `<div style="font-size:14px;font-weight:600;color:${LIGHT_INK};margin-top:18px;font-family:${EMAIL_FONT_FAMILY};">📌 ${escapeHtml(t("defectManagementPage.sprintReport.statusCard.actionsTitle"))}</div>` +
          actionParagraphs
              .map((paragraph, index) => {
                  const palette =
                      LIGHT_ACTION_PALETTE[index % LIGHT_ACTION_PALETTE.length];
                  const { lead, rest } = splitEmailActionLeadIn(paragraph);

                  return (
                      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.bg}" style="background-color:${palette.bg};border-radius:6px;margin-top:8px;">` +
                      `<tr><td style="border-left:4px solid ${palette.border};padding:10px 12px;font-size:13px;line-height:1.4;color:${LIGHT_INK};font-family:${EMAIL_FONT_FAMILY};">` +
                      (lead ? `<strong>${escapeHtml(lead)}</strong> ` : "") +
                      `${escapeHtml(rest)}</td></tr></table>`
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
                `${count} ${escapeHtml(t(`defectManagementPage.sprintReport.statusCard.statusLabels.${EMAIL_STATUS_LABEL_KEYS[name]}`))}`
        )
        .join(`<span style="color:${LIGHT_RULE};"> | </span>`);

    const statusSegments = statusEntries.map(([name, count]) => ({
        color: LIGHT_STATUS_COLORS[name],
        pct: report.total ? (count / report.total) * 100 : 0,
    }));

    const lightSeverityRowHtml = (
        entries: readonly (readonly [string, number])[],
        total: number,
        caption: string
    ): string =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr>` +
        entries
            .map(([raw, count]) => {
                const rank = severityRank(raw);
                const palette =
                    LIGHT_SEVERITY_PALETTE[rank - 1] ?? LIGHT_SEVERITY_FALLBACK;
                const width = Math.floor(100 / entries.length);
                const percent = total
                    ? Math.round((count / total) * 100)
                    : 0;

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
            })
        ) +
        lightSeverityRowHtml(
            openSeverityEntries,
            openSeverityTotal,
            t(
                "defectManagementPage.sprintReport.statusCard.openSeverityCaption",
                { count: openSeverityTotal }
            )
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
    segments: { color: string; pct: number }[]
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
    caption: string
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
        doc.text(`${percent}%`, chipX + chipWidth / 2, y + 11.5, { align: "center" });
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

interface StatusCardKpis {
    totalTestCases: number;
    totalPassed: number;
    totalNotApplicable: number;
    totalDecided: number;
    passRate: number;
    notApplicableRate: number;
    bugsClosed: number;
    bugsClosedPct: number;
    stillOpen: number;
    reopenedPct: number;
    avgClosureDays: number;
    criticalCount: number;
}

// Shared by the PDF and PPTX status card exports so the two renderings never
// drift apart on how a rate/percentage is derived from the raw report.
function computeStatusCardKpis(
    suiteGroups: SuiteProgressGroup[],
    report: SprintDefectReport
): StatusCardKpis {
    const totalTestCases = suiteGroups.reduce((sum, group) => sum + group.totalTestCases, 0);
    const totalPassed = suiteGroups.reduce((sum, group) => sum + group.outcomeCounts.Passed, 0);
    const totalNotApplicable = suiteGroups.reduce(
        (sum, group) => sum + group.outcomeCounts.NotApplicable,
        0
    );
    const totalDecided = totalTestCases - totalNotApplicable;
    const passRate = totalDecided ? Math.round((totalPassed / totalDecided) * 100) : 0;
    const notApplicableRate = totalTestCases
        ? Math.round((totalNotApplicable / totalTestCases) * 100)
        : 0;

    const bugsClosed = report.byStatusAll.Closed ?? 0;
    const bugsClosedPct = report.total ? Math.round((bugsClosed / report.total) * 100) : 0;
    const stillOpen = report.total - bugsClosed;
    const reopenedPct = report.total
        ? Math.round((report.reopenedCount / report.total) * 1000) / 10
        : 0;
    const avgClosureDays = Math.round(report.mttrDays ?? 0);

    // Only non-closed bugs count here - a closed critical bug isn't
    // something the reader still needs to act on. Mirrors
    // StatusReportCard.tsx's criticalCount so the live card, PDF, PPTX and
    // email export never drift apart on this number.
    const criticalCount = report.effectiveDefects.filter(
        (bug) => bug.state !== "Closed" && severityRank(bug.severity ?? "") === 1
    ).length;

    return {
        totalTestCases,
        totalPassed,
        totalNotApplicable,
        totalDecided,
        passRate,
        notApplicableRate,
        bugsClosed,
        bugsClosedPct,
        stillOpen,
        reopenedPct,
        avgClosureDays,
        criticalCount,
    };
}

interface BugStatusData {
    statusEntries: (readonly [string, number])[];
    statusSegments: { color: string; pct: number }[];
    severityTotal: number;
    severityEntries: (readonly [string, number])[];
    openSeverityTotal: number;
    openSeverityEntries: (readonly [string, number])[];
}

// Shared by the PDF and PPTX bug status sections - both render the same
// status/severity breakdown, just with a different renderer underneath.
function computeBugStatusData(report: SprintDefectReport): BugStatusData {
    const statusEntries = EMAIL_STATUS_ORDER.map(
        (name) =>
            [
                name,
                name === "Not Applicable" ? report.outOfScopeCount : report.byStatus[name] ?? 0,
            ] as const
    ).filter(([, count]) => count > 0);
    const statusSegments = statusEntries.map(([name, count]) => ({
        color: LIGHT_STATUS_COLORS[name],
        pct: report.total ? (count / report.total) * 100 : 0,
    }));

    const severityTotal = Object.values(report.bySeverity).reduce((sum, count) => sum + count, 0);
    const severityEntries = EMAIL_SEVERITY_KEYS.map(
        (key) => [key, report.bySeverity[key] ?? 0] as const
    );

    const openSeverityCounts = report.effectiveDefects.reduce<Record<string, number>>(
        (acc, bug) => {
            if (bug.state === "Closed") {
                return acc;
            }

            const key = bug.severity ?? "Unspecified";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
        },
        {}
    );
    const openSeverityTotal = Object.values(openSeverityCounts).reduce(
        (sum, count) => sum + count,
        0
    );
    const openSeverityEntries = EMAIL_SEVERITY_KEYS.map(
        (key) => [key, openSeverityCounts[key] ?? 0] as const
    );

    return {
        statusEntries,
        statusSegments,
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
function computeSuiteProgressRowData(group: SuiteProgressGroup): SuiteProgressRowData {
    const executed = group.totalTestCases - group.outcomeCounts.NotRun;
    const executedPct = group.totalTestCases
        ? Math.round((executed / group.totalTestCases) * 100)
        : 0;
    const decided = group.totalTestCases - group.outcomeCounts.NotApplicable;
    const groupPassRate = decided
        ? Math.round((group.outcomeCounts.Passed / decided) * 100)
        : 0;

    const legendEntries = EMAIL_OUTCOME_ORDER.filter(
        (outcome) => group.outcomeCounts[outcome] > 0
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

function pdfDrawAlertBanner(ctx: PdfDrawCtx, y: number, alertText: string): number {
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

function buildPdfRow2KpiDefs(
    kpis: StatusCardKpis,
    report: SprintDefectReport,
    t: TranslateFn
): { kpi: (typeof LIGHT_KPI)[number]; label: string; value: string }[] {
    return [
        {
            kpi: LIGHT_KPI[6],
            label: t("defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected"),
            value: `${report.effectiveCount}/${report.total}`,
        },
        {
            kpi: LIGHT_KPI[7],
            label: t("defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate"),
            value: String(report.withoutResolutionDateCount),
        },
        ...(report.outOfScopeCount > 0
            ? [
                {
                    kpi: LIGHT_KPI[8],
                    label: t(
                        "defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected"
                    ),
                    value: `${report.outOfScopeCount}/${report.total}`,
                },
            ]
            : []),
        {
            kpi: LIGHT_KPI[9],
            label: t("defectManagementPage.sprintReport.statusCard.kpis.notApplicableRate"),
            value: `${kpis.notApplicableRate}%`,
        },
    ];
}

function pdfDrawDashboardButton(
    ctx: PdfDrawCtx,
    y: number,
    dashboardUrl: string | undefined
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
    doc.text(label, pageWidth / 2, buttonY + buttonHeight / 2 + 1.2, { align: "center" });
    doc.link(PDF_MARGIN, buttonY, innerWidth, buttonHeight, { url: dashboardUrl });

    return buttonY + buttonHeight + 8;
}

function pdfDrawActionsSection(ctx: PdfDrawCtx, y: number, actionsText: string): number {
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
    doc.text(t("defectManagementPage.sprintReport.statusCard.actionsTitle"), PDF_MARGIN, cursorY);
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

function pdfDrawSuiteProgressRow(ctx: PdfDrawCtx, y: number, group: SuiteProgressGroup): number {
    const { doc, pageWidth, innerWidth, t } = ctx;
    const { executedPct, groupPassRate, segments, legendEntries } =
        computeSuiteProgressRowData(group);
    const legendText = legendEntries
        .map((outcome) => outcomeCountLabel(t, outcome, group.outcomeCounts[outcome]))
        .join("   |   ");

    let cursorY = ensurePdfSpace(doc, y, 18);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(LIGHT_INK);
    doc.text(
        `${group.label} – ${t("defectManagementPage.sprintReport.statusCard.casesCount", {
            count: group.totalTestCases,
        })}`,
        PDF_MARGIN,
        cursorY
    );
    doc.text(
        `${executedPct}% ${t("defectManagementPage.sprintReport.statusCard.executed")}`,
        pageWidth - PDF_MARGIN,
        cursorY,
        { align: "right" }
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
        cursorY
    );
    cursorY += 8;

    return cursorY;
}

function pdfDrawSuiteProgressSection(
    ctx: PdfDrawCtx,
    y: number,
    suiteGroups: SuiteProgressGroup[]
): number {
    const { doc, t } = ctx;
    let cursorY = ensurePdfSpace(doc, y, 10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(LIGHT_INK);
    doc.text(
        t("defectManagementPage.sprintReport.statusCard.suiteProgressTitle"),
        PDF_MARGIN,
        cursorY
    );
    cursorY += 6;

    if (suiteGroups.length === 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(LIGHT_INK_MUTED);
        doc.text(
            t("defectManagementPage.sprintReport.statusCard.noPlanSelected"),
            PDF_MARGIN,
            cursorY
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
    includeDsiSource: boolean
): number {
    const { doc, pageWidth, innerWidth, t } = ctx;
    const {
        statusEntries,
        statusSegments,
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
        cursorY
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
        cursorY
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
        cursorY
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
                })
            ),
        cursorY
    );
    doc.setFont("helvetica", "bold");
    doc.setTextColor(LIGHT_STILL_OPEN);
    doc.text(
        t("defectManagementPage.sprintReport.statusCard.stillOpen", { count: kpis.stillOpen }),
        pageWidth - PDF_MARGIN,
        cursorY,
        { align: "right" }
    );
    cursorY += 4;

    pdfProgressTrack(doc, PDF_MARGIN, cursorY, innerWidth, 3.5, statusSegments);
    cursorY += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(LIGHT_INK_MUTED);
    doc.text(
        statusEntries.map(([name, count]) => statusCountLabel(t, name, count)).join("   |   "),
        PDF_MARGIN,
        cursorY
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
        })
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
        })
    );

    return cursorY;
}

function pdfDrawOriginBreakdownSection(
    ctx: PdfDrawCtx,
    y: number,
    report: SprintDefectReport,
    showOriginBreakdown: boolean
): void {
    const { doc, t } = ctx;
    const { originDefs, originRowsData } = computeOriginBreakdown(report, showOriginBreakdown, t);

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
        titleY
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
    t: TranslateFn
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
        { align: "right" }
    );

    const ctx: PdfDrawCtx = { doc, pageWidth, innerWidth, t };

    let y = pdfDrawAlertBanner(ctx, 30, alertText);

    const kpis = computeStatusCardKpis(suiteGroups, report);

    y = ensurePdfSpace(doc, y, 24);

    autoTable(doc, {
        startY: y,
        theme: "plain",
        head: [
            [
                t("defectManagementPage.sprintReport.statusCard.kpis.totalTestCases"),
                t("defectManagementPage.sprintReport.statusCard.kpis.passRate"),
                t("defectManagementPage.sprintReport.statusCard.kpis.bugsClosed", {
                    percent: kpis.bugsClosedPct,
                }),
                t("defectManagementPage.sprintReport.statusCard.kpis.criticalBugs"),
                t("defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs", {
                    percent: kpis.reopenedPct,
                }),
                t("defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime"),
            ],
        ],
        body: [
            [
                String(kpis.totalTestCases),
                `${kpis.passRate}%`,
                `${kpis.bugsClosed}/${report.total}`,
                String(kpis.criticalCount),
                String(report.reopenedCount),
                t("defectManagementPage.stats.days", { value: kpis.avgClosureDays }),
            ],
        ],
        tableWidth: innerWidth,
        styles: { fontSize: 7, halign: "center", cellPadding: 2, textColor: LIGHT_INK_MUTED },
        headStyles: { textColor: LIGHT_INK_MUTED, fontStyle: "normal" },
        bodyStyles: { fontSize: 12, fontStyle: "bold" },
        // Explicit equal cellWidth (rather than autoTable's content-based
        // default) so all 6 tiles are exactly innerWidth/6 wide - matching
        // the standalone 7th tile below, which uses that same width.
        columnStyles: Object.fromEntries(
            LIGHT_KPI.slice(0, 6).map((kpi, index) => [
                index,
                { fillColor: kpi.bg, textColor: kpi.accent, cellWidth: innerWidth / 6 },
            ])
        ),
        didParseCell: (hookData) => {
            if (hookData.section === "head") {
                hookData.cell.styles.fillColor = LIGHT_KPI[hookData.column.index].bg;
                hookData.cell.styles.textColor = LIGHT_INK_MUTED;
            }
        },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;

    const row2Defs = buildPdfRow2KpiDefs(kpis, report, t);

    autoTable(doc, {
        startY: y,
        theme: "plain",
        tableWidth: (innerWidth / 6) * row2Defs.length,
        margin: { left: PDF_MARGIN },
        head: [row2Defs.map((d) => d.label)],
        body: [row2Defs.map((d) => d.value)],
        styles: { fontSize: 7, halign: "center", cellPadding: 2, textColor: LIGHT_INK_MUTED },
        headStyles: { textColor: LIGHT_INK_MUTED, fontStyle: "normal" },
        bodyStyles: { fontSize: 12, fontStyle: "bold" },
        columnStyles: Object.fromEntries(
            row2Defs.map((d, index) => [
                index,
                { fillColor: d.kpi.bg, textColor: d.kpi.accent, cellWidth: innerWidth / 6 },
            ])
        ),
        didParseCell: (hookData) => {
            if (hookData.section === "head") {
                hookData.cell.styles.fillColor = row2Defs[hookData.column.index].kpi.bg;
                hookData.cell.styles.textColor = LIGHT_INK_MUTED;
            }
        },
    });

    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

    y = pdfDrawDashboardButton(ctx, y, dashboardUrl);
    y = pdfDrawActionsSection(ctx, y, actionsText);
    y = pdfDrawSuiteProgressSection(ctx, y, suiteGroups);
    y = pdfDrawBugStatusSection(ctx, y, report, kpis, suiteGroups, includeDsiSource);
    pdfDrawOriginBreakdownSection(ctx, y, report, showOriginBreakdown);

    return doc;
}

export function exportStatusReportCardToPdf(
    filename: string,
    data: StatusReportCardEmailData,
    t: TranslateFn
): void {
    const doc = buildStatusReportCardPdfDocument(data, t);
    doc.save(filename);
}

export function downloadStatusReportCardEmailHtml(
    filename: string,
    data: StatusReportCardEmailData,
    t: TranslateFn
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
    fontSizePt: number
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
    segments: { color: string; pct: number }[]
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
    fontSize: number
): PptxGenJS.TextProps[] {
    return entries.flatMap((entry, index) => {
        const separator: PptxGenJS.TextProps[] =
            index > 0
                ? [{ text: "   |   ", options: { color: pptxHex(textColor), fontSize } }]
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
    scale = 1
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
                { text: `${percent}%`, options: { fontSize: 9 * scale, breakLine: true } },
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
            }
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
    t: TranslateFn
): {
    originDefs: { origin: string; labelKey: string; bySuite: Record<string, number> }[];
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
        const suiteEntries = Object.entries(def.bySuite).sort(([a], [b]) => a.localeCompare(b));

        return [
            ...suiteEntries.map(([suite, count]) => [
                t(def.labelKey),
                suiteCaption(t, suite),
                String(count),
            ]),
            [
                t(def.labelKey),
                t("defectManagementPage.sprintReport.statusCard.originBreakdown.detected"),
                String(report.byOriginDetected[def.origin] ?? 0),
            ],
            [
                t(def.labelKey),
                t("defectManagementPage.sprintReport.statusCard.originBreakdown.accepted"),
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
    const naturalAlertBlock = hasAlert ? naturalAlertLineCount * 0.2 + 0.14 + 0.18 : 0;

    const naturalKpiBlock = 0.62 + 0.08 + 0.62 + 0.15;

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
                  0
              )
            : 0;

    const naturalSuiteBlock = 0.32 + (suiteGroups.length > 0 ? suiteGroups.length * 0.5 : 0.28);

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
    report: SprintDefectReport,
    t: TranslateFn
): { value: string; label: string }[] {
    return [
        {
            value: String(kpis.totalTestCases),
            label: t("defectManagementPage.sprintReport.statusCard.kpis.totalTestCases"),
        },
        {
            value: `${kpis.passRate}%`,
            label: t("defectManagementPage.sprintReport.statusCard.kpis.passRate"),
        },
        {
            value: `${kpis.bugsClosed}/${report.total}`,
            label: t("defectManagementPage.sprintReport.statusCard.kpis.bugsClosed", {
                percent: kpis.bugsClosedPct,
            }),
        },
        {
            value: String(kpis.criticalCount),
            label: t("defectManagementPage.sprintReport.statusCard.kpis.criticalBugs"),
        },
        {
            value: String(report.reopenedCount),
            label: t("defectManagementPage.sprintReport.statusCard.kpis.reopenedBugs", {
                percent: kpis.reopenedPct,
            }),
        },
        {
            value: t("defectManagementPage.stats.days", { value: kpis.avgClosureDays }),
            label: t("defectManagementPage.sprintReport.statusCard.kpis.avgClosureTime"),
        },
    ];
}

function buildPptxRow2KpiDefs(
    kpis: StatusCardKpis,
    report: SprintDefectReport,
    t: TranslateFn
): { value: string; label: string }[] {
    return [
        {
            value: `${report.effectiveCount}/${report.total}`,
            label: t("defectManagementPage.sprintReport.statusCard.kpis.effectiveBugsDetected"),
        },
        {
            value: String(report.withoutResolutionDateCount),
            label: t("defectManagementPage.sprintReport.statusCard.kpis.withoutResolutionDate"),
        },
        ...(report.outOfScopeCount > 0
            ? [
                {
                    value: `${report.outOfScopeCount}/${report.total}`,
                    label: t(
                        "defectManagementPage.sprintReport.statusCard.kpis.outOfScopeBugsDetected"
                    ),
                },
            ]
            : []),
        {
            value: `${kpis.notApplicableRate}%`,
            label: t("defectManagementPage.sprintReport.statusCard.kpis.notApplicableRate"),
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
    naturalAlertBlock: number
): number {
    if (!alertText) {
        return cursorY;
    }

    const { slide, M, innerW, s } = ctx;
    const lineCount = estimateWrappedLineCount(`⚠ ${alertText}`, innerW - 0.35, s(11));
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
    row2KpiDefs: { value: string; label: string }[]
): void {
    const { slide, M, innerW, s } = ctx;
    const kpiHeight = s(0.62);
    const kpiGap = 0.06;
    const kpiColumns = 6;
    const kpiTileWidth = (innerW - kpiGap * (kpiColumns - 1)) / kpiColumns;

    const drawTile = (
        kpi: { value: string; label: string },
        paletteIndex: number,
        positionIndex: number,
        y: number
    ) => {
        const kpiPalette = PPTX_KPI[paletteIndex];
        const tileX = M + positionIndex * (kpiTileWidth + kpiGap);

        slide.addText(
            [
                { text: kpi.value, options: { fontSize: s(15), bold: true, breakLine: true } },
                { text: kpi.label, options: { fontSize: s(7) } },
            ],
            {
                x: tileX,
                y,
                w: kpiTileWidth,
                h: kpiHeight,
                align: "center",
                valign: "middle",
                color: pptxHex(kpiPalette.accent),
                fontFace: "Arial",
                fill: { color: pptxHex(kpiPalette.bg) },
                line: { color: pptxHex(kpiPalette.accent), width: 0.75 },
                shape: "roundRect",
                rectRadius: 0.06,
            }
        );
    };

    kpiDefs.forEach((kpi, index) => drawTile(kpi, index, index, cursorY));
    row2KpiDefs.forEach((kpi, index) =>
        drawTile(kpi, 6 + index, index, cursorY + kpiHeight + s(0.08))
    );
}

function pptxDrawDashboardButton(
    ctx: PptxDrawCtx,
    cursorY: number,
    dashboardUrl: string | undefined,
    naturalDashboardBlock: number
): number {
    if (!dashboardUrl) {
        return cursorY;
    }

    const { slide, M, innerW, s, t } = ctx;
    const buttonHeight = s(0.32);

    slide.addText(t("defectManagementPage.sprintReport.statusCard.openDashboard"), {
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
    });

    return cursorY + s(naturalDashboardBlock);
}

function pptxDrawActionsSection(
    ctx: PptxDrawCtx,
    cursorY: number,
    actionParagraphs: string[]
): number {
    if (actionParagraphs.length === 0) {
        return cursorY;
    }

    const { slide, M, innerW, s, t } = ctx;
    const titleHeight = s(0.32);

    slide.addText(`📌 ${t("defectManagementPage.sprintReport.statusCard.actionsTitle")}`, {
        x: M,
        y: cursorY,
        w: innerW,
        h: titleHeight,
        fontSize: s(13),
        bold: true,
        color: pptxHex(LIGHT_INK),
        fontFace: "Arial",
    });

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

function pptxDrawSuiteProgressRow(ctx: PptxDrawCtx, y: number, group: SuiteProgressGroup): void {
    const { slide, M, W, innerW, s, t } = ctx;
    const { executedPct, groupPassRate, segments, legendEntries } =
        computeSuiteProgressRowData(group);
    const legendRuns = pptxLegendRuns(
        legendEntries.map((outcome) => ({
            color: LIGHT_OUTCOME_COLORS[outcome],
            label: outcomeCountLabel(t, outcome, group.outcomeCounts[outcome]),
        })),
        LIGHT_INK_MUTED,
        s(8.5)
    );

    slide.addText(
        `${group.label} – ${t("defectManagementPage.sprintReport.statusCard.casesCount", {
            count: group.totalTestCases,
        })}`,
        {
            x: M,
            y,
            w: innerW - 1.3,
            h: s(0.2),
            fontSize: s(10),
            bold: true,
            color: pptxHex(LIGHT_INK),
            fontFace: "Arial",
        }
    );
    slide.addText(`${executedPct}% ${t("defectManagementPage.sprintReport.statusCard.executed")}`, {
        x: W - M - 1.3,
        y,
        w: 1.3,
        h: s(0.2),
        fontSize: s(10),
        bold: true,
        align: "right",
        color: pptxHex(LIGHT_INK),
        fontFace: "Arial",
    });

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
        }
    );
}

function pptxDrawSuiteProgressSection(
    ctx: PptxDrawCtx,
    cursorY: number,
    suiteGroups: SuiteProgressGroup[]
): number {
    const { slide, M, innerW, s, t } = ctx;
    const titleHeight = s(0.32);

    slide.addText(`📈 ${t("defectManagementPage.sprintReport.statusCard.suiteProgressTitle")}`, {
        x: M,
        y: cursorY,
        w: innerW,
        h: titleHeight,
        fontSize: s(13),
        bold: true,
        color: pptxHex(LIGHT_INK),
        fontFace: "Arial",
    });

    const rowY = cursorY + titleHeight;

    if (suiteGroups.length === 0) {
        slide.addText(t("defectManagementPage.sprintReport.statusCard.noPlanSelected"), {
            x: M,
            y: rowY,
            w: innerW,
            h: s(0.24),
            fontSize: s(10),
            italic: true,
            color: pptxHex(LIGHT_INK_MUTED),
            fontFace: "Arial",
        });

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
    naturalBugStatusBlock: number
): number {
    const { slide, M, W, innerW, scale, s, t } = ctx;
    const bugSources = [
        ...suiteGroups.map((group) => group.label),
        ...(includeDsiSource ? ["DSI"] : []),
    ].join(", ");
    const {
        statusEntries,
        statusSegments,
        severityTotal,
        severityEntries,
        openSeverityTotal,
        openSeverityEntries,
    } = computeBugStatusData(report);

    const y = cursorY;

    slide.addText(`🐛 ${t("defectManagementPage.sprintReport.statusCard.bugStatusTitle")}`, {
        x: M,
        y,
        w: innerW,
        h: s(0.24),
        fontSize: s(13),
        bold: true,
        color: pptxHex(LIGHT_INK),
        fontFace: "Arial",
    });
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
        }
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
        }
    );
    slide.addText(
        t("defectManagementPage.sprintReport.statusCard.stillOpen", { count: kpis.stillOpen }),
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
        }
    );

    localY += s(0.24);
    pptxProgressTrack(slide, M, localY, innerW, s(0.07), statusSegments);
    localY += s(0.1);

    slide.addText(
        statusEntries.map(([name, count]) => statusCountLabel(t, name, count)).join("   |   "),
        {
            x: M,
            y: localY,
            w: innerW,
            h: s(0.2),
            fontSize: s(8.5),
            color: pptxHex(LIGHT_INK_MUTED),
            fontFace: "Arial",
        }
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
        scale
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
        scale
    );

    return y + s(naturalBugStatusBlock);
}

function pptxDrawOriginBreakdownSection(
    ctx: PptxDrawCtx,
    cursorY: number,
    originDefs: unknown[],
    originRowsData: string[][]
): number {
    if (originDefs.length === 0) {
        return cursorY;
    }

    const { slide, M, innerW, s, t } = ctx;
    const titleHeight = s(0.32);
    const rowHeight = s(0.24);

    slide.addText(t("defectManagementPage.sprintReport.statusCard.originBreakdown.title"), {
        x: M,
        y: cursorY,
        w: innerW,
        h: titleHeight,
        fontSize: s(13),
        bold: true,
        color: pptxHex(LIGHT_INK),
        fontFace: "Arial",
    });

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
    t: TranslateFn
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
    const { originDefs, originRowsData } = computeOriginBreakdown(report, showOriginBreakdown, t);

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
        }
    );

    const ctx: PptxDrawCtx = { slide, M, W, innerW, scale, s, t };

    let cursorY = bodyTop;

    cursorY = pptxDrawAlertBanner(ctx, cursorY, alertText, heights.naturalAlertBlock);

    const kpis = computeStatusCardKpis(suiteGroups, report);
    const kpiDefs = buildPptxKpiDefs(kpis, report, t);
    const row2KpiDefs = buildPptxRow2KpiDefs(kpis, report, t);

    pptxDrawKpiTiles(ctx, cursorY, kpiDefs, row2KpiDefs);
    cursorY += s(heights.naturalKpiBlock);

    cursorY = pptxDrawDashboardButton(ctx, cursorY, dashboardUrl, heights.naturalDashboardBlock);
    cursorY = pptxDrawActionsSection(ctx, cursorY, actionParagraphs);
    cursorY = pptxDrawSuiteProgressSection(ctx, cursorY, suiteGroups);
    cursorY = pptxDrawBugStatusSection(
        ctx,
        cursorY,
        report,
        kpis,
        suiteGroups,
        includeDsiSource,
        heights.naturalBugStatusBlock
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
    t: TranslateFn
): Promise<void> {
    const bodyHtml = buildStatusReportCardEmailBodyHtml(data, t);

    await navigator.clipboard.write([
        new ClipboardItem({
            "text/html": new Blob([bodyHtml], { type: "text/html" }),
            "text/plain": new Blob([data.headerTitle], { type: "text/plain" }),
        }),
    ]);
}

export function exportPlanProgressToPdf(
    planTitle: string,
    counts: TestPlanProgressCounts,
    bugs: BugInfo[],
    labels: PlanProgressPdfLabels,
    charts: ChartImage[] = []
): void {
    const doc = buildPlanProgressPdfDocument(
        planTitle,
        counts,
        bugs,
        labels,
        charts
    );
    doc.save(buildPlanProgressFilename(planTitle));
}

export function buildPlanProgressPdfBase64(
    planTitle: string,
    counts: TestPlanProgressCounts,
    bugs: BugInfo[],
    labels: PlanProgressPdfLabels,
    charts: ChartImage[] = []
): string {
    const doc = buildPlanProgressPdfDocument(
        planTitle,
        counts,
        bugs,
        labels,
        charts
    );
    return pdfDocToBase64(doc);
}
