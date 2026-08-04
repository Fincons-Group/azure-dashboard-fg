import { cloneElement, type ReactElement } from "react";
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { FolderRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: tokens.spacingVerticalS,
        padding: tokens.spacingVerticalXXL,
        color: tokens.colorNeutralForeground3,
    },
    icon: {
        fontSize: "32px",
    },
});

export function EmptyState({
    message,
    icon,
}: {
    message: string;
    icon?: ReactElement<{
        className?: string;
        "aria-hidden"?: boolean | "true" | "false";
    }>;
}) {
    const styles = useStyles();

    const renderedIcon = icon
        ? cloneElement(icon, {
              className: mergeClasses(styles.icon, icon.props.className),
              "aria-hidden": true,
          })
        : <FolderRegular className={styles.icon} aria-hidden="true" />;

    return (
        <div className={styles.container}>
            {renderedIcon}
            <Text>{message}</Text>
        </div>
    );
}
