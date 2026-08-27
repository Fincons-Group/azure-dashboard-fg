process.env.PORT ??= process.env.PROXY_PORT ?? "4174";
process.env.CORS_ORIGIN ??= "http://localhost:4173";

await import("./server.js");
