import { MessageBar, MessageBarBody, MessageBarTitle, Button } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";

export function ErrorState({
    message,
    onRetry,
}: {
    message: string;
    onRetry: () => void;
}) {
    const { t } = useTranslation();

    return (
        <MessageBar intent="error">
            <MessageBarBody>
                <MessageBarTitle>{t("errorState.title")}</MessageBarTitle>
                {message}
            </MessageBarBody>
            <Button appearance="secondary" onClick={onRetry}>
                {t("errorState.retry")}
            </Button>
        </MessageBar>
    );
}
