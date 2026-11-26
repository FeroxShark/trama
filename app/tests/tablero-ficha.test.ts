// `tablero ficha <proyecto>` (app/electron/cli/tablero.ts): entra entera en el arranque de una sesión, así que cada item ocupa una línea
// de a lo sumo 160 caracteres, cada columna muestra 6 items (los más nuevos primero), el resto se cuenta y los «Probar …» se juntan en
// una sola línea. Contra un tablero y un repo TEMPORALES (el tablero real no se toca).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../electron/cli/tablero.ts";

const TMP = mkdtempSync(path.join(os.tmpdir(), "tablero-ficha-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const REPO = path.join(TMP, "demo");
mkdirSync(REPO);
const g = (...a: string[]) => execFileSync("git", ["-C", REPO, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8", windowsHide: true });
g("init", "-q", "-b", "main");
g("commit", "-q", "--allow-empty", "-m", "inicio");
const REGISTRY = path.join(TMP, "registry.json");
writeFileSync(REGISTRY, JSON.stringify({ projects: [{ name: "demo", path: REPO, estado: "activo" }] }));

let n = 0;
type Dato = { id: number; titulo: string; columna?: string; prueba?: string; dia: number };
/** Un tablero con esos items (todos de `demo`); `dia` ordena por antigüedad: más alto = más nuevo. */
const entorno = (datos: Dato[]) => {
  const dir = path.join(TMP, `tablero-${++n}`);
  mkdirSync(dir);
  const lineas = datos.map((d) => ({
    id: d.id, columna: d.columna ?? "espera-dueno", proyecto: "demo", titulo: d.titulo, detalle: "", prueba: d.prueba ?? "", origen: "", clave: "", head: null,
    creado: `2024-01-${String(d.dia).padStart(2, "0")}T12:00:00+00:00`, tocado: `2024-01-${String(d.dia).padStart(2, "0")}T12:00:00+00:00`, cerrado: null, hasta: null,
  }));
  writeFileSync(path.join(dir, "items.jsonl"), lineas.map((l) => JSON.stringify(l) + "\n").join(""));
  return { TABLERO_DIR: dir, TABLERO_VISTA: path.join(dir, "vista.json"), PA_STATE: path.join(TMP, "pa"), PROYECTOS_REGISTRY: REGISTRY, HOME: TMP, USERPROFILE: TMP, TRAMA_DUENO: "Ana" };
};
const ficha = async (datos: Dato[], ...args: string[]) => {
  let out = "";
  const rc = await main(["ficha", "demo", ...args], entorno(datos), { out: (s) => void (out += s), err: () => {} });
  return { rc, lineas: out.replace(/\n$/, "").split("\n") };
};

const MUCHOS: Dato[] = [
  ...Array.from({ length: 9 }, (_, i): Dato => ({ id: i + 1, titulo: `decidir ${i + 1}`, dia: i + 1, prueba: i === 4 ? "" : `1. [ ] paso uno\n2. [ ] paso dos ${"largo ".repeat(40)}` })),
  ...Array.from({ length: 15 }, (_, i): Dato => ({ id: 100 + i, titulo: `Probar v0.1.${i} (Linux)`, dia: i + 1, prueba: "mirar algo" })),
  ...Array.from({ length: 8 }, (_, i): Dato => ({ id: 200 + i, titulo: `en marcha ${i} ${"largo ".repeat(40)}`, columna: "en-curso", dia: i + 1 })),
];

test("cada item ocupa una línea de a lo sumo 160 caracteres, sin saltos de la prueba", async () => {
  const { rc, lineas } = await ficha(MUCHOS);
  assert.equal(rc, 0);
  for (const l of lineas) if (l.startsWith("  ")) assert.ok(Array.from(l).length <= 160, `línea larga (${Array.from(l).length}): ${l}`);
  // la prueba de varias líneas queda en la misma línea del item, recortada
  const i9 = lineas.find((l) => l.startsWith("  9  decidir 9"))!;
  assert.match(i9, /· probar: 1\. \[ \] paso uno 2\. \[ \] paso dos/);
  assert.ok(i9.endsWith("…"));
  // un item sin prueba no lleva «probar:»
  assert.doesNotMatch(lineas.find((l) => l.startsWith("  5  decidir 5"))!, /probar:/);
});

test("por columna: 6 sueltos, los más nuevos primero, y el resto contado con el comando para verlo", async () => {
  const { lineas } = await ficha(MUCHOS);
  const sueltos = lineas.filter((l) => /^ {2}\d+ {2}decidir /.test(l)).map((l) => l.trim().split(" ")[0]);
  assert.deepEqual(sueltos, ["9", "8", "7", "6", "5", "4"]);
  assert.ok(lineas.includes("  … y 3 más (tablero listar --proyecto demo --columna espera-dueno)"));
  const curso = lineas.filter((l) => /^ {2}\d+ {2}en marcha /.test(l)).map((l) => l.trim().split(" ")[0]);
  assert.deepEqual(curso, ["207", "206", "205", "204", "203", "202"]);
  assert.ok(lineas.includes("  … y 2 más (tablero listar --proyecto demo --columna en-curso)"));
  assert.ok(lineas.includes("espera-dueno (24):"));
});

test("los «Probar …» van en una sola línea (cuántos, ids de los más nuevos, el título del más nuevo) y no gastan el tope", async () => {
  const { lineas } = await ficha(MUCHOS);
  assert.equal(lineas.filter((l) => l.includes("Probar v0.1.")).length, 1);
  assert.equal(lineas.filter((l) => /^ {2}1\d\d {2}Probar /.test(l)).length, 0);
  const l = lineas.find((x) => x.startsWith("  Probar (15):"))!;
  assert.ok(l.startsWith("  Probar (15): 114 113 112 111 110 109 108 107 106 105 104 103 … +3"));
  assert.ok(l.includes("el más nuevo: «Probar v0.1.14 (Linux)»"));
  assert.ok(Array.from(l).length <= 160);
});

test("pocos items: sin «y N más» ni línea de Probar, y la ficha completa entra holgada", async () => {
  const { lineas } = await ficha([{ id: 1, titulo: "decidir esto", prueba: "npm test", dia: 3 }, { id: 2, titulo: "otro", dia: 4 }]);
  assert.ok(lineas.includes("espera-dueno (2):"));
  assert.ok(lineas.some((l) => /^ {2}2 {2}otro {2}\(/.test(l)));
  assert.ok(lineas.some((l) => /^ {2}1 {2}decidir esto {2}\(.*\) · probar: npm test$/.test(l)));
  assert.ok(!lineas.some((l) => l.includes("más (") || l.includes("Probar (")));
});

test("la ficha de un proyecto con muchos items queda corta; --corta y --json siguen como antes", async () => {
  const { lineas } = await ficha(MUCHOS);
  assert.ok(lineas.join("\n").length < 3000);
  const corta = await ficha(MUCHOS, "--corta");
  assert.ok(corta.lineas.some((l) => l.startsWith("espera-dueno (24): #")));
  const json = await ficha(MUCHOS, "--json");
  assert.equal(JSON.parse(json.lineas.join("\n")).espera_dueno.length, 24);
});
