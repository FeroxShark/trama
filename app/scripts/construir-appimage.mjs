import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(aqui);
const builderBin = path.join(repo, "windows", "node_modules", ".bin", "electron-builder");

const env = {
  ...process.env,
  TRAMA_GH_OWNER: process.env.TRAMA_GH_OWNER || "trama",
  TRAMA_GH_REPO: process.env.TRAMA_GH_REPO || "trama",
};

const args = ["--config", "electron-builder.yml", "--linux", "AppImage", "--x64", "--publish", "never", ...process.argv.slice(2)];

const bin = existsSync(builderBin) ? builderBin : "electron-builder";
console.log("construyendo AppImage con " + bin + "...");
execFileSync(bin, args, { cwd: aqui, env, stdio: "inherit" });
