const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const fs = require("fs");
(async () => {
  const cfg = JSON.parse(fs.readFileSync("/etc/openshield/agent.json"));
  const a = await p.agent.findFirst({ select: { id: true, name: true, secretEnc: true } });
  console.log("Agent:", a.id, a.name);
  console.log("Config secret:", cfg.secret_token);
  console.log("DB secretEnc:", a.secretEnc);
  // Try decrypt
  const { decrypt } = require("./src/lib/security/crypto.ts");
  try {
    const decrypted = decrypt(a.secretEnc);
    console.log("Decrypted:", decrypted);
    console.log("Match?", decrypted === cfg.secret_token);
  } catch (e) {
    console.log("Decrypt error:", e.message);
  }
  await p.$disconnect();
})();
