// El registro histórico de en qué se van los tokens: indexa los transcripts de Claude Code
// (`projects/<carpeta>/<sid>.jsonl` y sus `subagents/`) y guarda, por sesión, sólo números y nombres
// (electron/historial-parser.ts) en `$HILOS_STATE/historial/`: un archivo por mes (`AAAA-MM.json`) y
// `indice.json` con hasta dónde se leyó cada transcript. Claude Code borra los transcripts viejos;
// lo indexado queda.
//
// Incremental: de una pasada a la otra, un transcript que no creció cuesta un `stat`, y uno que
// creció se lee desde donde quedó. No traba: se lee de a trozos y entre uno y otro se le devuelve
// el turno al resto del main. Sin reloj propio: una pasada sale cuando alguien la pide (`pedir`,
// como mucho una por hora) o cuando se consulta (`consultar`). Sin Electron: `tests/historial.test.ts`.
import { mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  calibrar,
  diaDe,
  linea,
  PARSER,
  pesoArranque,
  servidorMcp,
  sesionNueva,
  type Clase,
  type Contexto,
  type Pieza,
  type Rol,
  type Sesion,
} from "./historial-parser.ts";
import { sumar, type Suma } from "./transcripts.ts";
import { silencio } from "./log.ts";

const VERSION = 1;
/** Lo que se lee de una vez antes de devolver el turno. */
const TROZO = 512 * 1024;
/** Una línea más larga que esto se saltea sin leerla. */
const LINEA_MAX = 32 * 1024 * 1024;
/** Lo que espera una pasada pedida (que la app termine de arrancar) y lo mínimo entre dos. */
const ESPERA_MS = 30_000;
const CADA_MS = 3_600_000;
/** Una consulta no vuelve a indexar si la última pasada es de hace menos que esto. */
const FRESCO_MS = 60_000;
/** Una sesión puede haber empezado meses antes del rango que se consulta. */
const MESES_ATRAS = 3;

const SID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID = /^\d{8}-\d{6}-\d+$/;
const MES = /^\d{4}-\d{2}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

type Indice = { version: number; parser: number; archivos: Record<string, [leido: number, mes: string, tam: number]> };
type Mes = { version: number; sesiones: Record<string, Sesion> };
/**
 * Un mes como va al disco: lo cargado se repite de una sesión a otra (las mismas skills, el mismo
 * CLAUDE.md), así que cada pieza distinta se anota una vez y la sesión la nombra por su lugar.
 */
type Guardada = Omit<Sesion, "cargado"> & { cargado: [pieza: number, veces: number][] };
export type MesGuardado = { version: number; piezas: [clase: Clase, nombre: string, chars: number, inicial: 0 | 1][]; sesiones: Record<string, Guardada> };

export function empacar(sesiones: Record<string, Sesion>): MesGuardado {
  const piezas: MesGuardado["piezas"] = [];
  const lugar = new Map<string, number>();
  const r: Record<string, Guardada> = {};
  for (const [k, s] of Object.entries(sesiones)) {
    const cargado = s.cargado.map((p): [number, number] => {
      const clave = `${p.clase}\n${p.nombre}\n${p.chars}\n${p.inicial ? 1 : 0}`;
      let i = lugar.get(clave);
      if (i === undefined) lugar.set(clave, (i = piezas.push([p.clase, p.nombre, p.chars, p.inicial ? 1 : 0]) - 1));
      return [i, p.veces];
    });
    r[k] = { ...s, cargado };
  }
  return { version: VERSION, piezas, sesiones: r };
}

/** `null`: no es un mes de esta versión. */
export function desempacar(d: unknown): Record<string, Sesion> | null {
  const m = d as MesGuardado | undefined;
  if (m?.version !== VERSION || !Array.isArray(m.piezas) || !m.sesiones || typeof m.sesiones !== "object") return null;
  try {
    const r: Record<string, Sesion> = {};
    for (const [k, s] of Object.entries(m.sesiones)) {
      const cargado: Pieza[] = [];
      for (const [i, veces] of s.cargado) {
        const p = m.piezas[i];
        if (p) cargado.push({ clase: p[0], nombre: p[1], chars: p[2], veces, inicial: p[3] === 1 });
      }
      r[k] = { ...s, cargado };
    }
    return r;
  } catch {
    return null;
  }
}
type Archivo = { clave: string; ruta: string; tam: number; mtimeMs: number; sid: string; agente: string | null };

/** Lo que hizo una pasada. `bloqueo`: lo más que tuvo el turno sin devolverlo, en ms. */
export type Pasada = { archivos: number; leidos: number; bytes: number; lineas: number; ms: number; bloqueo: number };

/** Cómo se junta lo cargado al consultar: una skill con prefijo también suma en su plugin, y las tres piezas de un servidor MCP son una. */
export type ClaseConsulta = "sistema" | "herramientas" | "skill" | "plugin" | "hook" | "claudemd" | "mcp" | "diferidas" | "agentes" | "estilo";

export type PiezaConsulta = {
  clase: ClaseConsulta;
  nombre: string;
  /** Cuántas sesiones del rango la cargaron. */
  sesiones: number;
  /** Su tamaño, en caracteres, promedio entre esas sesiones. Exacto. */
  chars: number;
  /**
   * **Estimado**: los tokens que pesó en el arranque (el primer pedido), sumados entre las sesiones.
   * Contra `arranque.tokens` da el porcentaje del arranque que se lleva.
   */
  peso: number;
  /** **Estimado**: lo mismo por cada mensaje del modelo en el rango (lo del arranque se relee en cada turno). */
  pesoPorTurnos: number;
  /** **Estimado**: lo que cargó después del arranque (un CLAUDE.md de una subcarpeta, un hook en cada mensaje, el listado otra vez tras compactar). */
  despues: number;
  /** Cuántas veces se usó en el rango. `null`: de esta clase no se cuenta (un CLAUDE.md no se "usa", un plugin sin skills tampoco). */
  usos: number | null;
  /** Cuántas veces corrió un hook de este plugin en el rango (los que inyectaron texto). Exacto. 0 si no es un plugin. Un plugin con hooks que corrieron actúa por ganchos: no cuenta como sin usar aunque `usos` sea 0. */
  ganchos: number;
  /** De una skill, de dónde viene: de un plugin (su prefijo) o de `~/.claude/skills`. `null`: no se sabe (de Claude Code o de un proyecto), o no es una skill. */
  origen: "plugin" | "usuario" | null;
};

export type Consulta = {
  version: 1;
  desde: string;
  hasta: string;
  /** Si se pidió sólo lo de un rol (las sesiones que son eso mismo; un subagente no cuenta en quien lo lanzó). */
  rol: Rol | null;
  /** Sesiones con algún mensaje del modelo en el rango. */
  sesiones: number;
  modelos: Record<string, Suma>;
  roles: Record<Rol, { sesiones: number; modelos: Record<string, Suma> }>;
  /** El peso exacto del arranque (primer mensaje), sumado entre las sesiones que lo traen. */
  arranque: { sesiones: number; tokens: number };
  compactaciones: number;
  /** Ordenadas por `peso`, de mayor a menor. */
  piezas: PiezaConsulta[];
  herramientas: Record<string, number>;
  subagentes: Record<string, number>;
  /** Lo que no se sabe: nunca un número inventado en su lugar. */
  sinDato: {
    /** Sesiones sin primer mensaje: no se sabe cuánto pesó su arranque. */
    sinArranque: number;
    /** Sesiones cuyo peso por pieza salió de 3,5 caracteres por token, sin calibrar contra su arranque. */
    sinCalibrar: number;
    /** Líneas de transcript que el parser no reconoció. */
    lineas: number;
    /** Sesiones indexadas con otro parser cuyo transcript ya no está: no entran en ningún número. */
    parserViejo: number;
    /** Meses guardados con una versión que este build no entiende. */
    meses: number;
  };
};

const ceder = () => new Promise<void>((r) => setImmediate(r));

async function leerJson(archivo: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(archivo, "utf8"));
  } catch {
    return undefined;
  }
}

async function escribirJson(archivo: string, dato: unknown): Promise<void> {
  const tmp = `${archivo}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(dato));
  await rename(tmp, archivo);
}

/**
 * Todos los transcripts: los de primer nivel y los de los subagentes de cada sesión. Un enlace
 * simbólico a un transcript no cuenta (es el mismo archivo otra vez), y si una sesión está en dos
 * carpetas vale la más larga.
 */
async function recorrer(proyectos: string): Promise<Archivo[]> {
  const r: Archivo[] = [];
  const carpetas = await readdir(proyectos, { withFileTypes: true }).catch(() => []);
  for (const c of carpetas) {
    if (!c.isDirectory()) continue;
    const dir = path.join(proyectos, c.name);
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        const sid = e.name.slice(0, -6);
        if (SID.test(sid)) r.push({ clave: sid, ruta: path.join(dir, e.name), tam: -1, mtimeMs: 0, sid, agente: null });
      } else if (e.isDirectory() && SID.test(e.name)) {
        const sub = path.join(dir, e.name, "subagents");
        for (const n of await readdir(sub).catch(() => [] as string[])) {
          const agente = n.endsWith(".jsonl") ? n.slice(0, -6) : "";
          if (SID.test(agente)) r.push({ clave: `${e.name}/${agente}`, ruta: path.join(sub, n), tam: -1, mtimeMs: 0, sid: e.name, agente });
        }
      }
    }
    await ceder();
  }
  const vivos: Archivo[] = [];
  for (const a of r) {
    try {
      const fd = await open(a.ruta, "r");
      try {
        const st = await fd.stat();
        a.tam = st.size;
        a.mtimeMs = st.mtimeMs;
        vivos.push(a);
      } finally {
        await fd.close();
      }
    } catch {
      // Lo borraron entre el listado y ahora.
    }
  }
  const uno = new Map<string, Archivo>();
  for (const a of vivos) if ((uno.get(a.clave)?.tam ?? -1) < a.tam) uno.set(a.clave, a);
  return [...uno.values()].sort((x, y) => (x.clave < y.clave ? -1 : 1));
}

/** Lee lo que el transcript creció desde `s.estado.leido`, de a trozos y sólo líneas enteras. */
async function leer(ruta: string, s: Sesion, ctx: Contexto, m: Pasada): Promise<void> {
  let fd;
  try {
    fd = await open(ruta, "r");
  } catch {
    return;
  }
  try {
    const tam = (await fd.stat()).size;
    let pos = s.estado.leido;
    // Una línea que no entró en el trozo: se junta hasta que aparece su fin.
    let resto: Buffer[] = [];
    let restoLen = 0;
    let saltando = false;
    let reloj = performance.now();
    // Un solo búfer por archivo: lo que tiene que durar de una vuelta a la otra se copia.
    const buf = Buffer.allocUnsafe(Math.min(TROZO, Math.max(1, tam - pos)));
    while (pos + restoLen < tam) {
      const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, tam - pos - restoLen), pos + restoLen);
      if (bytesRead <= 0) break;
      reloj = performance.now();
      m.bytes += bytesRead;
      const trozo = buf.subarray(0, bytesRead);
      const fin = trozo.lastIndexOf(10);
      if (fin < 0) {
        if (saltando) pos += bytesRead;
        else {
          resto.push(Buffer.from(trozo));
          restoLen += bytesRead;
          if (restoLen > LINEA_MAX) {
            saltando = true;
            pos += restoLen;
            resto = [];
            restoLen = 0;
            s.sinDato++;
          }
        }
        continue;
      }
      let texto: string;
      if (saltando) {
        saltando = false;
        texto = trozo.toString("utf8", trozo.indexOf(10) + 1, fin);
      } else texto = (restoLen ? Buffer.concat([...resto, trozo.subarray(0, fin)]) : trozo.subarray(0, fin)).toString("utf8");
      pos += restoLen + fin + 1;
      // Lo que quedó después del último salto es el principio de la línea que sigue: no se lee dos veces.
      resto = fin + 1 < bytesRead ? [Buffer.from(trozo.subarray(fin + 1))] : [];
      restoLen = bytesRead - fin - 1;
      for (const l of texto.split("\n")) {
        m.lineas++;
        linea(s, l, ctx);
      }
      s.estado.leido = pos;
      m.bloqueo = Math.max(m.bloqueo, performance.now() - reloj);
      await ceder();
    }
  } catch {
    // Se sigue desde donde quedó en la próxima pasada.
  } finally {
    await fd.close().catch(silencio("historial"));
  }
}

/** Texto de cada hook de cada plugin instalado (su comando y su `statusMessage`) → el plugin. */
async function hooksDePlugins(claude: string): Promise<Map<string, string>> {
  const r = new Map<string, string>();
  const instalados = (await leerJson(path.join(claude, "plugins", "installed_plugins.json"))) as { plugins?: Record<string, unknown> } | undefined;
  const juntar = (x: unknown, plugin: string, hondo: number): void => {
    if (!x || typeof x !== "object" || hondo > 8) return;
    for (const [k, v] of Object.entries(x)) {
      if ((k === "statusMessage" || k === "command") && typeof v === "string" && v.trim()) r.set(v.trim(), plugin);
      else juntar(v, plugin, hondo + 1);
    }
  };
  for (const [clave, v] of Object.entries(instalados?.plugins ?? {})) {
    const plugin = clave.split("@")[0];
    for (const inst of Array.isArray(v) ? v : [v]) {
      const dir = (inst as { installPath?: unknown } | null)?.installPath;
      if (!plugin || typeof dir !== "string") continue;
      for (const f of [path.join(dir, ".claude-plugin", "plugin.json"), path.join(dir, "hooks", "hooks.json")]) {
        const d = (await leerJson(f)) as { hooks?: unknown } | undefined;
        juntar(d?.hooks ?? (f.endsWith("hooks.json") ? d : null), plugin, 0);
      }
    }
  }
  return r;
}

const mesDe = (ms: number): string => diaDe(ms).slice(0, 7);

function mesesAntes(mes: string, n: number): string {
  const d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 - n, 1);
  return mesDe(d.getTime());
}

export function crearHistorial(o: {
  /** `~/.claude/projects`. */
  proyectos: string;
  paState: string;
  /** Donde se guarda: `$HILOS_STATE/historial`. */
  carpeta: string;
  /** `~/.claude`: de ahí sale qué hook es de qué plugin. */
  claude?: string;
  casa?: string;
  ahora?: () => number;
  esperaMs?: number;
  cadaMs?: number;
}) {
  const ahora = o.ahora ?? Date.now;
  const casa = o.casa ?? os.homedir();
  const claude = o.claude ?? path.dirname(o.proyectos);
  /** `.sid` de `pa` ya leídos: archivo → session_id. No cambian. */
  const sidLeido = new Map<string, string>();
  /** session_id → el worker de `pa` que es. */
  const workers = new Map<string, { id: string; proyecto: string }>();
  let corriendo: Promise<Pasada> | null = null;
  let ultima = -Infinity;
  let reloj: NodeJS.Timeout | null = null;

  const archivoMes = (mes: string) => path.join(o.carpeta, `${mes}.json`);

  async function leerSids(): Promise<void> {
    const carpetas = await readdir(o.paState, { withFileTypes: true }).catch(() => []);
    for (const c of carpetas) {
      if (!c.isDirectory()) continue;
      for (const n of await readdir(path.join(o.paState, c.name)).catch(() => [] as string[])) {
        if (!n.endsWith(".sid")) continue;
        const id = n.slice(0, -4);
        const archivo = path.join(o.paState, c.name, n);
        if (!ID.test(id) || sidLeido.has(archivo)) continue;
        const sid = await readFile(archivo, "utf8").then((t) => t.trim(), () => "");
        if (!SID.test(sid)) continue;
        sidLeido.set(archivo, sid);
        workers.set(sid, { id, proyecto: c.name });
      }
      await ceder();
    }
  }

  function ponerRol(s: Sesion): void {
    const w = workers.get(s.sid);
    if (s.agente) {
      s.rol = "subagente";
      s.rolPadre = w ? "worker" : "lider";
    } else s.rol = w ? "worker" : "lider";
    if (w) {
      s.worker = w.id;
      // El nombre de la carpeta del proyecto en PA_STATE (`<PA_STATE>/<proyecto>/<id>.sid`), no el de la carpeta del worktree.
      s.proyecto = w.proyecto;
    }
  }

  async function leerIndice(): Promise<Indice> {
    const d = (await leerJson(path.join(o.carpeta, "indice.json"))) as Indice | undefined;
    // Sin índice (o de otra versión) se indexa de nuevo: los meses guardan hasta dónde llegó cada sesión.
    if (d?.version !== VERSION || !d.archivos || typeof d.archivos !== "object") return { version: VERSION, parser: PARSER, archivos: {} };
    return d;
  }

  /** `null`: lo escribió una versión que este build no entiende (o está roto); no se toca. */
  async function leerMes(mes: string): Promise<Mes | null> {
    let texto: string;
    try {
      texto = await readFile(archivoMes(mes), "utf8");
    } catch (e) {
      // Que no exista es un mes sin nada; que no se pueda leer, no.
      return (e as NodeJS.ErrnoException).code === "ENOENT" ? { version: VERSION, sesiones: {} } : null;
    }
    let sesiones: Record<string, Sesion> | null = null;
    try {
      sesiones = desempacar(JSON.parse(texto));
    } catch {}
    return sesiones ? { version: VERSION, sesiones } : null;
  }

  async function pasada(): Promise<Pasada> {
    const t0 = performance.now();
    const m: Pasada = { archivos: 0, leidos: 0, bytes: 0, lineas: 0, ms: 0, bloqueo: 0 };
    await mkdir(o.carpeta, { recursive: true });
    const indice = await leerIndice();
    const rehacer = indice.parser !== PARSER;
    const archivos = await recorrer(o.proyectos);
    m.archivos = archivos.length;
    // Los transcripts que Claude Code ya borró salen del índice; lo indexado de ellos queda en su mes.
    const estan = new Set(archivos.map((a) => a.clave));
    let cambio = rehacer;
    for (const k of Object.keys(indice.archivos)) {
      if (estan.has(k)) continue;
      delete indice.archivos[k];
      cambio = true;
    }
    const pendientes = archivos.filter((a) => rehacer || indice.archivos[a.clave]?.[2] !== a.tam);
    if (pendientes.length) {
      await leerSids();
      const ctx: Contexto = { casa, plugins: await hooksDePlugins(claude) };
      const meses = new Map<string, Mes | null>();
      const sucios = new Set<string>();
      const mes = async (k: string): Promise<Mes | null> => {
        if (!meses.has(k)) meses.set(k, await leerMes(k));
        return meses.get(k) ?? null;
      };
      for (const a of pendientes) {
        const anotado = indice.archivos[a.clave]?.[1];
        const donde = anotado && MES.test(anotado) ? anotado : null;
        const viejo = donde ? await mes(donde) : undefined;
        if (viejo === null) continue;
        let s = viejo?.sesiones[a.clave];
        // Otro parser, o el archivo se achicó (lo reescribieron): de nuevo desde el principio.
        if (!s || s.parser !== PARSER || a.tam < s.estado.leido) {
          s = sesionNueva(a.sid, a.agente);
          if (a.agente) {
            const meta = (await leerJson(a.ruta.replace(/\.jsonl$/, ".meta.json"))) as { agentType?: unknown } | undefined;
            if (typeof meta?.agentType === "string") s.tipo = meta.agentType.slice(0, 96);
          }
        }
        const antes = s.estado.leido;
        await leer(a.ruta, s, ctx, m);
        ponerRol(s);
        if (s.estado.leido !== antes) m.leidos++;
        const destino = donde ?? mesDe(s.inicio ?? a.mtimeMs);
        const en = await mes(destino);
        if (en === null) continue;
        en.sesiones[a.clave] = s;
        sucios.add(destino);
        indice.archivos[a.clave] = [s.estado.leido, destino, a.tam];
        cambio = true;
      }
      // Primero los meses: si se corta acá, el índice viejo hace releer y cada sesión sigue desde su `leido`.
      for (const k of sucios) await escribirJson(archivoMes(k), empacar(meses.get(k)?.sesiones ?? {}));
    }
    if (cambio) {
      indice.parser = PARSER;
      await escribirJson(path.join(o.carpeta, "indice.json"), indice);
    }
    m.ms = performance.now() - t0;
    ultima = ahora();
    return m;
  }

  /** Indexa lo que falte. Si ya hay una pasada corriendo, es esa. */
  function alDia(): Promise<Pasada> {
    corriendo ??= pasada().finally(() => {
      corriendo = null;
    });
    return corriendo;
  }

  async function consultar(desde: string, hasta: string, soloRol?: Rol): Promise<Consulta> {
    if (!DIA.test(desde) || !DIA.test(hasta) || desde > hasta) throw new Error("historial: rango de días inválido");
    if (corriendo || ahora() - ultima > FRESCO_MS) await alDia().catch(silencio("historial"));
    const c: Consulta = {
      version: 1,
      desde,
      hasta,
      rol: soloRol ?? null,
      sesiones: 0,
      modelos: {},
      roles: { lider: { sesiones: 0, modelos: {} }, worker: { sesiones: 0, modelos: {} }, subagente: { sesiones: 0, modelos: {} } },
      arranque: { sesiones: 0, tokens: 0 },
      compactaciones: 0,
      piezas: [],
      herramientas: {},
      subagentes: {},
      sinDato: { sinArranque: 0, sinCalibrar: 0, lineas: 0, parserViejo: 0, meses: 0 },
    };
    type Junta = { clase: ClaseConsulta; nombre: string; sesiones: number; chars: number; peso: number; pesoPorTurnos: number; despues: number; ganchos: number };
    const piezas = new Map<string, Junta>();
    const skills: Record<string, number> = {};
    const mcp: Record<string, number> = {};
    const contar = (en: Record<string, number>, de: Record<string, number>) => {
      for (const [k, n] of Object.entries(de)) en[k] = (en[k] ?? 0) + n;
    };
    const primero = mesesAntes(desde.slice(0, 7), MESES_ATRAS);
    const ultimo = hasta.slice(0, 7);
    const nombres = (await readdir(o.carpeta).catch(() => [] as string[])).filter((n) => n.endsWith(".json") && MES.test(n.slice(0, -5))).sort();
    for (const n of nombres) {
      const k = n.slice(0, -5);
      if (k < primero || k > ultimo) continue;
      const mes = await leerMes(k);
      if (!mes) {
        c.sinDato.meses++;
        continue;
      }
      for (const s of Object.values(mes.sesiones)) {
        const dias = Object.entries(s.dias ?? {}).filter(([d]) => d >= desde && d <= hasta);
        if (!dias.length || (soloRol && s.rol !== soloRol)) continue;
        if (s.parser !== PARSER) {
          c.sinDato.parserViejo++;
          continue;
        }
        let mensajes = 0;
        const rol = c.roles[s.rol] ?? c.roles.lider;
        for (const [, d] of dias) {
          mensajes += d.mensajes;
          c.compactaciones += d.compactaciones;
          sumar(c.modelos, d.modelos);
          sumar(rol.modelos, d.modelos);
          contar(c.herramientas, d.usos.herramientas);
          contar(c.subagentes, d.usos.subagentes);
          contar(skills, d.usos.skills);
          contar(mcp, d.usos.mcp);
        }
        c.sesiones++;
        rol.sesiones++;
        c.sinDato.lineas += s.sinDato;
        if (s.arranque) {
          c.arranque.sesiones++;
          c.arranque.tokens += pesoArranque(s.arranque);
        } else c.sinDato.sinArranque++;
        const { k: porToken, calibrada } = calibrar(s);
        if (s.arranque && !calibrada) c.sinDato.sinCalibrar++;
        // Lo de esta sesión, ya junto: una skill con prefijo cuenta también en su plugin.
        const suyas = new Map<string, { clase: ClaseConsulta; nombre: string; chars: number; al: number; luego: number; ganchos: number }>();
        const mas = (clase: ClaseConsulta, nombre: string, chars: number, al: number, luego: number, ganchos = 0) => {
          const x = suyas.get(`${clase}\n${nombre}`);
          if (x) {
            x.chars += chars;
            x.al += al;
            x.luego += luego;
            x.ganchos += ganchos;
          } else suyas.set(`${clase}\n${nombre}`, { clase, nombre, chars, al, luego, ganchos });
        };
        for (const p of s.cargado) {
          const clase: ClaseConsulta = JUNTAR[p.clase] ?? "hook";
          // Lo que viajó en el primer pedido, y las veces que se cargó después.
          const al = p.inicial ? p.chars : 0;
          const luego = p.chars * Math.max(0, p.veces - (p.inicial ? 1 : 0));
          // Un plugin guardado es un hook suyo que inyectó texto: sus veces son las de sus hooks.
          mas(clase, p.nombre, p.chars, al, luego, p.clase === "plugin" ? p.veces : 0);
          const corte = p.clase === "skill" ? p.nombre.indexOf(":") : -1;
          if (corte > 0) mas("plugin", p.nombre.slice(0, corte), p.chars, al, luego);
        }
        for (const [clave, p] of suyas) {
          let x = piezas.get(clave);
          if (!x) piezas.set(clave, (x = { clase: p.clase, nombre: p.nombre, sesiones: 0, chars: 0, peso: 0, pesoPorTurnos: 0, despues: 0, ganchos: 0 }));
          x.sesiones++;
          x.chars += p.chars;
          x.peso += p.al / porToken;
          x.pesoPorTurnos += (p.al / porToken) * mensajes;
          x.despues += p.luego / porToken;
          x.ganchos += p.ganchos;
        }
      }
      await ceder();
    }
    // Lo que se usó sin estar en ningún listado también se dice.
    const usada = (clase: ClaseConsulta, nombre: string) => {
      if (!piezas.has(`${clase}\n${nombre}`)) piezas.set(`${clase}\n${nombre}`, { clase, nombre, sesiones: 0, chars: 0, peso: 0, pesoPorTurnos: 0, despues: 0, ganchos: 0 });
    };
    for (const nombre of Object.keys(skills)) usada("skill", nombre);
    for (const k of Object.keys(mcp)) {
      const servidor = servidorMcp(k);
      if (servidor) usada("mcp", servidor);
    }
    // Un plugin que no trae skills (sólo hooks) no tiene nada que "usar".
    const conSkills = new Set<string>();
    for (const p of piezas.values()) if (p.clase === "skill" && p.nombre.includes(":")) conSkills.add(p.nombre.slice(0, p.nombre.indexOf(":")));
    const propias = new Set(await readdir(path.join(claude, "skills")).catch(() => [] as string[]));
    const usosDe = (p: Junta): number | null => {
      if (p.clase === "skill") return skills[p.nombre] ?? 0;
      if (p.clase === "plugin") return conSkills.has(p.nombre) ? Object.entries(skills).reduce((n, [k, v]) => (k.startsWith(`${p.nombre}:`) ? n + v : n), 0) : null;
      if (p.clase === "mcp") return Object.entries(mcp).reduce((n, [k, v]) => (servidorMcp(k) === p.nombre ? n + v : n), 0);
      return null;
    };
    c.piezas = [...piezas.values()]
      .map((p) => ({
        clase: p.clase,
        nombre: p.nombre,
        sesiones: p.sesiones,
        chars: p.sesiones ? Math.round(p.chars / p.sesiones) : 0,
        peso: Math.round(p.peso),
        pesoPorTurnos: Math.round(p.pesoPorTurnos),
        despues: Math.round(p.despues),
        usos: usosDe(p),
        ganchos: p.ganchos,
        origen: p.clase !== "skill" ? null : p.nombre.indexOf(":") > 0 ? ("plugin" as const) : propias.has(p.nombre) ? ("usuario" as const) : null,
      }))
      .sort((a, b) => b.peso - a.peso || b.despues - a.despues || (a.nombre < b.nombre ? -1 : 1));
    return c;
  }

  return {
    /** Algo se movió (llegó una lista de workers): si hace más de una hora de la última, sale una pasada en un rato. */
    pedir(): void {
      if (corriendo || reloj || ahora() - ultima < (o.cadaMs ?? CADA_MS)) return;
      reloj = setTimeout(() => {
        reloj = null;
        void alDia().catch(silencio("historial"));
      }, o.esperaMs ?? ESPERA_MS);
      reloj.unref();
    },
    alDia,
    /** Lo que pasó entre dos días locales (`AAAA-MM-DD`, los dos adentro), de todos o sólo de un rol. Antes se pone al día. */
    consultar,
    /** Para Estadísticas (canal `historial:consultar`): los últimos 7 o 30 días con hoy. Lo que llega del renderer no se cree. */
    async ultimos(dias: unknown, rol: unknown): Promise<Consulta | { version: 1; error: string }> {
      const desde = new Date(ahora());
      desde.setDate(desde.getDate() - ((dias === 30 ? 30 : 7) - 1));
      try {
        return await consultar(diaDe(desde.getTime()), diaDe(ahora()), rol === "lider" || rol === "worker" || rol === "subagente" ? rol : undefined);
      } catch (e) {
        return { version: 1, error: e instanceof Error ? e.message : String(e) };
      }
    },
    cerrar(): void {
      if (reloj) clearTimeout(reloj);
      reloj = null;
    },
  };
}

const JUNTAR: Record<Clase, ClaseConsulta> = {
  sistema: "sistema",
  herramientas: "herramientas",
  skill: "skill",
  plugin: "plugin",
  hook: "hook",
  claudemd: "claudemd",
  mcp: "mcp",
  "mcp-herramientas": "mcp",
  "mcp-diferidas": "mcp",
  diferidas: "diferidas",
  agentes: "agentes",
  estilo: "estilo",
};
