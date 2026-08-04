import {
    AccordionItem,
    AccordionHeader,
    AccordionPanel,
    Text,
    Badge,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { ErrorSummary } from "../types";

const useStyles = makeStyles({
    header: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
    },
    signature: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    panel: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    sample: {
        whiteSpace: "pre-wrap",
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
    },
    testCaseList: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
    },
});

export function ErrorGroupItem({ error }: { error: ErrorSummary }) {
    const styles = useStyles();
    const { t } = useTranslation();

    return (
        <AccordionItem value={error.signature}>
            <AccordionHeader>
                <div className={styles.header}>
                    <Badge appearance="filled" color="danger">
                        {error.count}
                    </Badge>
                    <Text className={styles.signature} weight="semibold">
                        {error.signature}
                    </Text>
                </div>
            </AccordionHeader>

            <AccordionPanel className={styles.panel}>
                <Text className={styles.sample}>{error.sampleMessage}</Text>

                <Text weight="semibold">
                    {t("commonErrorsPage.table.affectedTestCases", {
                        count: error.affectedTestCases.length,
                    })}
                </Text>

                <div className={styles.testCaseList}>
                    {error.affectedTestCases.map((tc) => (
                        <Text key={tc.id}>
                            #{tc.id} — {tc.title}
                        </Text>
                    ))}
                </div>
            </AccordionPanel>
        </AccordionItem>
    );
}
