// Los topes de OpenCode Go se leen de opencode.ai/go (motor/opencode/go-topes.mjs → caché en el estado de trama) y go-topes.json queda de respaldo
// sin red. Acá: el parseo con una respuesta guardada (tests/fixtures/opencode-go.html y opencode-go-ids.json), el caché, el respaldo sin red y que
// `reparto` y la app lean la misma fuente. Sin red de verdad: el `fetch` es de mentira.
import { test, after } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { armarTabla, idsDeLaLista, parsearPagina, refrescar, slugDe, vigente } from "../../motor/opencode/go-topes.mjs";
import { cargarTablaGo, rutaCacheGo, vistaPlanGo } from "../electron/opencode-go.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "oc-go-topes-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const carpeta = () => {
  const d = path.join(tmp, `c${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const FIX = path.join(import.meta.dirname, "fixtures");
const HTML = readFileSync(path.join(FIX, "opencode-go.html"), "utf8");
const IDS = JSON.parse(readFileSync(path.join(FIX, "opencode-go-ids.json"), "utf8"));
const RESPALDO = path.join(import.meta.dirname, "..", "..", "motor", "opencode", "go-topes.json");
const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const AHORA = Date.parse("2026-10-28T12:00:00Z");

/** Un fetch de mentira: la página y la lista de ids de la fixture. */
const fetchFixture = (html = HTML, ids: unknown = IDS) => async (url: string | URL) => {
  const u = String(url);
  const cuerpo = u.endsWith("/go") ? html : JSON.stringify(ids);
  return { ok: true, status: 200, text: async () => cuerpo, json: async () => JSON.parse(cuerpo) } as unknown as Response;
};
const sinRed = async () => {
  throw new Error("fetch failed");
};

test("parsearPagina: la fixture guardada de opencode.ai/go da los 12 modelos con sus cuatro números y los precios", () => {
  const p = parsearPagina(HTML)!;
  assert.ok(p);
  assert.equal(p.modelos.length, 12);
  assert.deepEqual(p.precios, { go: 10, "go-plus": 40 });
  const por = Object.fromEntries(p.modelos.map((m: { nombre: string }) => [m.nombre, m]));
  assert.deepEqual(por["Kimi K3.1 Pro"], { nombre: "Kimi K3.1 Pro", go: { pedidos_5h: 147, usd_mes: 15 }, "go-plus": { pedidos_5h: 588, usd_mes: 60 } });
  assert.deepEqual(por["DeepSeek V4.1 Flash"].go, { pedidos_5h: 34670, usd_mes: 80 });
  assert.deepEqual(por["Gemini 4 Argon"]["go-plus"], { pedidos_5h: 1760, usd_mes: 120 }, "los miles con coma");
});

test("parsearPagina: sin la tabla (la página cambió) o con filas a medias no se inventa nada", () => {
  assert.equal(parsearPagina("<html><body>nada</body></html>"), null);
  assert.equal(parsearPagina(""), null);
  assert.equal(parsearPagina(null as unknown as string), null);
  // Una fila con un número que falta se descarta; con menos de 3 filas buenas, no es la tabla.
  const filas = HTML.split(/(?=<tr data-hk)/);
  const rota = [filas[0], filas[1]!.replace(/\$15/, "—"), ...filas.slice(2, 4)].join("") + "</tbody></table>";
  assert.equal(parsearPagina(rota), null);
});

test("armarTabla: ids emparejados con la lista de OpenCode (aunque cambien los signos) y formato de go-topes.json con `leido`", () => {
  const ids = idsDeLaLista(IDS);
  assert.ok(ids.includes("kimi-k3.1-pro"));
  assert.equal(slugDe("Kimi K3.1 Pro", ids), "kimi-k3.1-pro");
  assert.equal(slugDe("GLM-5.3-Flash", ids), "glm-5.3-flash");
  assert.equal(slugDe("Claude Haiku 5.5", ids), "claude-haiku-5-5");
  assert.equal(slugDe("Modelo Nuevo 1.0", ids), "modelo-nuevo-1.0", "sin id conocido: el nombre en minúsculas con guiones");
  const t = armarTabla(parsearPagina(HTML), ids, JSON.parse(readFileSync(RESPALDO, "utf8")), new Date(AHORA));
  assert.equal(t.version, 1);
  assert.equal(t.fuente, "https://opencode.ai/go");
  assert.equal(t.fecha, "2026-10-28");
  assert.equal(t.leido, "2026-10-28T12:00:00.000Z");
  assert.deepEqual(t.planes.go, { nombre: "Go", usd_mes: 10 });
  assert.equal(t.modelos.find((m: { id: string }) => m.id === "claude-haiku-5-5").go.pedidos_5h, 3850);
  assert.equal(new Set(t.modelos.map((m: { id: string }) => m.id)).size, 12);
});

test("refrescar: lee la página, escribe el caché con la fecha de lectura; la app y el reparto lo leen como `cache`", { skip: soloPosix("corre un script con shebang") }, async () => {
  const d = carpeta();
  const cache = path.join(d, "opencode-go-topes.json");
  const r = await refrescar({ cache, fetch: fetchFixture(), ahora: AHORA, respaldo: RESPALDO, env: {} });
  assert.equal(r.ok, true);
  const j = JSON.parse(readFileSync(cache, "utf8"));
  assert.equal(j.leido, "2026-10-28T12:00:00.000Z");
  assert.equal(j.modelos.length, 12);
  assert.ok(vigente(cache, AHORA + 3600_000) && !vigente(cache, AHORA + 25 * 3600_000), "vale un día");
  // La app: HILOS_STATE manda sobre el respaldo del repo.
  const env = { HILOS_STATE: d };
  assert.equal(rutaCacheGo(env, d), cache);
  const t = cargarTablaGo(env, d)!;
  assert.equal(t.origen, "cache");
  assert.equal(t.leido, "2026-10-28T12:00:00.000Z");
  assert.equal(t.modelos.length, 12);
  const v = vistaPlanGo({ ...env, TRAMA_MODELOS: path.join(d, "m.json") }, d);
  assert.equal(v.origen, "cache");
  assert.equal(v.precio, 10);
  assert.equal(v.modelos.length, 12);
  // reparto: la misma fuente.
  const cupos = path.join(d, "cupos.json");
  writeFileSync(cupos, JSON.stringify({ version: 1, leido: "2026-10-26T12:00:00Z", suscripciones: [] }));
  writeFileSync(path.join(d, "m.json"), '{"version":1,"opencode_plan":"go"}');
  const rr = spawnSync(REPARTO, ["--tabla", "--json"], {
    encoding: "utf8",
    env: { ...process.env, HILOS_STATE: d, TRAMA_GO_SIN_RED: "1", REPARTO_GO_TABLA: "", REPARTO_CUPOS_FIJOS: cupos, REPARTO_AHORA: "2026-10-26T12:00:00Z", REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]', REPARTO_AGY: "0", REPARTO_AA: "0", REPARTO_STATE: path.join(d, "rs"), PA_STATE: path.join(d, "pa"), TRAMA_MODELOS: path.join(d, "m.json") },
  });
  const go = (JSON.parse(rr.stdout || "{}").modelos ?? []).filter((m: { id: string }) => m.id.startsWith("opencode:opencode-go/"));
  assert.equal(go.length, 12, rr.stderr);
});

test("sin red: no hay caché → respaldo (go-topes.json, `origen: respaldo`, la interfaz dice «datos del <fecha>»); un caché bueno no se pisa", async () => {
  const d = carpeta();
  const cache = path.join(d, "opencode-go-topes.json");
  const r = await refrescar({ cache, fetch: sinRed as never, ahora: AHORA, respaldo: RESPALDO, env: {} });
  assert.equal(r.ok, false);
  assert.match(r.motivo!, /fetch failed/);
  assert.equal(existsSync(cache), false, "un intento fallido no crea el caché");
  const env = { HILOS_STATE: d };
  const t = cargarTablaGo(env, d)!;
  assert.equal(t.origen, "respaldo");
  assert.equal(t.modelos.length, 11);
  const v = vistaPlanGo({ ...env, TRAMA_MODELOS: path.join(d, "m.json") }, d);
  assert.equal(v.origen, "respaldo");
  assert.equal(v.fecha, JSON.parse(readFileSync(RESPALDO, "utf8")).fecha);
  // Con un caché bueno, una página rota (cambió el diseño) no lo pisa.
  await refrescar({ cache, fetch: fetchFixture(), ahora: AHORA, respaldo: RESPALDO, env: {} });
  const antes = readFileSync(cache, "utf8");
  const mal = await refrescar({ cache, fetch: fetchFixture("<html>otra página</html>"), ahora: AHORA + 48 * 3600_000, respaldo: RESPALDO, env: {} });
  assert.equal(mal.ok, false);
  assert.match(mal.motivo!, /no trae la tabla/);
  assert.equal(readFileSync(cache, "utf8"), antes);
  // Y un caché roto cae al respaldo.
  writeFileSync(cache, "{roto");
  assert.equal(cargarTablaGo(env, d)!.origen, "respaldo");
});

test("refrescar --si-viejo: con el caché de menos de un día, o tras un intento hace menos de una hora, no va a la red", async () => {
  const d = carpeta();
  const cache = path.join(d, "opencode-go-topes.json");
  let pedidos = 0;
  const contar = async (u: string | URL) => {
    pedidos++;
    return fetchFixture()(u);
  };
  await refrescar({ cache, fetch: contar as never, ahora: AHORA, respaldo: RESPALDO, env: {} });
  const base = pedidos;
  assert.deepEqual(await refrescar({ cache, fetch: contar as never, ahora: AHORA + 3600_000, siViejo: true, respaldo: RESPALDO, env: {} }), { ok: true, vigente: true });
  assert.equal(pedidos, base);
  // Pasado el día, va; un fallo deja la marca y no se reintenta en seguida.
  const luego = AHORA + 25 * 3600_000;
  const falla = await refrescar({ cache, fetch: sinRed as never, ahora: luego, siViejo: true, respaldo: RESPALDO, env: {} });
  assert.equal(falla.ok, false);
  assert.ok(statSync(`${cache}.intento`).mtimeMs >= luego - 1000);
  const otra = await refrescar({ cache, fetch: contar as never, ahora: luego + 600_000, siViejo: true, respaldo: RESPALDO, env: {} });
  assert.equal(otra.vigente, true);
  assert.equal(pedidos, base);
  utimesSync(`${cache}.intento`, new Date(luego - 7200_000), new Date(luego - 7200_000));
  assert.equal((await refrescar({ cache, fetch: contar as never, ahora: luego + 7200_000, siViejo: true, respaldo: RESPALDO, env: {} })).ok, true);
  assert.ok(pedidos > base);
});

test("TRAMA_GO_SIN_RED=1: no toca la red ni escribe nada", async () => {
  const d = carpeta();
  const cache = path.join(d, "c.json");
  const r = await refrescar({ cache, fetch: (() => assert.fail("no debía pedir")) as never, ahora: AHORA, respaldo: RESPALDO, env: { TRAMA_GO_SIN_RED: "1" } });
  assert.equal(r.ok, false);
  assert.equal(existsSync(cache), false);
});
