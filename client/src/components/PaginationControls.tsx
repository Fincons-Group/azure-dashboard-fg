import { useTranslation } from "react-i18next";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ChevronLeftRegular, ChevronRightRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    row: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    },
    label: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    buttons: {
        display: "flex",
        gap: tokens.spacingHorizontalXS,
    },
});

export function PaginationControls({
    page,
    pageCount,
    total,
    pageSize,
    onPageChange,
}: {
    page: number;
    pageCount: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}) {
    const styles = useStyles();
    const { t } = useTranslation();

    if (pageCount <= 1) {
        return null;
    }

    const rangeStart = page * pageSize + 1;
    const rangeEnd = Math.min(total, (page + 1) * pageSize);

    return (
        <div className={styles.row}>
            <Text className={styles.label}>
                {t("pagination.range", { rangeStart, rangeEnd, total })}
            </Text>
            <div className={styles.buttons}>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<ChevronLeftRegular />}
                    disabled={page === 0}
                    onClick={() => onPageChange(page - 1)}
                    aria-label={t("pagination.previous")}
                />
                <Text className={styles.label}>
                    {t("pagination.pageOf", { page: page + 1, pageCount })}
                </Text>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<ChevronRightRegular />}
                    disabled={page >= pageCount - 1}
                    onClick={() => onPageChange(page + 1)}
                    aria-label={t("pagination.next")}
                />
            </div>
        </div>
    );
}
