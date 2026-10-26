// Ajustes > DeepSeek Harness en el main (electron/dsh-ajustes.ts): si `dsh` está instalado y su versión, instalarlo, qué keys hay (sólo si
// hay, nunca el valor) y probar un proveedor contra su `/models` con la key guardada. Todo con dependencias inyectadas: ni red, ni npm, ni dsh.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { COMANDO_INSTALAR_DSH, SCRIPTS_DSH, estadoDsh, instalarDsh, probarProveedor } from "../electron/dsh-ajustes.ts";
import { hayDsh } from "../electron/capacidades.ts";
import { guardarClave } from "../electron/claves.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-dsh-ajustes-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const deps = (hay: string[], corre: (bin: string, args: string[]) => Promise<string> = async () => "0.2.1-rc.2\n") => ({
  env: { PATH: "/a:/b", HOME: "/h" } as NodeJS.ProcessEnv,
  home: "/h",
  existe: (f: string) => hay.includes(f),
  correr: async (bin: string, args: string[]) => corre(bin, args),
});
const enEs = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

test("estado: sin dsh no está instalado; con dsh sale su versión; las keys sólo dicen si hay", async () => {
  const sin = await estadoDsh(deps([]), {});
  assert.deepEqual(sin, { version: 1, instalado: false, versionDsh: null, hayNpm: false, comando: COMANDO_INSTALAR_DSH, claves: { OPENCODE_API_KEY: false, DEEPSEEK_API_KEY: false } });
  const con = await estadoDsh(deps(["/b/dsh", "/a/npm"]), { OPENCODE_API_KEY: "oc-secreta" });
  assert.equal(con.instalado, true);
  assert.equal(con.versionDsh, "0.2.1");
  assert.equal(con.hayNpm, true);
  assert.deepEqual(con.claves, { OPENCODE_API_KEY: true, DEEPSEEK_API_KEY: false });
  assert.ok(!JSON.stringify(con).includes("oc-secreta"), "la key nunca sale en el estado");
  // Instalado pero sin decir la versión: instalado igual.
  const raro = await estadoDsh(deps(["/b/dsh"], async () => { throw new Error("x"); }), {});
  assert.equal(raro.instalado, true);
  assert.equal(raro.versionDsh, null);
});

test("hayDsh: HILOS_DSH manda; una captura no lo prende sola; si no, lo que encuentra resolverDsh", () => {
  const si = (f: string) => f === "/x/dsh";
  assert.equal(hayDsh({ HILOS_DSH: "/x/dsh" }, "/h", si), true);
  assert.equal(hayDsh({ HILOS_DSH: "/no/dsh" }, "/h", si), false);
  assert.equal(hayDsh({ HILOS_DSH: "" }, "/h", si), false);
  assert.equal(hayDsh({ HILOS_CAPTURA: "1", PATH: "/x" }, "/h", si), false);
  assert.equal(hayDsh({ PATH: "/x" }, "/h", si), true);
  assert.equal(hayDsh({ PATH: "/y" }, "/h", si), false);
});

test("instalar: corre `npm install -g --prefix ~/.local @deepseek-ai/dsh` y devuelve el estado; sin npm o si npm falla, el motivo con el comando", async () => {
  const llamadas: string[][] = [];
  let instalado = false;
  const d = deps(["/a/npm"], async (bin, args) => {
    llamadas.push([bin, ...args]);
    if (bin === "npm") { instalado = true; return ""; }
    return "0.3.0\n";
  });
  d.existe = (f) => f === "/a/npm" || (instalado && f === "/b/dsh");
  const e = await instalarDsh(d);
  assert.deepEqual(llamadas[0], ["npm", "install", "-g", "--prefix", path.join(os.homedir(), ".local"), SCRIPTS_DSH, "@deepseek-ai/dsh"]);
  assert.equal(e.instalado, true);
  assert.equal(e.versionDsh, "0.3.0");

  const m1 = await enEs(instalarDsh(deps([])));
  assert.match(m1!, /main\.dshSinNpm/);
  assert.ok(m1!.includes(COMANDO_INSTALAR_DSH));
  const m2 = await enEs(instalarDsh(deps(["/a/npm"], async () => { throw Object.assign(new Error("Command failed"), { stderr: "npm error code EACCES\nnpm error path /usr/lib/node_modules\n" }); })));
  assert.match(m2!, /main\.dshInstalarFallo/);
  assert.ok(m2!.includes("EACCES") && m2!.includes(COMANDO_INSTALAR_DSH));
});

/** Un `/models` de mentira: cuenta qué Authorization llegó. */
async function proveedorFalso(respuesta: (auth: string | undefined) => { status: number; cuerpo: unknown }) {
  const vistas: (string | undefined)[] = [];
  const s = http.createServer((req, res) => {
    vistas.push(req.headers.authorization);
    const r = respuesta(req.headers.authorization);
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(typeof r.cuerpo === "string" ? r.cuerpo : JSON.stringify(r.cuerpo));
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  after(() => s.close());
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/models`;
  return { url, vistas, urls: { opencode: url, deepseek: url } };
}

test("probar: GET /models con la key guardada; cuenta los modelos; 401 es «clave mala»; sin key DeepSeek ni sale; la key no aparece en el motivo", async () => {
  const f = await proveedorFalso((auth) => (auth === "Bearer sk-buena" ? { status: 200, cuerpo: { data: [{ id: "a" }, { id: "b" }] } } : { status: 401, cuerpo: {} }));
  const env = {} as NodeJS.ProcessEnv;
  assert.deepEqual(await probarProveedor("deepseek", undefined, { urls: f.urls, env, claves: { DEEPSEEK_API_KEY: "sk-buena" } }), { ok: true, modelos: 2 });
  assert.deepEqual(f.vistas, ["Bearer sk-buena"]);
  const mala = await probarProveedor("deepseek", undefined, { urls: f.urls, env, claves: { DEEPSEEK_API_KEY: "sk-mala" } });
  assert.equal(mala.ok, false);
  assert.match((mala as { motivo: string }).motivo, /main\.dshClaveMala/);
  assert.ok(!JSON.stringify(mala).includes("sk-mala"));
  // Una key del entorno gana a la guardada.
  assert.deepEqual(await probarProveedor("deepseek", undefined, { urls: f.urls, env: { DEEPSEEK_API_KEY: "sk-buena" }, claves: { DEEPSEEK_API_KEY: "otra" } }), { ok: true, modelos: 2 });
  // DeepSeek sin key: ni siquiera sale al servidor.
  const n = f.vistas.length;
  const sin = await probarProveedor("deepseek", undefined, { urls: f.urls, env, claves: {} });
  assert.match((sin as { motivo: string }).motivo, /main\.dshSinClave/);
  assert.equal(f.vistas.length, n);
  // OpenCode anda sin key (sus modelos gratis): se prueba sin Authorization.
  const g = await proveedorFalso(() => ({ status: 200, cuerpo: { data: [] } }));
  // …pero sin clave propia avisa que el cupo gratis es compartido (GET /models anda aunque el uso gratis esté agotado).
  assert.deepEqual(await probarProveedor("opencode", undefined, { urls: g.urls, env, claves: {} }), { ok: true, modelos: 0, aviso: "\u0001i18n:main.dshAvisoSinClave\u0001\u0001" });
  assert.deepEqual(g.vistas, [undefined]);
  // Con clave propia no hay aviso.
  assert.deepEqual(await probarProveedor("opencode", undefined, { urls: g.urls, env, claves: { OPENCODE_API_KEY: "oc-mia" } }), { ok: true, modelos: 0 });
});

test("probar: errores del servidor, respuesta rara, nadie escucha y proveedor desconocido", async () => {
  const env = {} as NodeJS.ProcessEnv;
  const e500 = await proveedorFalso(() => ({ status: 500, cuerpo: {} }));
  assert.match(((await probarProveedor("opencode", undefined, { urls: e500.urls, env, claves: {} })) as { motivo: string }).motivo, /main\.dshHttp/);
  const raro = await proveedorFalso(() => ({ status: 200, cuerpo: "<html>" }));
  assert.equal((await probarProveedor("opencode", undefined, { urls: raro.urls, env, claves: {} })).ok, false);
  const caido = { opencode: "http://127.0.0.1:1/models", deepseek: "http://127.0.0.1:1/models" };
  assert.match(((await probarProveedor("opencode", undefined, { urls: caido, env, claves: {} })) as { motivo: string }).motivo, /main\.dshNoContesta/);
  assert.match((await enEs(probarProveedor("gpt", undefined)))!, /main\.dshProveedor/);
});

test("probar Ollama: /api/tags de la dirección dada", async () => {
  const s = http.createServer((_req, res) => (res.writeHead(200), res.end(JSON.stringify({ models: [{ name: "qwen3:8b", size: 1 }, { name: "llama3.2:3b" }] }))));
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  after(() => s.close());
  assert.deepEqual(await probarProveedor("ollama", `http://127.0.0.1:${(s.address() as AddressInfo).port}`), { ok: true, modelos: 2 });
  assert.equal((await probarProveedor("ollama", "http://127.0.0.1:1")).ok, false);
});

test("guardar una key y que el estado de la ruta por defecto la vea", async () => {
  const ruta = path.join(tmp, "k", "claves.env");
  const antes = process.env.TRAMA_CLAVES;
  process.env.TRAMA_CLAVES = ruta;
  try {
    await guardarClave("OPENCODE_API_KEY", "oc-1");
    const e = await estadoDsh(deps([]));
    assert.equal(e.claves.OPENCODE_API_KEY, true);
  } finally {
    if (antes === undefined) delete process.env.TRAMA_CLAVES;
    else process.env.TRAMA_CLAVES = antes;
  }
});
