import { acquireMailToken } from "../mailGraphAuth";

// Shared by both the env-driven defaults below and the report card's
// editable To/Cc inputs (SprintDefectReportTab) - one comma-splitting
// implementation for every "list of email addresses" field in the app.
export function parseAddressList(raw: unknown): string[] {
    return String(raw ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean);
}

// Defaults only - the report card's To/Cc fields are pre-filled from these
// but remain user-editable per send, see SprintDefectReportTab.
export const DEFAULT_REPORT_RECIPIENTS: string[] = parseAddressList(
    import.meta.env.VITE_SEND_MAIL_TO
);
export const DEFAULT_REPORT_CC: string[] = parseAddressList(
    import.meta.env.VITE_SEND_MAIL_CC
);

function toRecipientList(addresses: string[]) {
    return addresses.map((address) => ({ emailAddress: { address } }));
}

// Sends the sprint report card via Microsoft Graph, using the signed-in
// user's own mailbox (delegated Mail.Send - see mailAuthConfig.ts). Replaces
// the old backend /api/email-report path for this button, which relied on
// SMTP that's blocked outbound on this network.
export async function sendGraphMailReport({
    subject,
    bodyHtml,
    to,
    cc,
    fromDisplayName,
}: {
    subject: string;
    bodyHtml: string;
    to: string[];
    cc?: string[];
    // Overrides only the display name shown to recipients, not the actual
    // sending address (still the signed-in mailbox) - Graph may ignore this
    // for delegated /me/sendMail depending on tenant anti-spoofing policy.
    fromDisplayName?: string;
}): Promise<void> {
    if (to.length === 0) {
        throw new Error("At least one recipient is required.");
    }

    const loginResponse = await acquireMailToken();

    const message: Record<string, unknown> = {
        subject,
        body: { contentType: "HTML", content: bodyHtml },
        toRecipients: toRecipientList(to),
    };

    if (cc && cc.length > 0) {
        message.ccRecipients = toRecipientList(cc);
    }

    if (fromDisplayName) {
        const address =
            loginResponse.account?.username ?? loginResponse.account?.name;

        if (address) {
            message.from = {
                emailAddress: { name: fromDisplayName, address },
            };
        }
    }

    const response = await fetch(
        "https://graph.microsoft.com/v1.0/me/sendMail",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${loginResponse.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ message }),
        }
    );

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body}`);
    }
}
