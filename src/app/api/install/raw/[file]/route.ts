/**
 * /api/install/raw/[file]
 *
 * Serves raw agent source files (agent.sh, agent.py) for the quick installer.
 * No auth required — these are public read-only static agent binaries.
 * The actual auth is the agent_id+token in the installer's URL.
 *
 * Files are served from /app/agents/<type>/ inside the container.
 */

import { stat } from "node:fs/promises";
import path from "node:path";

const VALID_FILES = {
  "agent.sh": { dir: "bash", contentType: "text/x-shellscript; charset=utf-8" },
  "agent.py": { dir: "python", contentType: "text/x-python; charset=utf-8" },
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const meta = VALID_FILES[file as keyof typeof VALID_FILES];
  if (!meta) {
    return Response.json(
      { error: `Invalid file. Expected: ${Object.keys(VALID_FILES).join(", ")}` },
      { status: 400 },
    );
  }

  const filePath = path.join("/app/agents", meta.dir, file);
  try {
    await stat(filePath);
  } catch {
    return Response.json({ error: "Agent source not found on server" }, { status: 404 });
  }

  // Stream the file (small — read into memory is fine)
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath, "utf-8");

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": meta.contentType,
      "Content-Disposition": `inline; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
