// Las guardias de git y cargo de los workers de codex y dsh/opencode, en Node puro (sin bash): la misma lógica que los scripts `git` y
// `cargo` de esta carpeta, que siguen siendo los de Linux (el `pa` de bash está congelado y los usa tal cual). En Windows los llaman
// git.cmd y cargo.cmd (`node git.mjs %*`). Cada guardia devuelve null (pasa al binario de verdad) o el texto de `BLOQUEADO: …`.
import { spawnSync } from "node:child_process";
import { realpathSync, statSync, accessSync, constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIN_A = "nada de 'git commit -a' en un worker: commitea todo lo modificado, incluido lo de otra sesión. git add <archivo> y commit sin -a.";
const SIN_STASH = "nada de 'git stash' en un worker: si te cortan a mitad, el trabajo sin commitear de otra sesión queda en el stash y desaparece del working tree. Trabajá encima de lo que haya y commiteá archivo por archivo.";
const SIN_ADD = "nada de 'git add -A/-u' ni 'git add .' en un worker: te llevás cambios de otra sesión. Agregá los archivos que tocaste, uno por uno.";

/** Opciones globales de git que llevan el valor en el argumento siguiente. */
const GLOBALES_CON_VALOR = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

/** El subcomando de git (el primer argumento que no es una opción global) y lo que le sigue. */
export function subcomandoGit(args) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (GLOBALES_CON_VALOR.has(a)) i += 2;
    else if (a.startsWith("-")) i += 1;
    else break;
  }
  return { sub: args[i] ?? "", resto: args.slice(i + 1) };
}

/** null si git puede correr, o el motivo del bloqueo. */
export function guardiaGit(args) {
  const { sub, resto } = subcomandoGit(args);
  if (sub === "stash") {
    return resto[0] === "list" || resto[0] === "show" ? null : SIN_STASH;
  }
  if (sub === "add") {
    for (const a of resto) {
      if (a === "--") continue;
      if (a === "." || a === "--all" || a === "--update" || /^-[^-]*[Au]/.test(a)) return SIN_ADD;
    }
    return null;
  }
  if (sub === "commit") {
    let salta = false;
    for (const a of resto) {
      if (salta) { salta = false; continue; }
      if (a === "--") break;
      if (["-m", "-F", "-C", "-c", "--author", "--date", "--fixup", "--squash", "-t", "--template"].includes(a)) salta = true;
      else if (a === "--all") return SIN_A;
      else if (a.startsWith("--")) continue;
      else if (a.startsWith("-")) {
        const antes = a.split(/[mFCct]/)[0]; // lo que queda antes de la primera letra que lleva valor
        if (antes.includes("a")) return SIN_A;
        if (/[mFCct]$/.test(a)) salta = true;
      }
    }
  }
  return null;
}

/** null si cargo puede correr, o el motivo del bloqueo. */
export function guardiaCargo(args) {
  let sub = "";
  let prev = "";
  for (const a of args) {
    if (a === "--") break;
    if (a === "--release" || a === "-r" || a === "--profile=release" || (prev === "--profile" && a === "release")) {
      return "build de release en un worker: pisa el target compartido. El build lo hace el jefe después de integrar. Probá con cargo test/check o build debug; si de verdad hace falta release, decilo en DECISION.";
    }
    if (!sub && !a.startsWith("-") && !a.startsWith("+")) sub = a;
    prev = a;
  }
  if (sub === "install") return "nada de 'cargo install' en un worker: instalar lo hace el jefe después de integrar.";
  if (sub === "clean") return "nada de 'cargo clean' en un worker: el target es compartido con el tree principal (y con otros workers). Si sospechás de un artefacto roto, decilo en DECISION.";
  return null;
}

const real = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };

/**
 * El binario de verdad: el primero del PATH que no es la carpeta de los shims. En Windows prueba cada extensión de PATHEXT.
 * `o` se inyecta en los tests.
 */
export function buscarReal(nombre, o = {}) {
  const plat = o.plat ?? process.platform;
  const win = plat === "win32";
  const aqui = real(o.aqui ?? path.dirname(fileURLToPath(import.meta.url)));
  const delim = win ? ";" : ":";
  const exts = win ? (o.pathext ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const esArchivo = o.esArchivo ?? ((f) => {
    try {
      if (!statSync(f).isFile()) return false;
      if (!win) accessSync(f, constants.X_OK);
      return true;
    } catch { return false; }
  });
  for (const d of (o.path ?? process.env.PATH ?? "").split(delim)) {
    if (!d) continue;
    if (win ? real(d).toLowerCase() === aqui.toLowerCase() : real(d) === aqui) continue;
    for (const e of exts) {
      const f = path.join(d, nombre + e);
      if (esArchivo(f)) return f;
    }
  }
  return null;
}

/** Corre la guardia y, si pasa, el binario de verdad con el mismo código de salida. Devuelve el código. */
export function ejecutar(nombre, guardia, args, o = {}) {
  const motivo = guardia(args);
  if (motivo) {
    process.stderr.write(`BLOQUEADO: ${motivo}\n`);
    return 2;
  }
  const bin = buscarReal(nombre, o);
  if (!bin) {
    process.stderr.write(`${nombre}: no encuentro el ${nombre} de verdad en el PATH\n`);
    return 127;
  }
  // un .cmd/.bat (no un .exe) sólo corre por el shell de Windows
  const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  const r = viaShell
    ? spawnSync(`"${bin}"`, args.map((a) => `"${a.replace(/"/g, '\\"')}"`), { stdio: "inherit", shell: true, windowsHide: true })
    : spawnSync(bin, args, { stdio: "inherit", windowsHide: true });
  if (r.error) {
    process.stderr.write(`${nombre}: ${r.error.message}\n`);
    return 127;
  }
  return r.status ?? 128;
}
