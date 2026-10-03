import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be a whole number between 1 and 65535.");
  process.exit(1);
}
if (!existsSync(new URL("../.next/BUILD_ID", import.meta.url))) {
  console.error("Build FlowScope first with: npm run build");
  process.exit(1);
}

console.log(`\nFlowScope on this computer: http://localhost:${port}`);
const addresses = new Set();
for (const [name, entries] of Object.entries(networkInterfaces())) {
  if (/^(utun|tun|tap|docker|veth|lo)/i.test(name)) continue;
  for (const entry of entries || []) {
    if (entry.family === "IPv4" && !entry.internal) addresses.add(entry.address);
  }
}
for (const address of addresses) console.log(`Same-network viewing: http://${address}:${port}`);
console.log("Keep this window open. Other devices must be on the same trusted network.");
console.log("Shared HTTP viewing is for sample/CSV data. Connect a live feed on your own localhost or HTTPS.\n");

const child = spawn(process.execPath, [
  fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
  "start", "--hostname", "0.0.0.0", "--port", String(port),
], { cwd: root, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
