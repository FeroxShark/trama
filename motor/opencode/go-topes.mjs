#!/usr/bin/env node
// Los topes de OpenCode Go (pedidos cada 5 h y USD por mes, por modelo, para Go y Go Plus), leídos de OpenCode en vez de cargados a mano.
// OpenCode no los expone por CLI (`opencode models` y `opencode stats` no traen topes) ni por una API con JSON: lo único publico es la tabla
// «Limits» de https://opencode.ai/go (HTML renderizado en el servidor), así que se lee de ahí, y los ids de los modelos se emparejan con
// https://opencode.ai/zen/go/v1/models (JSON, la lista de ids de Go). El uso real por modelo (pedidos usados en la ventana) vive en la consola
// de OpenCode, detrás del login: no hay forma de pedirlo sin la sesión web, así que Trama sigue contando los pedidos que ella hace.
//
// Un solo lugar de datos: el CACHÉ `opencode-go-topes.json` en el estado de trama (`$HILOS_STATE` o ~/.local/state/hilos), con el mismo formato
// que go-topes.json más `leido` (cuándo se leyó). go-topes.json queda sólo de RESPALDO si el caché no existe o no sirve (sin red desde siempre).
// Lo leen `reparto` (motor/bin/reparto), la app (app/electron/opencode-go.ts); el runner (correr.mjs) y la app piden la actualización.
//
//   node go-topes.mjs --refrescar [--si-viejo] [--cache <archivo>]     lee la página y escribe el caché (con --si-viejo, sólo si pasó > 1 día)
// Salida: una línea («ok …», «vigente …», «error …»). Exit: 0 bien o vigente; 1 no se pudo. TRAMA_GO_SIN_RED=1 no toca la red (pruebas).
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export const URL_GO = "https://opencode.ai/go";
export const URL_IDS = "https://opencode.ai/zen/go/v1/models";
/** Cuánto vale una lectura: un día. */
export const VIGENCIA_MS = 24 * 3600_000;
/** Tras un intento (con o sin éxito) no se vuelve a intentar antes de esto. */
export const ESPERA_MS = 3600_000;
const MINIMO_MODELOS = 3;

/** Dónde está el caché (el estado propio de trama; igual que `estadoHilos` de app/electron/rutas.ts en Linux). */
export function rutaCache(env = process.env, home = os.homedir()) {
  return path.join(env.HILOS_STATE || path.join(home, ".local", "state", "hilos"), "opencode-go-topes.json");
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
/** El texto de un pedazo de HTML: sin comentarios, sin etiquetas, con las entidades de siempre. */
const texto = (h) => h.replace(/<!--.*?-->/gs, "").replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (e) => ENTIDADES[e]).replace(/\s+/g, " ").trim();
const numero = (s) => {
  const m = /^\$?\s*(\d[\d,]*(?:\.\d+)?)$/.exec(s.trim());
  return m ? Number(m[1].replaceAll(",", "")) : null;
};

/**
 * El HTML de https://opencode.ai/go → { go: {nombre, usd_mes}, "go-plus": {…}, modelos: [{nombre, go:{pedidos_5h,usd_mes}, "go-plus":{…}}] }.
 * Una fila sin sus cuatro números se descarta (no se muestran topes a medias). `null` si la página no trae la tabla (cambió el diseño).
 */
export function parsearPagina(html) {
  if (typeof html !== "string") return null;
  const cuerpo = /<tbody[^>]*>(.*?)<\/tbody>/s.exec(html)?.[1];
  if (!cuerpo) return null;
  const modelos = [];
  for (const fila of cuerpo.split(/<tr[\s>]/).slice(1)) {
    const nombre = texto(/<th[^>]*scope="row"[^>]*>\s*<bdi>(.*?)<\/bdi>/s.exec(fila)?.[1] ?? "");
    // Dos celdas «number»: la de pedidos (Go, Go Plus) y la de USD al mes (Go, Go Plus); cada una con un <span> por plan.
    const celdas = [...fila.matchAll(/<td[^>]*data-slot="number"[^>]*>(.*?)<\/td>/gs)].map((c) => [...c[1].matchAll(/<span[^>]*>(.*?)<\/span>/gs)].map((s) => numero(texto(s[1]))));
    if (!nombre || celdas.length < 2) continue;
    const [pedidos, usd] = celdas;
    if (pedidos.length < 2 || usd.length < 2 || [...pedidos.slice(0, 2), ...usd.slice(0, 2)].some((n) => n === null)) continue;
    modelos.push({ nombre, go: { pedidos_5h: pedidos[0], usd_mes: usd[0] }, "go-plus": { pedidos_5h: pedidos[1], usd_mes: usd[1] } });
  }
  if (modelos.length < MINIMO_MODELOS) return null;
  const plano = texto(html.replace(/<head>.*?<\/head>/s, ""));
  const precio = (re) => {
    const m = re.exec(plano);
    return m ? Number(m[1]) : null;
  };
  return { precios: { go: precio(/(?<![A-Za-z])Go costs \$(\d+)\s*\/\s*month/i), "go-plus": precio(/(?<![A-Za-z])Go Plus costs \$(\d+)\s*\/\s*month/i) }, modelos };
}

/** El JSON de /zen/go/v1/models → los ids. [] si no es el contrato. */
export function idsDeLaLista(json) {
  const data = json && typeof json === "object" && Array.isArray(json.data) ? json.data : [];
  return data.map((m) => (m && typeof m.id === "string" ? m.id : "")).filter((i) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(i));
}

/** El id (`kimi-k3.1-pro`) de un nombre de la página (`Kimi K3.1 Pro`): el que coincide quitando signos entre los ids conocidos; si ninguno, el nombre en minúsculas con guiones. */
export function slugDe(nombre, conocidos) {
  const n = norm(nombre);
  return conocidos.find((id) => norm(id) === n) ?? nombre.trim().toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * La tabla en el formato de go-topes.json (version 1) más `leido`. `pagina`: lo que devolvió parsearPagina; `ids`: los de la lista de OpenCode;
 * `respaldo`: la tabla de go-topes.json (sus ids también cuentan para emparejar, y su precio de Go si la página no lo trae).
 */
export function armarTabla(pagina, ids, respaldo, ahora = new Date()) {
  const conocidos = [...new Set([...ids, ...(respaldo?.modelos ?? []).map((m) => m.id)])];
  const modelos = [];
  const vistos = new Set();
  for (const m of pagina.modelos) {
    const id = slugDe(m.nombre, conocidos);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    modelos.push({ id, nombre: m.nombre, go: m.go, "go-plus": m["go-plus"] });
  }
  const iso = ahora.toISOString();
  const usd = (plan) => pagina.precios[plan] ?? respaldo?.planes?.[plan]?.usd_mes ?? null;
  const planes = { go: { nombre: "Go", ...(usd("go") !== null ? { usd_mes: usd("go") } : {}) }, "go-plus": { nombre: "Go Plus", ...(usd("go-plus") !== null ? { usd_mes: usd("go-plus") } : {}) } };
  return { version: 1, fuente: URL_GO, fecha: iso.slice(0, 10), leido: iso, nota: "Caché de trama: se lee solo de opencode.ai/go (motor/opencode/go-topes.mjs). No editar; el respaldo sin red es go-topes.json.", proveedor: "opencode-go", planes, modelos };
}

/** ¿El caché existe y se leyó hace menos de un día? */
export function vigente(cache, ahoraMs = Date.now()) {
  try {
    const t = Date.parse(JSON.parse(readFileSync(cache, "utf8")).leido);
    return Number.isFinite(t) && ahoraMs - t < VIGENCIA_MS && t <= ahoraMs + 60_000;
  } catch {
    return false;
  }
}

/** ¿Se intentó hace menos de una hora? (la marca es la fecha de `<cache>.intento`) */
export function intentoReciente(cache, ahoraMs = Date.now()) {
  try {
    return ahoraMs - statSync(`${cache}.intento`).mtimeMs < ESPERA_MS;
  } catch {
    return false;
  }
}

function marcarIntento(cache, ahoraMs) {
  try {
    mkdirSync(path.dirname(cache), { recursive: true });
    const m = `${cache}.intento`;
    if (!existsSync(m)) writeFileSync(m, "");
    utimesSync(m, new Date(ahoraMs), new Date(ahoraMs));
  } catch {
    /* sin marca, se reintenta antes: no es grave */
  }
}

const pedir = async (fetchFn, url, ms) => {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(ms), headers: { "user-agent": "trama (go-topes)" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
};

/**
 * Lee la página, arma la tabla y escribe el caché (tmp + rename). Devuelve { ok: true, tabla } o { ok: false, motivo }; nunca tira ni pisa un caché
 * bueno con algo que no sirve. Opciones: `cache`, `fetch` (pruebas), `ahora` (ms), `respaldo` (ruta de go-topes.json), `siViejo`.
 */
export async function refrescar({ cache = rutaCache(), fetch: fetchFn = globalThis.fetch, ahora = Date.now(), respaldo = path.join(path.dirname(fileURLToPath(import.meta.url)), "go-topes.json"), siViejo = false, env = process.env } = {}) {
  if (env.TRAMA_GO_SIN_RED === "1") return { ok: false, motivo: "TRAMA_GO_SIN_RED=1: sin red" };
  if (siViejo && (vigente(cache, ahora) || intentoReciente(cache, ahora))) return { ok: true, vigente: true };
  marcarIntento(cache, ahora);
  try {
    const pagina = parsearPagina(await (await pedir(fetchFn, URL_GO, 20_000)).text());
    if (!pagina) return { ok: false, motivo: `${URL_GO}: no trae la tabla de topes (¿cambió la página?)` };
    let ids = [];
    try {
      ids = idsDeLaLista(await (await pedir(fetchFn, URL_IDS, 15_000)).json());
    } catch {
      /* sin la lista se emparejan con el respaldo o se arma el id del nombre */
    }
    let base = null;
    try {
      base = JSON.parse(readFileSync(respaldo, "utf8"));
    } catch {
      /* sin respaldo */
    }
    const tabla = armarTabla(pagina, ids, base, new Date(ahora));
    mkdirSync(path.dirname(cache), { recursive: true });
    const tmp = `${cache}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(tabla, null, 1) + "\n");
    renameSync(tmp, cache);
    return { ok: true, tabla };
  } catch (e) {
    return { ok: false, motivo: String(e?.message ?? e).slice(0, 200) };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--refrescar")) {
    process.stderr.write("uso: node go-topes.mjs --refrescar [--si-viejo] [--cache <archivo>]\n");
    process.exit(2);
  }
  const i = args.indexOf("--cache");
  const cache = i >= 0 && args[i + 1] ? args[i + 1] : rutaCache();
  const r = await refrescar({ cache, siViejo: args.includes("--si-viejo") });
  if (!r.ok) {
    process.stdout.write(`error ${r.motivo}\n`);
    process.exit(1);
  }
  process.stdout.write(r.vigente ? `vigente ${cache}\n` : `ok ${r.tabla.modelos.length} modelos, leído ${r.tabla.leido} → ${cache}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
