import { execSync } from "node:child_process";

if (process.platform === "win32") {
    // Match only actual vite invocations (the vite.js entry script, or a cmd.exe
    // shim running "vite" as its command) and any node/cmd process anywhere in
    // the src/server.ts execution chain - the cross-env wrapper, the tsx watch
    // supervisor, and the actual tsx-loaded process all mention "server.ts" in
    // their command line. Killing only the innermost process isn't enough: tsx
    // watch's supervisor respawns it, so the whole chain needs to go. A plain
    // substring match on "vite" also catches unrelated shells whose command
    // line happens to mention vite, e.g. the very "npm run kill:dev" invocation
    // that runs this script.
    const command =
        "Get-CimInstance Win32_Process | " +
        "Where-Object { " +
        "$_.Name -in @('node.exe', 'cmd.exe') -and (" +
        "($_.CommandLine -match '[\\\\/]vite[\\\\/]bin[\\\\/]vite\\.js') -or " +
        "($_.CommandLine -match '/c\\s+vite(\\s|$)') -or " +
        "($_.CommandLine -match 'server\\.ts')" +
        ") } | " +
        "ForEach-Object { " +
        "Write-Output \"Killing PID $($_.ProcessId): $($_.CommandLine)\"; " +
        "Stop-Process -Id $_.ProcessId -Force " +
        "}";

    execSync(`powershell -NoProfile -Command "${command}"`, {
        stdio: "inherit",
    });
} else {
    try {
        execSync("pkill -f 'vite/bin/vite.js'", { stdio: "inherit" });
    } catch (error) {
        if (error.status !== 1) {
            throw error;
        }
    }
    try {
        execSync("pkill -f 'server\\.ts'", { stdio: "inherit" });
    } catch (error) {
        if (error.status !== 1) {
            throw error;
        }
    }
}
