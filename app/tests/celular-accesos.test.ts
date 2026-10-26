// electron/celular-accesos.ts: quién entró hace poco por la tailnet. Un reloj y una carpeta de mentira; nada de Tailscale.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-accesos-"));
process.env.HILOS_STATE = tmp;
after(() => rmSync(tmp, { recursive: true, force: true }));
const { crearAccesos, ESCRIBE_CADA_MS, RECUERDA_MS } = await import("../electron/celular-accesos.ts");
const { nodoDe } = await import("../electron/tailnet.ts");

const reloj = (t0 = 1_000_000_000_000) => {
  let t = t0;
  return { ahora: () => t, pasar: (ms: number) => void (t += ms) };
};
const disco = (f: string) => JSON.parse(readFileSync(f, "utf8"));

test("accesos: el primer pedido se escribe, el siguiente dentro del minuto sólo se recuerda", async () => {
  const f = path.join(tmp, "a.json");
  const r = reloj();
  const a = crearAccesos(f, r.ahora);
  await a.anotar("mi-celu", "android", "192.0.2.5");
  assert.deepEqual(disco(f).dispositivos, [{ nombre: "mi-celu", sistema: "android", ip: "192.0.2.5", visto: r.ahora() }]);
  r.pasar(5_000);
  await a.anotar("mi-celu", "android", "192.0.2.5");
  assert.equal(disco(f).dispositivos[0].visto, r.ahora() - 5_000, "no reescribe por cada pedido");
  assert.equal((await a.leer())[0].visto, r.ahora(), "pero lo que se lee es lo último");
  r.pasar(ESCRIBE_CADA_MS);
  await a.anotar("mi-celu", "android", "192.0.2.5");
  assert.equal(disco(f).dispositivos[0].visto, r.ahora());
  r.pasar(1000);
  await a.anotar("mi-celu", "iOS", "192.0.2.5");
  assert.equal(disco(f).dispositivos[0].sistema, "iOS", "un dato nuevo se escribe en el acto");
});

test("accesos: el más reciente primero, sobrevive a un reinicio y lo viejo se va", async () => {
  const f = path.join(tmp, "b.json");
  const r = reloj();
  const a = crearAccesos(f, r.ahora);
  await a.anotar("tablet", null, null);
  r.pasar(1000);
  await a.anotar("celu", "android", "192.0.2.9");
  assert.deepEqual((await a.leer()).map((x) => x.nombre), ["celu", "tablet"]);
  const b = crearAccesos(f, r.ahora);
  assert.deepEqual((await b.leer()).map((x) => x.nombre), ["celu", "tablet"], "otra corrida lee lo escrito");
  r.pasar(RECUERDA_MS);
  assert.deepEqual(await b.leer(), [], "pasado un mes ya no se muestra");
});

test("accesos: quitar un dispositivo de la lista borra su rastro y un archivo roto no tira nada", async () => {
  const f = path.join(tmp, "c.json");
  const a = crearAccesos(f, reloj().ahora);
  await a.anotar("uno", "android", null);
  await a.anotar("dos", "iOS", null);
  await a.olvidar(["Uno"]);
  assert.deepEqual((await a.leer()).map((x) => x.nombre), ["uno"]);
  assert.deepEqual(disco(f).dispositivos.map((x: { nombre: string }) => x.nombre), ["uno"]);
  const roto = path.join(tmp, "d.json");
  writeFileSync(roto, "{no es json");
  assert.deepEqual(await crearAccesos(roto, reloj().ahora).leer(), []);
});

test("tailnet: whois da el sistema y la IP del nodo", () => {
  const n = nodoDe({ Node: { Name: "mi-celu.x.ts.net.", User: 1, Addresses: ["192.0.2.5/32", "fd7a::5/128"], Hostinfo: { OS: "android" } } });
  assert.equal(n?.sistema, "android");
  assert.equal(n?.ip, "192.0.2.5");
  const sin = nodoDe({ Node: { Name: "x.y.ts.net.", User: 1 } });
  assert.equal(sin?.sistema, null);
  assert.equal(sin?.ip, null);
});
