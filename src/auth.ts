import type { NextFunction, Request, Response } from "express";
import jwt, {
    type JwtHeader,
    type SigningKeyCallback,
    type VerifyErrors,
    type JwtPayload,
} from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const tenantId = process.env.ENTRA_TENANT_ID!;
const clientId = process.env.ENTRA_CLIENT_ID!;

const validAudiences: [string, string] = [clientId, `api://${clientId}`];
const validIssuers: [string, string] = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
];

const jwks = jwksClient({
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    cache: true,
    rateLimit: true,
});

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback) {
    jwks.getSigningKey(header.kid, (error, key) => {
        callback(error, key?.getPublicKey());
    });
}

function isPrivileged(email: string): boolean {
    const allowlist = (process.env.PRIVILEGED_ALLOWLIST ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    const domain = process.env.PRIVILEGED_DOMAIN?.toLowerCase();

    const normalizedEmail = email.toLowerCase();

    return (
        allowlist.includes(normalizedEmail) ||
        (!!domain && normalizedEmail.endsWith(`@${domain}`))
    );
}

export function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
) {
    if (process.env.SKIP_AUTH === "true") {
        next();
        return;
    }

    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ message: "Missing bearer token" });
        return;
    }

    const token = header.slice("Bearer ".length);

    jwt.verify(
        token,
        getSigningKey,
        {
            audience: validAudiences,
            issuer: validIssuers,
            algorithms: ["RS256"],
        },
        (error: VerifyErrors | null, decoded: JwtPayload | string | undefined) => {
            if (error || !decoded || typeof decoded === "string") {
                res.status(401).json({ message: "Invalid token" });
                return;
            }

            const email =
                (decoded.preferred_username as string | undefined) ??
                (decoded.upn as string | undefined) ??
                (decoded.email as string | undefined);

            if (!email || !isPrivileged(email)) {
                res.status(403).json({ message: "Not authorized" });
                return;
            }

            next();
        }
    );
}
