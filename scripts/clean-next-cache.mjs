import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const packagePath = resolve(projectRoot, "package.json");
if (!existsSync(packagePath)) throw new Error("Run this command from the EstimatorAI project root");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
if (packageJson.name !== "bidpilot") throw new Error("Refusing to clean an unexpected project");
const targets = [resolve(projectRoot, ".next-dev"), resolve(projectRoot, ".next-clean")];
for (const target of targets) {
  if (!target.startsWith(`${projectRoot}\\`) && !target.startsWith(`${projectRoot}/`)) throw new Error("Cache target resolved outside the project");
  rmSync(target, { recursive: true, force: true });
  console.log(`Cleared ${target}`);
}
