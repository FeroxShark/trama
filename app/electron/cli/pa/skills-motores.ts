// Las skills de Claude Code (`~/.claude/skills` y las de los plugins habilitados) para los motores que no las cargan solos: agy,
// codex y opencode. Cada skill que no esté apagada en Trama (`apagados.json`) queda como un enlace en la carpeta de skills de ese
// motor (junction en Windows): lo que Claude edite se ve igual, sin copias que se desfasen. Una skill apagada no queda y su enlace
// viejo se quita. Idempotente: una segunda corrida sin cambios no toca nada.
// Sólo toca lo que creó: un enlace que apunta a una carpeta de Claude (`raices`). Un archivo, una carpeta o un enlace ajeno que ya esté
// en el destino se respeta, aunque tenga el mismo nombre. Node puro: los tests pasan el HOME y la carpeta de Claude.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { leerApagadosTrama } from "../../apagados.ts";
import { caminoDe, configTrama, type Plataforma } from "../../rutas.ts";
import type { Env } from "./entorno.ts";

/** Los motores que no cargan las skills de Claude por su cuenta (opencode, con un modelo `opencode:*` del dsh). */
export type MotorSkills = "agy" | "codex" | "opencode";

/** Una skill de Claude: `clave` como la pide apagados.json (`nombre`, o `plugin:nombre` si viene de un plugin), `nombre` de su carpeta y `dir` con su SKILL.md. */
export type SkillClaude = { clave: string; nombre: string; dir: string };

export type ResultadoSync = {
  creadas: string[];
  actualizadas: string[];
  quitadas: string[];
  /** Ya había un archivo, carpeta o enlace ajeno con ese nombre: no se toca. */
  respetadas: string[];
  fallidas: { nombre: string; error: string }[];
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** La carpeta de skills que lee cada motor al empezar: agy la global de `~/.gemini/config`; codex, `$CODEX_HOME` o `~/.codex`; opencode, su config global. */
export function carpetaSkillsDe(motor: MotorSkills, env: Env, home: string, plat: Plataforma): string {
  const j = caminoDe(plat);
  if (motor === "agy") return j.join(home, ".gemini", "config", "skills");
  if (motor === "codex") return j.join(env.CODEX_HOME || j.join(home, ".codex"), "skills");
  return j.join(env.XDG_CONFIG_HOME || j.join(home, ".config"), "opencode", "skills");
}

const existe = (ruta: string) => {
  try {
    lstatSync(ruta);
    return true;
  } catch {
    return false;
  }
};

/** ¿`apunta` está dentro de una de las carpetas de Claude? Sólo mira el texto de la ruta (sirve aunque el destino ya no exista). */
function dentroDe(apunta: string, raices: readonly string[]): boolean {
  return raices.some((r) => {
    const rel = path.relative(r, apunta);
    return rel !== "" && rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel);
  });
}

/** Quita un enlace sin tocar lo que apunta (en Windows un junction se quita con rmdir, no con unlink). */
function quitarEnlace(ruta: string) {
  try {
    unlinkSync(ruta);
  } catch {
    rmdirSync(ruta);
  }
}

/** Enlaza `ruta` a `origen` (carpeta absoluta; en Windows, junction: no pide permisos de administrador). */
const enlazar = (origen: string, ruta: string) => symlinkSync(origen, ruta, process.platform === "win32" ? "junction" : "dir");

/**
 * Deja en `destino` un enlace por cada skill de `skills` que no esté en `apagadas` (por clave o por nombre, como el catálogo del panel)
 * y quita los enlaces hechos a `raices` que ya no corresponden. Si dos skills tienen el mismo nombre gana la primera (las de
 * `~/.claude/skills` van antes que las de los plugins). Lo que no es un enlace hecho a `raices` no se toca.
 */
export function sincronizarSkills(d: { destino: string; skills: SkillClaude[]; apagadas: readonly string[]; raices: readonly string[] }): ResultadoSync {
  const r: ResultadoSync = { creadas: [], actualizadas: [], quitadas: [], respetadas: [], fallidas: [] };
  const pendientes = new Map<string, SkillClaude>();
  for (const s of d.skills) {
    if (d.apagadas.includes(s.clave) || d.apagadas.includes(s.nombre)) continue;
    if (!pendientes.has(s.nombre)) pendientes.set(s.nombre, s);
  }
  if (existsSync(d.destino)) {
    for (const nombre of readdirSync(d.destino)) {
      const ruta = path.join(d.destino, nombre);
      if (!lstatSync(ruta).isSymbolicLink()) continue;
      const apunta = path.resolve(d.destino, readlinkSync(ruta));
      if (!dentroDe(apunta, d.raices)) continue;
      const s = pendientes.get(nombre);
      if (!s) {
        quitarEnlace(ruta);
        r.quitadas.push(nombre);
        continue;
      }
      pendientes.delete(nombre);
      if (path.relative(apunta, s.dir) === "") continue;
      try {
        quitarEnlace(ruta);
        enlazar(s.dir, ruta);
        r.actualizadas.push(nombre);
      } catch (e) {
        r.fallidas.push({ nombre, error: msg(e) });
      }
    }
  }
  for (const [nombre, s] of pendientes) {
    const ruta = path.join(d.destino, nombre);
    if (existe(ruta)) {
      r.respetadas.push(nombre);
      continue;
    }
    try {
      mkdirSync(d.destino, { recursive: true });
      enlazar(s.dir, ruta);
      r.creadas.push(nombre);
    } catch (e) {
      r.fallidas.push({ nombre, error: msg(e) });
    }
  }
  return r;
}

const leerJson = <T>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Las subcarpetas de `dir` que tienen su SKILL.md (las que no, como un bucket de sincronización, no son skills). */
function skillsEn(dir: string, clave: (nombre: string) => string): SkillClaude[] {
  let nombres: string[];
  try {
    nombres = readdirSync(dir).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  return nombres.filter((n) => existsSync(path.join(dir, n, "SKILL.md"))).map((n) => ({ clave: clave(n), nombre: n, dir: path.join(dir, n) }));
}

/**
 * Las skills de Claude de esta máquina y las carpetas que las contienen (`raices`): `<claude>/skills` y, de cada plugin habilitado
 * en `settings.json` (`enabledPlugins`), su `skills/` en el `installPath` de `installed_plugins.json` (las de scope proyecto no van).
 */
export function skillsClaude(claude: string): { skills: SkillClaude[]; raices: string[] } {
  const skills = skillsEn(path.join(claude, "skills"), (n) => n);
  const raices = [path.join(claude, "skills")];
  const habilitados = leerJson<{ enabledPlugins?: Record<string, unknown> }>(path.join(claude, "settings.json"))?.enabledPlugins ?? {};
  const instalados = leerJson<{ plugins?: Record<string, { installPath?: unknown; scope?: unknown }[]> }>(path.join(claude, "plugins", "installed_plugins.json"))?.plugins ?? {};
  for (const [clave, instalaciones] of Object.entries(instalados)) {
    if (habilitados[clave] !== true) continue;
    const plugin = clave.split("@")[0]!;
    for (const inst of Array.isArray(instalaciones) ? instalaciones : []) {
      if (typeof inst.installPath !== "string" || !inst.installPath || inst.scope === "project") continue;
      raices.push(inst.installPath);
      skills.push(...skillsEn(path.join(inst.installPath, "skills"), (n) => `${plugin}:${n}`));
    }
  }
  return { skills, raices };
}

/** Sincroniza las skills de Claude en la carpeta del motor (con el apagado de Trama de `configTrama`). */
export function sincronizarSkillsParaMotor(motor: MotorSkills, env: Env, home: string, plat: Plataforma): ResultadoSync {
  const j = caminoDe(plat);
  const claude = env.CLAUDE_CONFIG_DIR || j.join(home, ".claude");
  const { skills, raices } = skillsClaude(claude);
  return sincronizarSkills({ destino: carpetaSkillsDe(motor, env, home, plat), skills, apagadas: leerApagadosTrama(configTrama(env, home, plat)).skills, raices });
}
