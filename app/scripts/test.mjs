// Corre `node --test` sobre tests/*.test.ts sin depender del shell (cmd.exe no expande globs
// ni entiende comillas simples). Pasa por el entorno y los argumentos extra tal cual.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(raiz, "tests");
const archivos = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join("tests", f));

const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (k.startsWith("PA_") || k === "TRAMA_LOCAL") delete env[k];
}
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...archivos], {
  cwd: raiz,
  stdio: "inherit",
  env,
});
if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
process.exit(r.status ?? (r.signal ? 1 : 0));
