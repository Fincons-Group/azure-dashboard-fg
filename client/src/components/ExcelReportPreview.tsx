import { type CSSProperties, useState } from "react";
import { Tab, TabList, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { PreviewCell, PreviewSheet, PreviewTable } from "../utils/excelReport";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
    },
    tabList: {
        flexWrap: "wrap",
    },
    tables: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
    },
    tableBlock: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    scroll: {
        overflowX: "auto",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    table: {
        borderCollapse: "collapse",
        width: "100%",
        fontSize: tokens.fontSizeBase200,
    },
    th: {
        position: "sticky",
        top: 0,
        backgroundColor: "#1F3864",
        color: "#FFFFFF",
        fontWeight: tokens.fontWeightSemibold,
        textAlign: "left",
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
        whiteSpace: "nowrap",
    },
    td: {
        padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        verticalAlign: "top",
    },
    tdNum: {
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
    },
    rowAlt: {
        backgroundColor: tokens.colorNeutralBackground2,
    },
    link: {
        color: tokens.colorBrandForegroundLink,
    },
    pill: {
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: tokens.borderRadiusSmall,
        fontWeight: tokens.fontWeightSemibold,
        fontVariantNumeric: "tabular-nums",
    },
});

// Mirrors STATUS_HEX / severityFillArgb in excelReport.ts so the preview and
// the workbook colour the same values the same way.
const STATUS_COLOR: Record<string, string> = {
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

function percentStyle(value: number, higherIsBetter: boolean): CSSProperties {
    const good = higherIsBetter ? value >= 80 : value <= 20;
    const bad = higherIsBetter ? value < 50 : value > 50;
    if (good) return { backgroundColor: "#C6EFCE", color: "#006100" };
    if (bad) return { backgroundColor: "#FFC7CE", color: "#9C0006" };
    return { backgroundColor: "#FFEB9C", color: "#9C6500" };
}

type PreviewStyles = ReturnType<typeof useStyles>;

// Plain render function (not a component) so a wide table doesn't fire the
// useStyles hook once per cell.
function renderCell(cell: PreviewCell, styles: PreviewStyles, key: number) {
    if (cell.kind === "link" && cell.href) {
        return (
            <td key={key} className={styles.td}>
                <a
                    className={styles.link}
                    href={cell.href}
                    target="_blank"
                    rel="noreferrer"
                >
                    {cell.value}
                </a>
            </td>
        );
    }

    if (cell.kind === "percent" || cell.kind === "percentInverse") {
        const value = Number(cell.value);
        return (
            <td key={key} className={`${styles.td} ${styles.tdNum}`}>
                <span
                    className={styles.pill}
                    style={percentStyle(value, cell.kind === "percent")}
                >
                    {value}%
                </span>
            </td>
        );
    }

    if (cell.kind === "number") {
        return (
            <td key={key} className={`${styles.td} ${styles.tdNum}`}>
                {cell.value}
            </td>
        );
    }

    if (cell.kind === "severity") {
        return (
            <td key={key} className={styles.td}>
                <span
                    style={{
                        color: severityColor(String(cell.value)),
                        fontWeight: 600,
                    }}
                >
                    {cell.value}
                </span>
            </td>
        );
    }

    if (cell.kind === "status") {
        return (
            <td key={key} className={styles.td}>
                <span
                    style={{
                        color: STATUS_COLOR[String(cell.value)] ?? "inherit",
                        fontWeight: 600,
                    }}
                >
                    {cell.value}
                </span>
            </td>
        );
    }

    return (
        <td key={key} className={styles.td}>
            {cell.value}
        </td>
    );
}

function PreviewTableView({ table }: { table: PreviewTable }) {
    const styles = useStyles();

    return (
        <div className={styles.tableBlock}>
            <Text weight="semibold">{table.title}</Text>
            <div className={styles.scroll}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            {table.columns.map((column) => (
                                <th key={column} className={styles.th}>
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {table.rows.map((row, rowIndex) => (
                            <tr
                                key={rowIndex}
                                className={rowIndex % 2 === 1 ? styles.rowAlt : undefined}
                            >
                                {row.map((cell, cellIndex) =>
                                    renderCell(cell, styles, cellIndex)
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function ExcelReportPreview({
    sheets,
    hiddenRowsNote,
}: {
    sheets: PreviewSheet[];
    // Rendered under a capped table, e.g. "+N rows - full list is in the file".
    hiddenRowsNote?: (count: number) => string;
}) {
    const styles = useStyles();
    const [activeName, setActiveName] = useState(sheets[0]?.name);
    const active =
        sheets.find((sheet) => sheet.name === activeName) ?? sheets[0];

    if (!active) {
        return null;
    }

    return (
        <div className={styles.root}>
            <TabList
                className={styles.tabList}
                selectedValue={active.name}
                onTabSelect={(_, data) => setActiveName(data.value as string)}
                size="small"
            >
                {sheets.map((sheet) => (
                    <Tab key={sheet.name} value={sheet.name}>
                        {sheet.name}
                    </Tab>
                ))}
            </TabList>

            <div className={styles.tables}>
                {active.tables.map((table, index) => (
                    <div key={`${active.name}-${index}`}>
                        <PreviewTableView table={table} />
                        {table.hiddenRowCount && hiddenRowsNote ? (
                            <Text size={200} italic>
                                {hiddenRowsNote(table.hiddenRowCount)}
                            </Text>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
