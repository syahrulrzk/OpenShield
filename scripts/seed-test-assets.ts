import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const USER_ID = "cmqk5p7v50000j6fdvcuyg3zq";
const TAG = `envlog-${Date.now()}`;

async function main() {
  const prod = await p.asset.create({
    data: {
      userId: USER_ID,
      category: "SSH",
      environment: "PROD",
      hostname: `${TAG}-prod-bastion.test.local`,
      status: "ONLINE",
    },
  });
  const stg = await p.asset.create({
    data: {
      userId: USER_ID,
      category: "SSH",
      environment: "STAGING",
      hostname: `${TAG}-stg-app-01.test.local`,
      status: "ONLINE",
    },
  });
  const dr = await p.asset.create({
    data: {
      userId: USER_ID,
      category: "DATABASE",
      environment: "UAT",
      dbType: "POSTGRES",
      hostname: `${TAG}-dr-db-pg.test.local`,
      dbHost: "127.0.0.1",
      dbPort: 5432,
      dbName: "app",
      dbUser: "app",
      status: "ONLINE",
    },
  });
  console.log("Created:");
  console.log("  PROD  SSH      ", prod.id, prod.hostname);
  console.log("  STG   SSH      ", stg.id, stg.hostname);
  console.log("  DR    DATABASE ", dr.id, dr.hostname);
  console.log("\nBATCH_ID=" + TAG);
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
