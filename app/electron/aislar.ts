// Aislamiento de las corridas de prueba: bench, captura, pruebas (`HILOS_PRUEBA`) y fixtures (`HILOS_FIXTURES=1`)
// nunca tocan los datos del usuario. Con ese modo prendido, cada acceso de Node al sistema de archivos (fs, fs/promises)
// que caiga bajo el HOME de verdad (el de /etc/passwd, no `$HOME`), fuera del checkout y de lo que la prueba
// declara suyo (`HILOS_AISLAR_PERMITE`, carpetas separadas por `path.delimiter`: ":" o ";"), y cada proceso hijo que se lance fuera del checkout
// o de /tmp (el tmp del sistema, aunque cuelgue del home, como %TEMP% en Windows), se anota (`HILOS_AISLAR_LOG`, y stderr) y la app sale con 97. No corta nada: el dato igual se vería,
// pero la corrida no puede dar verde. Lo que lee Chromium por su cuenta (fuentes, perfil) no pasa por acá: eso lo
// aíslan los scripts con `HOME`/`XDG_*` propios (scripts/visual.mjs) y `userData` (main.ts).
//
// Va primero en main.ts y motor.ts: parchea `fs` antes de que los demás módulos lo usen.
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e = process.env;
/** ¿Esta corrida es de prueba? (las mismas señales que apagan el historial, el autointegrar, el motor real…; y `TRAMA_AISLAR=1`, que pone scripts/aislar-pruebas.mjs en cada archivo de `node --test`) */
export const enPrueba = !!(e.HILOS_BENCH || e.HILOS_CAPTURA || e.HILOS_CAPTURA_PNG || e.HILOS_PRUEBA || e.HILOS_GUION || e.HILOS_FIXTURES === "1" || e.TRAMA_AISLAR === "1");

const violaciones: string[] = [];

/** Las que se anotaron hasta ahora (tests). */
export const anotadas = () => violaciones.slice();

const WIN = process.platform === "win32";
/** Para comparar rutas: ya resueltas, y sin distinguir mayúsculas en Windows. */
const norm = (p: string) => (WIN ? path.resolve(p).toLowerCase() : path.resolve(p));
/** ¿`p` es `raiz` o cuelga de ella? Con el separador de la plataforma. */
const dentro = (p: string, raiz: string) => {
  const a = norm(p);
  const r = norm(raiz);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
};

/** `permitidas`: lo que vale bajo el home (el checkout y su node_modules, lo que la prueba declare). `temporales`: los tmp, que valen aunque cuelguen del home. */
export function crearAislamiento(opts: { home: string[]; permitidas: string[]; temporales: string[]; camino?: () => string; anotar: (linea: string) => void }) {
  return {
    /** ¿`p` es un dato del usuario? Bajo el home de verdad y fuera de lo permitido y de los tmp. */
    ajeno(p: string): boolean {
      if (!opts.home.some((h) => norm(p) !== norm(h) && dentro(p, h))) return false;
      return !opts.permitidas.some((x) => dentro(p, x)) && !opts.temporales.some((x) => dentro(p, x));
    },
    /** ¿`bin` (un comando) sale del checkout o de /tmp? Un nombre suelto se resuelve por el PATH: cuenta sólo si alguna de sus carpetas es del home. */
    binarioAjeno(bin: string): boolean {
      const suelto = !bin.includes("/") && !(WIN && bin.includes("\\"));
      if (!path.isAbsolute(bin)) return suelto ? (opts.camino?.() ?? "").split(path.delimiter).some((d) => !!d && this.ajeno(d)) || !opts.camino : this.ajeno(bin);
      return this.ajeno(bin);
    },
    anotar: opts.anotar,
  };
}

const comoRuta = (a: unknown): string | null => {
  if (typeof a === "string") return a;
  if (a instanceof URL) return a.protocol === "file:" ? fileURLToPath(a) : null;
  if (Buffer.isBuffer(a)) return a.toString();
  return null;
};

/** Funciones de fs cuyo segundo argumento también es una ruta. */
const DOS_RUTAS = /^(rename|copyFile|cp|symlink|link)(Sync)?$/;
/** Lo que no es acceso a una ruta aunque reciba un string. */
const IGNORA = new Set(["watchFile", "unwatchFile", "createWriteStream"]);

/** El código con que sale la app: `97` si la corrida tocó algo del usuario (`app.exit` no pasa por el evento `exit` de Node). */
export const codigoSalida = (codigo: number) => (violaciones.length && !codigo ? 97 : codigo);

let armado = false;
export function armarAislamiento(raiz: string) {
  if (armado || !enPrueba) return;
  armado = true;
  const real = (p: string) => {
    try {
      return fs.realpathSync.native(p); // .native: en Windows expande los nombres cortos 8.3 (RUNNER~1)
    } catch {
      return p;
    }
  };
  const homes = new Set<string>();
  try {
    homes.add(path.resolve(os.userInfo().homedir));
  } catch {}
  for (const h of [...homes]) homes.add(real(h));
  // `raiz` es `app/`; `motor/` es del mismo checkout (el respaldo y el lector de topes de OpenCode Go, por ejemplo).
  const motorRepo = path.join(raiz, "..", "motor");
  const permitidas = new Set<string>([raiz, real(raiz), real(path.join(raiz, "node_modules")), motorRepo, real(motorRepo), path.dirname(process.execPath), real(path.dirname(process.execPath))]);
  for (const p of (e.HILOS_AISLAR_PERMITE ?? "").split(path.delimiter).filter(Boolean)) permitidas.add(path.resolve(p));
  // Lo ambiental, de entrada: sin directorios del home en el PATH (ahí viven el `pa`, el `tablero` y el `claude` del usuario: el
  // resolvedor de binarios los buscaría) y, si `HOME` es el de verdad, uno vacío y temporal (`os.homedir()` y los XDG).
  const temporales = [os.tmpdir(), real(os.tmpdir())];
  const bajoHome = (p: string) => [...homes].some((h) => dentro(p, h));
  // Del usuario de verdad: bajo su home y fuera de lo permitido y de los tmp (en Windows %TEMP% cuelga del perfil).
  const delUsuario = (p: string) => bajoHome(p) && ![...permitidas, ...temporales].some((x) => dentro(p, x));
  if (e.PATH) e.PATH = e.PATH.split(path.delimiter).filter((d) => d && !delUsuario(d)).join(path.delimiter);
  const casaVacia = (e.HOME && delUsuario(e.HOME)) || (WIN && e.USERPROFILE && delUsuario(e.USERPROFILE));
  if (casaVacia) {
    const casa = fs.mkdtempSync(path.join(os.tmpdir(), "hilos-casa-"));
    e.HOME = casa;
    if (WIN) e.USERPROFILE = casa;
    for (const [k, sub] of [["XDG_CONFIG_HOME", ".config"], ["XDG_DATA_HOME", ".local/share"], ["XDG_CACHE_HOME", ".cache"], ["XDG_STATE_HOME", ".local/state"]] as const)
      if (!e[k] || delUsuario(e[k])) e[k] = path.join(casa, sub);
    process.on("exit", () => fs.rmSync(casa, { recursive: true, force: true }));
  }
  const archivo = e.HILOS_AISLAR_LOG;
  const apendar = fs.appendFileSync;
  const a = crearAislamiento({
    home: [...homes],
    permitidas: [...permitidas],
    temporales,
    camino: () => e.PATH ?? "",
    anotar: (linea) => {
      if (violaciones.includes(linea)) return;
      violaciones.push(linea);
      process.stderr.write(`[aislar] ${linea}\n`);
      if (archivo) {
        try {
          apendar(archivo, `${linea}\n`);
        } catch {}
      }
    },
  });

  const parchar = (mod: Record<string, unknown>, etiqueta: string) => {
    for (const nombre of Object.keys(mod)) {
      const orig = mod[nombre];
      if (typeof orig !== "function" || IGNORA.has(nombre) || /^[A-Z]/.test(nombre)) continue;
      const envuelta = function (this: unknown, ...args: unknown[]) {
        const n = DOS_RUTAS.test(nombre) ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const r = comoRuta(args[i]);
          if (r !== null && a.ajeno(r)) a.anotar(`${etiqueta}.${nombre} ${r}`);
        }
        return (orig as (...x: unknown[]) => unknown).apply(this, args);
      };
      for (const k of Reflect.ownKeys(orig)) {
        if (k === "length" || k === "name" || k === "prototype") continue;
        const d = Object.getOwnPropertyDescriptor(orig, k);
        if (d) Object.defineProperty(envuelta, k, d);
      }
      try {
        mod[nombre] = envuelta;
      } catch {}
    }
  };
  parchar(fs as unknown as Record<string, unknown>, "fs");
  parchar(fs.promises as unknown as Record<string, unknown>, "fs/promises");

  const hijos = ["spawn", "spawnSync", "execFile", "execFileSync", "fork"] as const;
  for (const nombre of hijos) {
    const orig = childProcess[nombre] as (...x: unknown[]) => unknown;
    (childProcess as unknown as Record<string, unknown>)[nombre] = function (this: unknown, ...args: unknown[]) {
      const bin = comoRuta(args[0]);
      if (bin !== null && a.binarioAjeno(bin)) a.anotar(`child_process.${nombre} ${bin}`);
      return orig.apply(this, args);
    };
  }
  syncBuiltinESMExports();

  // Sale con 97 si hubo algo: la corrida no puede dar verde con un dato del usuario a la vista.
  process.on("exit", (codigo) => {
    if (violaciones.length && !codigo) process.exitCode = 97;
  });
}

armarAislamiento(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
