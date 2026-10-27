// Corre `node --test` sobre tests/*.test.js listando los archivos (Node 22 no acepta un
// directorio como argumento y cmd.exe no expande globs).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archivos = readdirSync(path.join(raiz, "tests"))
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join("tests", f));

const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...archivos], {
  cwd: raiz,
  stdio: "inherit",
  env: process.env,
});
if (r.error) {
  console.error(r.error.message);
  process.exit(1);
}
process.exit(r.status ?? (r.signal ? 1 : 0));
