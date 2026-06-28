
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const events = await prisma.tEventLogSyslog.findMany({ take: 20, select: { eventType: true } });
    const eventTypes = [...new Set(events.map(e => e.eventType))];
    console.log("Event types in DB:", eventTypes);
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
