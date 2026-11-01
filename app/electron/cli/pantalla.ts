// pantalla — control de pantalla para workers de frontend/diseño (#1869): abrir una Trama PROPIA (offscreen, con datos de
// ejemplo, sin tocar el escritorio ni el HOME del dueño), sacarle capturas, hacer clic y escribir, para probar la interfaz solos.
// Funciona igual en Linux y Windows: Electron offscreen + webContents.capturePage / sendInputEvent (electron/pantalla.ts), sin
// dependencias nuevas. Misma carcasa que scripts/captura.sh, pero la ventana queda viva entre comandos.
//
//   pantalla abrir [estado] [VAR=valor ...]   lanza la ventana (estado = los de `Captura` en src/modo.ts; default «normal»)
//        [--tam "1280 800"] [--escala 1] [--app <carpeta de app/>] [--sesion <nombre>]
//   pantalla captura [-o archivo.png]         la deja en un PNG (default: la carpeta de la sesión) y dice la ruta
//   pantalla clic <x> <y> | --sel "<css>"     clic (--derecho, --doble); x e y en píxeles de la captura; --sel apunta al centro del elemento
//   pantalla escribir "<texto>"               escribe en lo que tenga el foco (hacé clic en el campo antes)
//   pantalla tecla <Enter|Tab|Escape|ctrl+k…>  una tecla o combinación
//   pantalla rueda <dy> [x y]                 scroll (positivo = hacia abajo)
//   pantalla donde "<css>"                    {x,y,ancho,alto} del elemento, en píxeles de la captura
//   pantalla leer ["<css>"]                   el texto visible (de todo, o del elemento)
//   pantalla js "<expresión>"                 evalúa JavaScript en la página (mirar el DOM, estilos computados) y muestra el valor
//   pantalla estado                           si la ventana vive y su tamaño
//   pantalla cerrar                           cierra la ventana (sola se cierra a los 10 min sin pedidos)
//
// Cada worker tiene su sesión (por defecto una por carpeta de trabajo; --sesion la nombra): dos workers no se pisan.
// Dónde está la app: --app, $TRAMA_APP, la del checkout (app/ junto a motor/) o la de ~/.config/trama/app; necesita el build
// (`npm run build` en app/) y electron en su node_modules. Sale 0 si anduvo, 1 si la orden falló, 2 por uso o entorno.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configTrama, delimitadorDe, esWindows, homeDe } from "../rutas.ts";
import { esPrincipal } from "./base/principal.ts";
import type { Sesion } from "../pantalla.ts";

type Env = Record<string, string | undefined>;
export type Salida = { out: (s: string) => void; err: (s: string) => void };

export const USO = `uso: pantalla <orden> [argumentos]
  abrir [estado] [VAR=valor ...] [--tam "1280 800"] [--escala 1] [--app <carpeta>] [--sesion <nombre>]
  captura [-o archivo.png]       clic <x> <y> | --sel "<css>" [--derecho] [--doble]
  escribir "<texto>"             tecla <Enter|Tab|Escape|ctrl+k…>
  rueda <dy> [x y]               donde "<css>"        leer ["<css>"]
  js "<expresión>"               estado               cerrar
(x e y son píxeles de la captura; --sesion nombra la ventana, por defecto una por carpeta de trabajo)
`;

/** Cuánto se espera a que la ventana publique su sesión tras lanzarla. */
const ARRANQUE_MS = 45_000;

export type Pedido = { orden: string; posicionales: string[]; opciones: Record<string, string | true> };
const CON_VALOR = new Set(["tam", "escala", "app", "sesion", "o", "sel"]);

/** `clic 10 20 --sel x --doble` → orden, posicionales y opciones. Un argumento `-o`/`--tam` toma el valor siguiente. */
export function parsear(argv: string[]): Pedido | null {
  const [orden, ...resto] = argv;
  if (!orden) return null;
  const posicionales: string[] = [];
  const opciones: Pedido["opciones"] = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    const m = /^--?([a-z]+)(?:=(.*))?$/.exec(a);
    if (m && !/^-\d/.test(a)) {
      if (CON_VALOR.has(m[1])) {
        const v = m[2] ?? resto[++i];
        if (v === undefined) return null;
        opciones[m[1]] = v;
      } else opciones[m[1]] = m[2] ?? true;
    } else posicionales.push(a);
  }
  return { orden, posicionales, opciones };
}

/** La carpeta donde viven las sesiones de `pantalla` (`TRAMA_PANTALLA_DIR` la mueve). */
export const carpetaSesiones = (env: Env = process.env) => env.TRAMA_PANTALLA_DIR || path.join(os.tmpdir(), `trama-pantalla-${os.userInfo().username.replace(/[^\w.-]/g, "_")}`);

/** El nombre de la sesión: el pedido, o uno estable por carpeta de trabajo (dos worktrees distintos no comparten ventana). */
export function nombreSesion(opciones: Pedido["opciones"], cwd: string): string {
  const dado = opciones.sesion;
  if (typeof dado === "string") return dado.replace(/[^\w.-]/g, "_").slice(0, 60) || "x";
  return "w" + createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 8);
}

/**
 * El entorno de la ventana: nunca con lo del dueño. Un HOME vacío con sus XDG/AppData temporales, estado y perfil temporales,
 * y un PATH sin carpetas del home (ahí viven el `pa` y el `claude` del dueño). `electron/aislar.ts` hace fallar la corrida
 * (salida 97) si algo igual lo toca. Lo gráfico (WAYLAND_DISPLAY, DISPLAY, XDG_RUNTIME_DIR) se hereda.
 */
export function entornoAislado(env: Env, casa: string, motor: string, extra: Record<string, string>, carpeta: string): Env {
  const win = esWindows();
  const home = homeDe(env);
  const bajoHome = (p: string) => !!home && (win ? p.toLowerCase().startsWith(home.toLowerCase()) : p === home || p.startsWith(home + "/"));
  const camino = (env.PATH ?? env.Path ?? "").split(delimitadorDe()).filter((d) => d && !bajoHome(d)).join(delimitadorDe());
  const limpio: Env = { ...env };
  for (const k of ["CLAUDE_CONFIG_DIR", "PA_STATE", "PROYECTOS_REGISTRY", "TABLERO_DIR", "TABLERO_VISTA", "HILOS_BENCH", "HILOS_GUION", "HILOS_PRUEBA", "HILOS_CAPTURA_PNG", "HILOS_DEV_URL", "TRAMA_UNIDAD"]) delete limpio[k];
  return {
    ...limpio,
    HOME: casa,
    USERPROFILE: casa,
    APPDATA: path.join(casa, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(casa, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(casa, ".config"),
    XDG_DATA_HOME: path.join(casa, ".local", "share"),
    XDG_CACHE_HOME: path.join(casa, ".cache"),
    XDG_STATE_HOME: path.join(casa, ".local", "state"),
    PATH: camino,
    Path: camino,
    HILOS_STATE: path.join(casa, "estado"),
    HILOS_PERFIL: path.join(casa, "perfil"),
    HILOS_AISLAR_PERMITE: [motor, env.HILOS_AISLAR_PERMITE].filter(Boolean).join(":"),
    HILOS_PANTALLA: carpeta,
    HILOS_IDIOMA: env.HILOS_IDIOMA ?? "es",
    ...extra,
  };
}

/** Dónde está la app compilada (`dist/index.html` + `dist-electron/main.js`): --app, $TRAMA_APP, la de este checkout, la instalada. */
export function buscarApp(opc: { app?: string; env: Env; aqui: string }): string | null {
  const instalada = (() => {
    try {
      return readFileSync(path.join(configTrama(opc.env), "app"), "utf8").trim();
    } catch {
      return "";
    }
  })();
  const candidatas = [opc.app, opc.env.TRAMA_APP, path.resolve(opc.aqui, "..", ".."), instalada];
  for (const c of candidatas) if (c && existsSync(path.join(c, "dist", "index.html")) && existsSync(path.join(c, "dist-electron", "main.js"))) return path.resolve(c);
  return null;
}

/** El binario de Electron de esa app (`node_modules/electron`), o null. */
export function binarioElectron(app: string): string | null {
  try {
    const ruta = createRequire(path.join(app, "package.json"))("electron") as unknown;
    return typeof ruta === "string" && existsSync(ruta) ? ruta : null;
  } catch {
    return null;
  }
}

const leerSesion = (carpeta: string): Sesion | null => {
  try {
    const s = JSON.parse(readFileSync(path.join(carpeta, "sesion.json"), "utf8")) as Sesion;
    return typeof s.puerto === "number" && typeof s.token === "string" ? s : null;
  } catch {
    return null;
  }
};

export type Resp = { estado: number; tipo: string; cuerpo: Buffer };

/** Un pedido a la ventana. Rechaza si no contesta (ventana muerta). */
export function pedir(s: Sesion, orden: string, cuerpo: object = {}): Promise<Resp> {
  return new Promise((listo, fallo) => {
    const datos = Buffer.from(JSON.stringify(cuerpo));
    const req = http.request(
      { host: "127.0.0.1", port: s.puerto, path: `/${orden}`, method: "POST", headers: { "x-trama-pantalla": s.token, "content-type": "application/json", "content-length": datos.length }, timeout: 30_000 },
      (res) => {
        const trozos: Buffer[] = [];
        res.on("data", (t: Buffer) => trozos.push(t));
        res.on("end", () => listo({ estado: res.statusCode ?? 0, tipo: String(res.headers["content-type"] ?? ""), cuerpo: Buffer.concat(trozos) }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("la ventana no contesta")));
    req.on("error", fallo);
    req.end(datos);
  });
}

/** Lo que `abrir` necesita del entorno, inyectable para probar sin Electron. */
export type Deps = {
  /** Lanza la ventana; resuelve cuando ya publicó su sesión, o rechaza con el motivo. */
  lanzar: (o: { app: string; electron: string; carpeta: string; env: Env }) => Promise<void>;
  cwd: string;
  aqui: string;
};

async function lanzarElectron(o: { app: string; electron: string; carpeta: string; env: Env }): Promise<void> {
  mkdirSync(o.carpeta, { recursive: true });
  const log = openSync(path.join(o.carpeta, "electron.log"), "w");
  let salio: number | null | undefined;
  const hijo = spawn(o.electron, [o.app], { detached: true, stdio: ["ignore", log, log], env: o.env as NodeJS.ProcessEnv, windowsHide: true });
  hijo.on("exit", (c) => (salio = c ?? -1));
  hijo.unref();
  closeSync(log);
  const tope = Date.now() + ARRANQUE_MS;
  // espera-justificada: es la CLI, no un test; se espera a que otro proceso publique su sesión (con tope y sin colgarse si murió)
  while (Date.now() < tope) {
    if (leerSesion(o.carpeta)) return;
    if (salio !== undefined) throw new Error(`Electron salió con ${salio} antes de abrir la ventana (mirá ${path.join(o.carpeta, "electron.log")})`);
    await new Promise((r) => setTimeout(r, 100));
  }
  hijo.kill();
  throw new Error(`la ventana no abrió en ${ARRANQUE_MS / 1000} s (mirá ${path.join(o.carpeta, "electron.log")})`);
}

const aqui = path.dirname(fileURLToPath(import.meta.url));
const depsReales = (): Deps => ({ lanzar: lanzarElectron, cwd: process.cwd(), aqui });

const texto = (r: Resp) => r.cuerpo.toString("utf8");
const motivo = (r: Resp) => {
  try {
    return String((JSON.parse(texto(r)) as { error?: unknown }).error ?? texto(r));
  } catch {
    return texto(r) || `HTTP ${r.estado}`;
  }
};

export async function main(argv: string[], env: Env = process.env, io: Salida = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }, deps: Deps = depsReales()): Promise<number> {
  const p = parsear(argv);
  if (!p || p.orden === "-h" || p.orden === "--help" || p.orden === "ayuda") {
    (p ? io.out : io.err)(USO);
    return p ? 0 : 2;
  }
  const sesion = nombreSesion(p.opciones, deps.cwd);
  const carpeta = path.join(carpetaSesiones(env), sesion);
  const usoMal = (m: string) => (io.err(`pantalla: ${m}\n`), 2);

  if (p.orden === "abrir") {
    const previa = leerSesion(carpeta);
    if (previa) {
      const viva = await pedir(previa, "estado").catch(() => null);
      if (viva?.estado === 200) {
        io.out(`pantalla: la sesión «${sesion}» ya está abierta (${texto(viva)}); usá «pantalla cerrar» para reabrirla\n`);
        return 0;
      }
    }
    const app = buscarApp({ app: typeof p.opciones.app === "string" ? p.opciones.app : undefined, env, aqui: deps.aqui });
    if (!app) return usoMal("no encuentro la app compilada (dist/ y dist-electron/): corré `npm run build` en app/, o pasá --app <carpeta>");
    const electron = binarioElectron(app);
    if (!electron) return usoMal(`no encuentro electron en ${path.join(app, "node_modules")}: corré \`npm install\` en app/`);
    const estado = p.posicionales.find((a) => !a.includes("=")) ?? "normal";
    if (!/^[\w-]+$/.test(estado)) return usoMal(`estado raro: «${estado}»`);
    const extra: Record<string, string> = {};
    for (const a of p.posicionales.filter((x) => x.includes("="))) {
      const [k, ...v] = a.split("=");
      if (!/^(HILOS|TRAMA)_[A-Z_]+$/.test(k)) return usoMal(`sólo se aceptan variables HILOS_* o TRAMA_*: «${k}»`);
      extra[k] = v.join("=");
    }
    const tam = typeof p.opciones.tam === "string" ? p.opciones.tam : "1280 800";
    if (!/^\d{3,4}[ x]\d{3,4}$/.test(tam)) return usoMal(`--tam «ancho alto» en píxeles, por ejemplo "1280 800": «${tam}»`);
    const escala = typeof p.opciones.escala === "string" ? p.opciones.escala : "1";
    if (!(Number(escala) >= 0.5 && Number(escala) <= 3)) return usoMal("--escala entre 0.5 y 3");
    mkdirSync(carpeta, { recursive: true });
    const casa = path.join(carpeta, "casa");
    mkdirSync(casa, { recursive: true });
    const motor = path.resolve(app, "..", "motor");
    const entorno = entornoAislado(env, casa, motor, { HILOS_CAPTURA: estado, HILOS_TAM: tam.replace("x", " "), HILOS_ESCALA: escala, ...extra }, carpeta);
    try {
      await deps.lanzar({ app, electron, carpeta, env: entorno });
    } catch (e) {
      return usoMal((e as Error).message);
    }
    io.out(`pantalla: sesión «${sesion}» abierta en «${estado}» (${tam}). Siguiente: pantalla captura\n`);
    return 0;
  }

  const s = leerSesion(carpeta);
  if (!s) return usoMal(`no hay una ventana abierta en la sesión «${sesion}» (pantalla abrir [estado])`);
  const mandar = async (orden: string, cuerpo?: object): Promise<Resp | null> => {
    try {
      return await pedir(s, orden, cuerpo);
    } catch (e) {
      io.err(`pantalla: la ventana de la sesión «${sesion}» no contesta (${(e as Error).message}); abrila de nuevo con «pantalla abrir»\n`);
      return null;
    }
  };
  const resultado = (r: Resp | null, ok: (r: Resp) => void): number => {
    if (!r) return 1;
    if (r.estado !== 200) return (io.err(`pantalla: ${motivo(r)}\n`), 1);
    ok(r);
    return 0;
  };
  const numeros = (xs: string[]) => xs.map(Number);

  switch (p.orden) {
    case "estado":
      return resultado(await mandar("estado"), (r) => io.out(texto(r) + "\n"));
    case "captura": {
      const r = await mandar("captura");
      return resultado(r, (r) => {
        const dado = typeof p.opciones.o === "string" ? path.resolve(deps.cwd, p.opciones.o) : "";
        const salida = dado || path.join(carpeta, `captura-${readdirSync(carpeta).filter((f) => f.startsWith("captura-")).length + 1}.png`);
        mkdirSync(path.dirname(salida), { recursive: true });
        writeFileSync(salida, r.cuerpo);
        io.out(salida + "\n");
      });
    }
    case "clic": {
      let xy: number[];
      if (typeof p.opciones.sel === "string") {
        const d = await mandar("donde", { selector: p.opciones.sel });
        if (!d || d.estado !== 200) return resultado(d, () => undefined);
        const o = JSON.parse(texto(d)) as { x: number; y: number };
        xy = [o.x, o.y];
      } else {
        xy = numeros(p.posicionales.slice(0, 2));
        if (xy.length !== 2 || xy.some((n) => !Number.isFinite(n))) return usoMal("clic pide <x> <y> (píxeles de la captura) o --sel \"<css>\"");
      }
      const boton = p.opciones.derecho ? "right" : "left";
      return resultado(await mandar("clic", { x: xy[0], y: xy[1], boton, veces: p.opciones.doble ? 2 : 1 }), () => io.out(`clic en ${xy[0]},${xy[1]}\n`));
    }
    case "escribir": {
      const t = p.posicionales.join(" ");
      if (!t) return usoMal("escribir pide el texto entre comillas");
      return resultado(await mandar("escribir", { texto: t }), () => io.out("escrito\n"));
    }
    case "tecla": {
      if (!p.posicionales[0]) return usoMal("tecla pide una tecla (Enter, Tab, Escape, ctrl+k…)");
      return resultado(await mandar("tecla", { tecla: p.posicionales[0] }), () => io.out(`tecla ${p.posicionales[0]}\n`));
    }
    case "rueda": {
      const [dy, x, y] = numeros(p.posicionales);
      if (!Number.isFinite(dy)) return usoMal("rueda pide <dy> (positivo = hacia abajo) y, opcional, x y");
      return resultado(await mandar("rueda", { dy, x: Number.isFinite(x) ? x : 100, y: Number.isFinite(y) ? y : 100 }), () => io.out("rueda\n"));
    }
    case "donde":
      if (!p.posicionales[0]) return usoMal("donde pide un selector CSS");
      return resultado(await mandar("donde", { selector: p.posicionales[0] }), (r) => io.out(texto(r) + "\n"));
    case "leer":
      return resultado(await mandar("leer", { selector: p.posicionales[0] ?? "" }), (r) => io.out(texto(r) + "\n"));
    case "js": {
      const codigo = p.posicionales.join(" ");
      if (!codigo) return usoMal("js pide una expresión de JavaScript entre comillas");
      return resultado(await mandar("js", { codigo }), (r) => io.out(JSON.stringify((JSON.parse(texto(r)) as { valor: unknown }).valor) + "\n"));
    }
    case "cerrar":
      return resultado(await mandar("cerrar"), () => io.out(`sesión «${sesion}» cerrada\n`));
    default:
      return usoMal(`orden desconocida: «${p.orden}»\n${USO}`);
  }
}

if (esPrincipal(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
