import type { PreviewCell, PreviewSheet } from "./excelReport";

// This module is dependency-free on purpose: it only builds a plain
// `IWorkbookData`-shaped object literal (numeric enum values inlined below) so
// it can be imported without pulling any `@univerjs/*` runtime into the
// bundle. Only the lazy `UniverSheet` component imports Univer itself.
import type { IWorkbookData } from "@univerjs/core";

// Inlined @univerjs/core enum values (import type only above → no runtime dep).
const CELL_STRING = 1;
const CELL_NUMBER = 2;
const BOOL_TRUE = 1;
const ALIGN_RIGHT = 3;

const HEADER_BG = "#1F3864";
const HEADER_FG = "#FFFFFF";
const ZEBRA_BG = "#F2F5FB";
const TITLE_BG = "#D9E2F3";
const LINK_FG = "#0563C1";

const STATUS_HEX: Record<string, string> = {
    Closed: "#2E7D32",
    "Da verificare": "#1565C0",
    "In verifica": "#0097A7",
    "In Progress": "#F0A500",
    New: "#C62828",
    Reopened: "#AD1457",
    "Not Applicable": "#9E9E9E",
};

function severityColor(raw: string): string {
    const rank = Number(/^(\d+)\s*-/.exec(raw)?.[1] ?? 99);
    if (rank === 1) return "#C00000";
    if (rank === 2) return "#ED7D31";
    if (rank === 3) return "#B7950B";
    return "#808080";
}

function percentFill(value: number, higherIsBetter: boolean): { bg: string; fg: string } {
    const good = higherIsBetter ? value >= 80 : value <= 20;
    const bad = higherIsBetter ? value < 50 : value > 50;
    if (good) return { bg: "#C6EFCE", fg: "#006100" };
    if (bad) return { bg: "#FFC7CE", fg: "#9C0006" };
    return { bg: "#FFEB9C", fg: "#9C6500" };
}

// Univer sheet names: <=31 chars, no \ / ? * [ ] : and unique.
function sheetName(raw: string, used: Set<string>): string {
    const base = raw.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Sheet";
    let name = base;
    let i = 2;
    while (used.has(name)) {
        name = `${base} ${i++}`.slice(0, 31);
    }
    used.add(name);
    return name;
}

function cellText(cell: PreviewCell | undefined): string {
    if (!cell || cell.value == null) return "";
    return String(cell.value);
}

type Row = Record<number, Record<string, unknown>>;

function styleFor(cell: PreviewCell): Record<string, unknown> | undefined {
    switch (cell.kind) {
        case "number":
            return undefined;
        case "percent":
        case "percentInverse": {
            const value = Number(cell.value);
            const { bg, fg } = percentFill(value, cell.kind === "percent");
            return {
                n: { pattern: '0"%"' },
                bg: { rgb: bg },
                cl: { rgb: fg },
                bl: BOOL_TRUE,
                ht: ALIGN_RIGHT,
            };
        }
        case "severity":
            return { cl: { rgb: severityColor(String(cell.value)) }, bl: BOOL_TRUE };
        case "status": {
            const hex = STATUS_HEX[String(cell.value)];
            return hex ? { cl: { rgb: hex }, bl: BOOL_TRUE } : undefined;
        }
        case "link":
            return { cl: { rgb: LINK_FG }, ul: { s: BOOL_TRUE } };
        default:
            return undefined;
    }
}

// A value that is a pure integer (bug id, suite id, plan id, ...) - kept as a
// real number so Univer doesn't flag it as "text that looks numeric".
function asInteger(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isInteger(value) ? value : null;
    }
    if (typeof value === "string" && /^-?\d{1,15}$/.test(value.trim())) {
        return Number(value);
    }
    return null;
}

function valueCell(cell: PreviewCell | undefined): Record<string, unknown> {
    if (!cell || cell.value == null || cell.value === "") {
        return {};
    }

    if (
        cell.kind === "number" ||
        cell.kind === "percent" ||
        cell.kind === "percentInverse"
    ) {
        const num = Number(cell.value);
        const data: Record<string, unknown> = {
            v: Number.isFinite(num) ? num : cell.value,
            t: Number.isFinite(num) ? CELL_NUMBER : CELL_STRING,
        };
        const style = styleFor(cell);
        if (style) data.s = style;
        return data;
    }

    // Link cells render as plain (blue) text - real hyperlinks live in the
    // downloaded .xlsx. A `=HYPERLINK()` formula here makes Univer's formula
    // engine raise per-cell errors. Numeric ids go in as real numbers.
    const asInt = cell.kind === "link" ? asInteger(cell.value) : null;
    const data: Record<string, unknown> =
        asInt !== null
            ? { v: asInt, t: CELL_NUMBER }
            : { v: String(cell.value), t: CELL_STRING };
    const style = styleFor(cell);
    if (style) data.s = style;
    return data;
}

/**
 * Converts the report preview model into a Univer `IWorkbookData` object. The
 * embedded spreadsheet therefore mirrors exactly what the downloaded `.xlsx`
 * contains (both come from the same `PreviewSheet[]`).
 */
export function previewSheetsToUniverWorkbook(
    sheets: PreviewSheet[]
): Partial<IWorkbookData> {
    const used = new Set<string>();
    const sheetOrder: string[] = [];
    const out: NonNullable<IWorkbookData["sheets"]> = {};

    sheets.forEach((sheet, sheetIndex) => {
        const id = `sheet-${sheetIndex}`;
        const name = sheetName(sheet.name, used);
        sheetOrder.push(id);

        const cellData: Row = {};
        const colWidths: number[] = [];
        const noteColWidth = (col: number, text: string) => {
            colWidths[col] = Math.max(colWidths[col] ?? 48, Math.min(360, text.length * 7 + 16));
        };

        let r = 0;
        const singleTable = sheet.tables.length === 1;

        for (const table of sheet.tables) {
            if (!singleTable) {
                // Title band above each table when a sheet stacks several.
                cellData[r] = {
                    0: { v: table.title, t: CELL_STRING, s: { bl: BOOL_TRUE, bg: { rgb: TITLE_BG } } },
                };
                r += 1;
            }

            // Header row
            const headerRow: Record<number, Record<string, unknown>> = {};
            table.columns.forEach((col, ci) => {
                headerRow[ci] = {
                    v: col,
                    t: CELL_STRING,
                    s: { bl: BOOL_TRUE, bg: { rgb: HEADER_BG }, cl: { rgb: HEADER_FG } },
                };
                noteColWidth(ci, col);
            });
            cellData[r] = headerRow;
            r += 1;

            // Data rows
            table.rows.forEach((row, rowIndex) => {
                const cells: Record<number, Record<string, unknown>> = {};
                table.columns.forEach((_, ci) => {
                    const cell = row[ci];
                    const data = valueCell(cell);
                    if (rowIndex % 2 === 1 && !data.s) {
                        data.s = { bg: { rgb: ZEBRA_BG } };
                    } else if (rowIndex % 2 === 1 && data.s) {
                        (data.s as Record<string, unknown>).bg ??= { rgb: ZEBRA_BG };
                    }
                    cells[ci] = data;
                    noteColWidth(ci, cellText(cell));
                });
                cellData[r] = cells;
                r += 1;
            });

            if (!singleTable) {
                r += 1; // blank spacer row between stacked tables
            }
        }

        const columnCount = Math.max(
            ...sheet.tables.map((tbl) => tbl.columns.length),
            1
        );
        const columnData: Record<number, { w: number }> = {};
        for (let c = 0; c < columnCount; c += 1) {
            columnData[c] = { w: colWidths[c] ?? 90 };
        }

        out[id] = {
            id,
            name,
            rowCount: r + 40,
            columnCount: columnCount + 4,
            cellData: cellData as unknown as NonNullable<IWorkbookData["sheets"]>[string]["cellData"],
            columnData: columnData as unknown as NonNullable<IWorkbookData["sheets"]>[string]["columnData"],
            // Freeze the header only when the sheet is a single flat table.
            freeze: singleTable
                ? { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 }
                : { xSplit: 0, ySplit: 0, startRow: 0, startColumn: 0 },
        };
    });

    return {
        id: `report-${Date.now()}`,
        name: "Report",
        sheetOrder,
        sheets: out,
        styles: {},
    };
}
