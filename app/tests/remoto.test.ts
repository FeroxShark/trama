// trama por red (electron/remoto.ts): quién entra, qué se sirve, los pedidos y los avisos.
// El servidor de verdad en 127.0.0.1 con una identidad de mentira: "se conectó esta máquina" y
// la IP del cliente viene en X-Forwarded-For, como cuando delante está `tailscale serve`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { conPuente, crearRemoto, leerConfig } from "../electron/remoto.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-remoto-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const dist = path.join(tmp, "dist");
mkdirSync(path.join(dist, "assets"), { recursive: true });
writeFileSync(path.join(dist, "index.html"), '<html><head><script type="module" src="./assets/a.js"></script></head><body></body></html>');
writeFileSync(path.join(dist, "assets", "a.js"), "export {};");
writeFileSync(path.join(tmp, "secreto.txt"), "no");
// Un preload como el que deja tsc (CommonJS, `require("electron")`).
const preload = path.join(tmp, "preload.cjs");
writeFileSync(
  preload,
  `"use strict";
const electron_1 = require("electron");
const oir = (canal) => (fn) => { const f = (_e, d) => fn(d); electron_1.ipcRenderer.on(canal, f); return () => electron_1.ipcRenderer.off(canal, f); };
electron_1.contextBridge.exposeInMainWorld("hilos", {
  leer: () => electron_1.ipcRenderer.invoke("cosa:leer", 1, "dos"),
  archivo: (x) => electron_1.ipcRenderer.invoke("cosa:archivo", x),
  salir: () => electron_1.ipcRenderer.invoke("app:salir", false),
  alCambiar: oir("cosa:cambio"),
  conexion: { alCambiar: oir("remoto:conexion") },
});`,
);

const DISPOSITIVO = "192.0.2.9";
const HOST = "trama.test:8791";
const llamadas: { canal: string; args: unknown[]; cliente: string }[] = [];
const idos: string[] = [];
const remoto = crearRemoto({
  dist,
  preload,
  nombres: ["trama.test"],
  propias: ["127.0.0.1"],
  entra: async (ip) => ip === DISPOSITIVO,
  async llamar(canal, args, cliente) {
    llamadas.push({ canal, args, cliente });
    if (canal === "cosa:falla") throw new Error("no anduvo");
    return canal === "cosa:nada" ? undefined : { canal, args };
  },
  consulta: () => ({ fixtures: "0", idioma: "es" }),
  seFue: (c) => idos.push(c),
  changelog: "https://example.com/cambios",
  latidoMs: 60_000,
  graciaMs: 150,
});
const servidor = await remoto.escuchar("127.0.0.1", 0);
after(() => servidor.closeAllConnections?.() ?? servidor.close());
const puerto = (servidor.address() as { port: number }).port;

type Res = { codigo: number; cabeceras: http.IncomingHttpHeaders; cuerpo: string };
/** Un pedido como lo haría el celular de Ana, salvo lo que se pise. */
function pedir(ruta: string, x: { metodo?: string; cabeceras?: Record<string, string | undefined>; cuerpo?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const cabeceras: Record<string, string> = {};
    for (const [k, v] of Object.entries({ host: HOST, "x-forwarded-for": DISPOSITIVO, ...x.cabeceras })) if (v !== undefined) cabeceras[k] = v;
    const req = http.request({ host: "127.0.0.1", port: puerto, path: ruta, method: x.metodo ?? "GET", headers: cabeceras }, (res) => {
      let cuerpo = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (cuerpo += d));
      res.on("end", () => resolve({ codigo: res.statusCode ?? 0, cabeceras: res.headers, cuerpo }));
    });
    req.on("error", reject);
    req.end(x.cuerpo);
  });
}
const CLIENTE = "abcdef0123456789";
const rpc = (canal: string, args: unknown[], cabeceras: Record<string, string | undefined> = {}) =>
  pedir("/rpc", {
    metodo: "POST",
    cabeceras: { "content-type": "application/json", origin: `http://${HOST}`, "x-trama-cliente": CLIENTE, ...cabeceras },
    cuerpo: JSON.stringify({ canal, args }),
  });

/** Un flujo de avisos abierto: lo que fue llegando y cómo cerrarlo. */
function oir(ruta: string, cabeceras: Record<string, string> = {}) {
  let texto = "";
  let avisar = () => {};
  const req = http.request({ host: "127.0.0.1", port: puerto, path: ruta, headers: { host: HOST, "x-forwarded-for": DISPOSITIVO, ...cabeceras } }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (d) => {
      texto += d;
      avisar();
    });
  });
  req.on("error", () => {});
  req.end();
  return {
    /** Espera hasta que lo recibido cumpla. */
    async hasta(f: (t: string) => boolean) {
      const tope = Date.now() + 3000;
      while (!f(texto)) {
        if (Date.now() > tope) throw new Error(`no llegó: ${JSON.stringify(texto)}`);
        await new Promise<void>((r) => {
          avisar = r;
          setTimeout(r, 50);
        });
      }
      return texto;
    },
    cerrar: () => req.destroy(),
  };
}

test("remoto: sin identidad no se entrega nada, ni la página", async () => {
  for (const ruta of ["/", "/remoto.js", "/assets/a.js", "/eventos?c=" + CLIENTE, "/manifest.webmanifest"]) {
    assert.equal((await pedir(ruta, { cabeceras: { "x-forwarded-for": undefined } })).codigo, 403, `${ruta} sin identidad`);
    assert.equal((await pedir(ruta, { cabeceras: { "x-forwarded-for": "192.0.2.10" } })).codigo, 403, `${ruta} de otro nodo`);
  }
  assert.equal((await rpc("cosa:leer", [], { "x-forwarded-for": undefined })).codigo, 403);
  assert.equal((await rpc("cosa:leer", [], { "x-forwarded-for": `${DISPOSITIVO}, 192.0.2.10` })).codigo, 403, "una lista no es una IP");
  assert.equal(llamadas.length, 0, "ningún manejador corrió");
});

test("remoto: el Host tiene que ser un nombre de esta máquina (DNS rebinding)", async () => {
  assert.equal((await pedir("/", { cabeceras: { host: "malo.example:8791" } })).codigo, 403);
  assert.equal((await pedir("//trama.test/", { cabeceras: { host: "malo.example:8791" } })).codigo, 403);
  assert.equal((await pedir("/")).codigo, 200);
});

test("remoto: la página trae el puente antes del módulo y el manifest", async () => {
  const r = await pedir("/");
  assert.equal(r.codigo, 200);
  assert.ok(r.cuerpo.indexOf('<script src="./remoto.js">') < r.cuerpo.indexOf('<script type="module"'));
  assert.ok(r.cuerpo.includes('rel="manifest"'));
  assert.equal(r.cabeceras["x-frame-options"], "DENY");
  assert.equal(r.cabeceras["cross-origin-resource-policy"], "same-origin");
  assert.ok(conPuente("<html><head></head></html>").includes("remoto.js"), "sin <script>: antes de </head>");
});

test("remoto: archivos del frontend, y nada de afuera de dist", async () => {
  const a = await pedir("/assets/a.js");
  assert.equal(a.codigo, 200);
  assert.match(String(a.cabeceras["content-type"]), /javascript/);
  assert.match(String(a.cabeceras["cache-control"]), /immutable/);
  for (const ruta of ["/../secreto.txt", "/%2e%2e/secreto.txt", "/assets/../../secreto.txt", "/no-esta.js", "/assets"]) assert.equal((await pedir(ruta)).codigo, 404, ruta);
  assert.equal((await pedir("/assets/a.js", { metodo: "DELETE" })).codigo, 405);
});

test("remoto: de otro sitio no se le pide nada (CSRF)", async () => {
  assert.equal((await rpc("cosa:leer", [], { origin: undefined })).codigo, 403, "POST sin Origin");
  assert.equal((await rpc("cosa:leer", [], { origin: "https://malo.example" })).codigo, 403, "POST de otro origen");
  assert.equal((await rpc("cosa:leer", [], { "x-trama-cliente": undefined })).codigo, 403, "sin la cabecera propia");
  assert.equal((await rpc("cosa:leer", [], { "content-type": "text/plain" })).codigo, 415);
  assert.equal((await pedir("/rpc")).codigo, 403, "GET a /rpc");
  assert.equal((await pedir("/assets/a.js", { cabeceras: { "sec-fetch-site": "cross-site" } })).codigo, 403);
  assert.equal((await pedir("/eventos?c=" + CLIENTE, { cabeceras: { origin: "https://malo.example" } })).codigo, 403);
  assert.equal((await pedir("/", { cabeceras: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" } })).codigo, 200, "un link a la página sí");
  assert.equal(llamadas.length, 0);
});

test("remoto: un pedido corre el manejador del canal y vuelve su valor o su error", async () => {
  llamadas.length = 0;
  const r = await rpc("cosa:leer", [1, { datos: { $bin: Buffer.from("hola").toString("base64") } }]);
  assert.equal(r.codigo, 200);
  assert.deepEqual(JSON.parse(r.cuerpo).ok, true);
  assert.equal(llamadas[0].canal, "cosa:leer");
  assert.equal(llamadas[0].cliente, CLIENTE);
  const datos = (llamadas[0].args[1] as { datos: Uint8Array }).datos;
  assert.ok(datos instanceof Uint8Array, "los bytes vuelven a ser bytes");
  assert.equal(Buffer.from(datos).toString(), "hola");
  assert.deepEqual(JSON.parse((await rpc("cosa:nada", [])).cuerpo), { ok: true });
  assert.deepEqual(JSON.parse((await rpc("cosa:falla", [])).cuerpo), { ok: false, error: "no anduvo" });
  assert.equal((await rpc("cosa:leer", "no" as unknown as unknown[])).codigo, 400);
});

test("remoto: los avisos llegan, y quien se reconecta recibe lo que se perdió", async () => {
  const c = "c1c1c1c1c1c1";
  const a = oir(`/eventos?c=${c}`);
  const hola = await a.hasta((t) => t.includes("event: hola"));
  const epoca = /id: ([0-9a-f]+)-\d+/.exec(hola)![1];
  remoto.difundir("lider:evento", { sid: "s", e: { tipo: "parcial", texto: "uno\ndos" } });
  const t = await a.hasta((x) => x.includes("parcial"));
  const id = /id: (\S+)\ndata: \{"c":"lider:evento"/.exec(t)![1];
  assert.ok(t.includes('"texto":"uno\\ndos"'), "un salto de línea no parte el evento");
  a.cerrar();
  await new Promise((r) => setTimeout(r, 30));

  // Mientras no está: dos estados enteros (sirve el último) y un evento del stream.
  remoto.difundir("hilos:cambio", { n: 1 });
  remoto.difundir("lider:evento", { sid: "s", e: { tipo: "fin" } });
  remoto.difundir("hilos:cambio", { n: 2 });
  const b = oir(`/eventos?c=${c}&desde=${id}`);
  const rep = await b.hasta((x) => x.includes("event: hola"));
  assert.ok(!rep.includes('"n":1'), "el estado viejo no se repite");
  assert.ok(rep.indexOf('"tipo":"fin"') < rep.indexOf('"n":2') && rep.indexOf('"tipo":"fin"') > 0, "en orden");
  assert.ok(!rep.includes("parcial"), "lo que ya tenía no se repite");
  b.cerrar();

  // Otra corrida de trama (otra época), o un número que ya no está: empezar de nuevo.
  const d = oir(`/eventos?c=${c}`, { "last-event-id": "ffffffffffff-3" });
  await d.hasta((x) => x.includes("event: resinc"));
  d.cerrar();
  const e = oir(`/eventos?c=${c}&desde=${epoca}-999999`);
  await e.hasta((x) => x.includes("event: resinc"));
  e.cerrar();
  assert.equal((await pedir("/eventos?c=no-vale")).codigo, 400);
});

test("remoto: al que se fue y no vuelve se le suelta lo suyo", async () => {
  const c = "d2d2d2d2d2d2";
  const a = oir(`/eventos?c=${c}`);
  await a.hasta((t) => t.includes("event: hola"));
  a.cerrar();
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(idos.includes(c));
});

test("remoto: el puente arma window.hilos con el preload de verdad", async () => {
  const js = (await pedir("/remoto.js")).cuerpo;
  const pedidos: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fuentes: { url: string; oyentes: Record<string, (ev: unknown) => void>; onmessage?: (ev: unknown) => void }[] = [];
  let url = "";
  const g: Record<string, unknown> = {
    history: { replaceState: (_a: unknown, _b: unknown, u: string) => (url = u) },
    location: { pathname: "/", reload() {} },
    crypto: { getRandomValues: (u: Uint8Array) => u.fill(7) },
    document: { addEventListener() {}, visibilityState: "visible" },
    setTimeout: () => 1,
    clearTimeout() {},
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    EventSource: class {
      oyentes: Record<string, (ev: unknown) => void> = {};
      readyState = 1;
      url: string;
      constructor(u: string) {
        this.url = u;
        fuentes.push(this);
      }
      addEventListener(n: string, f: (ev: unknown) => void) {
        this.oyentes[n] = f;
      }
      close() {}
    },
    fetch: async (u: string, init: (typeof pedidos)[number]["init"]) => {
      pedidos.push({ url: u, init });
      return { status: 200, json: async () => ({ ok: true, valor: 42 }) };
    },
    Uint8Array,
    ArrayBuffer,
  };
  vm.runInNewContext(js, g);
  const hilos = g.hilos as { leer(): Promise<unknown>; archivo(x: unknown): Promise<unknown>; salir(): Promise<unknown>; alCambiar(fn: (d: unknown) => void): () => void };
  assert.equal(url, "/?fixtures=0&idioma=es", "la query de la ventana, antes de que cargue el frontend");
  assert.equal(typeof (g.crypto as { randomUUID?: unknown }).randomUUID, "function", "sin contexto seguro, randomUUID igual");
  assert.match(fuentes[0].url, /^eventos\?c=[0-9a-f]{24}$/);

  const vistos: unknown[] = [];
  const soltar = hilos.alCambiar((d) => vistos.push(d));
  fuentes[0].onmessage!({ data: JSON.stringify({ c: "cosa:cambio", d: { x: 1 } }), lastEventId: "e-5" });
  fuentes[0].onmessage!({ data: JSON.stringify({ c: "otra:cosa", d: 0 }), lastEventId: "e-6" });
  assert.equal(JSON.stringify(vistos), '[{"x":1}]'); // objetos de otro realm: se comparan como texto
  soltar();
  fuentes[0].onmessage!({ data: JSON.stringify({ c: "cosa:cambio", d: { x: 2 } }), lastEventId: "e-7" });
  assert.equal(vistos.length, 1);

  // Los pedidos esperan a que los avisos estén conectados.
  const leyendo = hilos.leer();
  await new Promise((r) => setImmediate(r));
  assert.equal(pedidos.length, 0);
  fuentes[0].oyentes.hola({ lastEventId: "e-8" });
  assert.equal(await leyendo, 42);
  assert.equal(pedidos[0].url, "rpc");
  assert.deepEqual(JSON.parse(pedidos[0].init.body), { canal: "cosa:leer", args: [1, "dos"] });
  assert.match(pedidos[0].init.headers["x-trama-cliente"], /^[0-9a-f]{24}$/);

  await hilos.archivo({ nombre: "a.txt", datos: vm.runInNewContext("new Uint8Array([104, 111, 108, 97])", g) });
  assert.deepEqual(JSON.parse(pedidos[1].init.body).args[0], { nombre: "a.txt", datos: { $bin: "aG9sYQ==" } });
  assert.equal(await hilos.salir(), 0, "salir de trama no se pide por red");
  assert.equal(pedidos.length, 2);
});

test("remoto: si se cae la conexión con la PC, el puente avisa y reintenta solo", async () => {
  const js = (await pedir("/remoto.js")).cuerpo;
  type Fuente = { url: string; cerrada: boolean; oyentes: Record<string, (ev: unknown) => void>; onerror?: () => void };
  const fuentes: Fuente[] = [];
  // Los timers a mano: el último que quedó armado es el próximo paso del puente (reintentar, o dar por perdida la conexión).
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let n = 0;
  let recargas = 0;
  let falla: number | "red" | null = null;
  const g: Record<string, unknown> = {
    history: { replaceState() {} },
    location: { pathname: "/", reload: () => void recargas++ },
    crypto: { getRandomValues: (u: Uint8Array) => u.fill(7) },
    document: { addEventListener() {}, visibilityState: "visible" },
    setTimeout: (fn: () => void, ms: number) => (timers.set(++n, { fn, ms }), n),
    clearTimeout: (id: number) => void timers.delete(id),
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    EventSource: class {
      oyentes: Record<string, (ev: unknown) => void> = {};
      readyState = 1;
      cerrada = false;
      url: string;
      constructor(u: string) {
        this.url = u;
        fuentes.push(this);
      }
      addEventListener(nombre: string, f: (ev: unknown) => void) {
        this.oyentes[nombre] = f;
      }
      close() {
        this.cerrada = true;
      }
    },
    fetch: async () => {
      if (falla === "red") throw new TypeError("Failed to fetch");
      if (falla) return { status: falla, json: async () => Promise.reject(new Error("no es JSON")) };
      return { status: 200, json: async () => ({ ok: true, valor: 42 }) };
    },
    Uint8Array,
    ArrayBuffer,
  };
  vm.runInNewContext(js, g);
  const hilos = g.hilos as { leer(): Promise<unknown>; conexion: { alCambiar(fn: (d: unknown) => void): () => void } };
  const ultima = () => fuentes[fuentes.length - 1];
  /** Corre el timer pendiente del puente (el de 4 s que suelta los pedidos no cuenta). */
  const pasar = () => {
    const [id, t] = [...timers].filter(([k]) => k !== 1).pop()!;
    timers.delete(id);
    t.fn();
    return t.ms;
  };
  const estados: unknown[] = [];
  hilos.conexion.alCambiar((ok) => estados.push(ok));

  ultima().oyentes.hola({ lastEventId: "e-3" });
  assert.deepEqual(estados, [], "conectado de entrada: no avisa nada");

  // Un corte suelto: reintenta enseguida y sin decir nada.
  ultima().onerror!();
  assert.ok(fuentes[0].cerrada, "no lo deja al EventSource reintentando por su cuenta");
  assert.deepEqual(estados, []);
  assert.equal(pasar(), 300);
  assert.equal(fuentes.length, 2);
  assert.match(ultima().url, /&desde=e-3$/, "pide lo que se perdió");

  // Sigue caída (trama relanzándose, la PC reiniciando): avisa una vez e insiste, cada vez más espaciado hasta 5 s.
  const esperas: number[] = [];
  for (let i = 0; i < 8; i++) {
    ultima().onerror!();
    esperas.push(pasar());
  }
  assert.deepEqual(estados, [false]);
  assert.deepEqual(esperas, [1000, 2000, 3000, 4000, 5000, 5000, 5000, 5000]);
  assert.equal(fuentes.length, 10);
  assert.equal(recargas, 0, "sin recargar la página");

  // Lo que se monta con la conexión ya caída se entera igual.
  const tarde: unknown[] = [];
  hilos.conexion.alCambiar((ok) => tarde.push(ok));
  assert.deepEqual(tarde, [false]);

  // Vuelve: avisa. Si trama es otra (se relanzó), el servidor pide empezar de nuevo y ahí sí se recarga.
  ultima().oyentes.hola({ lastEventId: "e-9" });
  assert.deepEqual(estados, [false, true]);
  ultima().oyentes.resinc({});
  assert.equal(recargas, 1);

  // Sin latidos (el celular cambió de red y nadie cerró nada): se da por caída y se avisa de una.
  assert.equal(pasar(), 150_000, "2,5 latidos");
  assert.deepEqual(estados, [false, true, false]);
  pasar();
  ultima().oyentes.hola({ lastEventId: "e-9" });
  assert.deepEqual(estados, [false, true, false, true]);

  // Un intento colgado (sin respuesta) no espera los 2,5 latidos.
  ultima().onerror!();
  pasar();
  assert.equal(pasar(), 8000);
  assert.deepEqual(estados, [false, true, false, true, false]);
  pasar();
  ultima().oyentes.hola({ lastEventId: "e-9" });

  // Un pedido que no llega a trama (sin red, o el 502 de `tailscale serve`) también destapa la caída.
  for (const f of ["red", 502] as const) {
    falla = f;
    const antes = fuentes.length;
    await assert.rejects(hilos.leer());
    assert.ok(ultima().cerrada, `${f}: cierra los avisos`);
    pasar();
    assert.equal(fuentes.length, antes + 1, `${f}: y los vuelve a conectar`);
    ultima().oyentes.hola({ lastEventId: "e-9" });
  }
  falla = null;
  assert.equal(await hilos.leer(), 42);
});

test("remoto.json: apagado si falta, si no se entiende o si no nombra dispositivos", () => {
  const f = path.join(tmp, "remoto.json");
  assert.equal(leerConfig(f), null);
  const con = (x: unknown) => (writeFileSync(f, JSON.stringify(x)), leerConfig(f));
  assert.deepEqual(con({ version: 1, puerto: 8791, dispositivos: ["mi-celu"] }), { puerto: 8791, dispositivos: ["mi-celu"] });
  assert.equal(con({ version: 2, puerto: 8791, dispositivos: ["mi-celu"] }), null);
  assert.equal(con({ version: 1, puerto: 80, dispositivos: ["mi-celu"] }), null);
  assert.equal(con({ version: 1, puerto: 8791, dispositivos: [] }), null);
  assert.equal(con({ version: 1, puerto: 8791, dispositivos: ["*", "a b", 3] }), null);
  writeFileSync(f, "{");
  assert.equal(leerConfig(f), null);
});

test("remoto: nunca se escucha sin una IP concreta", async () => {
  for (const ip of ["", "0.0.0.0", "::"]) await assert.rejects(remoto.escuchar(ip, 0));
});
