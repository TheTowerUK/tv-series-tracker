import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testsRoot = join(repositoryRoot, "tests");

async function discover(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discover(path));
    else if (/\.test\.(?:js|mjs)$/.test(entry.name)) files.push(relative(repositoryRoot, path));
  }
  return files.sort();
}

const testFiles = await discover(testsRoot);
if (!testFiles.length) throw new Error("No Node test files were discovered");

const child = spawn(process.execPath, ["--test", ...testFiles], {
  cwd: repositoryRoot,
  stdio: "inherit"
});

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
