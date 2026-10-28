// tablero — el único lugar de pendientes, esperas, ideas y hecho del dueño. Port a TypeScript de motor/bin/tablero (misma CLI,
// misma salida, mismo formato de items.jsonl y de vista.json).
//
// Un item JSON por línea en $TABLERO_DIR/items.jsonl (default ~/tablero, repo git propio). Sin daemon: lo escriben a la vez `pa`, Shark
// y el jefe, así que toda escritura va con lock + archivo temporal + rename atómico, y los que leen no toman el lock. Las vistas
// (ficha, proyectos, hoy, resumen) se generan en el momento desde git + el estado de `pa` + el tablero.
//
// Diferencia con el Python: el lock es el de base/lock.ts (socket abstracto / named pipe), no `flock` sobre `.lock`; mientras convivan
// los dos `tablero` (hasta el cambio de la etapa 11) no se excluyen entre sí.
// Entorno: TABLERO_DIR, TABLERO_VISTA, PA_STATE, PROYECTOS_REGISTRY, BARRENDERO_DIR, TRAMA_DUENO, TRAMA_PERFIL.
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { estadoPa, homeDe, registroProyectos, vistaTablero } from "../rutas.ts";
import { conReintentoSync } from "./base/archivo.ts";
import { esPrincipal } from "./base/principal.ts";
import { git } from "./base/git.ts";
import { tomar } from "./base/lock.ts";
import { vivo } from "./base/proc.ts";
import { jsonPy } from "./trama-estado.ts";
import { rutaReal } from "./proyecto-ruta.ts";
import { MARCA_DUENO } from "./tablero-ayuda.ts";
import { ErrorTipo, Salida, enteroPy, parsear, type Accion, type Io, type Parser } from "./tablero-args.ts";

type Env = Record<string, string | undefined>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = Record<string, any>;
type Entrada = Record<string, unknown> & { name: string };

export const COLUMNAS = ["bandeja", "sigue", "en-curso", "espera-dueno", "espera-externo", "ideas", "hecho", "tirado"];
const CERRADAS = ["hecho", "tirado"];
const AREAS = ["sistema", "casa", "personal", "producto"];
// `estado` del registry -> etapa. Sin dato o con un valor que no está acá: "?".
const ETAPAS: Record<string, string> = {
  activo: "activo", "a-suplantar": "activo", pausado: "pausado", pausa: "pausado", idea: "idea", "en preparacion": "idea", "en preparación": "idea", infra: "infra", retirado: "retirado",
};
// vista.json: sube cuando un campo cambia de significado o se va; sumar un campo no la toca.
const VISTA_VERSION = 1;
const VISTA_HECHO_MAX = 50; // cerrados recientes que lleva la vista
const TITULO_MAX = 120; // tope del título de una integrada sacado del RESULTADO
const TIPOS = ["pregunta", "prueba"];
const LETRAS = "abcdefghijklmnopqrstuvwxyz"; // ids de las opciones, en orden

// ------------------------------------------------------------------------------------------------ utilidades al estilo Python

const WS = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_WS = new RegExp(`[${WS}]+`, "g");
const RE_WS_BORDES = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");
/** `str.strip()` */
const strip = (s: string) => s.replace(RE_WS_BORDES, "");
/** `" ".join(s.split())` */
const unirEspacios = (s: string) => strip(s).replace(RE_WS, " ");
/** Verdad de Python (`bool(x)`). */
const verdad = (x: unknown) => !(x === null || x === undefined || x === false || x === 0 || x === "" || (Array.isArray(x) && x.length === 0) || (typeof x === "object" && x !== null && !Array.isArray(x) && Object.keys(x).length === 0));
/** `str(x)` */
function strPy(x: unknown): string {
  if (x === null || x === undefined) return "None";
  if (x === true) return "True";
  if (x === false) return "False";
  if (typeof x === "object") return jsonPy(x);
  return String(x);
}
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function recorte(txt: unknown, n: number): string {
  const t = unirEspacios(verdad(txt) ? String(txt) : "");
  const c = Array.from(t);
  return c.length <= n ? t : c.slice(0, n - 1).join("").replace(new RegExp(`[${WS}]+$`), "") + "…";
}

/** Como recorte, pero corta en un espacio: nunca deja una palabra por la mitad. */
function recortePalabra(txt: unknown, n: number): string {
  const t = unirEspacios(verdad(txt) ? String(txt) : "");
  const c = Array.from(t);
  if (c.length <= n) return t;
  let corte = c.slice(0, n);
  if (c[n] !== " " && corte.includes(" ")) corte = corte.slice(0, corte.lastIndexOf(" "));
  return corte.join("").replace(/[ ,;:]+$/, "") + "…";
}

// ---- fechas (hora local, como `datetime.now().astimezone()` y `date.today()`)

function isoLocal(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const s = off < 0 ? "-" : "+";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
const fechaLocal = (d: Date) => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoyStr = () => fechaLocal(new Date());

/** `datetime.fromisoformat(s)`: segundos desde la época y año-mes tal cual vienen escritos; null si no es una fecha ISO. */
function leerIso(s: unknown): { seg: number; ym: string; compacto: string } | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-?(\d\d)-?(\d\d)(?:[T ](\d\d)(?::?(\d\d))?(?::?(\d\d))?(?:[.,]\d+)?)?(Z|[+-]\d\d(?::?\d\d(?::?\d\d)?)?)?$/i.exec(strip(s) === s ? s : "\0");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi, se] = [m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || Number(h) > 23 || Number(mi) > 59 || Number(se) > 59) return null;
  const compacto = `${m[1]}${m[2]}${m[3]}-${pad(Number(h))}${pad(Number(mi))}${pad(Number(se))}`;
  let seg: number;
  if (m[7]) {
    const z = m[7].toUpperCase();
    let off = 0;
    if (z !== "Z") {
      const t = z.replace(/[:]/g, "");
      off = (z[0] === "-" ? -1 : 1) * (Number(t.slice(1, 3)) * 3600 + Number(t.slice(3, 5) || 0) * 60 + Number(t.slice(5, 7) || 0));
    }
    seg = Date.UTC(y, mo - 1, d, Number(h), Number(mi), Number(se)) / 1000 - off;
  } else seg = new Date(y, mo - 1, d, Number(h), Number(mi), Number(se)).getTime() / 1000;
  return { seg, ym: `${m[1]}-${m[2]}`, compacto };
}

function edadSeg(s: number): string {
  s = Math.max(0, Math.trunc(s));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function edad(iso: unknown): string {
  const f = leerIso(iso);
  return f ? edadSeg(Date.now() / 1000 - f.seg) : "?";
}

// ------------------------------------------------------------------------------------------------ registry

class Registro {
  private _proy: Entrada[] | null = null;
  private _rutas = new Map<unknown, string>();
  constructor(private ruta_: string, private home: string) {}

  get proyectos(): Entrada[] {
    if (this._proy === null) {
      try {
        const d = JSON.parse(readFileSync(this.ruta_, "utf8"));
        const lista = esObjeto(d) && Array.isArray(d.projects) ? d.projects : [];
        this._proy = lista.filter((p: unknown): p is Entrada => esObjeto(p) && verdad(p.name));
      } catch {
        this._proy = [];
      }
    }
    return this._proy;
  }

  /** Ruta real canónica, como proyecto-ruta: ~ expandido, archivo -> su carpeta, readlink -f. */
  ruta(p: Entrada): string {
    let r = this._rutas.get(p);
    if (r === undefined) {
      let x = verdad(p.path) ? String(p.path) : "";
      if (x === "~" || x.startsWith("~/")) x = this.home + x.slice(1);
      try {
        if (x && statSync(x).isFile()) x = path.dirname(x);
      } catch {
        /* no existe */
      }
      r = x ? (rutaReal(x) ?? realpathPy(x)) : "";
      this._rutas.set(p, r);
    }
    return r;
  }

  /** El slug de pa: basename de la ruta real en minúscula (carpeta de $PA_STATE y de pa/<slug>/*). */
  slug(p: Entrada): string {
    return path.basename(this.ruta(p)).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();
  }

  // Varios nombres con la MISMA carpeta son alias: el canónico es el primero.
  private canonico(p: Entrada): Entrada {
    const r = this.ruta(p);
    return this.proyectos.find((q) => this.ruta(q) === r) ?? p;
  }

  private static otrosNombres(p: Entrada): string[] {
    const v: unknown[] = [p.titulo];
    for (const k of ["alias", "aliases"]) {
      const x = p[k];
      v.push(...(Array.isArray(x) ? x : [x]));
    }
    return v.filter((a): a is string => typeof a === "string" && strip(a) !== "").map((a) => strip(a).toLowerCase());
  }

  /** -> [nombre canónico, entrada del registry o null, aviso o null]. */
  resolver(nombre: string | null | undefined): [string, Entrada | null, string | null] {
    const q = strip(nombre ?? "");
    if (!q) return ["", null, null];
    const ps = this.proyectos;
    const ql = q.toLowerCase();
    const conds: ((p: Entrada) => boolean)[] = [(p) => p.name === q, (p) => String(p.name).toLowerCase() === ql, (p) => this.slug(p) === ql, (p) => Registro.otrosNombres(p).includes(ql)];
    for (const cond of conds) {
      for (const p of ps) {
        if (cond(p)) {
          const c = this.canonico(p);
          return [c.name, c, null];
        }
      }
    }
    if (AREAS.includes(ql)) return [ql, null, null];
    const cands = ps.filter((p) => String(p.name).toLowerCase().includes(ql));
    const rutas = new Set(cands.map((p) => this.ruta(p)));
    if (rutas.size === 1) {
      const c = this.canonico(cands[0]!);
      return [c.name, c, null];
    }
    if (rutas.size > 1) return [q, null, `proyecto '${q}' es ambiguo (${cands.map((p) => p.name).join(", ")}); lo anoto tal cual`];
    return [q, null, `proyecto '${q}' no está en el registry ni es un área (${AREAS.join(", ")}); lo anoto igual`];
  }
}

/** `os.path.realpath` no estricto: resuelve lo que existe y deja el resto como está. */
function realpathPy(x: string): string {
  let abs = path.resolve(x);
  const cola: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(abs), ...cola.reverse());
    } catch {
      const padre = path.dirname(abs);
      if (padre === abs) return path.resolve(x);
      cola.push(path.basename(abs));
      abs = padre;
    }
  }
}

const etapa = (ent: Record<string, unknown>) => ETAPAS[strip(strPyVacio(ent.estado)).toLowerCase()] ?? "?";
const strPyVacio = (x: unknown) => (verdad(x) ? String(x) : "");

// ------------------------------------------------------------------------------------------------ items

const abierto = (it: Item) => !CERRADAS.includes(it.columna);
const pospuesto = (it: Item, hoy = hoyStr()) => verdad(it.hasta) && String(it.hasta) > hoy;
const visible = (it: Item, hoy = hoyStr()) => abierto(it) && !pospuesto(it, hoy);
const idNum = (it: Item) => (typeof it.id === "number" ? it.id : verdad(it.id) ? Number(it.id) : 0);

function ponerColumna(it: Item, col: string, ts: string) {
  it.columna = col;
  if (CERRADAS.includes(col)) it.cerrado = verdad(it.cerrado) ? it.cerrado : ts;
  else it.cerrado = null;
}

/** El item de esa clave: el abierto si hay; si no, el último cerrado (para reabrirlo). */
function porClave(items: Item[], clave: string): Item | null {
  let hallado: Item | null = null;
  for (const it of items) {
    if (it.clave === clave) {
      if (abierto(it)) return it;
      hallado = it;
    }
  }
  return hallado;
}

const linea = (it: Item) => [strPy(it.id), strPy(it.columna), verdad(it.proyecto) ? it.proyecto : "-", verdad(it.titulo) ? it.titulo : "", `(${edad(it.creado)})`].join("  ");

function ordenColumna(a: Item, b: Item): number {
  const ia = COLUMNAS.indexOf(a.columna);
  const ib = COLUMNAS.indexOf(b.columna);
  const ka = ia >= 0 ? ia : COLUMNAS.length;
  const kb = ib >= 0 ? ib : COLUMNAS.length;
  return ka - kb || idNum(a) - idNum(b);
}

/** proyecto -> su item `sigue` (el de clave sigue:<proyecto>, uno solo por proyecto). */
function sigueDe(items: Item[]): Map<unknown, Item> {
  const m = new Map<unknown, Item>();
  for (const it of items) if (abierto(it) && String(verdad(it.clave) ? it.clave : "").startsWith("sigue:")) m.set(it.proyecto, it);
  return m;
}

// ---- pregunta o prueba

function tipoDe(it: Item): string {
  return TIPOS.includes(it.tipo) ? it.tipo : verdad(it.prueba) ? "prueba" : "pregunta";
}
/** El item como sale en JSON (--json y vista.json): con `tipo` siempre. Al archivo no se escribe. */
const publico = (it: Item): Item => ({ ...it, tipo: tipoDe(it) });

function idOpcion(opciones: unknown, txt: unknown): string | null {
  const t = strip(String(txt)).toLowerCase();
  const ids = (Array.isArray(opciones) ? opciones : []).filter(esObjeto).map((o) => o.id as string);
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= ids.length ? ids[n - 1]! : null;
  }
  return ids.includes(t) ? t : null;
}

function textoRespuesta(r: unknown): string {
  if (!esObjeto(r)) return strPy(r);
  const p: string[] = [];
  if ("anda" in r) p.push(verdad(r.anda) ? "anda" : "no anda");
  if (verdad(r.opcion)) p.push(`${strPy(r.opcion)}) ${verdad(r.opcion_texto) ? r.opcion_texto : ""}`.replace(new RegExp(`[${WS}]+$`), ""));
  if (verdad(r.texto)) p.push(String(r.texto));
  return p.join(" · ") + (verdad(r.fecha) ? `  (${strPy(r.fecha)})` : "");
}

function fechaArgDe(t: string): string | null | undefined {
  // AAAA-MM-DD (o AAAAMMDD) válida -> normalizada; si no, undefined
  const m = /^(\d{4})-?(\d\d)-?(\d\d)$/.exec(t);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1 || f.getUTCFullYear() !== y || f.getUTCMonth() !== mo - 1 || f.getUTCDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ------------------------------------------------------------------------------------------------ el tablero

type Tx = { items: Item[]; cambio: boolean };

class Tablero {
  home: string;
  dir: string;
  items: string;
  seq: string;
  archivo: string;
  vista: string;
  paState: string;
  registry: string;
  private _dueno: string | null = null;
  private _legadas: Set<string> | null = null;

  constructor(readonly env: Env, readonly io: Io, private leerStdin: () => string = () => readFileSync(0, "utf8")) {
    this.home = homeDe(env);
    this.dir = env.TABLERO_DIR || path.join(this.home, "tablero");
    this.items = path.join(this.dir, "items.jsonl");
    this.seq = path.join(this.dir, "seq");
    this.archivo = path.join(this.dir, "hecho");
    this.vista = vistaTablero(env, this.home);
    this.paState = estadoPa(env, this.home);
    this.registry = registroProyectos(env, this.home);
  }

  aviso = (msg: string) => this.io.err(`tablero: ${msg}\n`);
  morir(msg: string, rc = 1): never {
    this.aviso(msg);
    throw new Salida(rc);
  }
  print = (s: string) => this.io.out(s + "\n");
  salidaJson = (d: unknown) => this.print(JSON.stringify(d, null, 1));
  registro = () => new Registro(this.registry, this.home);

  /** Nombre del dueño: TRAMA_DUENO -> `dueno` de perfil.json -> $USER con mayúscula inicial -> "el usuario". */
  get dueno(): string {
    if (this._dueno === null) {
      let n = strip(this.env.TRAMA_DUENO ?? "");
      if (!n) {
        const perfil = this.env.TRAMA_PERFIL || path.join(this.env.XDG_CONFIG_HOME || path.join(this.home, ".config"), "trama", "perfil.json");
        try {
          const j = JSON.parse(readFileSync(perfil, "utf8"));
          n = strip(esObjeto(j) && verdad(j.dueno) ? String(j.dueno) : "");
        } catch {
          n = "";
        }
      }
      if (!n) {
        const u = strip(this.env.USER ?? "");
        n = u.slice(0, 1).toUpperCase() + u.slice(1);
      }
      this._dueno = n || "el usuario";
    }
    return this._dueno;
  }
  /** Texto con {D} = nombre del dueño; "a el usuario" y "de el usuario" quedan como "al" y "del". */
  D = (t: string) => t.replaceAll("{D}", this.dueno).replaceAll(" a el usuario", " al usuario").replaceAll(" de el usuario", " del usuario");
  /** La ayuda copiada del Python trae «ZZZZZ» donde va el dueño. */
  ayuda = (t: string) => this.D(t.replaceAll(MARCA_DUENO, "{D}"));

  /** Nombres viejos de la columna del dueño (`espera-<su nombre>`): se leen como espera-dueno. */
  private get legadas(): Set<string> {
    if (this._legadas === null) {
      const s = new Set<string>();
      for (const n of [this.dueno, this.env.USER ?? ""]) if (n) s.add("espera-" + n.toLowerCase());
      s.delete("espera-el usuario");
      this._legadas = s;
    }
    return this._legadas;
  }
  colCanon = (c: string) => (this.legadas.has(c) ? "espera-dueno" : c);
  colArg = (s: string) => this.colCanon(strip(s));

  // ---- fechas con error de uso

  /** AAAA-MM-DD, hoy, mañana, +3d, +2s (semanas). `ya` la borra (devuelve null). */
  fechaArg(txt: string): string | null {
    const t = strip(txt).toLowerCase();
    if (["", "ya", "nunca", "-"].includes(t)) return null;
    if (t === "hoy") return hoyStr();
    const sumar = (dias: number) => {
      const d = new Date();
      d.setDate(d.getDate() + dias);
      return fechaLocal(d);
    };
    if (t === "mañana" || t === "manana") return sumar(1);
    if (t.length > 2 && t[0] === "+" && "ds".includes(t[t.length - 1]!) && /^\d+$/.test(t.slice(1, -1))) return sumar(Number(t.slice(1, -1)) * (t.endsWith("s") ? 7 : 1));
    const f = fechaArgDe(t);
    if (f) return f;
    return this.morir(`fecha inválida: '${txt}' (AAAA-MM-DD, hoy, mañana, +3d, +2s)`, 2);
  }

  /** El texto de --detalle-archivo / --prueba-archivo / --sumar-archivo (`-` = stdin). */
  leerTexto(ruta: string, que: string): string {
    try {
      const bytes = ruta === "-" ? Buffer.from(this.leerStdin(), "utf8") : readFileSync(ruta);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\n+|\n+$/g, "");
    } catch (e) {
      return this.morir(`${que}: no pude leer ${ruta}: ${e instanceof Error ? e.message : e}`, 2);
    }
  }
  /** --<campo> o --<campo>-archivo (uno solo de los dos); null si no vino ninguno. */
  textoOArchivo(a: Item, campo: string): string | null {
    const directo = a[campo] ?? null;
    const archivo = a[campo + "_archivo"] ?? null;
    if (directo !== null && archivo !== null) this.morir(`${a.cmd}: --${campo} y --${campo}-archivo no van juntos`, 2);
    return archivo !== null ? this.leerTexto(archivo, `--${campo}-archivo`) : directo;
  }

  canon(reg: Registro, nombre: string): string {
    const [c, , av] = reg.resolver(nombre);
    if (av) this.aviso(av);
    return c;
  }

  // ---- leer y escribir

  leerJsonl(ruta: string, estricto = false): Item[] {
    const items: Item[] = [];
    let texto: string;
    try {
      texto = readFileSync(ruta, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return items;
      throw e;
    }
    texto.split(/\r\n|\r|\n/).forEach((crudo, k) => {
      const l = strip(crudo);
      if (!l) return;
      let it: unknown;
      try {
        it = JSON.parse(l);
        if (!esObjeto(it)) throw new Error("no es un objeto");
        if (typeof it.columna === "string") it.columna = this.colCanon(it.columna);
      } catch {
        // Reescribir sin esa línea la perdería para siempre: el que escribe se niega.
        if (estricto) this.morir(`${ruta}:${k + 1}: línea que no es un item JSON; no escribo para no perderla`);
        this.aviso(`${ruta}:${k + 1}: línea que no es un item JSON, la salteo`);
        return;
      }
      items.push(it as Item);
    });
    return items;
  }
  leerItems = (estricto = false) => this.leerJsonl(this.items, estricto);

  leerArchivo(mes?: string): Item[] {
    let nombres: string[];
    try {
      nombres = readdirSync(this.archivo).filter((x) => x.endsWith(".jsonl")).sort();
    } catch {
      return [];
    }
    const items: Item[] = [];
    for (const x of nombres) if (mes === undefined || x === `${mes}.jsonl`) items.push(...this.leerJsonl(path.join(this.archivo, x)));
    return items;
  }

  escribirAtomico(ruta: string, texto: string, fsync = true) {
    const tmp = `${ruta}.${process.pid}.tmp`;
    try {
      const fd = openSync(tmp, "w");
      try {
        writeSync(fd, texto);
        if (fsync) fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      conReintentoSync(() => renameSync(tmp, ruta));
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }

  /** Primera escritura: ~/tablero es un repo git propio. Se llama con el lock tomado. */
  private async prepararRepo() {
    if (existsSync(path.join(this.dir, ".git")) && statSync(path.join(this.dir, ".git")).isDirectory()) return;
    const gi = path.join(this.dir, ".gitignore");
    if (!existsSync(gi)) this.escribirAtomico(gi, ".lock\n*.tmp\nvista.json\n", false);
    await git(["init", "-q", this.dir], { env: this.env, timeoutMs: 20_000 }).catch(() => {});
  }

  /** Lock exclusivo, items leídos adentro del lock y, si hubo cambio, items + vista reescritos. */
  async escritura<T>(f: (tx: Tx) => T | Promise<T>): Promise<T> {
    mkdirSync(this.archivo, { recursive: true });
    const archivoLock = path.join(this.dir, ".lock");
    closeSync(openSync(archivoLock, "a"));
    const lock = await tomar(archivoLock, { esperarMs: Infinity });
    try {
      await this.prepararRepo();
      const tx: Tx = { items: this.leerItems(true), cambio: false };
      const r = await f(tx);
      if (tx.cambio) {
        this.escribirAtomico(this.items, tx.items.map((it) => jsonPy(it) + "\n").join(""));
        this.escribirVista(tx.items);
      }
      return r;
    } finally {
      await lock?.liberar();
    }
  }

  /** Número incremental que no se reusa: `seq` sobrevive a que `archivar` saque los ids altos. */
  nuevoId(items: Item[]): number {
    let n = 0;
    try {
      const v = enteroPy(strip(readFileSync(this.seq, "utf8")) || "0");
      if (v !== null) n = v;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        // sin seq (borrado a mano): que tampoco se reuse un id que ya está archivado
        for (const it of this.leerArchivo()) if (Number.isInteger(it.id)) n = Math.max(n, it.id);
      }
    }
    n = Math.max(n, ...items.filter((it) => Number.isInteger(it.id)).map((it) => it.id as number)) + 1;
    this.escribirAtomico(this.seq, `${n}\n`);
    return n;
  }

  buscar(items: Item[], i: number): Item {
    return items.find((it) => it.id === i) ?? this.morir(`no hay item ${i}`);
  }

  // ---- pregunta o prueba: opciones, respuesta

  private armarOpciones(textos: string[], cmd: string) {
    if (textos.length > LETRAS.length) this.morir(`${cmd}: demasiadas opciones (${textos.length}; hasta ${LETRAS.length})`, 2);
    const ops = textos.map((t, i) => ({ id: LETRAS[i]!, texto: unirEspacios(t) }));
    if (ops.some((o) => !o.texto)) this.morir(`${cmd}: una --opcion está vacía`, 2);
    return ops;
  }

  /** --tipo, --simple, --contexto, --opcion y --defecto sobre un item. Sólo toca lo que vino; valida antes de cambiar nada. */
  poner_pregunta(it: Item, a: Item) {
    let opciones: { id: string; texto: string }[] | null = a.opcion !== null && a.opcion !== undefined ? this.armarOpciones(a.opcion, a.cmd) : null;
    if (a.sin_opciones) {
      if (opciones || (a.defecto ?? null) !== null) this.morir(`${a.cmd}: --sin-opciones no va con --opcion ni con --defecto`, 2);
      opciones = [];
    }
    let defecto: string | null = null;
    if ((a.defecto ?? null) !== null) {
      const finales = opciones === null ? it.opciones : opciones;
      defecto = idOpcion(finales, a.defecto);
      if (defecto === null) {
        const hay = (Array.isArray(finales) ? finales : []).map((o: Item) => o.id).join(", ") || "ninguna";
        this.morir(`${a.cmd}: --defecto '${a.defecto}' no es una de las opciones (${hay})`, 2);
      }
    }
    if ((a.tipo ?? null) !== null) it.tipo = a.tipo;
    for (const [k, v0] of [["titulo_simple", a.simple], ["contexto", a.contexto]] as const) {
      if (v0 === null || v0 === undefined) continue;
      const v = k === "titulo_simple" ? unirEspacios(v0) : strip(v0);
      if (v) it[k] = v;
      else delete it[k];
    }
    if (opciones !== null) {
      // Reemplazo entero: los ids se reparten de nuevo, así que el por_defecto de antes ya no apunta a lo mismo y se va.
      delete it.por_defecto;
      if (opciones.length) it.opciones = opciones;
      else delete it.opciones;
    }
    if (defecto !== null) it.por_defecto = defecto;
  }

  // ---- git y estado de pa (sólo lectura)

  /** pedidos: {clave: [ruta, args]}. Lanza todos juntos; -> {clave: stdout o null si falló}. */
  async gitVarios<K>(pedidos: Map<K, [string, string[]]>): Promise<Map<K, string | null>> {
    // GIT_OPTIONAL_LOCKS=0: `git status` no refresca el índice ni deja index.lock en un repo donde puede haber un worker commiteando.
    const env = { ...this.env, GIT_OPTIONAL_LOCKS: "0" };
    const claves = [...pedidos.keys()];
    const res = await Promise.all(claves.map((k) => git(["-C", pedidos.get(k)![0], ...pedidos.get(k)![1]], { env, timeoutMs: 15_000 })));
    return new Map(claves.map((k, i) => [k, res[i]!.codigo === 0 && !res[i]!.error ? res[i]!.salida : null]));
  }
  /** Como gitVarios pero de a tandas: para recorrer los 64 repos sin lanzar 64 git juntos. */
  async gitMuchos<K>(pedidos: Map<K, [string, string[]]>): Promise<Map<K, string | null>> {
    const out = new Map<K, string | null>();
    const claves = [...pedidos.keys()];
    for (let i = 0; i < claves.length; i += 16) {
      const tanda = new Map(claves.slice(i, i + 16).map((k) => [k, pedidos.get(k)!] as [K, [string, string[]]]));
      for (const [k, v] of await this.gitVarios(tanda)) out.set(k, v);
    }
    return out;
  }

  leerHilo(ruta: string): Record<string, string> {
    const d: Record<string, string> = {};
    try {
      for (const l of readFileSync(ruta, "utf8").split(/\r\n|\r|\n/)) {
        const i = l.indexOf("=");
        if (i >= 0) d[l.slice(0, i)] = l.slice(i + 1);
      }
    } catch {
      /* sin hilo */
    }
    return d;
  }

  /** id -> última fila de integradas.tsv (la última fila de un id manda). */
  leerIntegradas(): Map<string, string[]> {
    const ult = new Map<string, string[]>();
    try {
      for (const l of readFileSync(path.join(this.paState, "integradas.tsv"), "utf8").split(/\r\n|\r|\n/)) {
        const c = l.split("\t");
        if (c.length >= 10 && c[0] !== "fecha") ult.set(c[1]!, c);
      }
    } catch {
      /* sin integradas */
    }
    return ult;
  }

  private pidVivoArchivo(ruta: string): boolean {
    try {
      const n = enteroPy(strip(readFileSync(ruta, "utf8")));
      return n !== null && vivo(n);
    } catch {
      return false;
    }
  }

  /** La corrida `cid` de `slug` sigue viva: su `<id>.pid` (sólo --async lo escribe) o un `.running` con ese id y un pid vivo. */
  corridaViva(slug: string, cid: string): boolean {
    if (this.pidVivoArchivo(path.join(this.paState, slug, cid + ".pid"))) return true;
    let nombres: string[] = [];
    try {
      nombres = readdirSync(this.paState);
    } catch {
      return false;
    }
    const esDeSlug = (n: string) => n === `${slug}.running` || (n.startsWith(`${slug}@`) && n.endsWith(".running")) || (n.startsWith(`${slug}.leer-`) && n.endsWith(".running"));
    for (const n of nombres.filter(esDeSlug)) {
      const campos: Record<string, string> = {};
      try {
        for (const l of readFileSync(path.join(this.paState, n), "utf8").split(/\r\n|\r|\n/)) {
          const i = l.indexOf("=");
          const k = i >= 0 ? l.slice(0, i) : l;
          if (!(k in campos)) campos[k] = i >= 0 ? l.slice(i + 1) : "";
        }
      } catch {
        continue;
      }
      if (campos.id !== cid) continue;
      const pid = enteroPy(campos.pid || campos.pa_pid || "");
      if (pid !== null && vivo(pid)) return true;
    }
    return false;
  }

  /** Primera oración del RESULTADO de una corrida (`.result` de su JSON), o "" si no hay. */
  primeraOracionResultado(rutaJson: string): string {
    let res: unknown;
    try {
      if (statSync(rutaJson).size > 8 << 20) return "";
      const j = JSON.parse(readFileSync(rutaJson, "utf8"));
      if (!esObjeto(j)) return "";
      res = j.result;
    } catch {
      return "";
    }
    if (typeof res !== "string") return "";
    let ini: number | null = null;
    for (const m of res.matchAll(ENCABEZADO)) if (m[1] === "RESULTADO") ini = m.index + m[0].length; // el último manda, como en `campo_de` de pa
    if (ini === null) return "";
    let t = res.slice(ini);
    let m = ENCABEZADO_UNO.exec(t);
    if (m) t = t.slice(0, m.index);
    m = OTRO_CAMPO.exec(t); // todo en una línea: "RESULTADO: listo. ARCHIVOS: ninguno."
    if (m) t = t.slice(0, m.index);
    t = unirEspacios(t.replaceAll("**", ""));
    m = FIN_ORACION.exec(t);
    if (m) t = t.slice(0, m.index + m[0].length);
    return recortePalabra(t, TITULO_MAX);
  }

  /** Qué se integró, en una oración: el RESULTADO de la última corrida de esa rama anterior a la integración. "" si ninguna lo tiene. */
  tituloIntegrada(slug: string, cid: string, fechaIso: string): string {
    const d = path.join(this.paState, slug);
    const tope = leerIso(fechaIso)?.compacto ?? "9";
    const ids = [cid];
    try {
      // los ids ordenan por fecha: sólo hace falta abrir los .hilo de después de la dueña
      for (const x of readdirSync(d).sort()) {
        if (x.endsWith(".hilo") && cid < x.slice(0, -5) && x.slice(0, 15) <= tope && this.leerHilo(path.join(d, x)).origen === cid) ids.push(x.slice(0, -5));
      }
    } catch {
      /* sin carpeta */
    }
    for (const i of ids.reverse()) {
      const t = this.primeraOracionResultado(path.join(d, i + ".json"));
      if (t) return t;
    }
    return "";
  }

  /** Últimas n corridas de pa del proyecto: fecha, tarea y en qué terminó. */
  corridas(slug: string, n = 3) {
    const d = path.join(this.paState, slug);
    let nombres: string[];
    try {
      nombres = readdirSync(d).filter((x) => x.endsWith(".hilo")).sort().reverse().slice(0, n);
    } catch {
      return [];
    }
    const integ = nombres.length ? this.leerIntegradas() : new Map<string, string[]>();
    return nombres.map((x) => {
      const cid = x.slice(0, -5);
      const h = this.leerHilo(path.join(d, x));
      const fila = integ.get(cid);
      let res: string;
      if (fila) res = fila[9]!;
      else if (!("decision_nada" in h)) res = this.corridaViva(slug, cid) ? "en curso" : "sin resultado";
      else if (h.decision_nada === "0") res = "espera decisión" + (h.decision ? `: ${recorte(h.decision, 80)}` : "");
      else if (h.leer === "1") res = "consulta";
      else res = h.rama ? "sin integrar" : "ok";
      const f = /^\d{8}/.test(cid) ? `${cid.slice(0, 4)}-${cid.slice(4, 6)}-${cid.slice(6, 8)}` : "?";
      return { id: cid, fecha: f, tarea: recorte(h.tarea ?? "", 70), resultado: res };
    });
  }

  /** Ramas pa/* de un repo leyendo sus refs del disco, sin lanzar git. */
  ramasPaEnDisco(ruta: string): string[] {
    let g = path.join(ruta, ".git");
    try {
      if (statSync(g).isFile()) {
        // worktree o submódulo: `gitdir: <ruta>` y, adentro, `commondir`
        g = path.resolve(ruta, strip(readFileSync(g, "utf8").split("gitdir:")[1] ?? "\0"));
        try {
          g = path.resolve(g, strip(readFileSync(path.join(g, "commondir"), "utf8")));
        } catch {
          /* sin commondir */
        }
      } else if (!statSync(g).isDirectory()) return [];
    } catch {
      return [];
    }
    const heads = path.join(g, "refs", "heads");
    const nombres = new Set<string>();
    const caminar = (d: string) => {
      let ents;
      try {
        ents = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) caminar(p);
        else if (!e.name.endsWith(".lock")) nombres.add(path.relative(heads, p).split(path.sep).join("/"));
      }
    };
    caminar(path.join(heads, "pa"));
    const pk = path.join(g, "packed-refs");
    try {
      if (statSync(pk).size < 4 << 20) {
        for (const l of readFileSync(pk, "utf8").split(/\r\n|\r|\n/)) if (l.includes(" refs/heads/pa/")) nombres.add(strip(l.slice(l.indexOf(" ") + 1)).slice("refs/heads/".length));
      }
    } catch {
      /* sin packed-refs */
    }
    return [...nombres].sort();
  }

  /** pa/<slug>/<id> con su worker vivo: todavía no es una rama que espere integración. */
  ramaEnCurso(rama: string): boolean {
    const p = rama.split("/");
    return p.length === 3 && this.corridaViva(p[1]!, p[2]!);
  }

  /** Ramas pa/* sin mergear de todos los proyectos. Git sólo en los repos que tienen alguna. */
  async ramasSinIntegrar(reg: Registro): Promise<string[]> {
    const pedidos = new Map<string, [string, string[]]>();
    for (const p of reg.proyectos) {
      const r = reg.ruta(p);
      if (r && !pedidos.has(r) && this.ramasPaEnDisco(r).length) pedidos.set(r, [r, ["branch", "--no-merged", "HEAD", "--list", "pa/*", "--format=%(refname:short)"]]);
    }
    const ramas: string[] = [];
    for (const o of (await this.gitVarios(pedidos)).values()) ramas.push(...strip(o ?? "").split(RE_WS).filter((x) => x && !this.ramaEnCurso(x)));
    return ramas.sort();
  }

  // ---- vista.json

  /** Los proyectos retirados del registry, sin git: nombre, descripción, abiertos y su sigue. */
  filasRetirados(reg: Registro, items: Item[], sg: Map<unknown, Item>, hoy: string) {
    const abiertos = new Map<string, number>();
    for (const it of items) if (visible(it, hoy)) abiertos.set(it.proyecto || "", (abiertos.get(it.proyecto || "") ?? 0) + 1);
    const filas: { proyecto: string; etapa: string; dias: null; abiertos: number; sigue: unknown; desc: string }[] = [];
    const rutas = new Set<string>();
    for (const p of reg.proyectos) {
      const r = reg.ruta(p);
      if (etapa(p) !== "retirado" || rutas.has(r)) continue;
      rutas.add(r);
      filas.push({ proyecto: p.name, etapa: "retirado", dias: null, abiertos: abiertos.get(p.name) ?? 0, sigue: sg.get(p.name)?.titulo ?? null, desc: verdad(p.desc) ? String(p.desc) : "" });
    }
    return filas;
  }

  /** Lo de `datos_hoy` que no necesita git: integradas y cerrados. */
  private datosHoyBase(items: Item[], fecha: string, conArchivo: boolean) {
    const integradas: Item[] = [];
    for (const [cid, c] of this.leerIntegradas()) {
      if (c[9] === "integrada" && c[0]!.slice(0, 10) === fecha) {
        const h = this.leerHilo(path.join(this.paState, c[2]!, cid + ".hilo"));
        integradas.push({ id: cid, proyecto: c[2], hora: c[0]!.slice(11, 16), titulo: this.tituloIntegrada(c[2]!, cid, c[0]!) || recorte(h.tarea ?? "", 80), commits: /^\d+$/.test(c[7]!) ? Number(c[7]) : 0 });
      }
    }
    integradas.sort((x, y) => (x.hora < y.hora ? -1 : x.hora > y.hora ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const vistos = new Set<unknown>();
    const cerrados: Item[] = [];
    for (const it of [...items, ...(conArchivo ? this.leerArchivo(fecha.slice(0, 7)) : [])]) {
      if (strPy(verdad(it.cerrado) ? it.cerrado : "").slice(0, 10) === fecha && !vistos.has(it.id)) {
        vistos.add(it.id);
        cerrados.push(it);
      }
    }
    return { fecha, integradas, cerrados: cerrados.map(publico) } as { fecha: string; integradas: Item[]; cerrados: Item[]; commits?: Record<string, number> };
  }

  async datosHoy(reg: Registro, items: Item[], fecha: string) {
    const d = this.datosHoyBase(items, fecha, true);
    const pedidos = new Map<string, [string, string[]]>();
    const rutas = new Set<string>();
    for (const p of reg.proyectos) {
      const r = reg.ruta(p);
      if (r && !rutas.has(r) && statSyncDir(r)) {
        rutas.add(r);
        // `-- .`: un proyecto que es una subcarpeta de un repo cuenta sólo lo suyo
        pedidos.set(p.name, [r, ["rev-list", "--count", `--since=${fecha} 00:00:00`, `--until=${fecha} 23:59:59`, "HEAD", "--", "."]]);
      }
    }
    d.commits = {};
    for (const [k, v] of await this.gitMuchos(pedidos)) if (v && /^\d+$/.test(strip(v)) && Number(strip(v)) > 0) d.commits[k] = Number(strip(v));
    return d as typeof d & { commits: Record<string, number> };
  }

  /** Lo que leen el QML de Shark y Trama. Se regenera en cada escritura, con el lock tomado. */
  escribirVista(items: Item[]) {
    const hoy = hoyStr();
    const columnas: Record<string, Item[]> = {};
    for (const c of COLUMNAS) if (!CERRADAS.includes(c)) columnas[c] = [];
    const posp: Item[] = [];
    for (const it of [...items].sort(ordenColumna)) {
      if (!abierto(it)) continue;
      if (pospuesto(it, hoy)) posp.push(publico(it));
      else if (it.columna in columnas) columnas[it.columna]!.push(publico(it));
    }
    const h = this.datosHoyBase(items, hoy, false);
    const cont: Record<string, number> = {};
    for (const [c, v] of Object.entries(columnas)) cont[c] = v.length;
    cont.abiertos = Object.values(columnas).reduce((s, v) => s + v.length, 0);
    cont.pospuestos = posp.length;
    cont.cerrados_hoy = h.cerrados.length;
    cont.integradas_hoy = h.integradas.length;
    const hecho = items.filter((it) => it.columna === "hecho").sort((x, y) => (String(verdad(y.cerrado) ? y.cerrado : "") < String(verdad(x.cerrado) ? x.cerrado : "") ? -1 : String(verdad(y.cerrado) ? y.cerrado : "") > String(verdad(x.cerrado) ? x.cerrado : "") ? 1 : idNum(y) - idNum(x)));
    const sg = sigueDe(items);
    const retirados = this.filasRetirados(this.registro(), items, sg, hoy).map((f) => ({ proyecto: f.proyecto, desc: f.desc, abiertos: f.abiertos, sigue: f.sigue }));
    const sigue: Record<string, unknown> = {};
    for (const [p, it] of sg) sigue[strPy(p) === "None" ? "null" : String(p)] = { id: it.id ?? null, titulo: it.titulo ?? null, head: it.head ?? null, tocado: it.tocado ?? null };
    const v = {
      version: VISTA_VERSION,
      generado: isoLocal(),
      contadores: cont,
      columnas,
      sigue,
      hoy: h,
      // lo de acá abajo se sumó después (version 1): no está en `columnas` ni en `contadores`
      pospuestos: posp.sort((x, y) => (String(x.hasta) < String(y.hasta) ? -1 : String(x.hasta) > String(y.hasta) ? 1 : idNum(x) - idNum(y))),
      hecho: hecho.slice(0, VISTA_HECHO_MAX).map(publico),
      retirados,
    };
    try {
      mkdirSync(path.dirname(this.vista), { recursive: true });
      this.escribirAtomico(this.vista, jsonPy(v), false);
    } catch (e) {
      this.aviso(`no pude escribir la vista ${this.vista}: ${(e as NodeJS.ErrnoException).message}`);
    }
  }

  // ------------------------------------------------------------------------------------------ comandos que escriben

  async cmdInit() {
    await this.escritura((tx) => void (tx.cambio = true));
    this.print(this.dir);
  }

  async cmdAgregar(a: Item) {
    const titulo = strip(a.titulo);
    if (!titulo) this.morir("agregar: el título está vacío", 2);
    const proy = a.proyecto !== null ? this.canon(this.registro(), a.proyecto) : null;
    const hasta = a.hasta !== null ? this.fechaArg(a.hasta) : null;
    a.detalle = this.textoOArchivo(a, "detalle");
    a.prueba = this.textoOArchivo(a, "prueba");
    const it = await this.escritura((tx) => {
      const ts = isoLocal();
      let it = verdad(a.clave) ? porClave(tx.items, a.clave) : null;
      if (it === null) {
        this.poner_pregunta({}, a); // valida antes de gastar un id
        it = { id: this.nuevoId(tx.items), columna: null, proyecto: proy || "", titulo, detalle: a.detalle || "", prueba: a.prueba || "", origen: a.origen || "", clave: a.clave || "", head: null, creado: ts, tocado: ts, cerrado: null, hasta };
        ponerColumna(it, a.columna || "bandeja", ts);
        this.poner_pregunta(it, a);
        tx.items.push(it);
      } else {
        this.poner_pregunta(it, a);
        // Clave que ya está: se actualiza, no se duplica. Si estaba cerrada vuelve a abrirse y la edad arranca de nuevo.
        if (!abierto(it)) {
          it.cerrado = null;
          it.creado = ts;
          ponerColumna(it, a.columna || "bandeja", ts);
        } else if (a.columna) ponerColumna(it, a.columna, ts);
        it.titulo = titulo;
        for (const k of ["detalle", "prueba", "origen"]) if (a[k] !== null && a[k] !== undefined) it[k] = a[k];
        if (proy !== null) it.proyecto = proy;
        if (a.hasta !== null) it.hasta = hasta;
        it.tocado = ts;
      }
      tx.cambio = true;
      return it;
    });
    this.print(String(it.id));
  }

  async cmdMover(a: Item) {
    if (a.columna === null && a.proyecto === null && a.hasta === null) this.morir("mover: pasá --columna, --proyecto o --hasta", 2);
    const proy = a.proyecto !== null ? this.canon(this.registro(), a.proyecto) : null;
    const hasta = a.hasta !== null ? this.fechaArg(a.hasta) : null;
    const it = await this.escritura((tx) => {
      const it = this.buscar(tx.items, a.id);
      const ts = isoLocal();
      if (a.columna) ponerColumna(it, a.columna, ts);
      if (proy !== null) it.proyecto = proy;
      if (a.hasta !== null) it.hasta = hasta;
      it.tocado = ts;
      tx.cambio = true;
      return it;
    });
    this.print(linea(it));
  }

  async cmdPosponer(a: Item) {
    const hasta = this.fechaArg(a.fecha);
    const objetivos = await this.escritura((tx) => {
      const objetivos = (a.ids as number[]).map((i) => this.buscar(tx.items, i));
      const ts = isoLocal();
      for (const it of objetivos) {
        if (!abierto(it)) this.morir(`posponer: el item ${strPy(it.id)} está cerrado (${strPy(it.columna)})`);
        it.hasta = hasta;
        it.tocado = ts;
        tx.cambio = true;
      }
      return objetivos;
    });
    const hoy = hoyStr();
    for (const it of objetivos) this.print(linea(it) + (pospuesto(it, hoy) ? `  hasta ${it.hasta}` : ""));
  }

  async cmdEditar(a: Item) {
    a.detalle = this.textoOArchivo(a, "detalle");
    a.prueba = this.textoOArchivo(a, "prueba");
    a.sumar = this.textoOArchivo(a, "sumar");
    if ([a.titulo, a.detalle, a.prueba, a.sumar, a.tipo, a.simple, a.contexto, a.opcion, a.defecto].every((x) => x === null || x === undefined) && !a.sin_opciones) {
      this.morir("editar: pasá --titulo, --detalle, --prueba, --sumar (o su -archivo), --tipo, --simple, --contexto, --opcion, --defecto o --sin-opciones", 2);
    }
    if (a.titulo !== null && !strip(a.titulo)) this.morir("editar: el título está vacío", 2);
    if (a.sumar !== null && !strip(a.sumar)) this.morir("editar: --sumar está vacío", 2);
    const it = await this.escritura((tx) => {
      const it = this.buscar(tx.items, a.id);
      this.poner_pregunta(it, a);
      for (const k of ["titulo", "detalle", "prueba"]) if (a[k] !== null) it[k] = k === "titulo" ? strip(a[k]) : a[k];
      if (a.sumar !== null) {
        // al final de lo que haya (también de un --detalle de esta misma llamada)
        it.detalle = (verdad(it.detalle) ? it.detalle.replace(/\n+$/, "") + "\n" : "") + a.sumar;
      }
      it.tocado = isoLocal();
      tx.cambio = true;
      return it;
    });
    this.print(linea(it));
  }

  /** La respuesta del dueño queda en el item; no lo cierra ni lo mueve (eso lo hace el que la lee). */
  async cmdResponder(a: Item) {
    if (a.texto !== null) {
      // `responder 42 "la opción 2"`: el texto suelto es --respuesta
      if (a.respuesta !== null) this.morir("responder: el texto va suelto o con --respuesta, no los dos", 2);
      a.respuesta = a.texto;
    }
    const prueba = a.anda !== null;
    if (a.borrar) {
      if (prueba || a.respuesta !== null || a.opcion !== null || a.nota !== null) this.morir("responder: --borrar va solo", 2);
    } else if (prueba && (a.respuesta !== null || a.opcion !== null)) this.morir("responder: --anda/--no-anda van con --nota, no con --respuesta ni --opcion", 2);
    else if (!prueba && a.nota !== null) this.morir("responder: --nota va con --anda o --no-anda", 2);
    else if (!prueba && a.respuesta === null && a.opcion === null) this.morir("responder: pasá --respuesta, --opcion, --anda o --no-anda", 2);
    const it = await this.escritura((tx) => {
      const it = this.buscar(tx.items, a.id);
      if (!abierto(it)) this.morir(`responder: el item ${strPy(it.id)} está cerrado (${strPy(it.columna)})`);
      const ts = isoLocal();
      if (a.borrar) {
        if (!("respuesta" in it)) return it;
        delete it.respuesta;
      } else if (prueba) {
        if (tipoDe(it) !== "prueba") this.morir(`responder: el item ${strPy(it.id)} es una pregunta, no una prueba (--respuesta / --opcion)`, 2);
        it.respuesta = { anda: a.anda, texto: strip(a.nota ?? ""), fecha: ts };
      } else {
        const r: Item = { texto: strip(a.respuesta ?? "") };
        if (a.opcion !== null) {
          const oid = idOpcion(it.opciones, a.opcion);
          if (oid === null) {
            const hay = (Array.isArray(it.opciones) ? it.opciones : []).map((o: Item) => o.id).join(", ") || "ninguna";
            this.morir(`responder: --opcion '${a.opcion}' no es una de las opciones del item (${hay})`, 2);
          }
          // el texto viaja con el id: si después cambian las opciones, la respuesta se sigue entendiendo
          r.opcion = oid;
          r.opcion_texto = (it.opciones as Item[]).find((o) => o.id === oid)!.texto;
        } else if (!r.texto) this.morir("responder: --respuesta está vacía", 2);
        r.fecha = ts;
        it.respuesta = r;
      }
      it.tocado = ts;
      tx.cambio = true;
      return it;
    });
    this.print(linea(it) + (verdad(it.respuesta) ? `  respuesta: ${textoRespuesta(it.respuesta)}` : ""));
  }

  private async cerrarComo(a: Item, columna: string) {
    const clave = a.clave ?? null;
    const nota = a.nota ?? null;
    if (!(a.ids as number[]).length && !verdad(clave)) this.morir(`${a.cmd}: pasá un id` + (columna === "hecho" ? " o --clave" : ""), 2);
    await this.escritura((tx) => {
      const objetivos = (a.ids as number[]).map((i) => this.buscar(tx.items, i));
      // Sin item abierto con esa clave no es un error: el doctor cierra en cada pasada buena.
      if (verdad(clave)) objetivos.push(...tx.items.filter((it) => it.clave === clave && abierto(it)));
      const ts = isoLocal();
      for (const it of objetivos) {
        if (it.columna === columna) continue;
        it.columna = columna;
        it.cerrado = ts;
        it.tocado = ts;
        if (verdad(nota)) it.detalle = (verdad(it.detalle) ? it.detalle + "\n" : "") + `cierre: ${nota}`;
        tx.cambio = true;
        this.print(linea(it));
      }
    });
  }
  cmdCerrar = (a: Item) => this.cerrarComo(a, "hecho");
  cmdTirar = (a: Item) => this.cerrarComo(a, "tirado");

  async cmdSigue(a: Item) {
    const texto = strip(a.texto);
    if (!texto) this.morir("sigue: el texto está vacío", 2);
    const reg = this.registro();
    const [proy, ent, av] = reg.resolver(a.proyecto);
    if (!proy) this.morir("sigue: el proyecto está vacío", 2);
    if (av) this.aviso(av);
    let head: string | null = a.head;
    if (!verdad(head) && ent && statSyncDir(reg.ruta(ent))) head = strip((await this.gitVarios(new Map([["h", [reg.ruta(ent), ["rev-parse", "HEAD"]] as [string, string[]]]]))).get("h") ?? "") || null;
    const clave = `sigue:${proy}`;
    const it = await this.escritura((tx) => {
      const ts = isoLocal();
      let it = porClave(tx.items, clave);
      if (it === null) {
        it = { id: this.nuevoId(tx.items), columna: "sigue", proyecto: proy, titulo: texto, detalle: "", prueba: "", origen: "sigue", clave, head, creado: ts, tocado: ts, cerrado: null, hasta: null };
        tx.items.push(it);
      } else {
        // Uno solo por proyecto: el paso nuevo reemplaza al anterior en el mismo item.
        if (it.titulo !== texto || !abierto(it)) it.creado = ts;
        Object.assign(it, { columna: "sigue", proyecto: proy, titulo: texto, head, tocado: ts, cerrado: null, hasta: null });
      }
      tx.cambio = true;
      return it;
    });
    this.print(String(it.id));
  }

  async cmdArchivar(a: Item) {
    const corte = Date.now() / 1000 - a.dias * 86400;
    let n = 0;
    await this.escritura((tx) => {
      const quedan: Item[] = [];
      const porMes = new Map<string, Item[]>();
      for (const it of tx.items) {
        let mes: string | null = null;
        if (!abierto(it)) {
          const f = leerIso(verdad(it.cerrado) ? it.cerrado : verdad(it.tocado) ? it.tocado : "");
          if (f && f.seg < corte) mes = f.ym;
        }
        if (mes) porMes.set(mes, [...(porMes.get(mes) ?? []), it]);
        else quedan.push(it);
      }
      // Primero al archivo y recién después fuera de items.jsonl: si se corta en el medio queda un item repetido en el archivo, no uno perdido.
      for (const [mes, its] of porMes) {
        const fd = openSync(path.join(this.archivo, `${mes}.jsonl`), "a");
        try {
          appendFileSync(fd, its.map((it) => jsonPy(it) + "\n").join(""));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        n += its.length;
      }
      if (n) {
        tx.items.splice(0, tx.items.length, ...quedan);
        tx.cambio = true;
      }
    });
    this.print(`archivados: ${n}`);
  }

  // ------------------------------------------------------------------------------------------ comandos que leen

  cmdListar(a: Item) {
    const items = this.leerItems();
    let cols: string[] | null = null;
    if (a.columna) {
      cols = (a.columna as string).split(",").filter((c) => strip(c)).map((c) => this.colCanon(strip(c)));
      const malas = cols.filter((c) => !COLUMNAS.includes(c));
      if (malas.length) this.morir(`columna desconocida: ${malas.join(", ")} (hay: ${COLUMNAS.join(", ")})`, 2);
    }
    const proy = a.proyecto ? this.registro().resolver(a.proyecto)[0] : null;
    const hoy = hoyStr();
    const sal: Item[] = [];
    for (const it of [...items].sort(ordenColumna)) {
      if (proy !== null && it.proyecto !== proy) continue;
      if (a.pospuestos) {
        // sólo los que están escondidos por su `hasta` (abiertos), para traerlos de vuelta
        if (!(abierto(it) && pospuesto(it, hoy)) || (cols !== null && !cols.includes(it.columna))) continue;
      } else if (cols !== null) {
        // una columna pedida por nombre se muestra aunque sea hecho/tirado; los pospuestos no
        if (!cols.includes(it.columna) || (pospuesto(it, hoy) && !a.todo)) continue;
      } else if (!a.todo && !visible(it, hoy)) continue;
      sal.push(it);
    }
    if (a.json) return this.salidaJson(sal.map(publico));
    for (const it of sal) this.print(linea(it) + (pospuesto(it, hoy) ? `  hasta ${it.hasta}` : ""));
  }

  cmdVer(a: Item) {
    const it = this.leerItems().find((x) => x.id === a.id) ?? this.leerArchivo().find((x) => x.id === a.id) ?? this.morir(`no hay item ${a.id}`);
    if (a.json) return this.salidaJson(publico(it));
    this.print(linea(it));
    this.print(`tipo: ${tipoDe(it)}`);
    for (const k of ["titulo_simple", "contexto", "detalle", "prueba"]) if (verdad(it[k])) this.print(`${k}: ${strPy(it[k])}`);
    if (verdad(it.opciones)) {
      this.print("opciones:");
      for (const o of it.opciones) this.print(`  ${strPy(o.id)}) ${strPy(o.texto)}` + (o.id === it.por_defecto ? "  (por defecto)" : ""));
    }
    if (verdad(it.respuesta)) this.print(`respuesta: ${textoRespuesta(it.respuesta)}`);
    for (const k of ["origen", "clave", "head", "creado", "tocado", "cerrado", "hasta"]) if (verdad(it[k])) this.print(`${k}: ${strPy(it[k])}`);
  }

  async datosFicha(reg: Registro, nombre: string) {
    const [proy, ent, av] = reg.resolver(nombre);
    if (av) this.aviso(av);
    const items = this.leerItems();
    const hoy = hoyStr();
    const mios = items.filter((it) => it.proyecto === proy && visible(it, hoy));
    const d: Item = { proyecto: proy, desc: "", etapa: null, commit: null, sucio: null, ramas: [], sigue: null, espera_dueno: mios.filter((it) => it.columna === "espera-dueno").map(publico), en_curso: mios.filter((it) => it.columna === "en-curso").map(publico), corridas: [] };
    const sg = sigueDe(items).get(proy);
    if (sg) d.sigue = { id: sg.id ?? null, texto: sg.titulo ?? null, head: sg.head ?? null, viejo: null };
    if (!ent) return d;
    d.desc = verdad(ent.desc) ? ent.desc : "";
    d.etapa = etapa(ent);
    const ruta = reg.ruta(ent);
    const slug = reg.slug(ent);
    d.corridas = this.corridas(slug);
    if (!statSyncDir(ruta)) return d;
    const pedidos = new Map<string, [string, string[]]>([
      ["commit", [ruta, ["log", "-1", "--format=%h%x09%cs%x09%ct%x09%s", "--", "."]]],
      ["sucio", [ruta, ["status", "--porcelain", "--", "."]]],
      ["ramas", [ruta, ["branch", "--no-merged", "HEAD", "--list", `pa/${slug}/*`, "--format=%(refname:short)"]]],
    ]);
    if (sg && verdad(sg.head)) pedidos.set("viejo", [ruta, ["rev-list", "--count", `${sg.head}..HEAD`]]);
    const g = await this.gitVarios(pedidos);
    const c = (g.get("commit") ?? "").replace(/\n+$/, "").split("\t");
    if (c.length >= 4) {
      // sin esto no hay repo (o ningún commit toca la carpeta): se omite todo lo de git
      const asunto = c.slice(3).join("\t");
      d.commit = { hash: c[0], fecha: c[1], asunto, edad: /^\d+$/.test(c[2]!) ? edadSeg(Date.now() / 1000 - Number(c[2])) : "?" };
      d.sucio = verdad(strip(g.get("sucio") ?? ""));
      d.ramas = strip(g.get("ramas") ?? "").split(RE_WS).filter(Boolean).map((x) => ({ rama: x, en_curso: this.ramaEnCurso(x) }));
      if (pedidos.has("viejo")) {
        const v = strip(g.get("viejo") ?? "");
        // null de git: ese HEAD ya no existe en el repo (rebase, reset): seguro que está viejo
        d.sigue.viejo = /^\d+$/.test(v) ? Number(v) : -1;
      }
    }
    return d;
  }

  async cmdFicha(a: Item) {
    const d = await this.datosFicha(this.registro(), a.proyecto);
    if (a.json) return this.salidaJson(d);
    const corta = a.corta;
    const L: string[] = [];
    let cab = d.proyecto + (d.etapa ? ` [${d.etapa}]` : !AREAS.includes(d.proyecto) ? " (no está en el registry)" : " (área)");
    if (d.desc) cab += " — " + recorte(d.desc, corta ? 100 : 200);
    L.push(cab);
    const c = d.commit;
    if (c) L.push(`commit: ${c.hash} ${c.fecha} ${recorte(c.asunto, 80)} (${c.edad}) · árbol ${d.sucio ? "sucio" : "limpio"}`);
    if (d.ramas.length) {
      const rs = d.ramas.map((r: Item) => r.rama + (r.en_curso ? " (en curso)" : ""));
      L.push(`ramas sin integrar (${rs.length}): ` + rs.slice(0, 6).join(", ") + (rs.length > 6 ? ` … +${rs.length - 6}` : ""));
    }
    const sg = d.sigue;
    if (sg) {
      const marca = marcaViejo(sg);
      L.push(`sigue: ${recorte(sg.texto, corta ? 160 : 400)}` + (marca ? ` (${marca})` : ""));
    }
    for (const [clave, titulo] of [["espera_dueno", "espera-dueno"], ["en_curso", "en-curso"]] as const) {
      const its: Item[] = d[clave];
      if (!its.length) continue;
      if (corta) L.push(`${titulo} (${its.length}): ` + recorte(its.map((it) => `#${it.id} ${strPy(it.titulo)}`).join("; "), 200));
      else {
        L.push(`${titulo}:`);
        for (const it of its) L.push(`  ${it.id}  ${strPy(it.titulo)}` + (verdad(it.prueba) ? ` · probar: ${strPy(it.prueba)}` : "") + `  (${edad(it.creado)})`);
      }
    }
    if (d.corridas.length) {
      if (corta) L.push("corridas: " + d.corridas.map((r: Item) => `${r.fecha.slice(5)} ${recorte(r.resultado, 30)} «${recorte(r.tarea, 40)}»`).join("; "));
      else {
        L.push("corridas:");
        for (const r of d.corridas) L.push(`  ${r.fecha}  ${r.resultado}  ${r.tarea}`);
      }
    }
    this.print((corta ? L.slice(0, 8) : L).join("\n"));
  }

  async cmdProyectos(a: Item) {
    const reg = this.registro();
    const items = this.leerItems();
    const hoy = hoyStr();
    const abiertos = new Map<string, number>();
    for (const it of items) if (visible(it, hoy)) abiertos.set(it.proyecto || "", (abiertos.get(it.proyecto || "") ?? 0) + 1);
    const sg = sigueDe(items);
    type Fila = { proyecto: string; etapa: string; dias: number | null; abiertos: number; sigue: unknown };
    const filas: Fila[] = [];
    const rutas = new Set<string>();
    const pedidos = new Map<string, [string, string[]]>();
    for (const p of reg.proyectos) {
      const et = etapa(p);
      const r = reg.ruta(p);
      if ((et === "retirado" && !a.retirados) || rutas.has(r)) continue;
      rutas.add(r);
      const n = p.name;
      const ab = abiertos.get(n) ?? 0;
      abiertos.delete(n);
      filas.push({ proyecto: n, etapa: et, dias: null, abiertos: ab, sigue: sg.get(n)?.titulo ?? null });
      if (r && statSyncDir(r)) pedidos.set(n, [r, ["log", "-1", "--format=%ct", "--", "."]]);
    }
    const t = Date.now() / 1000;
    for (const [n, o] of await this.gitMuchos(pedidos)) if (o && /^\d+$/.test(strip(o))) filas.find((f) => f.proyecto === n)!.dias = Math.floor((t - Number(strip(o))) / 86400);
    // los retirados (sólo con --retirados) van después de los vivos
    filas.sort((x, y) => Number(x.etapa === "retirado") - Number(y.etapa === "retirado") || Number(x.dias === null) - Number(y.dias === null) || (x.dias ?? 0) - (y.dias ?? 0) || (x.proyecto.toLowerCase() < y.proyecto.toLowerCase() ? -1 : x.proyecto.toLowerCase() > y.proyecto.toLowerCase() ? 1 : 0));
    // áreas y nombres sueltos con algo abierto: no están en el registry pero también son trabajo
    for (const n of [...abiertos.keys()].filter(Boolean).sort()) filas.push({ proyecto: n, etapa: AREAS.includes(n) ? "área" : "?", dias: null, abiertos: abiertos.get(n)!, sigue: sg.get(n)?.titulo ?? null });
    if (a.json) return this.salidaJson(filas);
    for (const f of filas) this.print([f.proyecto, f.etapa, f.dias === null ? "-" : `${f.dias}d`, `abiertos:${f.abiertos}`].join("  ") + (verdad(f.sigue) ? `  sigue: ${recorte(f.sigue, 100)}` : ""));
  }

  async cmdHoy(a: Item) {
    const fecha = a.fecha ? this.fechaArg(a.fecha) : hoyStr();
    if (!fecha) this.morir("hoy: --fecha vacía", 2);
    const d = await this.datosHoy(this.registro(), this.leerItems(), fecha);
    if (a.json) return this.salidaJson(d);
    if (!(d.integradas.length || d.cerrados.length || Object.keys(d.commits).length)) return this.print(`hoy ${fecha}: nada registrado`);
    this.print(`hoy ${fecha}`);
    if (d.integradas.length) {
      this.print(`integradas (${d.integradas.length}):`);
      for (const x of d.integradas) this.print(`  ${x.hora}  ${x.proyecto}  ${verdad(x.titulo) ? x.titulo : x.id}  (${x.commits} commits)`);
    }
    if (d.cerrados.length) {
      this.print(`cerrados (${d.cerrados.length}):`);
      for (const it of d.cerrados) this.print(`  ${strPy(it.id)}  ${strPy(it.columna)}  ${verdad(it.proyecto) ? it.proyecto : "-"}  ${strPy(it.titulo)}`);
    }
    const cs = Object.entries(d.commits);
    if (cs.length) this.print("commits: " + cs.sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", "));
  }

  /** El informe de la última barrida nocturna (bin/barrendero), si es de hoy o ayer. */
  informeBarrendero(): Item | null {
    const ruta = path.join(this.env.BARRENDERO_DIR || path.join(this.home, ".local/state/barrendero"), "informe.json");
    let inf: unknown;
    let dias: number;
    try {
      inf = JSON.parse(readFileSync(ruta, "utf8"));
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(esObjeto(inf) ? String(inf.fecha) : "\0");
      if (!m) return null;
      const f = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const h = new Date();
      dias = Math.round((Date.UTC(h.getFullYear(), h.getMonth(), h.getDate()) - f) / 86400000);
    } catch {
      return null;
    }
    return dias > 1 || !esObjeto(inf) ? null : inf;
  }

  async cmdResumen(a: Item) {
    const reg = this.registro();
    const hoy = hoyStr();
    const vis = this.leerItems().filter((it) => visible(it, hoy));
    const esperan = vis.filter((it) => it.columna === "espera-dueno").sort((x, y) => {
      const cx = String(verdad(x.creado) ? x.creado : "");
      const cy = String(verdad(y.creado) ? y.creado : "");
      return cx < cy ? -1 : cx > cy ? 1 : idNum(x) - idNum(y);
    });
    const doctor = vis.filter((it) => String(verdad(it.origen) ? it.origen : "").startsWith("doctor") || String(verdad(it.clave) ? it.clave : "").startsWith("doctor:"));
    const bandeja = vis.filter((it) => it.columna === "bandeja").length;
    const ramas = await this.ramasSinIntegrar(reg);
    if (a.json) return this.salidaJson({ espera_dueno: esperan.map(publico), ramas, doctor: doctor.map(publico), bandeja, barrendero: this.informeBarrendero() });
    const cola: string[] = [];
    if (ramas.length) cola.push(`ramas sin integrar (${ramas.length}): ` + ramas.slice(0, 5).join(", ") + (ramas.length > 5 ? ` … +${ramas.length - 5}` : ""));
    if (doctor.length) cola.push(`doctor (${doctor.length}): ` + recorte(doctor.map((it) => `#${it.id} ${verdad(it.proyecto) ? it.proyecto : "-"} ${strPy(it.titulo)}`).join("; "), 220));
    if (bandeja) cola.push(`bandeja: ${bandeja} sin clasificar`);
    const barr = this.informeBarrendero();
    const lb = barr ? lineaBarrendero(barr) : null;
    if (lb) cola.push(lb);
    const L: string[] = [];
    if (esperan.length) {
      L.push(`te esperan ${esperan.length} (más viejo primero):`);
      const lugar = Math.max(1, a.max - cola.length - 1);
      const mostrar = esperan.length <= lugar ? esperan : esperan.slice(0, Math.max(0, lugar - 1));
      for (const it of mostrar) L.push(`  ${it.id}  ${verdad(it.proyecto) ? it.proyecto : "-"}  ${recorte(it.titulo, 120)}` + (verdad(it.prueba) ? ` · probar: ${recorte(it.prueba, 80)}` : "") + `  (${edad(it.creado)})`);
      if (mostrar.length < esperan.length) L.push(`  … y ${esperan.length - mostrar.length} más: tablero listar --columna espera-dueno`);
    }
    L.push(...cola);
    this.print(L.length ? L.slice(0, Math.max(1, a.max)).join("\n") : "tablero: nada pendiente");
  }
}

const ENCABEZADO = /^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI[OÓ]N|SIGUE)[*]*:[*]*[ \t]*/gm;
const ENCABEZADO_UNO = /^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI[OÓ]N|SIGUE)[*]*:[*]*[ \t]*/m;
const OTRO_CAMPO = /\b(ARCHIVOS|DECISI[OÓ]N|SIGUE)[*]*:/;
// fin de oración: punto, ! o ? seguido de un espacio y de algo que arranca otra oración (un "p. ej." o un `bin/pa.` seguido de minúscula no corta)
const FIN_ORACION = /[.!?…](?=\s+[A-ZÁÉÍÓÚÑ¿¡`"«(\d]|\s*$)/;

function statSyncDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function marcaViejo(sg: Item): string {
  const v = sg.viejo;
  if (!v) return "";
  return v > 0 ? `puede estar viejo: ${v} commits después` : "puede estar viejo: el HEAD de entonces ya no está";
}

function lineaBarrendero(inf: Item): string | null {
  const largo = (k: string) => (Array.isArray(inf[k]) ? inf[k].length : 0);
  const [c, m, f] = [largo("cerrados"), largo("movidos"), largo("fusionados")];
  if (!(c || m || f)) return null;
  const ids = ["cerrados", "fusionados", "movidos"].flatMap((k) => (Array.isArray(inf[k]) ? inf[k] : []).map((x: Item) => `#${strPy(x.id)}`));
  return `barrendero (${strPy(inf.fecha)}): cerró ${c}, movió ${m}, fusionó ${f} — ` + ids.slice(0, 8).join(", ") + (ids.length > 8 ? ` … +${ids.length - 8}` : "") + " (barrendero --deshacer)";
}

// ------------------------------------------------------------------------------------------------ línea de comandos

const conv = {
  id: (s: string): number => {
    const n = enteroPy(s.replace(/^#+/, ""));
    if (n === null) throw new ErrorTipo(`id inválido: ${s}`);
    return n;
  },
};

const val = (flag: string, o: Partial<Accion> = {}): Accion => ({ flags: [flag], dest: flag.slice(2).replaceAll("-", "_"), nombre: flag, tipo: "valor", ...o });
const bandera = (flag: string, o: Partial<Accion> = {}): Accion => ({ flags: [flag], dest: flag.slice(2).replaceAll("-", "_"), nombre: flag, tipo: "const", const: true, ...o });
const pos = (dest: string, nombre: string, o: Partial<Accion> = {}): Accion => ({ flags: [], dest, nombre, tipo: "pos", ...o });
const ajuste = (cmd: string, acciones: Accion[]): Parser => ({ prog: `tablero ${cmd}`, acciones });

function parsers(t: Tablero): Record<string, Parser> {
  const col = (flag: string): Accion => val(flag, { conv: t.colArg, choices: COLUMNAS });
  const preguntas = (): Accion[] => [
    val("--tipo", { choices: TIPOS }),
    val("--simple"),
    val("--contexto"),
    { flags: ["--opcion"], dest: "opcion", nombre: "--opcion", tipo: "anexar" },
    val("--defecto"),
  ];
  const json = (): Accion => bandera("--json");
  return {
    agregar: ajuste("agregar", [pos("titulo", "<título>"), col("--columna"), val("--proyecto"), val("--detalle"), val("--detalle-archivo"), val("--prueba"), val("--prueba-archivo"), val("--origen"), val("--clave"), val("--hasta"), ...preguntas()]),
    listar: ajuste("listar", [json(), val("--proyecto"), val("--columna"), bandera("--todo"), bandera("--pospuestos")]),
    ver: ajuste("ver", [json(), pos("id", "id", { conv: conv.id })]),
    mover: ajuste("mover", [pos("id", "id", { conv: conv.id }), col("--columna"), val("--proyecto"), val("--hasta")]),
    editar: ajuste("editar", [pos("id", "id", { conv: conv.id }), val("--titulo"), val("--detalle"), val("--detalle-archivo"), val("--prueba"), val("--prueba-archivo"), val("--sumar"), val("--sumar-archivo"), ...preguntas(), bandera("--sin-opciones")]),
    responder: ajuste("responder", [
      pos("id", "id", { conv: conv.id }),
      pos("texto", "texto", { nargs: "?" }),
      val("--respuesta"),
      val("--opcion"),
      { flags: ["--anda"], dest: "anda", nombre: "--anda", tipo: "const", const: true, defecto: null, grupo: 1 },
      { flags: ["--no-anda"], dest: "anda", nombre: "--no-anda", tipo: "const", const: false, grupo: 1 },
      val("--nota"),
      bandera("--borrar"),
    ]),
    posponer: ajuste("posponer", [pos("ids", "id", { nargs: "+", conv: conv.id }), pos("fecha", "<fecha|ya>")]),
    cerrar: ajuste("cerrar", [pos("ids", "id", { nargs: "*", conv: conv.id }), val("--clave"), val("--nota")]),
    tirar: ajuste("tirar", [pos("ids", "id", { nargs: "+", conv: conv.id })]),
    sigue: ajuste("sigue", [pos("proyecto", "proyecto"), pos("texto", "<texto>"), val("--head")]),
    ficha: ajuste("ficha", [json(), pos("proyecto", "proyecto"), bandera("--corta")]),
    proyectos: ajuste("proyectos", [json(), bandera("--retirados")]),
    hoy: ajuste("hoy", [json(), val("--fecha")]),
    resumen: ajuste("resumen", [json(), val("--max", { conv: "int", defecto: 12 })]),
    archivar: ajuste("archivar", [val("--dias", { conv: "int", defecto: 30 })]),
    init: ajuste("init", []),
  };
}

const porDefecto = (): Io => {
  process.stdout.on("error", () => {}); // `tablero listar | head`: el lector cortó; no es un error de tablero
  return { out: (s) => void process.stdout.write(s), err: (s) => void process.stderr.write(s) };
};

export async function main(argv: string[], env: Env = process.env, io: Io = porDefecto(), leerStdin?: () => string): Promise<number> {
  const t = new Tablero(env, io, leerStdin);
  try {
    const r = parsear(argv, parsers(t), io, t.ayuda);
    const a: Item = { ...r.ns, cmd: r.cmd };
    const f: Record<string, (a: Item) => void | Promise<void>> = {
      agregar: (x) => t.cmdAgregar(x), listar: (x) => t.cmdListar(x), ver: (x) => t.cmdVer(x), mover: (x) => t.cmdMover(x), editar: (x) => t.cmdEditar(x), responder: (x) => t.cmdResponder(x),
      posponer: (x) => t.cmdPosponer(x), cerrar: (x) => t.cmdCerrar(x), tirar: (x) => t.cmdTirar(x), sigue: (x) => t.cmdSigue(x), ficha: (x) => t.cmdFicha(x), proyectos: (x) => t.cmdProyectos(x),
      hoy: (x) => t.cmdHoy(x), resumen: (x) => t.cmdResumen(x), archivar: (x) => t.cmdArchivar(x), init: () => t.cmdInit(),
    };
    await f[r.cmd]!(a);
    return 0;
  } catch (e) {
    if (e instanceof Salida) return e.codigo;
    if ((e as NodeJS.ErrnoException).code === "EPIPE") return 0; // `tablero listar | head`: el lector cortó; no es un error de tablero
    throw e;
  }
}

if (esPrincipal(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
