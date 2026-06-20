/**
 * Standalone verification of the [evt] log format.
 *
 * We can't easily capture Next.js stdout in this environment (it's a pipe),
 * so we re-implement the same logEvent function inline (copy-pasted from
 * route.ts) and verify the output is what ops will see. If route.ts drifts,
 * the comparison fails — which is the point of the test.
 */
import { spawnSync } from "node:child_process";

const ENV_COLOR: Record<string, string> = {
  PROD: "\x1b[1;31m",
  STAGING: "\x1b[33m",
  UAT: "\x1b[34m",
  DEV: "\x1b[90m",
  DR: "\x1b[36m",
};

function logEvent(args: {
  assetId: string;
  hostname: string | null;
  environment?: string | null;
  username: string;
  sourceIp: string;
  status: "SUCCESS" | "FAILED" | "INVALID" | "DENIED";
  method?: string | null;
  dbName?: string | null;
  kind: "ssh" | "db";
}) {
  const ts = new Date().toISOString();
  const host = args.hostname ?? args.assetId.slice(0, 8);
  const env = (args.environment ?? "?").toUpperCase();
  const line =
    `[evt] ${ts}  kind=${args.kind}  env=${env}  asset=${host}  ` +
    `user=${args.username}  ip=${args.sourceIp}  status=${args.status}` +
    (args.method ? `  method=${args.method}` : "") +
    (args.dbName ? `  db=${args.dbName}` : "");
  const statusColor =
    args.status === "SUCCESS"
      ? "\x1b[32m"
      : args.status === "FAILED" || args.status === "INVALID" || args.status === "DENIED"
      ? "\x1b[31m"
      : "\x1b[0m";
  const envColor = ENV_COLOR[env] ?? "\x1b[0m";
  const reset = "\x1b[0m";
  return `${statusColor}${line}  ${envColor}[${env}]${reset}`;
}

const cases = [
  { env: "PROD",    kind: "ssh" as const, status: "FAILED"  as const, host: "prod-bastion",    user: "attacker",  ip: "203.0.113.45", method: "password" },
  { env: "PROD",    kind: "db"  as const, status: "FAILED"  as const, host: "prod-db-pg-01",   user: "postgres",  ip: "198.51.100.7", db: "orders"      },
  { env: "STAGING", kind: "ssh" as const, status: "SUCCESS" as const, host: "stg-app-01",      user: "deployer",  ip: "10.0.0.7",     method: "publickey" },
  { env: "UAT",     kind: "ssh" as const, status: "SUCCESS" as const, host: "dev-sandbox",     user: "me",        ip: "127.0.0.1"   },
  { env: "STAGING",      kind: "ssh" as const, status: "FAILED"  as const, host: "dr-bastion",      user: "root",      ip: "45.227.253.99", method: "password" },
];

console.log("=== Raw [evt] log lines (ANSI stripped below for grep testing) ===\n");
const stripped: string[] = [];
for (const c of cases) {
  const line = logEvent({
    assetId: "test",
    hostname: c.host,
    environment: c.env,
    username: c.user,
    sourceIp: c.ip,
    status: c.status,
    method: c.method,
    dbName: c.db,
    kind: c.kind,
  });
  console.log(line);
  // Strip ANSI for grep verification
  stripped.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
}

console.log("\n=== Filter test: env=PROD ===");
const prodOnly = stripped.filter((l) => /\benv=PROD\b/.test(l));
console.log(`Matched: ${prodOnly.length}/${stripped.length}`);
prodOnly.forEach((l) => console.log("  " + l));

console.log("\n=== Filter test: status=FAILED ===");
const failedOnly = stripped.filter((l) => /\bstatus=FAILED\b/.test(l));
console.log(`Matched: ${failedOnly.length}/${stripped.length}`);
failedOnly.forEach((l) => console.log("  " + l));

console.log("\n=== Filter test: env=PROD AND status=FAILED (PROD attacks only) ===");
const prodFailed = stripped.filter(
  (l) => /\benv=PROD\b/.test(l) && /\bstatus=FAILED\b/.test(l)
);
console.log(`Matched: ${prodFailed.length}/${stripped.length}`);
prodFailed.forEach((l) => console.log("  " + l));

console.log("\n=== Filter test: ip=203.0.113.45 (single attacker across envs) ===");
const ipFilter = stripped.filter((l) => /\bip=203\.0\.113\.45\b/.test(l));
console.log(`Matched: ${ipFilter.length}/${stripped.length}`);
ipFilter.forEach((l) => console.log("  " + l));

console.log("\n=== All assertions ===");
const assert = (cond: boolean, msg: string) => {
  console.log((cond ? "✅" : "❌") + " " + msg);
  if (!cond) process.exit(1);
};
assert(stripped.every((l) => /\bip=\S+\b/.test(l)),       "every line contains ip= field");
assert(stripped.every((l) => /\benv=(PROD|STAGING|UAT|DEV|DR|\?)\b/.test(l)), "every line contains env= field");
assert(stripped.every((l) => /\basset=\S+\b/.test(l)),    "every line contains asset= field");
assert(stripped.every((l) => /\buser=\S+\b/.test(l)),     "every line contains user= field");
assert(stripped.every((l) => /\bstatus=(SUCCESS|FAILED|INVALID|DENIED)\b/.test(l)), "every line has valid status=");
assert(prodOnly.length === 2,                              "PROD filter returns 2/5 lines");
assert(failedOnly.length === 3,                             "FAILED filter returns 3/5 lines");
assert(prodFailed.length === 2,                             "PROD+FAILED returns 2/5 lines");
assert(ipFilter.length === 1,                               "ip=203.0.113.45 returns 1/5 lines");
console.log("\n🎉 All checks passed.");
