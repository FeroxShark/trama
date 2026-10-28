// NVIDIA NIM en la app: la lista de modelos (modelos.json), el estado sin la clave y la prueba mínima. Sin red: `fetch` falso.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MODELO_NIM_BASE, estadoNim, guardarModelosNim, modelosNim, probarNim } from "../electron/nvidia-nim.ts";

async function casa() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nim-"));
  const ruta = path.join(dir, "modelos.json");
  return { dir, ruta, env: { TRAMA_MODELOS: ruta } as Record<string, string> };
}
const resp = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;

test("sin modelos.json el modelo es el base", async () => {
  const { env, dir } = await casa();
  assert.deepEqual(modelosNim(env, dir), [MODELO_NIM_BASE]);
});

test("guardar la lista: prende y apaga sin tocar lo demás, y la base sola saca la clave", async () => {
  const { env, dir, ruta } = await casa();
  await writeFile(ruta, JSON.stringify({ version: 1, opencode_plan: "go" }));
  const r = await guardarModelosNim([MODELO_NIM_BASE, "meta/llama-3.3-70b-instruct", "meta/llama-3.3-70b-instruct"], env, dir);
  assert.deepEqual(r, [MODELO_NIM_BASE, "meta/llama-3.3-70b-instruct"]);
  const j = JSON.parse(await readFile(ruta, "utf8"));
  assert.equal(j.opencode_plan, "go");
  assert.deepEqual(j.nvidia_modelos, r);
  assert.deepEqual(modelosNim(env, dir), r);
  await guardarModelosNim([], env, dir); // todos apagados: [] (no vuelve al base)
  assert.deepEqual(modelosNim(env, dir), []);
  await guardarModelosNim([MODELO_NIM_BASE], env, dir);
  assert.equal("nvidia_modelos" in JSON.parse(await readFile(ruta, "utf8")), false);
});

test("guardar valida los ids y no escribe encima de un archivo roto", async () => {
  const { env, dir, ruta } = await casa();
  await assert.rejects(guardarModelosNim(["x y"], env, dir), /i18n:main\.nimModeloId/);
  await assert.rejects(guardarModelosNim("a", env, dir), /i18n:main\.nimModelos/);
  await writeFile(ruta, "{roto");
  await assert.rejects(guardarModelosNim(["a/b"], env, dir), /i18n:main\.modelosRoto/);
  assert.equal(await readFile(ruta, "utf8"), "{roto");
});

test("el estado dice si hay clave pero nunca la trae", async () => {
  const { env, dir } = await casa();
  const sin = await estadoNim(env, dir, {});
  assert.equal(sin.hayClave, false);
  const con = await estadoNim(env, dir, { NVIDIA_API_KEY: "nvapi-secreta" });
  assert.equal(con.hayClave, true);
  assert.equal(JSON.stringify(con).includes("secreta"), false);
});

test("probar: sin clave, clave mala, 429 (la clave sirve), red caída, y la clave no se repite", async () => {
  const { env, dir } = await casa();
  const x = (fetch: typeof globalThis.fetch, claves: Record<string, string> = { NVIDIA_API_KEY: "nvapi-secreta" }) => ({ fetch, env, home: dir, claves });
  const sin = await probarNim(x(resp(200), {}));
  assert.equal(sin.ok, false);
  assert.match((sin as { motivo: string }).motivo, /nimSinClave/);
  assert.deepEqual(await probarNim(x(resp(200))), { ok: true, modelo: MODELO_NIM_BASE });
  assert.equal((await probarNim(x(resp(429)))).ok, true);
  assert.match(((await probarNim(x(resp(401)))) as { motivo: string }).motivo, /nimClaveMala/);
  assert.match(((await probarNim(x(resp(500)))) as { motivo: string }).motivo, /nimHttp/);
  const caida = (async () => { throw new Error("fallo con nvapi-secreta"); }) as unknown as typeof fetch;
  const r = (await probarNim(x(caida))) as { motivo: string };
  assert.match(r.motivo, /nimRed/);
  assert.equal(r.motivo.includes("secreta"), false);
});

test("probar manda la clave sólo en la cabecera y pide una llamada mínima", async () => {
  const { env, dir } = await casa();
  let visto: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { visto = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  await probarNim({ fetch: f, env, home: dir, claves: { NVIDIA_API_KEY: "nvapi-secreta" } });
  assert.equal(visto!.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal((visto!.init.headers as Record<string, string>).authorization, "Bearer nvapi-secreta");
  assert.equal(JSON.parse(String(visto!.init.body)).max_tokens, 1);
  assert.equal(String(visto!.init.body).includes("secreta"), false);
});

test("la barra: el modelo más cargado del último minuto contra el tope, sin marca de agotado", async () => {
  const { suscripcionNvidia } = await import("../electron/opencode-pedidos.ts");
  const ahora = 1_800_000_000;
  const m = "nvidia/deepseek-ai/deepseek-v4.1-flash";
  const e = { hayClave: true, modelos: [MODELO_NIM_BASE], tope: 40, ahoraMs: ahora * 1000 };
  assert.equal(suscripcionNvidia({ ...e, hayClave: false, pedidos: [] }), null, "sin clave no hay fila");
  assert.equal(suscripcionNvidia({ ...e, modelos: [], pedidos: [] }), null, "todos apagados no hay fila");
  const vacio = suscripcionNvidia({ ...e, pedidos: [] })!;
  assert.deepEqual(vacio.grupos![0].ventanas[0], { id: "1m", pct: 0, vuelve: null, pedidos: 0, tope: 40 });
  const s = suscripcionNvidia({
    ...e,
    pedidos: [
      { t: ahora - 90, m, n: 30 }, // fuera del minuto
      { t: ahora - 50, m, n: 6 },
      { t: ahora - 5, m, n: 4 },
      { t: ahora - 5, m: "nvidia/meta/llama-3.3-70b-instruct", n: 2 }, // otro modelo: el tope es de cada uno
    ],
  })!;
  assert.equal(s.proveedor, "nvidia");
  assert.equal(s.grupos![0].id, "nvidia-nim");
  assert.equal(s.grupos![0].agotado, undefined);
  assert.deepEqual(s.grupos![0].ventanas[0], { id: "1m", pct: 25, vuelve: ahora - 50 + 60, pedidos: 10, tope: 40 });
});

test("anotar: los pedidos de NIM cuentan (como nvidia/<modelo>) y los de pago por uso no", async () => {
  const { anotarPedidos, cuentaPedidos, leerPedidos } = await import("../electron/opencode-pedidos.ts");
  const dir = await mkdtemp(path.join(os.tmpdir(), "nim-ped-"));
  const env = { REPARTO_STATE: dir } as NodeJS.ProcessEnv;
  assert.equal(cuentaPedidos("opencode:nvidia/deepseek-ai/deepseek-v4.1-flash"), true);
  assert.equal(cuentaPedidos("opencode:anthropic/claude-x"), false);
  assert.equal(anotarPedidos("opencode:nvidia/deepseek-ai/deepseek-v4.1-flash", 3, env), true);
  assert.deepEqual(leerPedidos(env).map((p) => [p.m, p.n]), [["nvidia/deepseek-ai/deepseek-v4.1-flash", 3]]);
});
