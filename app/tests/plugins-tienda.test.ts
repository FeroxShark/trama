// La tienda de plugins: lo que se lee de la caché del catálogo de Claude Code (instalaciones y última actualización) y cómo se filtra y ordena.
// Catálogo falso en una carpeta temporal: sólo se LEE; ningún test instala ni quita un plugin (nunca se llama a `claude`).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Rutas } from "../electron/conectores-claude.ts";
import { estadoCatalogos, type DepsPlugins, type PluginCatalogo } from "../electron/plugins-claude.ts";
import { CAT_NINGUNA, CAT_TODAS, categoriasDe, filtrarCategoria, ordenarPlugins } from "../src/paneles/conectores-vista.ts";

const escribir = (ruta: string, x: unknown) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, typeof x === "string" ? x : JSON.stringify(x));
};

/** Un home inventado con un catálogo de cuatro plugins; `cache` es el contenido de plugin-catalog-cache.json (sin él, el archivo no existe). */
function armar(cache?: unknown) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "tienda-"));
  const home = path.join(raiz, "ana");
  const rutas: Rutas = { home, claude: path.join(home, ".claude"), claudeJson: path.join(home, ".claude.json"), registro: path.join(raiz, "registry.json") };
  const mercado = path.join(rutas.claude, "plugins", "marketplaces", "oficial");
  escribir(path.join(rutas.claude, "plugins", "known_marketplaces.json"), { oficial: { source: { source: "github", repo: "anthropics/claude-plugins-official" }, installLocation: mercado } });
  escribir(path.join(mercado, ".claude-plugin", "marketplace.json"), {
    name: "oficial",
    plugins: [
      { name: "alfa", description: "A", category: "diseño" },
      { name: "beta", description: "B", category: "seguridad" },
      { name: "gamma", description: "C" },
      { name: "delta", description: "D", category: "diseño" },
    ],
  });
  if (cache !== undefined) escribir(path.join(rutas.claude, "plugins", "plugin-catalog-cache.json"), cache);
  const deps: DepsPlugins = { env: { PATH: "/usr/bin" }, home, plat: "linux", rutas, cuentas: () => [] };
  return { deps, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

const plugins = async (cache?: unknown): Promise<PluginCatalogo[]> => {
  const { deps, limpiar } = armar(cache);
  try {
    return (await estadoCatalogos(deps)).catalogos.find((c) => c.id === "oficial")!.plugins;
  } finally {
    limpiar();
  }
};

const cacheDe = (plugins: Record<string, unknown>) => ({ version: 1, fetchedAt: "2026-10-09T10:31:44.108Z", catalog: { plugins } });

test("estadoCatalogos: instalaciones y última actualización salen de la caché de Claude Code", async () => {
  const ps = await plugins(
    cacheDe({
      "alfa@oficial": { unique_installs: 3448, last_updated: "2026-05-12T09:29:59-07:00" },
      "beta@oficial": { unique_installs: 10, last_updated: "2026-09-21T10:39:52Z" },
    }),
  );
  const alfa = ps.find((p) => p.nombre === "alfa")!;
  assert.equal(alfa.instalaciones, 3448);
  assert.equal(alfa.actualizado, Date.parse("2026-05-12T16:29:59Z"));
  assert.equal(ps.find((p) => p.nombre === "beta")!.instalaciones, 10);
});

test("estadoCatalogos: sin archivo, con el archivo roto o con campos que no sirven, «sin dato» (null) y no se rompe", async () => {
  const sinDato = (ps: PluginCatalogo[]) => ps.every((p) => p.instalaciones === null && p.actualizado === null);
  const sinArchivo = await plugins();
  assert.equal(sinArchivo.length, 4, "el archivo no existe");
  assert.ok(sinDato(sinArchivo));
  assert.ok(sinDato(await plugins("{ esto no es json")));
  assert.ok(sinDato(await plugins(["no", "es", "un", "objeto"])));
  assert.ok(sinDato(await plugins({ version: 1, catalog: { plugins: "raro" } })));
  // Un campo malo no tapa al otro, ni a los demás plugins.
  const ps = await plugins(
    cacheDe({
      "alfa@oficial": { unique_installs: "muchos", last_updated: "2026-01-02T00:00:00Z" },
      "beta@oficial": { unique_installs: -5, last_updated: "ayer" },
      "gamma@oficial": { unique_installs: null },
      "delta@oficial": 7,
    }),
  );
  const por = (n: string) => ps.find((p) => p.nombre === n)!;
  assert.equal(por("alfa").instalaciones, null);
  assert.equal(por("alfa").actualizado, Date.parse("2026-01-02T00:00:00Z"));
  assert.equal(por("beta").instalaciones, null);
  assert.equal(por("beta").actualizado, null);
  assert.equal(por("gamma").instalaciones, null);
  assert.equal(por("delta").actualizado, null);
});

test("estadoCatalogos: la categoría es la del propio catálogo (vacía si no trae)", async () => {
  const ps = await plugins();
  assert.deepEqual(ps.map((p) => [p.nombre, p.categoria]), [["alfa", "diseño"], ["beta", "seguridad"], ["delta", "diseño"], ["gamma", ""]]);
});

const P = (nombre: string, categoria: string, instalaciones: number | null, actualizado: number | null) => ({ nombre, categoria, instalaciones, actualizado });
const lista = [P("alfa", "diseño", 50, 100), P("beta", "seguridad", 900, null), P("gamma", "", null, 300), P("delta", "diseño", 900, 200), P("epsilon", "", 0, null)];

test("ordenarPlugins: «instalados» de más a menos, el cero antes que el «sin dato», empate por nombre y sin dato al final", () => {
  assert.deepEqual(ordenarPlugins(lista, "instalados").map((p) => p.nombre), ["beta", "delta", "alfa", "epsilon", "gamma"]);
});

test("ordenarPlugins: «recientes» del más nuevo al más viejo y los sin fecha al final, por nombre", () => {
  assert.deepEqual(ordenarPlugins(lista, "recientes").map((p) => p.nombre), ["gamma", "delta", "alfa", "beta", "epsilon"]);
});

test("ordenarPlugins: por nombre, sin tocar la lista original", () => {
  const antes = lista.map((p) => p.nombre);
  assert.deepEqual(ordenarPlugins(lista, "nombre").map((p) => p.nombre), ["alfa", "beta", "delta", "epsilon", "gamma"]);
  assert.deepEqual(lista.map((p) => p.nombre), antes);
});

test("ordenarPlugins: datos que faltan del todo (el campo ni existe) cuentan como «sin dato»", () => {
  const sueltos = [{ nombre: "b", categoria: "" }, { nombre: "a", categoria: "", instalaciones: 3 }, { nombre: "c", categoria: "", instalaciones: Number.NaN }];
  assert.deepEqual(ordenarPlugins(sueltos, "instalados").map((p) => p.nombre), ["a", "b", "c"]);
  assert.deepEqual(ordenarPlugins(sueltos, "recientes").map((p) => p.nombre), ["a", "b", "c"]);
});

test("categorías: las del catálogo, ordenadas; «Sin categoría» sólo si algún plugin no trae", () => {
  const c = categoriasDe(lista);
  assert.deepEqual(c.claves, ["c:diseño", "c:seguridad"]);
  assert.equal(c.haySin, true);
  assert.equal(categoriasDe([P("x", "docs", 1, 1)]).haySin, false);
  assert.equal(categoriasDe([P("x", "  ", 1, 1)]).haySin, true);
});

test("filtrarCategoria: una categoría, «sin categoría» o todas", () => {
  assert.deepEqual(filtrarCategoria(lista, "c:diseño").map((p) => p.nombre), ["alfa", "delta"]);
  assert.deepEqual(filtrarCategoria(lista, CAT_NINGUNA).map((p) => p.nombre), ["gamma", "epsilon"]);
  assert.equal(filtrarCategoria(lista, CAT_TODAS).length, 5);
  assert.deepEqual(filtrarCategoria(lista, "c:nada"), []);
});
