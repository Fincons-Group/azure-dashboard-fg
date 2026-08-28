import { useState } from "react";
import {
    Button,
    Field,
    Input,
    Text,
    Title2,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { AzdoConnection } from "../azdoConnection";

const useStyles = makeStyles({
    wrapper: {
        maxWidth: "420px",
        margin: "80px auto",
        padding: tokens.spacingHorizontalL,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalL,
        textAlign: "center",
    },
    fields: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalM,
        textAlign: "left",
    },
});

export function PatSetup({
    onSave,
}: {
    onSave: (connection: AzdoConnection) => void;
}) {
    const styles = useStyles();
    const { t } = useTranslation();
    const [pat, setPat] = useState("");
    const [org, setOrg] = useState("");

    const canSave = pat.trim().length > 0 && org.trim().length > 0;

    return (
        <div className={styles.wrapper}>
            <Title2 as="h2">{t("patSetup.title")}</Title2>
            <Text block>{t("patSetup.description")}</Text>
            <div className={styles.fields}>
                <Field label={t("patSetup.orgLabel")}>
                    <Input
                        placeholder={t("patSetup.orgPlaceholder")}
                        value={org}
                        onChange={(_, data) => setOrg(data.value)}
                    />
                </Field>
                <Field label={t("patSetup.patLabel")}>
                    <Input
                        type="password"
                        autoComplete="off"
                        placeholder={t("patSetup.patPlaceholder")}
                        value={pat}
                        onChange={(_, data) => setPat(data.value)}
                    />
                </Field>
            </div>
            <Text size={200}>{t("patSetup.sharedMachineWarning")}</Text>
            <Button
                appearance="primary"
                disabled={!canSave}
                onClick={() =>
                    onSave({
                        org: org.trim(),
                        pat: pat.trim(),
                    })
                }
            >
                {t("patSetup.connect")}
            </Button>
        </div>
    );
}
