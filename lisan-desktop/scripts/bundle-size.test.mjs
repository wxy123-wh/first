import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distAssetsDir = path.resolve(__dirname, "..", "dist", "assets");
const chunkSizeLimitBytes = 500_000;

test("no production JS chunk exceeds Vite warning threshold", async () => {
  const files = await readdir(distAssetsDir);
  const jsFiles = files.filter((file) => file.endsWith(".js"));

  assert.ok(
    jsFiles.length > 0,
    `No JavaScript assets found in ${distAssetsDir}. Run npm run build first.`,
  );

  const chunks = await Promise.all(
    jsFiles.map(async (name) => ({
      name,
      size: (await stat(path.join(distAssetsDir, name))).size,
    })),
  );

  const oversizedChunks = chunks.filter((chunk) => chunk.size > chunkSizeLimitBytes);
  const details = oversizedChunks
    .map((chunk) => `- ${chunk.name}: ${chunk.size} bytes`)
    .join("\n");

  assert.equal(
    oversizedChunks.length,
    0,
    `Chunks over ${chunkSizeLimitBytes} bytes:\n${details}`,
  );
});
