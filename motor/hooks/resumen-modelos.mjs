#!/usr/bin/env node
// resumen-modelos.mjs — hook SessionStart del LÍDER: deja en su contexto el resumen de modelos de `reparto --resumen` (id para `-m`,
// inteligencia por effort, costo, gratis/pago, cupo libre y para qué sirve cada uno), para que sepa qué hay; el modelo y el effort de
// cada worker los elige `reparto` (el líder delega con --tipo y sin -m, salvo con motivo). Port a Node (sin bash, jq ni `timeout`; anda
// igual en Windows) de `resumen-modelos.sh`. Se registra sólo en `SessionStart` de `startup` y `compact` (al retomar o limpiar no hace
// falta repetirlo: el `source` del evento lo dice y acá también se mira); a mitad de sesión el líder lo vuelve a pedir con `reparto --resumen`.
// Sólo en la sesión del home (el líder): un worker (PA_WORKER) o una sesión dentro de un proyecto no lo ven.
// Nunca falla ni demora el arranque (8 s de tope): cualquier error termina en silencio con código 0.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const win = process.platform === "win32";
const AQUI = path.dirname(fileURLToPath(import.meta.url));

const real = (p) => {
  try {
    const r = realpathSync(p);
    return win ? r.toLowerCase() : r;
  } catch {
    return null;
  }
};

/** El ejecutable de `reparto`: en Windows, `bin\reparto.cmd` de la instalación (`<raíz>\app\hooks` -> `<raíz>\bin`) o el del PATH; si no, el del PATH. */
export function buscarReparto(e = env, plat = process.platform, aqui = AQUI) {
  const exts = plat === "win32" ? ["", ...(e.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  const candidatos = plat === "win32" ? [path.win32.join(aqui, "..", "..", "bin", "reparto.cmd")] : [];
  const sep = plat === "win32" ? ";" : ":";
  for (const d of (e.PATH || e.Path || "").split(sep).filter(Boolean)) for (const x of exts) candidatos.push(path.join(d, `reparto${x}`));
  return (
    candidatos.find((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    }) ?? null
  );
}

function leerStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  if (env.PA_WORKER) return;
  let d = {};
  try {
    const j = JSON.parse(leerStdin());
    if (j && typeof j === "object" && !Array.isArray(j)) d = j;
  } catch {}
  // Sólo en un arranque o tras compactar (con el matcher del settings ya no llega otro, pero un settings viejo sin matcher sí).
  if (typeof d.source === "string" && d.source !== "startup" && d.source !== "compact") return;
  const cwd = typeof d.cwd === "string" && d.cwd ? d.cwd : process.cwd();
  const casa = win ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir();
  const a = real(cwd);
  if (a === null || a !== real(casa)) return;
  const reparto = buscarReparto();
  if (!reparto) return;
  // Un .cmd/.bat no se lanza directo (Node lo rechaza sin shell): va por el shell de la plataforma, con la ruta entre comillas.
  const r = /\.(cmd|bat)$/i.test(reparto)
    ? spawnSync(`"${reparto}" --resumen`, { shell: true, encoding: "utf8", timeout: 8000, windowsHide: true })
    : spawnSync(reparto, ["--resumen"], { encoding: "utf8", timeout: 8000, windowsHide: true });
  if (r.error || r.status !== 0) return;
  const salida = (r.stdout ?? "").replace(/\s+$/, "");
  if (salida) process.stdout.write(`${salida}\n`);
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch {
    /* nunca falla */
  }
  process.exitCode = 0;
}
