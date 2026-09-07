import { useEffect, useRef, useState } from "react";
import { Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import {
    LocaleType,
    Univer,
    mergeLocales,
    type IWorkbookData,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
// Facade side-effect imports: each one calls FUniver.extend(...) to add its
// API surface (createWorkbook comes from @univerjs/sheets/facade).
import "@univerjs/engine-formula/facade";
import "@univerjs/ui/facade";
import "@univerjs/docs-ui/facade";
import "@univerjs/sheets/facade";
import "@univerjs/sheets-ui/facade";
import "@univerjs/sheets-formula/facade";
import "@univerjs/sheets-numfmt/facade";
import "@univerjs/sheets-filter/facade";
import "@univerjs/sheets-sort/facade";
import { defaultTheme } from "@univerjs/themes";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverUIPlugin } from "@univerjs/ui";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsUIPlugin } from "@univerjs/sheets-ui";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsFormulaUIPlugin } from "@univerjs/sheets-formula-ui";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverSheetsNumfmtUIPlugin } from "@univerjs/sheets-numfmt-ui";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsFilterUIPlugin } from "@univerjs/sheets-filter-ui";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsSortUIPlugin } from "@univerjs/sheets-sort-ui";

import DesignEnUS from "@univerjs/design/locale/en-US";
import UIEnUS from "@univerjs/ui/locale/en-US";
import DocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import SheetsUIEnUS from "@univerjs/sheets-ui/locale/en-US";
import SheetsFormulaUIEnUS from "@univerjs/sheets-formula-ui/locale/en-US";
import SheetsNumfmtUIEnUS from "@univerjs/sheets-numfmt-ui/locale/en-US";
import SheetsFilterUIEnUS from "@univerjs/sheets-filter-ui/locale/en-US";
import SheetsSortUIEnUS from "@univerjs/sheets-sort-ui/locale/en-US";

import "@univerjs/design/lib/index.css";
import "@univerjs/ui/lib/index.css";
import "@univerjs/docs-ui/lib/index.css";
import "@univerjs/sheets-ui/lib/index.css";
import "@univerjs/sheets-formula-ui/lib/index.css";
import "@univerjs/sheets-numfmt-ui/lib/index.css";
import "@univerjs/sheets-filter-ui/lib/index.css";
import "@univerjs/sheets-sort-ui/lib/index.css";

import { useThemeMode } from "../hooks/useThemeMode";

const useStyles = makeStyles({
    root: {
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "320px",
        overflow: "hidden",
    },
    host: {
        width: "100%",
        height: "100%",
    },
    overlay: {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tokens.colorNeutralBackgroundAlpha,
        zIndex: 5,
    },
    placeholder: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        color: tokens.colorNeutralForeground3,
    },
});

function bootUniver(
    container: HTMLElement,
    data: Partial<IWorkbookData>,
    darkMode: boolean
): Univer {
    const univer = new Univer({
        theme: defaultTheme,
        darkMode,
        locale: LocaleType.EN_US,
        locales: {
            [LocaleType.EN_US]: mergeLocales(
                DesignEnUS,
                UIEnUS,
                DocsUIEnUS,
                SheetsEnUS,
                SheetsUIEnUS,
                SheetsFormulaUIEnUS,
                SheetsNumfmtUIEnUS,
                SheetsFilterUIEnUS,
                SheetsSortUIEnUS
            ),
        },
    });

    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, {
        container,
        header: true,
        toolbar: true,
        footer: true,
    });
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverDocsUIPlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsUIPlugin, {
        // The report has string cells that hold numeric-looking text (IDs,
        // "Ambito" tags, ...). Univer's "force string" alert popup nags about
        // those and, in 0.25.1, its title key ("sheets-ui.info.error") is even
        // untranslated - just turn it off for this read-mostly view.
        disableForceStringAlert: true,
        disableForceStringMark: true,
    });
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.registerPlugin(UniverSheetsFormulaUIPlugin);
    univer.registerPlugin(UniverSheetsNumfmtPlugin);
    univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
    univer.registerPlugin(UniverSheetsFilterPlugin);
    univer.registerPlugin(UniverSheetsFilterUIPlugin);
    univer.registerPlugin(UniverSheetsSortPlugin);
    univer.registerPlugin(UniverSheetsSortUIPlugin);

    const api = FUniver.newAPI(univer);
    api.createWorkbook(data);

    return univer;
}

export default function UniverSheet({
    data,
    loading = false,
}: {
    data: Partial<IWorkbookData> | null;
    loading?: boolean;
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const { mode } = useThemeMode();
    const hostRef = useRef<HTMLDivElement>(null);
    const [mountError, setMountError] = useState<string | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !data) {
            return;
        }

        // Each instance gets its own child element, so deferring the old
        // instance's disposal never touches the new instance's DOM.
        const mountEl = document.createElement("div");
        mountEl.style.width = "100%";
        mountEl.style.height = "100%";
        host.appendChild(mountEl);

        let instance: Univer | null = null;
        let failure: string | null = null;
        try {
            instance = bootUniver(mountEl, data, mode === "dark");
        } catch (error) {
            console.error("Univer failed to mount", error);
            failure = error instanceof Error ? error.message : String(error);
        }
        // Synchronising React with the imperative Univer mount result.
        setMountError(failure);

        return () => {
            const disposed = instance;
            instance = null;
            // Deferred: univer.dispose() unmounts Univer's own React root, and
            // doing that synchronously inside this cleanup races React 19's
            // current render pass.
            setTimeout(() => {
                try {
                    disposed?.dispose();
                } catch (error) {
                    console.error("Univer failed to dispose", error);
                }
                mountEl.remove();
            }, 0);
        };
    }, [data, mode]);

    if (!data) {
        return (
            <div className={styles.root}>
                <div className={styles.placeholder}>
                    {t("excelExportPage.sheetPlaceholder")}
                </div>
            </div>
        );
    }

    return (
        <div className={styles.root}>
            <div ref={hostRef} className={styles.host} />
            {mountError && (
                <div className={styles.overlay}>
                    <div className={styles.placeholder}>
                        {t("excelExportPage.sheetError", { message: mountError })}
                    </div>
                </div>
            )}
            {loading && !mountError && (
                <div className={styles.overlay}>
                    <Spinner label={t("excelExportPage.preparing")} />
                </div>
            )}
        </div>
    );
}
