
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const agents = await prisma.agent.findMany({
    orderBy: [{ status: "asc" }, { lastHeartbeat: "desc" }],
  });
  
  console.log("=== AGENTS ===");
  agents.forEach(a => {
    const lastHb = a.lastHeartbeat ? `${a.lastHeartbeat.toLocaleString("id-ID")} (${Math.floor((Date.now() - a.lastHeartbeat.getTime()) / 1000)}s ago)` : "NEVER";
    console.log(`
  Name: ${a.name} (${a.displayId})
  Status DB: ${a.status}
  Last Heartbeat: ${lastHb}
  Last Error: ${a.lastError || "NONE"}
  Agent ID: ${a.id}`);
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
