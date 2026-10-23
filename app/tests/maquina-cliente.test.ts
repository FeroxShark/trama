// El cliente de otra máquina (electron/maquina-cliente.ts) contra un motor de verdad (crearRemoto) en 127.0.0.2:
// pedido, evento, corte con reconexión (lo perdido se repone), motor nuevo (resinc), caída y silencio.
// La identidad de mentira: entra cualquiera que venga de 127.x (en la tailnet la dice `tailscale whois`).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { crearRemoto } from "../electron/remoto.ts";
import { armarClienteMaquina, CANAL_SALUDO, type EstadoMaquina } from "../electron/maquina-cliente.ts";
import { HUELLA, PROTOCOLO } from "../electron/maquinas-contrato.ts";

const IP = "127.0.0.2";
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-maquina-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const preload = path.join(tmp, "preload.cjs");
writeFileSync(preload, "");

/** Lo que contesta `maquina:saludo` un motor del mismo build. */
const SALUDO = { version: 1, protocolo: PROTOCOLO, huella: HUELLA, maquina: "dell" };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 4000) {
  const fin = Date.now() + ms;
  while (!f()) {
    if (Date.now() > fin) assert.fail("no pasó a tiempo");
    await espera(10);
  }
}

type Motor = { llamadas: { canal: string; args: unknown[]; cliente: string }[]; difundir(c: string, d: unknown): void; puerto: number; apagar(): Promise<void>; cortar(): void };
/** Un motor como el de otra máquina: `crearRemoto` en 127.0.0.2, que acepta a quien venga de 127.x. */
async function motor(puerto = 0, saludo: unknown = SALUDO, sinSaludo = false): Promise<Motor> {
  const llamadas: Motor["llamadas"] = [];
  const r = crearRemoto({
    dist: tmp,
    preload,
    nombres: ["dell.test"],
    propias: [],
    entra: async (ip) => ip.startsWith("127."),
    async llamar(canal, args, cliente) {
      llamadas.push({ canal, args, cliente });
      if (canal === CANAL_SALUDO) {
        if (sinSaludo) throw new Error("canal desconocido");
        return saludo;
      }
      if (canal === "cosa:falla") throw new Error("no anduvo");
      if (canal === "cosa:lenta") return new Promise(() => {});
      return { canal, args };
    },
    consulta: () => ({}),
    seFue: () => {},
    changelog: "",
    latidoMs: 60_000,
    graciaMs: 60_000,
  });
  const s = await r.escuchar(IP, puerto);
  return {
    llamadas,
    difundir: r.difundir,
    puerto: (s.address() as { port: number }).port,
    // Cerrar el servidor: lo que estaba conectado se corta y nadie más entra.
    apagar: () => new Promise<void>((ok) => (s.close(() => ok()), s.closeAllConnections())),
    // Un corte de red: se cortan las conexiones y el servidor sigue (misma corrida, lo perdido se repone).
    cortar: () => s.closeAllConnections(),
  };
}

const PAUSAS = [20, 40];
const clienteDe = (m: { puerto: number }, extra: Partial<Parameters<typeof armarClienteMaquina>[0]> = {}) => {
  const eventos: [string, unknown][] = [];
  const estados: EstadoMaquina[] = [];
  let resinc = 0;
  const c = armarClienteMaquina({
    ip: IP,
    puerto: m.puerto,
    host: "dell.test",
    alEvento: (canal, dato) => eventos.push([canal, dato]),
    alCambiar: (e) => estados.push(e),
    alResincronizar: () => resinc++,
    latidoMs: 60_000,
    pausasMs: PAUSAS,
    ...extra,
  });
  after(() => c.cerrar());
  return { c, eventos, estados, resinc: () => resinc };
};

test("conecta, saluda y hace un pedido (un adjunto va en base64)", async () => {
  const m = await motor();
  after(() => m.apagar());
  const { c, estados } = clienteDe(m);
  assert.equal(c.estado().fase, "conectando");
  await hasta(() => c.estado().acceso === "si");
  assert.deepEqual(c.estado(), { fase: "conectada", saludo: SALUDO, acceso: "si" });
  assert.deepEqual(estados.map((e) => e.fase), ["conectada", "conectada"]);
  assert.deepEqual(await c.pedir("cosa:leer", [1, "dos"]), { canal: "cosa:leer", args: [1, "dos"] });
  await c.pedir("cosa:adjunto", [{ bytes: new Uint8Array([1, 2, 3]) }]);
  assert.deepEqual(m.llamadas.at(-1)?.args, [{ bytes: Buffer.from([1, 2, 3]) }]);
  await assert.rejects(c.pedir("cosa:falla"), /no anduvo/);
});

test("un motor que no entiende el saludo queda conectado y sin acceso", async () => {
  const m = await motor(0, undefined, true);
  after(() => m.apagar());
  const { c } = clienteDe(m);
  await hasta(() => m.llamadas.some((l) => l.canal === CANAL_SALUDO));
  await espera(50);
  assert.deepEqual(c.estado(), { fase: "conectada", saludo: null, acceso: "no" });
});

test("otro build: conectada y sólo para leer; lo que no es un saludo, sin acceso", async () => {
  const m = await motor(0, { ...SALUDO, protocolo: PROTOCOLO + 1 });
  after(() => m.apagar());
  const { c } = clienteDe(m);
  await hasta(() => c.estado().acceso === "leer");
  const n = await motor(0, { version: "1.2.3" });
  after(() => n.apagar());
  const { c: d } = clienteDe(n);
  await hasta(() => n.llamadas.some((l) => l.canal === CANAL_SALUDO));
  await espera(50);
  assert.deepEqual(d.estado(), { fase: "conectada", saludo: null, acceso: "no" });
});

test("recibe lo que difunde el motor", async () => {
  const m = await motor();
  after(() => m.apagar());
  const { c, eventos } = clienteDe(m);
  await hasta(() => c.estado().fase === "conectada");
  m.difundir("hilos:cambio", { n: 1 });
  m.difundir("cosa:cambio", "hola");
  await hasta(() => eventos.length === 2);
  assert.deepEqual(eventos, [["hilos:cambio", { n: 1 }], ["cosa:cambio", "hola"]]);
});

test("un corte suelto se reconecta callado y repone lo difundido mientras tanto", async () => {
  const m = await motor();
  after(() => m.apagar());
  const { c, eventos, estados, resinc } = clienteDe(m);
  await hasta(() => c.estado().acceso === "si");
  m.difundir("cosa:cambio", 1);
  await hasta(() => eventos.length === 1);
  const antes = estados.length;
  m.cortar();
  // Mientras está cortado, el motor sigue difundiendo.
  m.difundir("cosa:cambio", 2);
  m.difundir("cosa:cambio", 3);
  await hasta(() => eventos.length === 3);
  assert.deepEqual(eventos.map((e) => e[1]), [1, 2, 3]);
  assert.equal(resinc(), 0);
  assert.equal(c.estado().fase, "conectada");
  // Un solo corte: ni siquiera pasó por `caida`.
  assert.ok(estados.slice(antes).every((e) => e.fase !== "caida"));
});

test("con el motor apagado pasa a caída; un pedido espera, y el motor nuevo manda resinc", async () => {
  const m = await motor();
  const { c, resinc } = clienteDe(m, { esperaMs: 5000 });
  await hasta(() => c.estado().acceso === "si");
  await m.apagar();
  await hasta(() => c.estado().fase === "caida");
  assert.equal(c.estado().saludo, null);
  // El pedido hecho con la máquina caída espera a que vuelva y sale entonces.
  const p = c.pedir("cosa:leer", ["despues"]);
  await espera(100);
  const n = await motor(m.puerto);
  after(() => n.apagar());
  assert.deepEqual(await p, { canal: "cosa:leer", args: ["despues"] });
  assert.equal(n.llamadas.at(-1)?.canal, "cosa:leer");
  // Otra corrida del motor: lo que el cliente tenía ya no sirve.
  assert.equal(resinc(), 1);
  await hasta(() => c.estado().fase === "conectada" && c.estado().acceso === "si");
});

test("un pedido con la máquina caída falla al agotar la espera", async () => {
  const m = await motor();
  const { c } = clienteDe(m, { esperaMs: 150 });
  await hasta(() => c.estado().fase === "conectada");
  await m.apagar();
  await hasta(() => c.estado().fase === "caida");
  await assert.rejects(c.pedir("cosa:leer"), /ECONNREFUSED/);
});

test("sin latidos se declara caída y corta lo que estaba en vuelo", async () => {
  // Un motor que dice `hola` y se queda mudo (una máquina que se colgó, o se perdió la red sin avisar).
  const s = http.createServer((req, res) => {
    if (req.url?.startsWith("/eventos")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: hola\nid: x-0\ndata: 1\n\n");
    }
    // `/rpc` no contesta nunca.
  });
  await new Promise<void>((ok) => s.listen(0, IP, ok));
  after(() => void s.closeAllConnections() ?? s.close());
  const { c, estados } = clienteDe({ puerto: (s.address() as { port: number }).port }, { latidoMs: 100 });
  await hasta(() => c.estado().fase === "conectada");
  const p = c.pedir("cosa:lenta");
  const rechazo = assert.rejects(p, /dejó de contestar/);
  await hasta(() => c.estado().fase === "caida");
  await rechazo;
  assert.ok(estados.some((e) => e.fase === "caida"));
});

test("cerrar corta todo y no reintenta", async () => {
  const m = await motor();
  after(() => m.apagar());
  const { c, estados } = clienteDe(m);
  await hasta(() => c.estado().fase === "conectada");
  c.cerrar();
  const n = estados.length;
  await m.apagar();
  await espera(150);
  assert.equal(estados.length, n);
  await assert.rejects(c.pedir("cosa:leer"));
});

test("el servidor sigue exigiendo Origin: sin él, 403 (el cliente lo manda él mismo)", async () => {
  const m = await motor();
  after(() => m.apagar());
  const codigo = await new Promise<number>((ok, mal) => {
    const req = http.request(
      { host: IP, port: m.puerto, path: "/rpc", method: "POST", headers: { host: `dell.test:${m.puerto}`, "x-trama-cliente": "abcdef0123456789", "content-type": "application/json" } },
      (res) => (res.resume(), ok(res.statusCode ?? 0)),
    );
    req.on("error", mal);
    req.end(JSON.stringify({ canal: "cosa:leer", args: [] }));
  });
  assert.equal(codigo, 403);
});
