import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
    Badge,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Spinner,
    Text,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import {
    AddRegular,
    ArrowClockwiseRegular,
    ArrowDownloadRegular,
    ChevronLeftRegular,
    ChevronRightRegular,
    DeleteRegular,
    EditRegular,
} from "@fluentui/react-icons";
import { PageLayout } from "../components/PageLayout";
import { ErrorState } from "../components/ErrorState";
import {
    PresetEditorDialog,
    type PresetEditorValues,
} from "../components/PresetEditorDialog";
import {
    isPresetComplete,
    useExcelExportPresets,
    type ExcelExportPreset,
} from "../hooks/useExcelExportPresets";
import { useScope } from "../hooks/useScope";
import { buildStatusReportCardFilename } from "../utils/export";
import {
    buildMultiScopePreview,
    exportMultiScopeReportToExcel,
} from "../utils/excelReport";
import {
    assembleMultiScopeData,
    type MultiScopeEntry,
} from "../utils/multiScopeReport";
import { previewSheetsToUniverWorkbook } from "../utils/univerWorkbook";

const UniverSheet = lazy(() => import("../components/UniverSheet"));

const SIDE_WIDTH = "340px";
const SIDE_COLLAPSED_WIDTH = "48px";
const SIDE_COLLAPSED_KEY = "azureDashboardExcelSidePanelCollapsed";

const useStyles = makeStyles({
    layout: {
        display: "flex",
        height: "100%",
        width: "100%",
    },
    sheetArea: {
        position: "relative",
        flex: "1 1 auto",
        minWidth: 0,
        height: "100%",
    },
    sheetFill: {
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
    },
    sheetCenter: {
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: tokens.spacingHorizontalXXL,
        color: tokens.colorNeutralForeground3,
        textAlign: "center",
    },
    side: {
        width: SIDE_WIDTH,
        minWidth: SIDE_WIDTH,
        flexShrink: 0,
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        boxSizing: "border-box",
        borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        padding: tokens.spacingHorizontalL,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        transitionProperty: "width, min-width, padding",
        transitionDuration: tokens.durationNormal,
        transitionTimingFunction: tokens.curveEasyEase,
    },
    sideCollapsed: {
        width: SIDE_COLLAPSED_WIDTH,
        minWidth: SIDE_COLLAPSED_WIDTH,
        paddingLeft: tokens.spacingHorizontalXXS,
        paddingRight: tokens.spacingHorizontalXXS,
        alignItems: "center",
    },
    sideHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalS,
    },
    sideHeaderCollapsed: {
        justifyContent: "center",
    },
    rail: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: tokens.spacingVerticalS,
    },
    intro: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    sideButtons: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    fullButton: {
        width: "100%",
        justifyContent: "flex-start",
    },
    list: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        padding: tokens.spacingHorizontalS,
    },
    headRow: {
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingBottom: tokens.spacingVerticalXS,
        marginBottom: tokens.spacingVerticalXXS,
    },
    row: {
        display: "flex",
        alignItems: "flex-start",
        gap: tokens.spacingHorizontalS,
        padding: `${tokens.spacingVerticalXS} 0`,
    },
    rowMain: {
        flex: "1 1 auto",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
    },
    rowSummary: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase100,
        overflowWrap: "anywhere",
    },
    rowActions: {
        display: "flex",
        flexShrink: 0,
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        padding: tokens.spacingVerticalL,
    },
});

function scopeLeaf(path: string): string {
    if (!path) {
        return "-";
    }
    const parts = path.split("\\");
    return parts[parts.length - 1];
}

function readCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDE_COLLAPSED_KEY) === "true";
    } catch {
        return false;
    }
}

export function ExcelExportPage() {
    const { t } = useTranslation();
    const styles = useStyles();
    const scope = useScope();
    const queryClient = useQueryClient();

    const { presets, addPreset, updatePreset, deletePreset } =
        useExcelExportPresets();

    const [collapsed, setCollapsed] = useState(readCollapsed);

    // The Univer canvas keys its size off its container; nudge it to re-measure
    // once the side-panel width transition has finished.
    useEffect(() => {
        const id = window.setTimeout(
            () => window.dispatchEvent(new Event("resize")),
            260
        );
        return () => window.clearTimeout(id);
    }, [collapsed]);

    const toggleCollapsed = () =>
        setCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(SIDE_COLLAPSED_KEY, String(next));
            } catch {
                // ignore - preference just won't persist
            }
            return next;
        });

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<ExcelExportPreset | undefined>(
        undefined
    );
    const [toDelete, setToDelete] = useState<ExcelExportPreset | undefined>(
        undefined
    );

    const [isDownloading, setIsDownloading] = useState(false);

    const completePresets = useMemo(
        () => presets.filter(isPresetComplete),
        [presets]
    );

    const selectedPresets = useMemo(
        () => completePresets.filter((preset) => selectedIds.has(preset.id)),
        [completePresets, selectedIds]
    );

    // Stable primitive dep so the fetch effect only re-runs on an actual
    // selection change (not on every render's new array identity).
    const selectionKey = selectedPresets.map((preset) => preset.id).join("|");

    const allChecked =
        completePresets.length > 0 &&
        completePresets.every((preset) => selectedIds.has(preset.id));
    const someChecked = completePresets.some((preset) =>
        selectedIds.has(preset.id)
    );

    const toggleAll = (checked: boolean) => {
        setSelectedIds(
            checked
                ? new Set(completePresets.map((preset) => preset.id))
                : new Set()
        );
    };

    const toggleOne = (id: string, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    };

    const handleSave = (draft: PresetEditorValues) => {
        if (editing) {
            updatePreset(editing.id, draft);
        } else {
            addPreset(draft);
        }
        setEditorOpen(false);
        setEditing(undefined);
    };

    // Fetches once per scope selection and then only when the user presses
    // "Aggiorna dati" (refetch()). NOT on window focus / reconnect - Univer's
    // editor churns focus/blur events and each one would otherwise re-pull the
    // whole multi-scope report. assembleMultiScopeData forces a live read from
    // Azure when it does run (its inner fetchQuery calls use staleTime 0).
    const {
        data: fetchedEntries,
        isFetching,
        isError,
        error,
        refetch,
    } = useQuery({
        queryKey: ["excel-export-multi-scope", selectionKey],
        queryFn: () => assembleMultiScopeData(selectedPresets, queryClient),
        enabled: selectedPresets.length > 0,
        retry: false,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });

    const activeEntries: MultiScopeEntry[] = useMemo(
        () => (selectedPresets.length > 0 ? fetchedEntries ?? [] : []),
        [selectedPresets.length, fetchedEntries]
    );
    const isPreparing = isFetching && selectedPresets.length > 0;

    const previewSheets = useMemo(
        () =>
            activeEntries.length > 0
                ? buildMultiScopePreview(activeEntries, t)
                : [],
        [activeEntries, t]
    );

    const univerData = useMemo(
        () =>
            previewSheets.length > 0
                ? previewSheetsToUniverWorkbook(previewSheets)
                : null,
        [previewSheets]
    );

    const handleDownload = async () => {
        if (activeEntries.length === 0) {
            return;
        }
        setIsDownloading(true);
        try {
            const title =
                activeEntries.length === 1
                    ? activeEntries[0].scopeName
                    : t("dynamicSprintReportPage.excel.combinedTitle");
            await exportMultiScopeReportToExcel(
                buildStatusReportCardFilename(title, "xlsx"),
                activeEntries,
                t
            );
        } finally {
            setIsDownloading(false);
        }
    };

    const sheetBody = () => {
        if (selectedPresets.length === 0) {
            return (
                <div className={styles.sheetCenter}>
                    {t("excelExportPage.selectPresetPrompt")}
                </div>
            );
        }
        if (isError) {
            return (
                <div className={styles.sheetCenter}>
                    <ErrorState
                        message={
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }
                        onRetry={() => void refetch()}
                    />
                </div>
            );
        }
        if (!univerData) {
            return (
                <div className={styles.sheetCenter}>
                    <Spinner label={t("excelExportPage.loadingSheet")} />
                </div>
            );
        }
        return (
            <Suspense
                fallback={
                    <div className={styles.sheetCenter}>
                        <Spinner label={t("excelExportPage.loadingSheet")} />
                    </div>
                }
            >
                <UniverSheet data={univerData} loading={isPreparing} />
            </Suspense>
        );
    };

    return (
        <PageLayout
            title={t("excelExportPage.title")}
            fullBleed
            hideAreaSprintScope
        >
            <div className={styles.layout}>
                <div className={styles.sheetArea}>
                    <div className={styles.sheetFill}>{sheetBody()}</div>
                </div>

                <aside
                    className={mergeClasses(
                        styles.side,
                        collapsed && styles.sideCollapsed
                    )}
                >
                    <div
                        className={mergeClasses(
                            styles.sideHeader,
                            collapsed && styles.sideHeaderCollapsed
                        )}
                    >
                        {!collapsed && (
                            <Text weight="semibold">
                                {t("excelExportPage.scopesHeading")}
                            </Text>
                        )}
                        <Tooltip
                            content={t(
                                collapsed
                                    ? "excelExportPage.expandPanel"
                                    : "excelExportPage.collapsePanel"
                            )}
                            relationship="label"
                        >
                            <Button
                                appearance="subtle"
                                icon={
                                    collapsed ? (
                                        <ChevronLeftRegular />
                                    ) : (
                                        <ChevronRightRegular />
                                    )
                                }
                                onClick={toggleCollapsed}
                            />
                        </Tooltip>
                    </div>

                    {collapsed && (
                        <div className={styles.rail}>
                            <Tooltip
                                content={t("excelExportPage.refreshData")}
                                relationship="label"
                            >
                                <Button
                                    appearance="subtle"
                                    icon={<ArrowClockwiseRegular />}
                                    disabled={
                                        selectedPresets.length === 0 ||
                                        isPreparing
                                    }
                                    onClick={() => void refetch()}
                                />
                            </Tooltip>
                            <Tooltip
                                content={t("excelExportPage.downloadButton")}
                                relationship="label"
                            >
                                <Button
                                    appearance="primary"
                                    icon={<ArrowDownloadRegular />}
                                    disabled={
                                        activeEntries.length === 0 ||
                                        isDownloading ||
                                        isPreparing
                                    }
                                    onClick={handleDownload}
                                />
                            </Tooltip>
                            <Tooltip
                                content={t("excelExportPage.addPreset")}
                                relationship="label"
                            >
                                <Button
                                    appearance="subtle"
                                    icon={<AddRegular />}
                                    onClick={() => {
                                        setEditing(undefined);
                                        setEditorOpen(true);
                                    }}
                                />
                            </Tooltip>
                        </div>
                    )}

                    {!collapsed && (
                        <>
                            <Text as="p" className={styles.intro}>
                                {t("excelExportPage.intro")}
                            </Text>

                            <div className={styles.sideButtons}>
                                <Button
                                    className={styles.fullButton}
                                    icon={<ArrowClockwiseRegular />}
                                    disabled={
                                        selectedPresets.length === 0 ||
                                        isPreparing
                                    }
                                    onClick={() => void refetch()}
                                >
                                    {isPreparing
                                        ? t("excelExportPage.preparing")
                                        : t("excelExportPage.refreshData")}
                                </Button>
                                <Button
                                    className={styles.fullButton}
                                    appearance="primary"
                                    icon={<ArrowDownloadRegular />}
                                    disabled={
                                        activeEntries.length === 0 ||
                                        isDownloading ||
                                        isPreparing
                                    }
                                    onClick={handleDownload}
                                >
                                    {isDownloading
                                        ? t("excelExportPage.exporting")
                                        : t("excelExportPage.downloadButton")}
                                </Button>
                                <Button
                                    className={styles.fullButton}
                                    icon={<AddRegular />}
                                    onClick={() => {
                                        setEditing(undefined);
                                        setEditorOpen(true);
                                    }}
                                >
                                    {t("excelExportPage.addPreset")}
                                </Button>
                            </div>

                            {presets.length === 0 ? (
                        <Text className={styles.empty}>
                            {t("excelExportPage.noPresets")}
                        </Text>
                    ) : (
                        <div className={styles.list}>
                            <div
                                className={`${styles.row} ${styles.headRow}`}
                            >
                                <Checkbox
                                    checked={
                                        allChecked
                                            ? true
                                            : someChecked
                                            ? "mixed"
                                            : false
                                    }
                                    onChange={(_, data) =>
                                        toggleAll(!!data.checked)
                                    }
                                    label={t("excelExportPage.selectAll")}
                                />
                            </div>

                            {presets.map((preset) => {
                                const complete = isPresetComplete(preset);
                                return (
                                    <div
                                        key={preset.id}
                                        className={styles.row}
                                    >
                                        <Checkbox
                                            checked={selectedIds.has(preset.id)}
                                            disabled={!complete}
                                            onChange={(_, data) =>
                                                toggleOne(
                                                    preset.id,
                                                    !!data.checked
                                                )
                                            }
                                        />
                                        <div className={styles.rowMain}>
                                            <Text weight="semibold">
                                                {preset.name}
                                                {!complete && (
                                                    <>
                                                        {" "}
                                                        <Badge
                                                            appearance="tint"
                                                            color="warning"
                                                            size="small"
                                                        >
                                                            !
                                                        </Badge>
                                                    </>
                                                )}
                                            </Text>
                                            <span className={styles.rowSummary}>
                                                {complete
                                                    ? `${preset.project} · ${scopeLeaf(
                                                          preset.areaPath
                                                      )} · ${scopeLeaf(
                                                          preset.sprint
                                                      )} · ${t(
                                                          "excelExportPage.planSummary",
                                                          {
                                                              count: preset
                                                                  .planIds
                                                                  .length,
                                                          }
                                                      )}`
                                                    : t(
                                                          "excelExportPage.incompletePreset"
                                                      )}
                                            </span>
                                        </div>
                                        <div className={styles.rowActions}>
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<EditRegular />}
                                                aria-label={t(
                                                    "excelExportPage.editPreset"
                                                )}
                                                onClick={() => {
                                                    setEditing(preset);
                                                    setEditorOpen(true);
                                                }}
                                            />
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<DeleteRegular />}
                                                aria-label={t(
                                                    "excelExportPage.deletePreset"
                                                )}
                                                onClick={() =>
                                                    setToDelete(preset)
                                                }
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                        </>
                    )}
                </aside>
            </div>

            {editorOpen && (
                <PresetEditorDialog
                    key={editing?.id ?? "new"}
                    preset={editing}
                    defaultProject={scope.project}
                    onSave={handleSave}
                    onClose={() => {
                        setEditorOpen(false);
                        setEditing(undefined);
                    }}
                />
            )}

            <Dialog
                open={!!toDelete}
                onOpenChange={(_, data) => !data.open && setToDelete(undefined)}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t("excelExportPage.deleteConfirmTitle")}
                        </DialogTitle>
                        <DialogContent>
                            {t("excelExportPage.deleteConfirmBody", {
                                name: toDelete?.name ?? "",
                            })}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() => setToDelete(undefined)}
                            >
                                {t("excelExportPage.cancel")}
                            </Button>
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    if (toDelete) {
                                        deletePreset(toDelete.id);
                                        setSelectedIds((prev) => {
                                            const next = new Set(prev);
                                            next.delete(toDelete.id);
                                            return next;
                                        });
                                    }
                                    setToDelete(undefined);
                                }}
                            >
                                {t("excelExportPage.delete")}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </PageLayout>
    );
}
