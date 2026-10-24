// Bajar un modelo de Ollama (electron/ollama-bajar.ts) contra un servidor HTTP de mentira en loopback: nunca el Ollama
// de verdad ni un modelo. Progreso, error de Ollama, 404, cancelar, nombre inválido y una sola bajada por modelo.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crearBajadas, type Bajada } from "../electron/ollama-bajar.ts";
import { cambiarIdioma, textoMain } from "../src/i18n/index.ts";

const enEs = (s: string) => {
  cambiarIdioma("es");
  try {
    return textoMain(s);
  } finally {
    cambiarIdioma("en");
  }
};

const pedidos: { modelo: string }[] = [];
let colgar: http.ServerResponse | null = null;
const srv = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (d) => (cuerpo += d));
  req.on("end", () => {
    const { model } = JSON.parse(cuerpo) as { model: string };
    pedidos.push({ modelo: model });
    if (req.url !== "/api/pull" || req.method !== "POST") return res.writeHead(404).end();
    if (model === "no-existe") return res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "pull model manifest: file does not exist" }));
    if (model === "falla-al-medio") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
      return res.end(JSON.stringify({ error: "disco lleno" }) + "\n");
    }
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
    if (model === "cuelga") return void (colgar = res);
    // Una línea partida a la mitad entre dos chunks: se junta.
    const l = JSON.stringify({ status: "pulling abc", total: 1000, completed: 500 }) + "\n";
    res.write(l.slice(0, 10));
    setTimeout(() => {
      res.write(l.slice(10));
      res.write(JSON.stringify({ status: "verifying sha256 digest" }) + "\n");
      res.end(JSON.stringify({ status: "success" }) + "\n");
    }, 20);
  });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const URL_FALSA = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => {
  colgar?.destroy();
  srv.closeAllConnections();
  srv.close();
});

/** Espera el primer evento que cumple `cond`. */
function hasta(eventos: Bajada[], cond: (b: Bajada) => boolean): Promise<Bajada> {
  return new Promise((ok, mal) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const b = eventos.find(cond);
      if (b) (clearInterval(id), ok(b));
      else if (Date.now() - t0 > 5000) (clearInterval(id), mal(new Error("no llegó el evento: " + JSON.stringify(eventos))));
    }, 10);
  });
}

test("baja un modelo: avisa 'bajando' con el progreso y termina en 'listo'", async () => {
  const ev: Bajada[] = [];
  const b = crearBajadas((x) => ev.push(x));
  const primero = b.bajar(URL_FALSA + "/", " llama3.2:3b ");
  assert.equal(primero.estado, "bajando");
  assert.equal(primero.modelo, "llama3.2:3b");
  assert.equal(primero.url, URL_FALSA);
  assert.equal(b.lista().length, 1);
  const listo = await hasta(ev, (x) => x.estado === "listo");
  assert.equal(listo.modelo, "llama3.2:3b");
  assert.equal(listo.motivo, null);
  assert.ok(ev.some((x) => x.estado === "bajando" && x.total === 1000 && x.completado === 500), "alguna vez mostró el 50 %");
  assert.deepEqual(b.lista(), [], "lo terminado no queda en la lista");
});

test("el error de Ollama (una línea o un 404) llega como motivo", async () => {
  const ev: Bajada[] = [];
  const b = crearBajadas((x) => ev.push(x));
  b.bajar(URL_FALSA, "no-existe");
  assert.match((await hasta(ev, (x) => x.modelo === "no-existe" && x.estado === "error")).motivo ?? "", /manifest/);
  b.bajar(URL_FALSA, "falla-al-medio");
  assert.equal((await hasta(ev, (x) => x.modelo === "falla-al-medio" && x.estado === "error")).motivo, "disco lleno");
  assert.deepEqual(b.lista(), []);
});

test("cancelar corta la bajada y lo dice; una sola bajada por modelo", async () => {
  const ev: Bajada[] = [];
  const b = crearBajadas((x) => ev.push(x));
  b.bajar(URL_FALSA, "cuelga");
  b.bajar(URL_FALSA, "cuelga");
  await hasta(ev, (x) => x.texto === "pulling manifest");
  assert.equal(b.lista().length, 1);
  assert.equal(pedidos.filter((p) => p.modelo === "cuelga").length, 1, "el segundo pedido no abre otra bajada");
  b.cancelar(URL_FALSA, "cuelga");
  const x = await hasta(ev, (e) => e.estado === "error");
  assert.match(enEs(x.motivo ?? ""), /cancelada/i);
  assert.deepEqual(b.lista(), []);
});

test("rechaza un nombre raro o una dirección que no es de Ollama, sin tocar la red", () => {
  const antes = pedidos.length;
  const b = crearBajadas(() => {});
  for (const mal of ["", "a b", "-x", "x;y", 3, null]) assert.throws(() => b.bajar(URL_FALSA, mal), (e) => /ollamaNombre|nombre/i.test((e as Error).message), String(mal));
  for (const mal of ["file:///x", "localhost", "", null]) assert.throws(() => b.bajar(mal, "llama3.2:3b"));
  assert.equal(pedidos.length, antes);
});

test("si Ollama no contesta, falla con un motivo (no queda 'bajando')", async () => {
  const ev: Bajada[] = [];
  const b = crearBajadas((x) => ev.push(x));
  b.bajar("http://127.0.0.1:1", "llama3.2:3b");
  const x = await hasta(ev, (e) => e.estado === "error");
  assert.ok(x.motivo);
  assert.deepEqual(b.lista(), []);
});
