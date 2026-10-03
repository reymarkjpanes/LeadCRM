import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stamp = Date.now();
const port = 55439;
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/leadcrm_workflow_test_${stamp}?connection_limit=1&statement_cache_size=0`,
  DIRECT_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/leadcrm_workflow_test_${stamp}`,
  JWT_SECRET: "isolated-task-acceptance-secret-never-production",
};
function run(script, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      windowsHide: true,
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`Test process exited ${code}`)),
    );
  });
}
const db = await PGlite.create();
const server = new PGLiteSocketServer({
  db,
  host: "127.0.0.1",
  port,
  maxConnections: 10,
});
try {
  const sql = await run(
    path.join(root, "../node_modules/prisma/build/index.js"),
    [
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    true,
  );
  await db.exec(sql);
  await server.start();
  console.log(
    "Task acceptance uses a disposable in-memory PostgreSQL database; no configured database is touched.",
  );
  await run(path.join(root, "../node_modules/vitest/vitest.mjs"), [
    "run",
    ...(process.argv.length > 2 ? process.argv.slice(2) : [
      "src/modules/operations/tasks/__tests__/tasks.integration.test.ts",
      "src/modules/automation/workflows/__tests__/workflow.integration.test.ts",
    ]),
    "--maxWorkers=1",
    "--pool=threads",
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server.stop();
  await db.close();
}
