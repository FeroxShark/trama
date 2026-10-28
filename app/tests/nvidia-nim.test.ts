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
