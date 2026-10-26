// trama por red: el mismo frontend que carga la ventana, servido por HTTP para abrirlo desde el
// celular por Tailscale. Quien llega acá maneja agentes que corren comandos en esta máquina, así que:
//  - se escucha SÓLO en las IPs de Tailscale de esta máquina (nunca 0.0.0.0, nunca la LAN);
//  - cada pedido tiene que venir de un dispositivo del usuario anotado en `remoto.json` (la identidad
//    la dice Tailscale por la IP de origen, electron/tailnet.ts); sin eso no se entrega nada, ni la página;
//  - el `Host` tiene que ser uno de los nombres de esta máquina (DNS rebinding) y lo que no es
//    abrir la página tiene que venir de la página misma (`Origin`, `Sec-Fetch-Site`: CSRF).
// Apagado salvo que exista `remoto.json` en el estado propio (docs/remoto.md).
// Los pedidos van por POST /rpc a los mismos manejadores del IPC; lo que el main avisa, por
// Server-Sent Events (/eventos), numerado: quien se reconecta recibe lo que se perdió.
// Sin `electron`: lo prueba tests/remoto.test.ts.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { escapar, icono, iconoPng, manifest, type Identidad } from "./identidad.ts";
import { cliente, type ConfigCliente } from "./remoto-cliente.ts";
import { ipLimpia } from "./tailnet.ts";
import { cookieValida, mismoToken } from "./token.ts";

export type ConfigRemoto = { puerto: number; dispositivos: string[] };

/** `remoto.json` (`{ version: 1, puerto, dispositivos }`, o con `activo: false`), o `null` si no está, está apagado o no sirve. */
export function leerConfig(archivo: string): ConfigRemoto | null {
  let j: { version?: unknown; puerto?: unknown; dispositivos?: unknown; activo?: unknown };
  try {
    j = JSON.parse(readFileSync(archivo, "utf8"));
  } catch {
    return null;
  }
  const { puerto, dispositivos } = j ?? {};
  // `activo: false` lo escribe Ajustes al apagarlo: se conservan el puerto y la lista, pero no se escucha.
  if (j?.activo === false) return null;
  if (j?.version !== 1 || typeof puerto !== "number" || !Number.isInteger(puerto) || puerto < 1024 || puerto > 65535) return null;
  if (!Array.isArray(dispositivos)) return null;
  const ds = dispositivos.filter((d): d is string => typeof d === "string" && /^[a-z0-9-]{1,63}$/i.test(d));
  return ds.length ? { puerto, dispositivos: ds } : null;
}

export type OpcionesRemoto = {
  /** La carpeta del frontend compilado (`dist/`). */
  dist: string;
  /** El preload compilado (`dist-electron/preload.cjs`): el navegador lo corre con un `electron` de mentira. */
  preload: string;
  /** Los nombres por los que se puede entrar (lo que puede decir `Host`, sin puerto). */
  nombres: string[];
  /** Las IPs de esta máquina: lo que llega desde ellas es de acá (el proxy de `tailscale serve`, o un navegador local). */
  propias: string[];
  /** Si esa IP es de un dispositivo del usuario. */
  entra(ip: string): Promise<boolean>;
  /** Corre el manejador de un canal del IPC. `ip` es la dirección real del socket (nunca `X-Forwarded-For`). */
  llamar(canal: string, args: unknown[], cliente: string, ip?: string): Promise<unknown>;
  /** La query de la ventana (se pide en cada carga: el idioma o la letra pudieron cambiar). */
  consulta(): Record<string, string>;
  /** Quién es esta máquina (PC o Dell): título, color y ícono de lo que se sirve. Sin ella, o con `propia: false`, todo sale como siempre. */
  identidad?(): Identidad;
  /** Un cliente se fue hace rato: se suelta lo que tenía tomado. */
  seFue(cliente: string): void;
  changelog: string;
  /** El secreto del modo local: si devuelve uno, todo pedido necesita la cookie `trama=<token>` (se la da `/?t=<token>`). Sin esto (la tailnet) no se pide nada más. */
  token?(): string | null;
  /** Para probar. */
  latidoMs?: number;
  graciaMs?: number;
};

/** Lo que llevan estado entero: del que se perdió varios, sólo le sirve el último. */
const ESTADOS = new Set(["statusline:cambio", "hilos:cambio", "salud:cambio", "auto:cambio", "claude:version", "agy:version", "tablero:cambio", "nombres:orden", "reinicio:cambio", "maquinas:cambio", "pc:cambio"]);
/** Cuánto de lo avisado se guarda para quien se reconecta. */
const COLA_MAX = 5000;
/** Lo más grande que cabe en un mensaje: todas las imágenes, o un adjunto en base64. */
const CUERPO_MAX = 160 * 1024 * 1024;
/** Un celular que no lee no llena la memoria: pasado esto se corta y que se reconecte. */
const ATRASO_MAX = 16 * 1024 * 1024;

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

/** Lo que se le agrega al `index.html` al servirlo: el manifest (acceso directo) y el puente, antes del módulo. */
const cabeza = (color: string, extra: string) =>
  `<link rel="manifest" href="./manifest.webmanifest" /><meta name="theme-color" content="${color}" />` +
  `<meta name="mobile-web-app-capable" content="yes" />${extra}<script src="./remoto.js"></script>`;

/**
 * La página con el puente. De una máquina con identidad propia (`i.propia`) también cambia el título, el color y
 * el nombre del acceso directo: así el celular puede tener una entrada por máquina. Sin ella, igual que siempre.
 */
export function conPuente(html: string, i?: Identidad): string {
  let h = html;
  let c = cabeza("#0a0a0a", "");
  if (i?.propia) {
    h = h.replace(/<title>[^<]*<\/title>/, () => `<title>${escapar(i.titulo)}</title>`);
    c = cabeza(i.fondo, `<meta name="apple-mobile-web-app-title" content="${escapar(i.corto)}" /><link rel="apple-touch-icon" href="./icon-192.png" />`);
  }
  const k = h.search(/<script\b/);
  if (k >= 0) return h.slice(0, k) + c + h.slice(k);
  return h.replace("</head>", () => `${c}</head>`);
}

/** Lo que sale distinto en cada máquina con identidad propia. */
const PROPIOS = new Set(["/manifest.webmanifest", "/favicon.svg", "/icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable.png"]);

const esCliente = (c: unknown): c is string => typeof c === "string" && /^[0-9a-f]{8,64}$/.test(c);

export type OpcionesCanal = {
  /** Corre el manejador de un canal del núcleo. `ip` es la dirección real del socket (nunca `X-Forwarded-For`). */
  llamar(canal: string, args: unknown[], cliente: string, ip?: string): Promise<unknown>;
  /** Un cliente se fue hace rato: se suelta lo que tenía tomado. */
  seFue(cliente: string): void;
  /** Si el `/rpc` exige `Origin` (un navegador siempre lo manda: CSRF). El socket local no lo trae. */
  conOrigen: boolean;
  latidoMs?: number;
  graciaMs?: number;
};

/**
 * Los pedidos (`POST /rpc`) y los eventos (`GET /eventos`, numerados: quien vuelve con `desde` recibe
 * lo que se perdió) sin nada de quién entra: eso lo resuelve quien atiende (crearRemoto: Tailscale,
 * Host, Origin; electron/local.ts: el socket en una carpeta 0700).
 */
export function crearCanal(o: OpcionesCanal) {
  const latidoMs = o.latidoMs ?? 20_000;
  const graciaMs = o.graciaMs ?? 10 * 60_000;
  const epoca = randomBytes(6).toString("hex");
  let n = 0;
  /** El último número que ya no está en la cola. */
  let piso = 0;
  let cola: { n: number; canal: string; dato: unknown }[] = [];
  const clientes = new Map<string, { flujos: Set<ServerResponse>; adios: NodeJS.Timeout | null }>();
  const flujos = new Set<ServerResponse>();
  let latido: NodeJS.Timeout | null = null;

  /** El cliente dio señales: mientras no tenga un flujo abierto, corre su despedida. */
  function tocar(c: string) {
    let x = clientes.get(c);
    if (!x) clientes.set(c, (x = { flujos: new Set(), adios: null }));
    if (x.adios) clearTimeout(x.adios);
    x.adios = null;
    if (x.flujos.size) return x;
    x.adios = setTimeout(() => {
      clientes.delete(c);
      o.seFue(c);
      // Sin nadie que pueda volver a pedirla, la cola no se guarda.
      if (!clientes.size) {
        cola = [];
        piso = n;
      }
    }, graciaMs);
    x.adios.unref();
    return x;
  }

  const linea = (e: { n: number; canal: string; dato: unknown }) => `id: ${epoca}-${e.n}\ndata: ${JSON.stringify({ c: e.canal, d: e.dato })}\n\n`;

  function escribir(res: ServerResponse, texto: string) {
    if (res.writableLength > ATRASO_MAX) return void res.destroy();
    res.write(texto);
  }

  /** Lo que el main le avisa a la ventana, también a los que están por red. */
  function difundir(canal: string, dato: unknown) {
    if (!clientes.size) return;
    const e = { n: ++n, canal, dato };
    if (ESTADOS.has(canal)) {
      const k = cola.findIndex((x) => x.canal === canal);
      if (k >= 0) cola.splice(k, 1);
    }
    cola.push(e);
    if (cola.length > COLA_MAX) piso = cola.shift()!.n;
    if (!flujos.size) return;
    let texto: string;
    try {
      texto = linea(e);
    } catch {
      return;
    }
    for (const f of flujos) escribir(f, texto);
  }

  function eventos(req: IncomingMessage, res: ServerResponse, url: URL) {
    const c = url.searchParams.get("c");
    if (!esCliente(c)) return void negar(res, 400);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
    const x = tocar(c);
    if (x.adios) clearTimeout(x.adios);
    x.adios = null;
    x.flujos.add(res);
    flujos.add(res);
    if (!latido) {
      latido = setInterval(() => {
        for (const f of flujos) escribir(f, "event: latido\ndata: 1\n\n");
      }, latidoMs);
      latido.unref();
    }
    res.on("close", () => {
      flujos.delete(res);
      x.flujos.delete(res);
      if (!flujos.size && latido) {
        clearInterval(latido);
        latido = null;
      }
      if (clientes.get(c) === x) tocar(c);
    });

    // Vuelve uno que ya venía oyendo: lo que se perdió, o empezar de nuevo si ya no está (o es otra corrida de trama).
    const desde = url.searchParams.get("desde") ?? req.headers["last-event-id"];
    let texto = `retry: 3000\nevent: hola\nid: ${epoca}-${n}\ndata: 1\n\n`;
    if (typeof desde === "string" && desde) {
      const [ep, num] = desde.split("-");
      const k = Number(num);
      if (ep !== epoca || !Number.isInteger(k) || k < piso || k > n) return void res.write("event: resinc\ndata: 1\n\n");
      try {
        texto = `retry: 3000\n\n${cola.filter((e) => e.n > k).map(linea).join("")}event: hola\nid: ${epoca}-${n}\ndata: 1\n\n`;
      } catch {
        return void res.write("event: resinc\ndata: 1\n\n");
      }
    }
    res.write(texto);
  }

  function leerCuerpo(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const partes: Buffer[] = [];
      let total = 0;
      req.on("data", (b: Buffer) => {
        total += b.length;
        if (total > CUERPO_MAX) {
          reject(new Error("grande"));
          req.destroy();
        } else partes.push(b);
      });
      req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function rpc(req: IncomingMessage, res: ServerResponse, ip?: string) {
    const c = req.headers["x-trama-cliente"];
    // Con `Origin` (un POST de navegador siempre lo trae) y una cabecera propia: nada de formularios de otro sitio.
    if (req.method !== "POST" || !esCliente(c) || (o.conOrigen && req.headers.origin === undefined)) return negar(res, 403);
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return negar(res, 415);
    let canal: unknown;
    let args: unknown;
    try {
      ({ canal, args } = JSON.parse(await leerCuerpo(req), (_k, v) =>
        v && typeof v === "object" && typeof v.$bin === "string" && Object.keys(v).length === 1 ? Buffer.from(v.$bin, "base64") : v,
      ));
    } catch {
      return negar(res, 400);
    }
    if (typeof canal !== "string" || !Array.isArray(args)) return negar(res, 400);
    tocar(c);
    let cuerpo: string;
    try {
      cuerpo = JSON.stringify({ ok: true, valor: await o.llamar(canal, args, c, ip) });
    } catch (e) {
      cuerpo = JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) });
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(cuerpo);
  }

  /** Cuántos flujos de eventos hay abiertos (los clientes que están mirando ahora). */
  const conectados = () => flujos.size;

  return { difundir, eventos, rpc, conectados };
}

export function negar(res: ServerResponse, codigo: number) {
  if (res.headersSent) return void res.destroy();
  res.writeHead(codigo, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(String(codigo));
}

/** Lo que ve quien llega sin la cookie: sin recursos de afuera (nada más se le entrega). */
const PAGINA_SIN_TOKEN = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trama</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 16px;color:#222;background:#fafafa}code{background:#0001;padding:.1em .4em;border-radius:4px}@media(prefers-color-scheme:dark){body{color:#ddd;background:#181818}}</style></head><body>
<h1>Trama</h1>
<p>Abrí Trama desde su lanzador, o corré <code>trama-motor abrir</code> en una terminal.</p>
<p lang="en">Open Trama from its launcher, or run <code>trama-motor abrir</code> in a terminal.</p>
</body></html>`;

function sinToken(res: ServerResponse, pagina: boolean) {
  if (!pagina) return negar(res, 401);
  res.writeHead(401, { "content-type": TIPOS[".html"], "cache-control": "no-store" });
  res.end(PAGINA_SIN_TOKEN);
}

export function crearRemoto(o: OpcionesRemoto) {
  const latidoMs = o.latidoMs ?? 20_000;
  const { difundir, eventos, rpc, conectados } = crearCanal({ llamar: o.llamar, seFue: o.seFue, conOrigen: true, latidoMs, graciaMs: o.graciaMs });
  let preload: string | null = null;

  async function archivo(res: ServerResponse, ruta: string) {
    const cual = path.join(o.dist, path.normalize(ruta));
    if (ruta.includes("\0") || !cual.startsWith(o.dist + path.sep)) return negar(res, 404);
    let datos: Buffer;
    try {
      datos = await readFile(cual);
    } catch {
      return negar(res, 404);
    }
    res.writeHead(200, {
      "content-type": TIPOS[path.extname(cual).toLowerCase()] ?? "application/octet-stream",
      // Lo de `assets/` lleva el hash en el nombre; el resto se vuelve a pedir.
      "cache-control": ruta.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(datos);
  }

  /** Lo que cambia según la máquina: el manifest y el ícono, pintados con su identidad (los PNG se dibujan una vez). */
  function propio(res: ServerResponse, yo: Identidad, ruta: string) {
    let tipo = TIPOS[".png"];
    let cuerpo: Buffer | string;
    if (ruta === "/manifest.webmanifest") [tipo, cuerpo] = [TIPOS[".webmanifest"], manifest(yo)];
    else if (ruta === "/favicon.svg") [tipo, cuerpo] = [TIPOS[".svg"], icono(yo)];
    else cuerpo = iconoPng(yo, ruta === "/icon-192.png" ? 192 : ruta === "/icon.png" ? 256 : 512, ruta === "/icon-maskable.png");
    res.writeHead(200, { "content-type": tipo, "cache-control": "no-cache" });
    res.end(cuerpo);
  }

  async function atender(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("content-security-policy", "frame-ancestors 'none'");
    res.setHeader("cross-origin-resource-policy", "same-origin");

    const host = (req.headers.host ?? "").toLowerCase();
    let url: URL;
    let nombre: string;
    try {
      // El nombre sale de `Host` y de nada más (un `//otro/` en la ruta no lo cambia).
      nombre = new URL(`http://${host}`).hostname;
      url = new URL(`http://${host}${(req.url ?? "/").replace(/^\/+/, "/")}`);
    } catch {
      return negar(res, 400);
    }
    if (!host || url.hostname !== nombre || !o.nombres.includes(nombre)) return negar(res, 403);
    const pagina = req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html");
    // De otro sitio sólo se puede llegar navegando a la página (un link): nada de pedirle cosas desde allá.
    const origen = req.headers.origin;
    if (origen !== undefined) {
      let mismo = false;
      try {
        mismo = new URL(origen).host === host;
      } catch {}
      if (!mismo) return negar(res, 403);
    }
    const sitio = req.headers["sec-fetch-site"];
    if (sitio !== undefined && sitio !== "same-origin" && sitio !== "none" && !(pagina && req.headers["sec-fetch-mode"] === "navigate")) return negar(res, 403);

    // Quién es: la IP que se conectó; si se conectó esta misma máquina, la que dice el proxy de `tailscale serve`.
    const de = ipLimpia(req.socket.remoteAddress);
    const reenviado = req.headers["x-forwarded-for"];
    const ip = o.propias.includes(de) && reenviado !== undefined ? ipLimpia(String(reenviado).trim()) : de;
    if (!(await o.entra(ip).catch(() => false))) return negar(res, 403);

    // Modo local: sin la cookie del token no se entrega nada, salvo la página que explica cómo abrir Trama.
    const token = o.token?.() ?? null;
    if (token && !cookieValida(req.headers.cookie, token)) {
      const dado = pagina ? url.searchParams.get("t") : null;
      if (dado === null || !mismoToken(dado, token)) return sinToken(res, pagina);
      // Token bueno por la URL: pasa a una cookie y se redirige a `/` para que no quede en la barra ni en el historial.
      res.writeHead(303, { location: "/", "set-cookie": `trama=${token}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store" });
      return void res.end();
    }

    // Al núcleo va la IP real del socket (`de`), nunca `X-Forwarded-For`: un pedido por la tailnet no puede hacerse pasar por loopback.
    if (url.pathname === "/rpc") return rpc(req, res, de);
    if (req.method !== "GET" && req.method !== "HEAD") return negar(res, 405);
    if (url.pathname === "/eventos") return eventos(req, res, url);
    if (pagina) {
      let html: string;
      try {
        html = conPuente(await readFile(path.join(o.dist, "index.html"), "utf8"), o.identidad?.());
      } catch {
        return negar(res, 404);
      }
      res.writeHead(200, { "content-type": TIPOS[".html"], "cache-control": "no-store" });
      return void res.end(html);
    }
    if (url.pathname === "/remoto.js") {
      // El preload de cuando arrancó trama: el que entiende este main.
      preload ??= await readFile(o.preload, "utf8").catch(() => null);
      if (preload === null) return negar(res, 404);
      const cfg: ConfigCliente = { query: new URLSearchParams(o.consulta()).toString(), changelog: o.changelog, latido: latidoMs };
      res.writeHead(200, { "content-type": TIPOS[".js"], "cache-control": "no-store" });
      return void res.end(`(${cliente})(${JSON.stringify(cfg)},function(require,exports,module){${preload}\n});\n`);
    }
    const yo = o.identidad?.();
    if (yo?.propia && PROPIOS.has(url.pathname)) return propio(res, yo, url.pathname);
    let ruta: string;
    try {
      ruta = decodeURIComponent(url.pathname);
    } catch {
      return negar(res, 400);
    }
    return archivo(res, ruta);
  }

  /** Un servidor por IP (nunca sin IP: eso sería escuchar en todas). */
  function escuchar(ip: string, puerto: number): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      if (!ip || ip === "0.0.0.0" || ip === "::") return reject(new Error("sin IP"));
      const s = http.createServer((req, res) => void atender(req, res).catch(() => negar(res, 500)));
      s.once("error", reject);
      s.listen(puerto, ip, () => resolve(s));
    });
  }

  return { atender, difundir, escuchar, conectados };
}
