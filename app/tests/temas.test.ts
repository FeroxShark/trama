// Los temas de color (src/temas.css, src/temas.ts): que cada tema se lea (contraste WCAG AA de los textos sobre
// las superficies) y que los estados (ok, aviso, crítico) no se confundan con deuteranomalía (rojo-verde débil).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { esTema, resolverTema, TEMAS } from "../src/temas.ts";
import { normalizar } from "../src/tipografia.ts";

const raiz = path.join(import.meta.dirname, "..");
const leer = (f: string) => readFileSync(path.join(raiz, f), "utf8");
const temasCss = leer("src/temas.css");
const tokensCss = leer("src/tokens.css");

/** Las declaraciones `--x: valor;` de un bloque. */
const declaraciones = (cuerpo: string): Record<string, string> =>
  Object.fromEntries([...cuerpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\s+/g, " ").trim()]));

const bloque = (css: string, selector: string): string => {
  const i = css.indexOf(selector + " {");
  assert.ok(i >= 0, `falta ${selector}`);
  return css.slice(i + selector.length + 2, css.indexOf("\n}", i));
};

const PINTADOS = TEMAS.filter((t) => t !== "sistema");
/** Los tokens de cada tema: lo de :root con lo que pisa su bloque. */
const raizTokens = declaraciones(bloque(tokensCss, ":root"));
const tema = (id: string): Record<string, string> => ({ ...raizTokens, ...declaraciones(bloque(temasCss, `[data-tema="${id}"]`)) });

// --- color ---
const rgbDe = (v: string): [number, number, number, number] => {
  const hx = v.match(/^#([0-9a-f]{6})$/i);
  if (hx) return [0, 2, 4].map((i) => parseInt(hx[1].slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
  const f = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/);
  assert.ok(f, `color que no entiendo: ${v}`);
  const a = f[4] === undefined ? 1 : f[4].endsWith("%") ? parseFloat(f[4]) / 100 : parseFloat(f[4]);
  return [+f[1], +f[2], +f[3], a];
};
/** Un color (con alfa) puesto sobre un fondo opaco. */
const sobre = (v: string, fondo: [number, number, number]): [number, number, number] => {
  const [r, g, b, a] = rgbDe(v);
  return [r, g, b].map((c, i) => c * a + fondo[i] * (1 - a)) as [number, number, number];
};
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contraste = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const SUPERFICIES = ["--sup-0", "--sup-1", "--sup-2"];
// Cuerpo: lo que se lee corrido. Apagado: lo secundario (metadatos, placeholders). El resto de la escala (texto-7/8) es decorativo.
const CUERPO = ["--texto-1", "--texto-2", "--texto-3", "--texto-4", "--txt-1", "--txt-2", "--txt-3"];
const APAGADO = ["--texto-5", "--texto-6", "--txt-4"];
// Colores que se usan como texto (estados, acento, enlaces).
const COLOR_TEXTO = ["--acento", "--ok", "--aviso", "--critico", "--rojo-texto"];

for (const id of PINTADOS) {
  test(`tema ${id}: el texto cumple WCAG AA sobre las superficies (cuerpo ≥ 4,5, apagado ≥ 3, estados ≥ 4,5)`, () => {
    const t = tema(id);
    const fallas: string[] = [];
    for (const s of SUPERFICIES) {
      const fondo = rgbDe(t[s]).slice(0, 3) as [number, number, number];
      const mira = (tk: string, min: number) => {
        const c = contraste(sobre(t[tk], fondo), fondo);
        if (c < min) fallas.push(`${tk} sobre ${s}: ${c.toFixed(2)} < ${min}`);
      };
      CUERPO.forEach((k) => mira(k, 4.5));
      APAGADO.forEach((k) => mira(k, 3));
      COLOR_TEXTO.forEach((k) => mira(k, 4.5));
    }
    // El texto sobre el acento (botón primario) también se lee.
    const ac = rgbDe(t["--acento"]).slice(0, 3);
    const c = contraste(rgbDe(t["--acento-texto"]).slice(0, 3), ac);
    if (c < 4.5) fallas.push(`--acento-texto sobre --acento: ${c.toFixed(2)}`);
    assert.deepEqual(fallas, []);
  });
}

// --- daltonismo: deuteranomalía (Machado 2009, severidad 1) y distancia CIE76 ---
const M = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];
const gamma = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const deutan = (c: number[]) => {
  const l = c.map(lin);
  return M.map((f) => gamma(Math.min(1, Math.max(0, f[0] * l[0] + f[1] * l[1] + f[2] * l[2]))));
};
const lab = (c: number[]) => {
  const l = c.map(lin);
  const x = (0.4124 * l[0] + 0.3576 * l[1] + 0.1805 * l[2]) / 0.95047;
  const y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  const z = (0.0193 * l[0] + 0.1192 * l[1] + 0.9505 * l[2]) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const distancia = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

for (const id of PINTADOS) {
  test(`tema ${id}: ok, aviso y crítico se distinguen con deuteranomalía`, () => {
    const t = tema(id);
    const v = (k: string) => lab(deutan(rgbDe(t[k]).slice(0, 3)));
    for (const [a, b] of [["--ok", "--critico"], ["--ok", "--aviso"], ["--aviso", "--critico"]]) {
      const d = distancia(v(a), v(b));
      assert.ok(d >= 25, `${a} y ${b} se parecen demasiado (ΔE ${d.toFixed(0)} < 25)`);
    }
  });
}

test("el bloque oscuro de temas.css no se separa de :root", () => {
  const o = declaraciones(bloque(temasCss, '[data-tema="oscuro"]'));
  for (const [k, v] of Object.entries(o)) assert.equal(v, raizTokens[k], `${k} difiere de :root`);
});

test("cada tema tiene su bloque y su nombre en los dos idiomas", () => {
  const es = leer("src/i18n/es.ts");
  const en = leer("src/i18n/en.ts");
  for (const id of TEMAS) {
    if (id !== "sistema") assert.ok(temasCss.includes(`[data-tema="${id}"] {`), `falta el bloque de ${id}`);
    assert.ok(es.includes(`"ajustes.tema.${id}"`) && en.includes(`"ajustes.tema.${id}"`), `falta el nombre de ${id}`);
  }
});

test("el script de index.html conoce los mismos ids que src/temas.ts", () => {
  const html = leer("index.html");
  const lista = html.match(/\[("sistema"[^\]]+)\]\.indexOf/);
  assert.ok(lista, "no encuentro la lista de ids en index.html");
  assert.deepEqual(JSON.parse(`[${lista[1]}]`), [...TEMAS]);
});

test("resolver y normalizar", () => {
  assert.equal(resolverTema("sistema", true), "claro");
  assert.equal(resolverTema("sistema", false), "oscuro");
  assert.equal(resolverTema("bosque", true), "bosque");
  assert.ok(esTema("grafito") && !esTema("rosa") && !esTema(null));
  assert.equal(normalizar({ tema: "claro" }).tema, "claro");
  assert.equal(normalizar({ tema: "violeta" }).tema, "oscuro");
  assert.equal(normalizar(null).tema, "oscuro");
});
