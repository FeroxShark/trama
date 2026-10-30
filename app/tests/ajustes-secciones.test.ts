// Cada sección de Ajustes tiene que vivir dentro de un <Cat> (AjustesNav.tsx): lo que queda afuera se ve en TODAS las pestañas.
// Regresión: "Precios de API" aparecía arriba de todo en cada categoría. Se mira el código: los componentes se montan siempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/paneles");
const leer = (f: string) => readFileSync(path.join(dir, f), "utf8");

/** Los componentes de sección que `padre` monta (importados de ./X) y que quedan fuera de un <Cat> del propio padre. */
function sueltos(padre: string): { nombre: string; archivo: string }[] {
  const src = leer(padre);
  const importados = new Map<string, string>();
  for (const m of src.matchAll(/import \{([^}]+)\} from "\.\/([A-Za-z]+)";/g)) {
    for (const n of m[1].split(",").map((x) => x.trim().split(" as ").pop()!)) importados.set(n, m[2]);
  }
  const salida: { nombre: string; archivo: string }[] = [];
  let prof = 0;
  // Sólo el JSX que arma la pantalla: desde <AjustesMarco> (Ajustes) o desde el return que contiene a los hermanos (Modelos).
  const marco = src.indexOf("<AjustesMarco>");
  const ini = marco >= 0 ? marco : src.lastIndexOf("\n  return (", src.indexOf("<AjustesPrecios"));
  for (const linea of src.slice(ini).split("\n")) {
    if (/<Cat\b/.test(linea) && !/<\/Cat>/.test(linea)) prof++;
    else if (/<\/Cat>/.test(linea) && !/<Cat\b/.test(linea)) prof--;
    const m = /^\s*<([A-Z]\w*)\b/.exec(linea);
    const archivo = m && importados.get(m[1]);
    if (m && archivo && prof === 0 && existsSync(path.join(dir, archivo + ".tsx"))) salida.push({ nombre: m[1], archivo: archivo + ".tsx" });
  }
  return salida;
}

test("las secciones que Ajustes y Modelos montan sueltas se envuelven ellas mismas en un <Cat>", () => {
  const todas = [...sueltos("Ajustes.tsx"), ...sueltos("AjustesModelos.tsx")].filter((s) => !["AjustesMarco", "BarraGuardar", "ErrorCarga", "Numeros"].includes(s.nombre));
  assert.ok(todas.some((s) => s.nombre === "AjustesPrecios"), "el escaneo tiene que ver AjustesPrecios");
  for (const s of todas) assert.match(leer(s.archivo), /<Cat id="/, `${s.nombre} (${s.archivo}) se ve en todas las pestañas: falta envolverlo en <Cat id=…>`);
});

test("Precios de API sólo se pinta en Modelos", () => {
  const src = leer("AjustesPrecios.tsx");
  assert.match(src, /<Cat id="modelos"[^>]*>\s*<section/, "la sección de precios va dentro de <Cat id=\"modelos\">");
  assert.equal(src.match(/<Cat\b/g)?.length, 1);
  assert.equal(leer("AjustesModelos.tsx").match(/<AjustesPrecios\b/g)?.length, 1);
});

test("el ajuste de caché vencida vive en General", () => {
  const src = leer("Ajustes.tsx");
  const dato = src.indexOf('nombre="ajustes.cacheVencida"');
  assert.ok(dato > 0);
  assert.match(src.slice(0, dato), /const app = \(\s*\n\s*<section/, "el ajuste está en el bloque `app`");
  assert.match(src, /<Cat id="general">\s*\{a \? <Fijo[^\n]*\n\s*\{app\}/);
});
