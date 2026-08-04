import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { SprintDefectReport } from "./types.js";

const PDF_MARGIN = 14;

// Mirrors the ordering used for the on-screen charts and PDF export in
// client/src/utils/export.ts, kept in sync by hand since this runs in a
// separate (server-side, no-DOM) build from the client bundle.
const STATUS_ORDER = ["New", "In Progress", "Closed"];

function sortByStatusOrder(
    breakdown: Record<string, number>
): [string, number][] {
    return Object.entries(breakdown).sort(
        ([a], [b]) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b)
    );
}

function severityRank(raw: string): number {
    const match = /^(\d+)\s*-/.exec(raw);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sortBySeverityOrder(
    breakdown: Record<string, number>
): [string, number][] {
    return Object.entries(breakdown).sort(
        ([a], [b]) => severityRank(a) - severityRank(b)
    );
}

function breakdownTable(
    doc: jsPDF,
    heading: string,
    entries: [string, number][],
    startY: number
): number {
    doc.setFontSize(12);
    doc.text(heading, PDF_MARGIN, startY);

    autoTable(doc, {
        startY: startY + 4,
        head: [[heading, "Count"]],
        body: entries.map(([name, count]) => [name, String(count)]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 90, 158] },
    });

    return (
        (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 10
    );
}

function buildSprintDefectReportPdf(report: SprintDefectReport): jsPDF {
    const doc = new jsPDF();

    doc.setFontSize(14);
    doc.text("Report Difetti di Sprint 1", PDF_MARGIN, 15);

    autoTable(doc, {
        startY: 22,
        head: [["Bugs Detected", "Effective Defects", "Out of Scope"]],
        body: [
            [
                String(report.total),
                String(report.effectiveCount),
                String(report.outOfScopeCount),
            ],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 90, 158] },
    });

    let nextY =
        (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 10;

    nextY = breakdownTable(
        doc,
        "Effective Defects by Origin",
        Object.entries(report.byOrigin),
        nextY
    );
    nextY = breakdownTable(
        doc,
        "Effective Defects by Status",
        sortByStatusOrder(report.byStatus),
        nextY
    );
    breakdownTable(
        doc,
        "Effective Defects by Severity",
        sortBySeverityOrder(report.bySeverity),
        nextY
    );

    return doc;
}

function formatDateDDMMYYYY(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

// Writes today's Sprint Defect Report PDF into destinationFolder, named the
// same way as the dashboard's manual export (sprint_defect_report_DD-MM-YYYY.pdf).
export function writeSprintDefectReportFile(
    report: SprintDefectReport,
    destinationFolder: string
): string {
    fs.mkdirSync(destinationFolder, { recursive: true });

    const filename = `sprint_defect_report_${formatDateDDMMYYYY(new Date())}.pdf`;
    const filePath = path.join(destinationFolder, filename);

    const doc = buildSprintDefectReportPdf(report);
    fs.writeFileSync(filePath, Buffer.from(doc.output("arraybuffer")));

    return filePath;
}
