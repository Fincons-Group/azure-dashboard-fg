#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openModule from "open";
import sirv from "sirv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const open = openModule.default ?? openModule;

const PORT = Number(process.env.PORT || 4173);
const DIST_DIR = path.join(__dirname, "..", "dist");

process.env.PROXY_PORT ??= "4174";
process.env.CORS_ORIGIN ??= `http://localhost:${PORT}`;

const serve = sirv(DIST_DIR, { single: true });

http.createServer((req, res) => {
    serve(req, res);
}).listen(PORT, "127.0.0.1", () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\nAzure Dashboard running at ${url}\n`);
    void open(url);
});

await import("../server/proxy.js");
