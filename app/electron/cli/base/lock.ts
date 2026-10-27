// Locks exclusivos por clave (una ruta), sin addons nativos. Reemplazan al `flock` de `pa`.
//
// Mecanismo: el que tiene el lock es el que ESCUCHA en un socket con nombre derivado de la ruta.
//   Linux:   socket abstracto `\0trama-<sha1(ruta)>` (no crea archivo, no hay nada que limpiar)
//   Windows: named pipe `\\.\pipe\trama-<usuario>-<sha1(ruta)>`
// El kernel cierra el socket cuando el proceso muere (incluso con kill -9), así que el lock se libera solo.
// La ruta NO se toca en disco: es sólo la clave (en Windows se normaliza: minúsculas y `\`, porque NTFS no distingue mayúsculas).
//
// Mapeo de las formas de flock que usa `pa` (ver motor/bin/pa):
//   flock -n FD / flock -n FD en un bucle de lugares  -> tomar(ruta)                      (null si ocupado)
//   flock -w N FD                                      -> tomar(ruta, { esperarMs: N*1000 }) (reintento cada 50-100 ms)
//   flock FD (bloqueante, sin tope)                    -> tomar(ruta, { esperarMs: Infinity })
//   flock -n -s ARCHIVO true  (`puesto_libre`)         -> !(await probar(ruta))
// `-s` (compartido) sólo se usa para SONDEAR "¿lo tiene alguien en exclusivo?", y para que dos sondeos a la vez no se vean
// ocupados entre sí. `probar` lo resuelve sin tomar nada: intenta CONECTAR al socket (si alguien escucha, está tomado), así que
// varios sondeos simultáneos no se estorban ni estorban a un `tomar`. No hay locks compartidos "de verdad" (varios lectores a la
// vez reteniendo el lock): pa no los usa, y si hicieran falta se implementarían con un contador de lectores (un `tomar` por
// lector sobre `<clave>#lector<i>` y el escritor que sondea todos), no con este mecanismo.
//
// Diferencia con flock: es por PROCESO-servidor, no por fd. El mismo proceso que ya tiene el lock también ve "ocupado" si
// vuelve a `tomar` (igual que flock con otro open). Nunca hereda un hijo: un hijo no recibe el socket (Node cierra fds ajenos en spawn),
// justo lo que `pa` consigue con `6>&-`.
//
// Canal de control opcional: el que tiene el lock acepta conexiones y, por cada línea JSON recibida, llama a `alMensaje(msg)`
// y contesta con una línea JSON (`consultar` es el cliente). Sirve para `--parar` / `--matar` en Windows (no hay SIGTERM).
// Un `probar` conecta y corta sin mandar nada: no dispara `alMensaje`.
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { plataformaActual, type Plataforma } from "../../rutas.ts";

type Env = Record<string, string | undefined>;

export type OpcionesNombre = { plat?: Plataforma; env?: Env; usuario?: string };

/** El usuario para el nombre de la pipe: sólo `[a-z0-9_-]`. */
export function usuarioDe(env: Env = process.env, usuario?: string): string {
  const u = usuario ?? env.USERNAME ?? env.USER ?? "usuario";
  return u.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "usuario";
}

/** La clave canónica de una ruta (lo que se hashea). */
export function claveDe(ruta: string, plat: Plataforma = plataformaActual()): string {
  if (plat === "win32") return path.win32.resolve(ruta).replace(/\//g, "\\").toLowerCase();
  return path.posix.resolve(ruta);
}

/** El nombre del socket para una ruta: abstracto en Linux/macOS (`\0trama-<sha1>`), named pipe en Windows. Puro. */
export function nombreLock(ruta: string, o: OpcionesNombre = {}): string {
  const plat = o.plat ?? plataformaActual();
  const hash = createHash("sha1").update(claveDe(ruta, plat)).digest("hex");
  if (plat === "win32") return `\\\\.\\pipe\\trama-${usuarioDe(o.env, o.usuario)}-${hash}`;
  return `\0trama-${hash}`;
}

export type Mensaje = Record<string, unknown>;
export type AlMensaje = (msg: Mensaje) => Mensaje | void | Promise<Mensaje | void>;
export type OpcionesTomar = OpcionesNombre & {
  /** Cuánto esperar si está ocupado (ms), reintentando cada 50-100 ms. 0 / omitido = no esperar. `Infinity` = sin tope. */
  esperarMs?: number;
  /** Canal de control: se llama por cada línea JSON que llegue al lock. Lo que devuelva se contesta (`{ok:true}` si nada). */
  alMensaje?: AlMensaje;
  /** Si el lock mantiene vivo el event loop (por defecto NO: el proceso sale aunque lo tenga tomado). */
  mantenerVivo?: boolean;
};

export type Lock = {
  readonly ruta: string;
  readonly nombre: string;
  /** Suelta el lock (cierra el socket y las conexiones). Idempotente. */
  liberar(): Promise<void>;
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = () => 50 + Math.floor(Math.random() * 51);

function escuchar(nombre: string, alMensaje: AlMensaje | undefined, mantenerVivo: boolean): Promise<net.Server | null> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>();
    const srv = net.createServer((s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
      s.on("error", () => {});
      let buf = "";
      s.setEncoding("utf8");
      s.on("data", (d: string) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const linea = buf.slice(0, i).replace(/\r$/, "");
          buf = buf.slice(i + 1);
          if (!linea.trim()) continue;
          void responder(s, linea, alMensaje);
        }
      });
    });
    (srv as net.Server & { _sockets?: Set<net.Socket> })._sockets = sockets;
    srv.once("error", (e: NodeJS.ErrnoException) => {
      // EADDRINUSE: ya lo tiene alguien. EACCES en una pipe de Windows ajena: también "ocupado".
      if (e.code === "EADDRINUSE" || e.code === "EACCES") resolve(null);
      else reject(e);
    });
    srv.listen(nombre, () => {
      srv.removeAllListeners("error");
      srv.on("error", () => {});
      if (!mantenerVivo) srv.unref();
      resolve(srv);
    });
  });
}

async function responder(s: net.Socket, linea: string, alMensaje: AlMensaje | undefined) {
  let salida: Mensaje = { ok: true };
  try {
    const msg = JSON.parse(linea) as Mensaje;
    const r = alMensaje ? await alMensaje(msg) : undefined;
    if (r) salida = r;
  } catch (e) {
    salida = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!s.destroyed) s.write(JSON.stringify(salida) + "\n");
}

/** Toma el lock de `ruta`. `null` si lo tiene otro (tras esperar `esperarMs`, si se pidió). Se libera solo si el proceso muere. */
export async function tomar(ruta: string, o: OpcionesTomar = {}): Promise<Lock | null> {
  const nombre = nombreLock(ruta, o);
  const espera = o.esperarMs ?? 0;
  const limite = espera === Infinity ? Infinity : Date.now() + espera;
  for (;;) {
    const srv = await escuchar(nombre, o.alMensaje, o.mantenerVivo ?? false);
    if (srv) return nuevoLock(ruta, nombre, srv);
    const queda = limite - Date.now();
    if (queda <= 0) return null;
    await dormir(Math.min(jitter(), queda));
  }
}

function nuevoLock(ruta: string, nombre: string, srv: net.Server): Lock {
  let cierre: Promise<void> | null = null;
  return {
    ruta,
    nombre,
    liberar() {
      cierre ??= new Promise<void>((resolve) => {
        const socks = (srv as net.Server & { _sockets?: Set<net.Socket> })._sockets;
        srv.close(() => resolve());
        for (const s of socks ?? []) s.destroy();
      });
      return cierre;
    },
  };
}

/** ¿Lo tiene alguien ahora? Conecta y corta: no toma nada, no estorba a otros sondeos ni a un `tomar` (ver el mapeo de `flock -n -s`). */
export function probar(ruta: string, o: OpcionesNombre & { timeoutMs?: number } = {}): Promise<boolean> {
  const nombre = nombreLock(ruta, o);
  return new Promise((resolve) => {
    const s = net.connect(nombre);
    let listo = false;
    const fin = (v: boolean) => {
      if (listo) return;
      listo = true;
      clearTimeout(t);
      s.destroy();
      resolve(v);
    };
    // sin servidor: ECONNREFUSED (socket abstracto muerto) / ENOENT (pipe inexistente). Cualquier otro error: no podemos decir que esté libre.
    s.once("connect", () => fin(true));
    s.once("error", (e: NodeJS.ErrnoException) => fin(!(e.code === "ECONNREFUSED" || e.code === "ENOENT")));
    const t = setTimeout(() => fin(true), o.timeoutMs ?? 2000); // conecta pero no contesta: hay alguien
  });
}

/** Le manda un mensaje al que tiene el lock y devuelve su respuesta. `null` si nadie lo tiene o no contesta a tiempo. */
export function consultar(ruta: string, msg: Mensaje, o: OpcionesNombre & { timeoutMs?: number } = {}): Promise<Mensaje | null> {
  const nombre = nombreLock(ruta, o);
  return new Promise((resolve) => {
    const s = net.connect(nombre);
    let buf = "";
    let listo = false;
    const fin = (v: Mensaje | null) => {
      if (listo) return;
      listo = true;
      clearTimeout(t);
      s.destroy();
      resolve(v);
    };
    const t = setTimeout(() => fin(null), o.timeoutMs ?? 5000);
    s.setEncoding("utf8");
    s.once("connect", () => s.write(JSON.stringify(msg) + "\n"));
    s.on("data", (d: string) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i < 0) return;
      try {
        fin(JSON.parse(buf.slice(0, i)) as Mensaje);
      } catch {
        fin(null);
      }
    });
    s.once("error", () => fin(null));
    s.once("close", () => fin(null));
  });
}
