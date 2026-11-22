#!/usr/bin/env node
// cierre-cupo.mjs — hook de PostToolUse y UserPromptSubmit del `claude` oficial (líderes de la app, líderes de terminal y workers de
// `pa`). Si a la suscripción de ESTA sesión le queda poco cupo (la señal `$PA_STATE/cierre-cupo.json`, ver
// motor/docs/protocolo-cierre-cupo.md), le inyecta UNA vez por ventana el aviso de cierre ordenado (`additionalContext`):
//   - worker (el entorno trae PA_WORKER=1, lo pone `pa`): cerrá, commiteá y reportá; nada nuevo.
//   - líder: dejá andando lo que funciona, escribí el resumen para retomar en `<estado de la app>/relevos/<session_id>.md` (el
//     `archivoRelevo` de los líderes de la app; en uno de terminal es el mismo lugar), mandá a cerrar a tus workers y avisá al dueño en UNA línea.
// Después de la primera vez no vuelve a inyectar en esa ventana (marca en `$PA_STATE/cierre-cupo/visto/<session_id>/<ventana>-<desde>`): el dueño sigue
// chateando normal. Barato: sin archivo de señal hace un `stat` y sale, sin leer stdin. Nunca bloquea (siempre sale con 0).
// Textos (es/en) en cierre-cupo-textos.mjs, el mismo que usa el main de la app para los líderes que no corren hooks.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const env = process.env;
const win = process.platform === "win32";
const casa = () => (win ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir());
const estadoPa = () => env.PA_STATE || (win ? path.win32.join(env.LOCALAPPDATA || path.win32.join(casa(), "AppData", "Local"), "trama", "estado", "pa") : path.join(casa(), ".local", "state", "pa"));
const estadoHilos = () => env.HILOS_STATE || (win ? path.win32.join(env.LOCALAPPDATA || path.win32.join(casa(), "AppData", "Local"), "trama", "estado", "hilos") : path.join(casa(), ".local", "state", "hilos"));
const leerJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

/** El idioma de la app (preferencias.json de su estado); sin él, el de la terminal; por defecto es. */
function idiomaDeLaApp() {
  const p = leerJson(path.join(estadoHilos(), "preferencias.json"));
  if (p && (p.idioma === "es" || p.idioma === "en")) return p.idioma;
  return /^en/i.test(env.LC_ALL || env.LANG || "") ? "en" : "es";
}

/** La cuenta de Claude de esta sesión: `claude` (la de siempre) o el id de la agregada cuya carpeta es CLAUDE_CONFIG_DIR; `null` si no se sabe. */
export function cuentaDeSesion(e = env, plat = process.platform) {
  const w = plat === "win32";
  const c = w ? path.win32 : path;
  const dir = e.CLAUDE_CONFIG_DIR;
  // En Windows el home es USERPROFILE (HOME puede venir de un Git Bash ajeno); en Linux, HOME.
  const h = (w ? e.USERPROFILE || e.HOME : e.HOME || e.USERPROFILE) || casa();
  if (!dir) return "claude";
  // En Windows las rutas no distinguen mayúsculas (`c:\` y `C:\`) ni el sentido de la barra.
  const igual = (a, b) => (w ? c.resolve(a).toLowerCase() === c.resolve(b).toLowerCase() : c.resolve(a) === c.resolve(b));
  if (igual(dir, c.join(h, ".claude"))) return "claude";
  const archivo = e.TRAMA_CUENTAS || c.join(e.TRAMA_CUENTAS_HOME || h, ".config", "trama", "cuentas.json");
  const lista = leerJson(archivo)?.cuentas;
  if (!Array.isArray(lista)) return null;
  for (const x of lista) {
    if (!x || x.proveedor !== "claude" || typeof x.id !== "string") continue;
    const propia = typeof x.dir === "string" && x.dir ? x.dir.replace(/^~(?=[\\/]|$)/, h) : c.join(c.dirname(archivo), "cuentas", x.id);
    if (igual(propia, dir)) return x.id;
  }
  return null;
}

const SESION_OK = /^[A-Za-z0-9._-]{1,128}$/;

/** Con la señal ya leída: lo que hay que inyectar (o `null`). Marca lo visto. Separado para probarlo sin stdin ni reloj. */
export async function decidir({ senal, sesion, evento, e = env, ahora = Math.floor(Date.now() / 1000), estado = estadoPa(), hilos = estadoHilos(), idioma }) {
  if (!senal || senal.version !== 1 || !Array.isArray(senal.entradas) || !SESION_OK.test(sesion || "")) return null;
  if (e.ANTHROPIC_BASE_URL) return null; // un claude contra otro endpoint (Ollama, un proxy): no gasta cupo de la suscripción
  const cuenta = cuentaDeSesion(e);
  if (!cuenta) return null;
  const vivas = senal.entradas.filter((x) => x && x.proveedor === "claude" && x.cuenta === cuenta && (x.vuelve === null || x.vuelve === undefined || x.vuelve > ahora));
  if (!vivas.length) return null;
  // Una marca por sesión y ventana, creada con `wx`: si dos copias del hook corren a la vez (el de ~/.claude/settings.json y el que
  // la app agrega al líder) sólo una la crea y sólo esa inyecta.
  const dirMarcas = path.join(estado, "cierre-cupo", "visto", sesion);
  try {
    mkdirSync(dirMarcas, { recursive: true });
  } catch {
    return null; // sin dónde marcar el aviso saldría en cada herramienta: mejor no avisar
  }
  const nuevas = [];
  for (const x of vivas) {
    try {
      writeFileSync(path.join(dirMarcas, `${x.ventana}-${x.desde}`.replace(/[^A-Za-z0-9._-]/g, "_")), `${x.cuenta}\n`, { flag: "wx" });
      nuevas.push(x);
    } catch {
      /* ya se avisó de esta ventana (o no se pudo marcar) */
    }
  }
  if (!nuevas.length) return null;
  // La que más tarda en volver manda en el texto (sin hora conocida, la más tarde de todas).
  const mayor = nuevas.reduce((a, b) => ((b.vuelve ?? Infinity) > (a.vuelve ?? Infinity) ? b : a));
  limpiarVistos(path.dirname(dirMarcas), ahora);
  const { textoCierre } = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "cierre-cupo-textos.mjs")).href);
  const rol = e.PA_WORKER === "1" ? "worker" : "lider";
  return {
    hookSpecificOutput: {
      hookEventName: evento === "UserPromptSubmit" ? "UserPromptSubmit" : "PostToolUse",
      additionalContext: textoCierre({ rol, idioma: idioma ?? idiomaDeLaApp(), entrada: mayor, archivo: path.join(hilos, "relevos", `${sesion}.md`), ahora }),
    },
  };
}

/** Las marcas de sesiones de hace más de dos semanas se borran (sólo cuando se escribe una nueva). */
function limpiarVistos(dir, ahora) {
  try {
    for (const n of readdirSync(dir)) {
      const f = path.join(dir, n);
      if (ahora - statSync(f).mtimeMs / 1000 > 14 * 86400) rmSync(f, { recursive: true, force: true });
    }
  } catch {
    /* mejor esfuerzo */
  }
}

function main() {
  const archivo = path.join(estadoPa(), "cierre-cupo.json");
  try {
    statSync(archivo);
  } catch {
    return; // sin archivo no se cierra nada: lo más común, y cuesta un stat
  }
  let doc = {};
  try {
    doc = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const senal = leerJson(archivo);
  return decidir({ senal, sesion: doc.session_id, evento: doc.hook_event_name }).then((r) => {
    if (r) process.stdout.write(JSON.stringify(r) + "\n");
  });
}

// Como programa corre; importado (los tests) no hace nada.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  Promise.resolve()
    .then(main)
    .catch(() => {})
    .finally(() => process.exit(0));
}
