import {
    Button,
    Dropdown,
    Option,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ChevronLeftRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
    root: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
        marginTop: tokens.spacingVerticalS,
    },
    pageSize: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        marginLeft: tokens.spacingHorizontalM,
    },
    pageSizeDropdown: {
        minWidth: "72px",
    },
});

export function Pagination({
    page,
    pageCount,
    onPageChange,
    pageSize,
    pageSizeOptions,
    onPageSizeChange,
}: {
    page: number;
    pageCount: number;
    onPageChange: (page: number) => void;
    pageSize?: number;
    pageSizeOptions?: number[];
    onPageSizeChange?: (pageSize: number) => void;
}) {
    const styles = useStyles();
    const { t } = useTranslation();

    const showPageSizeSelector =
        pageSize != null && pageSizeOptions != null && onPageSizeChange != null;

    if (pageCount <= 1 && !showPageSizeSelector) {
        return null;
    }

    return (
        <div className={styles.root}>
            <Button
                icon={<ChevronLeftRegular />}
                appearance="subtle"
                size="small"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                aria-label={t("pagination.previous")}
            />
            <Text size={200}>
                {t("pagination.pageOf", { page, pageCount })}
            </Text>
            <Button
                icon={<ChevronRightRegular />}
                appearance="subtle"
                size="small"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
                aria-label={t("pagination.next")}
            />
            {showPageSizeSelector && (
                <div className={styles.pageSize}>
                    <Text size={200}>{t("pagination.itemsPerPage")}</Text>
                    <Dropdown
                        className={styles.pageSizeDropdown}
                        size="small"
                        value={String(pageSize)}
                        selectedOptions={[String(pageSize)]}
                        onOptionSelect={(_, data) => {
                            if (data.optionValue) {
                                onPageSizeChange(Number(data.optionValue));
                            }
                        }}
                        aria-label={t("pagination.itemsPerPage")}
                    >
                        {pageSizeOptions.map((size) => (
                            <Option key={size} value={String(size)}>
                                {String(size)}
                            </Option>
                        ))}
                    </Dropdown>
                </div>
            )}
        </div>
    );
}
