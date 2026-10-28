// cuentas — varias cuentas por proveedor (Claude, Google/agy, ChatGPT/codex, OpenCode), cada una con su carpeta de credenciales.
// Port a TypeScript de motor/bin/cuentas (misma CLI, misma salida, mismo cuentas.json). La ayuda completa es `cuentas -h`.
//
// Diferencias con el Python: el lock de cuentas.json es el de base/lock.ts (socket abstracto / named pipe, no `flock`), y `login` no hace
// `exec` (Node no puede): lanza el login como hijo con la terminal heredada y sale con su código. Con `--imprimir` sale lo mismo que antes.
// TRAMA_CUENTAS (el cuentas.json) y TRAMA_CUENTAS_HOME (el home de verdad de donde salen los symlinks, default $HOME) mueven las rutas.
import { spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homeDe } from "../rutas.ts";
import { borrarSinSeguir, enlazarArchivo, enlazarDir } from "./base/enlaces.ts";
import { enPath, esEjecutable } from "./base/buscar.ts";
import { tomar } from "./base/lock.ts";
import { esPrincipal } from "./base/principal.ts";
import { correr } from "./base/proc.ts";
import { AYUDA_CUENTAS } from "./cuentas-ayuda.ts";
import { jsonPy } from "./trama-estado.ts";

type Env = Record<string, string | undefined>;
export type Io = { out: (s: string) => void; err: (s: string) => void };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ent = Record<string, any>;

const VERSION = 1;
const PROVEEDORES: Record<string, [string, string]> = {
  // id: [nombre de la cuenta de siempre, motor que la usa]
  claude: ["Claude", "claude"],
  google: ["Google AI Pro", "agy"],
  chatgpt: ["ChatGPT", "codex"],
  opencode: ["OpenCode", "opencode"],
};
const PLANES_OPENCODE = ["gratis", "go", "go-plus"];
const ID_OK = /^[a-z0-9][a-z0-9-]{0,39}\n?$/;
const DBUS_ROTO = "unix:path=/nonexistent/trama-sin-llavero";
const MARCA_DIR = ".trama-cuenta"; // la deja `agregar`/`login`: sólo se borra una carpeta que la lleva (o que cuelga de la carpeta de cuentas)
// proveedor: rutas relativas al home de verdad -> misma ruta relativa en la carpeta de la cuenta
const LINKS: Record<string, [string, string][]> = {
  claude: ["settings.json", "CLAUDE.md", "hooks", "skills", "agents", "commands", "plugins", "projects", "sessions", "output-styles", "keybindings.json"].map((n) => [".claude/" + n, n]),
  google: [".gemini/config", ".gemini/GEMINI.md", ".gitconfig", ".config/git", ".config/trama", ".local/bin", ".local/state", ".claude"].map((n) => [n, n]),
  chatgpt: ["config.toml", "AGENTS.md", "prompts"].map((n) => [".codex/" + n, n]),
  opencode: [[".local/share/opencode/bin", "data/opencode/bin"]], // sus LSP bajados (en 2.x no existe: no se enlaza nada)
};
// `agy models`: el id solo, o "id<TAB>nombre" (mismo patrón que bin/trama-estado)
const MODELO_AGY = /^\s*(?:(?:gemini|claude|gpt)[-\w.]*\s*$|[a-z0-9][a-z0-9.-]*\t)/i;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const verdad = (x: unknown) => !(x === null || x === undefined || x === false || x === 0 || x === "" || (Array.isArray(x) && x.length === 0) || (esObjeto(x) && Object.keys(x).length === 0));
/** `"%-Ns" % s`: relleno por caracteres (no por unidades UTF-16). */
const izq = (s: string, n: number) => s + " ".repeat(Math.max(0, n - Array.from(s).length));
const igualLista = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const lexists = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
const esDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const expandir = (p: string, home: string) => (p === "~" ? home : p.startsWith("~/") ? path.join(home, p.slice(2)) : p);

type Cuenta = { id: string; proveedor: string; motor: string; nombre: string; dir: string | null; defecto: boolean; plan?: string; logueado?: boolean | null; plan_detectado?: string | null };

class Cuentas {
  constructor(readonly env: Env, readonly io: Io) {}

  err = (m: string) => this.io.err(`cuentas: ${m}\n`);
  print = (s: string) => this.io.out(s + "\n");

  homeReal = () => this.env.TRAMA_CUENTAS_HOME || homeDe(this.env);
  ruta = () => this.env.TRAMA_CUENTAS || path.join(this.homeReal(), ".config", "trama", "cuentas.json");
  dirDefault = (cid: string) => path.join(path.dirname(path.resolve(this.ruta())), "cuentas", cid);

  /** Las entradas de cuentas.json. Sin archivo: []. Inválido: una línea por stderr y [] (todo sigue como antes). */
  leerArchivo(): Ent[] {
    let d: unknown;
    try {
      d = JSON.parse(readFileSync(this.ruta(), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      this.err(`${this.ruta()} inválido (${e instanceof Error ? e.message : e}): uso sólo las cuentas de siempre`);
      return [];
    }
    const lista = esObjeto(d) && verdad(d.cuentas) ? d.cuentas : [];
    const out: Ent[] = [];
    for (const c of Array.isArray(lista) ? lista : []) {
      if (!esObjeto(c) || !(typeof c.proveedor === "string" && c.proveedor in PROVEEDORES) || !ID_OK.test(c.id === undefined ? "" : String(c.id))) {
        this.err(`entrada inválida en ${this.ruta()}: ${jsonPy(c)} (la salteo)`);
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /** Todas las cuentas: la de siempre de claude y google (y las de chatgpt/opencode si hay o está instalado), más las agregadas. */
  cargar(): Cuenta[] {
    const ent = this.leerArchivo();
    const porId = new Map<string, Ent>();
    for (const c of ent) if (!porId.has(c.id)) porId.set(c.id, c);
    const provs = ["claude", "google", ...(ent.some((c) => c.proveedor === "chatgpt") ? ["chatgpt"] : []), ...(this.opencodeBin() || ent.some((c) => c.proveedor === "opencode") ? ["opencode"] : [])];
    const out: Cuenta[] = [];
    for (const p of provs) {
      const r = porId.get(p);
      out.push({ id: p, proveedor: p, motor: PROVEEDORES[p]![1], nombre: (verdad(r?.nombre) ? r!.nombre : PROVEEDORES[p]![0]) as string, dir: null, defecto: true });
    }
    for (const c of ent) {
      if (c.id in PROVEEDORES || c !== porId.get(c.id)) continue;
      const d = expandir(verdad(c.dir) ? String(c.dir) : this.dirDefault(c.id), homeDe(this.env));
      const cu: Cuenta = { id: c.id, proveedor: c.proveedor, motor: PROVEEDORES[c.proveedor]![1], nombre: verdad(c.nombre) ? c.nombre : c.id, dir: path.resolve(d), defecto: false };
      if (c.proveedor === "opencode") cu.plan = PLANES_OPENCODE.includes(c.plan) ? c.plan : "gratis";
      out.push(cu);
    }
    return out;
  }

  /** El binario opencode (el PATH o ~/.opencode/bin, como pa): null si no está. */
  opencodeBin(): string | null {
    const c = enPath("opencode", [], this.env);
    if (c) return c;
    const f = path.join(this.homeReal(), ".opencode", "bin", "opencode");
    return esEjecutable(f) ? f : null;
  }

  buscar = (cid: string) => this.cargar().find((c) => c.id === cid) ?? null;

  guardar(ent: Ent[]) {
    const p = this.ruta();
    mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
    const tmp = `${p}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ version: VERSION, cuentas: ent }, null, 2) + "\n");
    renameSync(tmp, p);
  }

  async conCandado<T>(f: () => T | Promise<T>): Promise<T> {
    mkdirSync(path.dirname(path.resolve(this.ruta())), { recursive: true });
    const archivo = this.ruta() + ".lock";
    closeSync(openSync(archivo, "a"));
    const lock = await tomar(archivo, { esperarMs: Infinity });
    try {
      return await f();
    } finally {
      await lock?.liberar();
    }
  }

  /** (datos, estado) de una cuenta agregada de OpenCode: XDG_DATA_HOME y XDG_STATE_HOME. */
  dirsOpencode = (c: Cuenta): [string, string] => [path.join(c.dir!, "data"), path.join(c.dir!, "state")];

  /** Crea la carpeta de la cuenta y los symlinks a lo compartido. No pisa nada que ya exista. */
  asegurarLinks(c: Cuenta) {
    if (c.defecto) return;
    mkdirSync(c.dir!, { recursive: true, mode: 0o700 });
    if (c.proveedor === "opencode") for (const d of this.dirsOpencode(c)) mkdirSync(d, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path.join(c.dir!, MARCA_DIR), c.id + "\n", { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") this.err(`no pude marcar ${c.dir}: ${(e as NodeJS.ErrnoException).message}`);
    }
    for (const [src, dst] of LINKS[c.proveedor]!) {
      const s = path.join(this.homeReal(), src);
      const t = path.join(c.dir!, dst);
      if (!lexists(s) || lexists(t)) continue;
      try {
        mkdirSync(path.dirname(t), { recursive: true });
        if (esDir(s)) enlazarDir(s, t);
        else enlazarArchivo(s, t);
      } catch (e) {
        this.err(`no pude enlazar ${t}: ${(e as NodeJS.ErrnoException).message}`);
      }
    }
  }

  /** [poner, sacar]: variables a poner y a sacar para correr un worker de esa cuenta. La de siempre: nada. */
  entorno(c: Cuenta): [Record<string, string>, string[]] {
    if (c.defecto) return [{}, []];
    if (c.proveedor === "claude") return [{ CLAUDE_CONFIG_DIR: c.dir! }, ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]];
    if (c.proveedor === "google") return [{ HOME: c.dir!, DBUS_SESSION_BUS_ADDRESS: DBUS_ROTO }, []];
    if (c.proveedor === "opencode") {
      const [datos, estado] = this.dirsOpencode(c);
      return [{ XDG_DATA_HOME: datos, XDG_STATE_HOME: estado, TRAMA_OPENCODE_CUENTA: c.id, TRAMA_OPENCODE_PLAN: c.plan || "gratis" }, []];
    }
    return [{ CODEX_HOME: c.dir! }, ["OPENAI_API_KEY"]];
  }

  envDe(c: Cuenta): Env {
    const e: Env = { ...this.env };
    const [poner, sacar] = this.entorno(c);
    for (const v of sacar) delete e[v];
    Object.assign(e, poner);
    return e;
  }

  private cwdTmp = () => this.env.TMPDIR || "/tmp";

  /** ["--standalone"] si ese subcomando de opencode lo tiene (2.x) y la cuenta es una agregada; si no, []. */
  async opencodeStandalone(c: Cuenta, sub: string[]): Promise<string[]> {
    if (c.defecto) return [];
    const r = await correr(this.opencodeBin() || "opencode", [...sub, "--help"], { env: this.envDe(c), timeoutMs: 15_000, input: "" });
    if (r.error || r.agotado) return [];
    return /(^|\s)--standalone(\s|$)/m.test(r.salida + r.errores) ? ["--standalone"] : [];
  }

  async comandoLogin(c: Cuenta): Promise<string[]> {
    const [poner, sacar] = this.entorno(c);
    const base = {
      claude: ["claude", "auth", "login"],
      google: ["agy"],
      chatgpt: ["codex", "login"],
      opencode: [this.opencodeBin() || "opencode", "auth", "login", ...(c.proveedor === "opencode" ? await this.opencodeStandalone(c, ["auth", "login"]) : [])],
    }[c.proveedor]!;
    const pares = Object.entries(poner).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const pre = Object.keys(poner).length || sacar.length ? ["env", ...sacar.map((v) => `-u${v}`), ...pares.map(([k, v]) => `${k}=${v}`)] : [];
    return [...pre, ...base];
  }

  /** true/false/null. opencode 1.x: auth.json en el data dir (sólo se cuentan las claves). 2.x: sólo lo dice `opencode auth list` (con `verificar`). */
  async logueadoOpencode(c: Cuenta, verificar: boolean): Promise<boolean | null> {
    const datos = c.dir ? this.dirsOpencode(c)[0] : this.env.XDG_DATA_HOME || path.join(this.homeReal(), ".local", "share");
    try {
      const j = JSON.parse(readFileSync(path.join(datos, "opencode", "auth.json"), "utf8"));
      if (esObjeto(j) && Object.keys(j).length > 0) return true;
    } catch {
      /* sin auth.json */
    }
    const b = this.opencodeBin();
    if (!verificar || !b) return null;
    const sa = await this.opencodeStandalone(c, ["auth", "list"]);
    for (const extra of [["--format", "json"], []] as string[][]) {
      const r = await correr(b, ["auth", "list", ...sa, ...extra], { env: this.envDe(c), timeoutMs: 25_000, input: "", cwd: this.cwdTmp() });
      if (r.error || r.agotado) return null;
      if (r.codigo !== 0) continue;
      if (extra.length) {
        let j: unknown;
        try {
          j = JSON.parse(r.salida);
        } catch {
          continue;
        }
        if (Array.isArray(j)) return j.some((x) => esObjeto(x) && verdad(x.connections));
      } else {
        const t = r.salida.replace(ANSI, "");
        const m = /(\d+)\s+credentials?/i.exec(t);
        if (m) return Number(m[1]) > 0;
        return t.split(/\r\n|\r|\n/).some((l) => l.toLowerCase().includes("stored"));
      }
    }
    return null;
  }

  /** true/false si se sabe, null si no hay forma barata de saberlo (agy guarda el token en el llavero). */
  async logueado(c: Cuenta, verificar = false): Promise<boolean | null> {
    const p = c.proveedor;
    if (p === "claude") {
      if (verificar && enPath("claude", [], this.env)) {
        const r = await correr("claude", ["auth", "status", "--json"], { env: this.envDe(c), timeoutMs: 20_000, input: "" });
        if (!r.error && !r.agotado) {
          try {
            const j = JSON.parse(r.salida);
            if (esObjeto(j)) return verdad(j.loggedIn);
          } catch {
            /* sigue con el archivo */
          }
        }
      }
      const d = c.dir || this.env.CLAUDE_CONFIG_DIR || path.join(this.homeReal(), ".claude");
      return existsSync(path.join(d, ".credentials.json"));
    }
    if (p === "chatgpt") return existsSync(path.join(c.dir || this.env.CODEX_HOME || path.join(this.homeReal(), ".codex"), "auth.json"));
    if (p === "opencode") return this.logueadoOpencode(c, verificar);
    if (verificar && enPath("agy", [], this.env)) {
      const r = await correr("agy", ["models"], { env: this.envDe(c), timeoutMs: 20_000, input: "", cwd: this.cwdTmp() });
      if (r.error || r.agotado) return false;
      return r.salida.split(/\r\n|\r|\n/).some((l) => MODELO_AGY.test(l));
    }
    return null;
  }

  static slug(nombre: string): string {
    const s = nombre.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
    return s || "cuenta";
  }

  /** El plan de OpenCode que dice la salida de `opencode models`: "go" si lista algún `opencode-go/*`, "gratis" si lista modelos pero ninguno de Go, null si no lista nada. */
  static planDeModelos(salida: string): string | null {
    const ids = salida.replace(ANSI, "").split(/\r\n|\r|\n/).filter((l) => /^\s*[a-z0-9][\w.-]*\/[\w.:-]+\s*$/.test(l)).map((l) => l.trim());
    if (ids.some((i) => i.startsWith("opencode-go/"))) return "go";
    return ids.length ? "gratis" : null;
  }

  /** El plan de esa cuenta de OpenCode según lo que lista `opencode models` con SU entorno. null si no se pudo preguntar. */
  async planDetectado(c: Cuenta): Promise<string | null> {
    const b = this.opencodeBin();
    if (!b) return null;
    const r = await correr(b, ["models", ...(await this.opencodeStandalone(c, ["models"]))], { env: this.envDe(c), timeoutMs: 40_000, input: "", cwd: this.cwdTmp() });
    if (r.error || r.agotado) return null;
    return r.codigo === 0 ? Cuentas.planDeModelos(r.salida) : null;
  }

  async publico(c: Cuenta, verificar = false): Promise<Cuenta> {
    const d: Cuenta = { ...c };
    d.logueado = await this.logueado(c, verificar);
    if (verificar && c.proveedor === "opencode") d.plan_detectado = await this.planDetectado(c);
    return d;
  }

  // ------------------------------------------------------------------------------------------ comandos

  async cmdListar(a: string[]): Promise<number> {
    const ver = a.includes("--verificar");
    const cs: Cuenta[] = [];
    for (const c of this.cargar()) cs.push(await this.publico(c, ver));
    if (a.includes("--json")) {
      this.print(jsonPy({ version: VERSION, archivo: this.ruta(), cuentas: cs }));
      return 0;
    }
    for (const c of cs) {
      const lg = c.logueado === true ? "con sesión" : c.logueado === false ? "sin sesión" : "sesión sin verificar";
      this.print(`${izq(c.id, 22)} ${izq(c.proveedor, 8)} ${izq(c.nombre, 24)} ${lg}${c.defecto ? "" : `  (${c.dir})`}`);
    }
    return 0;
  }

  async cmdAgregar(a: string[]): Promise<number> {
    const uso = 'uso: cuentas agregar claude|google|chatgpt|opencode "Nombre" [--id ID]';
    if (a.length < 2 || !(a[0]! in PROVEEDORES)) return this.err(uso), 2;
    const [prov, nombre, ...resto] = a as [string, string, ...string[]];
    let cid: string | null = null;
    if (resto[0] === "--id" && resto.length === 2) cid = resto[1]!;
    else if (resto.length) return this.err(uso), 2;
    const r = await this.conCandado(() => {
      const ent = this.leerArchivo();
      const usados = new Set([...Object.keys(PROVEEDORES), ...ent.map((c) => c.id)]);
      if (cid !== null) {
        if (!ID_OK.test(cid)) return this.err(`id inválido: ${cid} (minúsculas, números y guiones; hasta 40)`), 2;
        if (usados.has(cid)) return this.err(`ya existe una cuenta con id ${cid}`), 2;
      } else {
        const base = Cuentas.slug(nombre);
        cid = base;
        for (let n = 2; usados.has(cid); n++) cid = `${base}-${n}`;
      }
      ent.push({ id: cid, proveedor: prov, nombre });
      this.guardar(ent);
      return 0;
    });
    if (r) return r;
    this.asegurarLinks(this.buscar(cid!)!);
    this.print(cid!);
    this.io.err(`cuentas: falta el login: cuentas login ${cid}\n`);
    return 0;
  }

  /** ¿Se puede borrar la carpeta de esa cuenta con --borrar-credenciales? Sólo una carpeta propia: que cuelgue de la carpeta de cuentas o que lleve la marca. */
  carpetaBorrable(c: Cuenta): boolean {
    if (!c.dir || !esDir(c.dir) || lstatSync(c.dir).isSymbolicLink()) return false;
    const d = realpathSync(c.dir);
    const h = realpathPy(this.homeReal());
    const protegidas = [h, ...[".local", ".local/share", ".local/state", ".config", ".cache", ".claude", ".codex", ".gemini", ".opencode", ".local/share/opencode", ".local/state/opencode", ".config/opencode", ".cache/opencode", ".config/trama"].map((r) => realpathPy(path.join(h, r)))];
    for (const p of protegidas) if (d === p || p.startsWith(d + path.sep)) return false;
    if (d.startsWith(path.join(h, ".local", "share", "opencode") + path.sep) || d.startsWith(path.join(h, ".local", "state", "opencode") + path.sep)) return false;
    const raiz = realpathPy(path.join(path.dirname(path.resolve(this.ruta())), "cuentas"));
    if (d.startsWith(raiz + path.sep)) return true;
    try {
      return readFileSync(path.join(d, MARCA_DIR), "utf8").trim() === c.id;
    } catch {
      return false;
    }
  }

  async cmdQuitar(a: string[]): Promise<number> {
    if (!a.length || !(a.length === 1 || (a.length === 2 && a[1] === "--borrar-credenciales"))) return this.err("uso: cuentas quitar ID [--borrar-credenciales]"), 2;
    const cid = a[0]!;
    if (cid in PROVEEDORES) return this.err(`${cid} es la cuenta de siempre de su proveedor: no se quita (se puede renombrar)`), 2;
    let borrar = false;
    let c: Cuenta | null = null;
    const r = await this.conCandado(() => {
      c = this.buscar(cid);
      if (!c) return this.err(`no hay ninguna cuenta ${cid}`), 1;
      borrar = a.includes("--borrar-credenciales") && !!c.dir && esDir(c.dir);
      if (borrar && !this.carpetaBorrable(c)) return this.err(`no borro ${c.dir}: no es una carpeta propia de trama (sacala a mano si de verdad es esa); la cuenta sigue en la lista`), 1;
      this.guardar(this.leerArchivo().filter((e) => e.id !== cid));
      return 0;
    });
    if (r) return r;
    const cu = c as unknown as Cuenta;
    if (borrar) {
      // los symlinks a lo compartido se borran como links, nunca se sigue adentro
      borrarSinSeguir(cu.dir!);
      this.print(`cuenta ${cid} quitada y su carpeta borrada`);
    } else this.print(`cuenta ${cid} quitada${cu.dir ? ` (su carpeta queda en ${cu.dir})` : ""}`);
    return 0;
  }

  async cmdRenombrar(a: string[]): Promise<number> {
    if (a.length !== 2 || !a[1]!.trim()) return this.err('uso: cuentas renombrar ID "Nombre"'), 2;
    const [cid, nombre] = a as [string, string];
    const r = await this.conCandado(() => {
      if (!this.buscar(cid)) return this.err(`no hay ninguna cuenta ${cid}`), 1;
      const ent = this.leerArchivo();
      const e = ent.find((x) => x.id === cid);
      if (e) e.nombre = nombre;
      else ent.push({ id: cid, proveedor: cid, nombre }); // la de siempre, todavía sin entrada
      this.guardar(ent);
      return 0;
    });
    if (r) return r;
    this.print(`${cid}: ${nombre}`);
    return 0;
  }

  async cmdLogin(a: string[]): Promise<number> {
    if (!a.length || !(a.length === 1 || (a.length === 2 && a[1] === "--imprimir"))) return this.err("uso: cuentas login ID [--imprimir]"), 2;
    const c = this.buscar(a[0]!);
    if (!c) return this.err(`no hay ninguna cuenta ${a[0]}`), 1;
    this.asegurarLinks(c);
    const cmd = await this.comandoLogin(c);
    if (a.includes("--imprimir")) {
      this.print(cmd.map((x) => (/^[\p{L}\p{N}_@%+=:,./-]+$/u.test(x) ? x : `'${x.replaceAll("'", "'\\''")}'`)).join(" "));
      return 0;
    }
    const i = cmd[0] === "env" ? cmd.findIndex((x, k) => k > 0 && !x.includes("=") && !x.startsWith("-u")) : 0;
    const prog = cmd[i]!;
    if (!enPath(prog, [], this.env)) return this.err(`no está instalado el CLI de ${c.proveedor}`), 1;
    // Python hacía `exec`; acá el login corre como hijo con la terminal heredada y su código es el nuestro
    return new Promise<number>((resolve) => {
      const h = spawn(prog, cmd.slice(i + 1), { stdio: "inherit", env: this.envDe(c) as NodeJS.ProcessEnv });
      h.on("error", () => resolve(127));
      h.on("close", (code, senal) => resolve(code ?? (senal ? 128 : 1)));
    });
  }

  cmdEnv(a: string[]): number {
    if (!a.length || !(a.length === 1 || (a.length === 2 && a[1] === "--json"))) return this.err("uso: cuentas env ID [--json]"), 2;
    const c = this.buscar(a[0]!);
    if (!c) return this.err(`no hay ninguna cuenta ${a[0]}`), 1;
    this.asegurarLinks(c);
    const [poner, sacar] = this.entorno(c);
    if (a.includes("--json")) {
      this.print(jsonPy({ id: c.id, proveedor: c.proveedor, motor: c.motor, nombre: c.nombre, defecto: c.defecto, poner, sacar, ...(c.plan !== undefined ? { plan: c.plan } : {}) }));
    } else {
      for (const v of sacar) this.print(`-${v}`);
      for (const [k, v] of Object.entries(poner).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) this.print(`${k}=${v}`);
    }
    return 0;
  }

  async cmdVer(a: string[]): Promise<number> {
    const resto = a.slice(1);
    const ok = resto.length === 0 || igualLista(resto, ["--json"]) || igualLista(resto, ["--verificar"]) || igualLista(resto, ["--json", "--verificar"]) || igualLista(resto, ["--verificar", "--json"]);
    if (!a.length || !ok) return this.err("uso: cuentas ver ID [--json] [--verificar]"), 2;
    const c = this.buscar(a[0]!);
    if (!c) return this.err(`no hay ninguna cuenta ${a[0]}`), 1;
    const d = await this.publico(c, a.includes("--verificar"));
    this.print(a.includes("--json") ? jsonPy(d) : `${d.id} ${d.proveedor} ${d.nombre}`);
    return 0;
  }

  async cmdPlan(a: string[]): Promise<number> {
    if (a.length === 2 && a[1] === "--detectar") {
      // El plan que dice `opencode models` de esa cuenta (la de siempre incluida): se imprime y, en una agregada, se guarda. 3 = no se pudo saber.
      const c = this.buscar(a[0]!);
      if (!c || c.proveedor !== "opencode") return this.err(`no hay ninguna cuenta de OpenCode ${a[0]}`), 1;
      const plan = await this.planDetectado(c);
      if (!plan) return 3;
      if (!c.defecto && plan !== (c.plan || "gratis") && !(plan === "go" && c.plan === "go-plus")) return this.cmdPlan([a[0]!, plan]);
      this.print(`${a[0]}: ${plan}`);
      return 0;
    }
    if (a.length !== 2 || !PLANES_OPENCODE.includes(a[1]!)) return this.err("uso: cuentas plan ID gratis|go|go-plus|--detectar"), 2;
    const [cid, plan] = a as [string, string];
    if (cid === "opencode") return this.err("el plan de la cuenta de siempre de OpenCode es `opencode_plan` de modelos.json (Ajustes > Plan y cupos)"), 2;
    const r = await this.conCandado(() => {
      const c = this.buscar(cid);
      if (!c || c.proveedor !== "opencode") return this.err(`no hay ninguna cuenta de OpenCode ${cid}`), 1;
      const ent = this.leerArchivo();
      for (const e of ent) {
        if (e.id === cid) {
          if (plan === "gratis") delete e.plan;
          else e.plan = plan;
        }
      }
      this.guardar(ent);
      return 0;
    });
    if (r) return r;
    this.print(`${cid}: ${plan}`);
    return 0;
  }
}

/** `os.path.realpath` no estricto. */
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

const porDefecto = (): Io => {
  process.stdout.on("error", () => {});
  return { out: (s) => void process.stdout.write(s), err: (s) => void process.stderr.write(s) };
};

export async function main(argv: string[], env: Env = process.env, io: Io = porDefecto()): Promise<number> {
  const c = new Cuentas(env, io);
  if (!argv.length || argv[0] === "--json" || argv[0] === "--verificar") return c.cmdListar(argv);
  if (argv[0] === "-h" || argv[0] === "--help") {
    io.out(AYUDA_CUENTAS);
    return 0;
  }
  const resto = argv.slice(1);
  switch (argv[0]) {
    case "agregar": return c.cmdAgregar(resto);
    case "quitar": return c.cmdQuitar(resto);
    case "renombrar": return c.cmdRenombrar(resto);
    case "login": return c.cmdLogin(resto);
    case "env": return c.cmdEnv(resto);
    case "ver": return c.cmdVer(resto);
    case "listar": return c.cmdListar(resto);
    case "plan": return c.cmdPlan(resto);
    default:
      io.out(AYUDA_CUENTAS);
      return 2;
  }
}

if (esPrincipal(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
