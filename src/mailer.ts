import nodemailer from "nodemailer";
import axios from "axios";
import { ConfidentialClientApplication } from "@azure/msal-node";
import "dotenv/config";

// Office 365 tenants increasingly block SMTP entirely (basic auth: 535
// 5.7.139 via Conditional Access; OAuth2 SMTP.SendAsApp: often refused by
// governance since Microsoft is deprecating SMTP AUTH org-wide). Microsoft
// Graph's sendMail is a plain HTTPS call, not a "legacy protocol", so it
// sidesteps both. When these three are set, mail is sent via Graph using an
// Entra ID app registration (client credentials flow, Mail.Send application
// permission). Falls back to SMTP basic auth when they're absent, so
// local/Mailtrap setups using SMTP_USER/SMTP_PASS keep working unchanged.
const graphTenantId = process.env.MAIL_OAUTH_TENANT_ID;
const graphClientId = process.env.MAIL_OAUTH_CLIENT_ID;
const graphClientSecret = process.env.MAIL_OAUTH_CLIENT_SECRET;
const useGraph = Boolean(graphTenantId && graphClientId && graphClientSecret);

const msalClient = useGraph
    ? new ConfidentialClientApplication({
        auth: {
            authority: `https://login.microsoftonline.com/${graphTenantId}`,
            clientId: graphClientId!,
            clientSecret: graphClientSecret!,
        },
    })
    : null;

async function getGraphAccessToken(): Promise<string> {
    const result = await msalClient!.acquireTokenByClientCredential({
        scopes: ["https://graph.microsoft.com/.default"],
    });

    if (!result?.accessToken) {
        throw new Error("Failed to acquire a Microsoft Graph access token.");
    }

    return result.accessToken;
}

let cachedTransporter: nodemailer.Transporter | null = null;

function getSmtpTransporter(): nodemailer.Transporter {
    if (!cachedTransporter) {
        cachedTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            requireTLS: true,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    return cachedTransporter;
}

async function sendViaGraph({
    fromAddress,
    fromDisplayName,
    to,
    subject,
    bodyHtml,
    pdfBase64,
    filename,
}: {
    fromAddress: string;
    fromDisplayName: string;
    to: string[];
    subject: string;
    bodyHtml: string;
    pdfBase64?: string;
    filename?: string;
}): Promise<void> {
    const accessToken = await getGraphAccessToken();

    try {
        await axios.post(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromAddress)}/sendMail`,
            {
                message: {
                    subject,
                    body: { contentType: "HTML", content: bodyHtml },
                    from: { emailAddress: { address: fromAddress, name: fromDisplayName } },
                    toRecipients: to.map((address) => ({ emailAddress: { address } })),
                    attachments:
                        pdfBase64 && filename
                            ? [
                                {
                                    "@odata.type": "#microsoft.graph.fileAttachment",
                                    name: filename,
                                    contentType: "application/pdf",
                                    contentBytes: pdfBase64,
                                },
                            ]
                            : undefined,
                },
                saveToSentItems: false,
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error) {
        // Graph's actual error code/message (e.g. ErrorAccessDenied vs. an
        // application access policy block) is in the response body, which
        // axios's own error.message discards - surface it so the toast/log
        // shows the real reason instead of just "status code 403".
        if (axios.isAxiosError(error)) {
            const graphError = error.response?.data?.error;

            throw new Error(
                `Microsoft Graph sendMail failed (HTTP ${error.response?.status}): ${graphError?.code ?? "unknown error"} - ${graphError?.message ?? error.message}`
            );
        }

        throw error;
    }
}

export async function sendReportEmail({
    to,
    subject,
    bodyHtml,
    pdfBase64,
    filename,
    fromName,
}: {
    to: string[];
    subject: string;
    bodyHtml: string;
    pdfBase64?: string;
    filename?: string;
    fromName: string;
}): Promise<void> {
    const fromAddress = process.env.MAIL_FROM;

    if (!fromAddress) {
        throw new Error("MAIL_FROM is not set.");
    }

    // The sender identity (who this is from) is a fixed brand, separate from
    // fromName (what the report is about, e.g. "UAT Sprint 1 - Auto") - so
    // it's pinned via its own env var rather than reusing fromName, and
    // falls back to fromName only if that var isn't configured.
    const fromDisplayName = process.env.MAIL_FROM_NAME ?? fromName;

    if (useGraph) {
        await sendViaGraph({ fromAddress, fromDisplayName, to, subject, bodyHtml, pdfBase64, filename });
        return;
    }

    await getSmtpTransporter().sendMail({
        from: {
            name: fromDisplayName,
            address: fromAddress,
        },
        // Nodemailer accepts an array here, but joining into a single
        // comma-separated header is the form actually documented/guaranteed
        // to address every recipient - an array was silently only
        // delivering to the first address.
        to: to.join(", "),
        subject,
        html: bodyHtml,
        attachments:
            pdfBase64 && filename
                ? [
                    {
                        filename,
                        content: Buffer.from(pdfBase64, "base64"),
                        contentType: "application/pdf",
                    },
                ]
                : undefined,
    });
}
