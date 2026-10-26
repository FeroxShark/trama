// Tamaño de letra y fuentes (src/tipografia.ts): qué se acepta, los pasos de
// Ctrl+= / Ctrl+- / Ctrl+0 y las variables CSS que se ponen en <html>. Que se
// guarda en preferencias.json y se aplica en la app de verdad lo mira
// scripts/prueba-acciones.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  alCambiarApariencia,
  apariencia,
  aplicar,
  APARIENCIA_DEF,
  atajoLetra,
  cambiarApariencia,
  FUENTES,
  LETRA_DEF,
  LETRA_MAX,
  LETRA_MIN,
  MONOS,
  normalizar,
  pasoLetra,
} from "../src/tipografia.ts";

const raiz = path.join(import.meta.dirname, "..");
const css = readFileSync(path.join(raiz, "src/index.css"), "utf8");

test("el default es el estándar visual: 13 px, Inter y JetBrains Mono", () => {
  assert.deepEqual(APARIENCIA_DEF, { letra: 13, fuente: "inter", mono: "jetbrains" });
  assert.deepEqual(apariencia(), APARIENCIA_DEF);
  assert.ok(LETRA_MIN <= LETRA_DEF && LETRA_DEF <= LETRA_MAX);
});

test("normalizar: lo que no se entiende va a default, la letra se acota", () => {
  assert.deepEqual(normalizar(null), APARIENCIA_DEF);
  assert.deepEqual(normalizar({ letra: "16", fuente: "inter", mono: "fira" }), { letra: 16, fuente: "inter", mono: "fira" });
  assert.deepEqual(normalizar({ letra: 99, fuente: "comic", mono: 3 }), { letra: LETRA_MAX, fuente: "inter", mono: "jetbrains" });
  assert.equal(normalizar({ letra: 2 }).letra, LETRA_MIN);
  assert.equal(normalizar({ letra: "" }).letra, LETRA_DEF);
  assert.equal(normalizar({ letra: "grande" }).letra, LETRA_DEF);
  assert.equal(normalizar({ letra: 14.6 }).letra, 15);
  // Una fuente de interfaz no vale como fuente de código, ni al revés.
  assert.equal(normalizar({ mono: "inter" }).mono, "jetbrains");
  assert.equal(normalizar({ fuente: "fira" }).fuente, "inter");
});

test("los pasos no se salen de la escala", () => {
  assert.equal(pasoLetra(13, 1), 14);
  assert.equal(pasoLetra(LETRA_MAX, 1), LETRA_MAX);
  assert.equal(pasoLetra(LETRA_MIN, -1), LETRA_MIN);
  assert.equal(pasoLetra(16, -1), 15);
});

test("atajos: Ctrl con = + - 0 (y el teclado numérico); sin Ctrl o con Alt, nada", () => {
  const e = (key: string, mas: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; code: string }> = {}) => ({
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    key,
    ...mas,
  });
  assert.equal(atajoLetra(e("=")), 1);
  assert.equal(atajoLetra(e("+")), 1);
  assert.equal(atajoLetra(e("-")), -1);
  assert.equal(atajoLetra(e("0")), 0);
  assert.equal(atajoLetra(e("Add", { code: "NumpadAdd" })), 1);
  assert.equal(atajoLetra(e("Subtract", { code: "NumpadSubtract" })), -1);
  assert.equal(atajoLetra(e("=", { ctrlKey: false })), null);
  assert.equal(atajoLetra(e("=", { ctrlKey: false, metaKey: true })), 1);
  assert.equal(atajoLetra(e("=", { altKey: true })), null);
  assert.equal(atajoLetra(e("k")), null);
});

test("aplicar pone las tres variables CSS", () => {
  const puesto: Record<string, string> = {};
  aplicar({ setProperty: (k, v) => (puesto[k] = v) }, { letra: 16, fuente: "plex", mono: "jetbrains" });
  assert.equal(puesto["--letra"], "16");
  assert.match(puesto["--font-sans"], /^"IBM Plex Sans", "Inter"/);
  assert.match(puesto["--font-mono"], /^"JetBrains Mono", "Geist Mono"/);
});

test("cambiarApariencia avisa y devuelve sólo lo que cambió", () => {
  let avisos = 0;
  const soltar = alCambiarApariencia(() => avisos++);
  try {
    assert.equal(cambiarApariencia({ letra: 13 }), null);
    assert.equal(avisos, 0);
    assert.deepEqual(cambiarApariencia({ letra: 15, fuente: "inter" }), { letra: 15 });
    assert.deepEqual(cambiarApariencia({ letra: 40, mono: "fira" }), { letra: 18, mono: "fira" });
    assert.equal(cambiarApariencia({ fuente: "no-existe" }), null);
    assert.deepEqual(apariencia(), { letra: 18, fuente: "inter", mono: "fira" });
    assert.equal(avisos, 2);
  } finally {
    cambiarApariencia(APARIENCIA_DEF);
    soltar();
  }
  assert.deepEqual(apariencia(), APARIENCIA_DEF);
});

test("cada fuente elegible tiene su @font-face, su .woff2 y su licencia en el repo", () => {
  const caras = [...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"[^}]*url\("\.\/fuentes\/([^"]+)"\)/g)];
  const familias = new Set(caras.map((m) => m[1]));
  for (const [, , archivo] of caras) assert.ok(existsSync(path.join(raiz, "src/fuentes", archivo)), archivo);
  const terceros = readFileSync(path.join(raiz, "THIRD_PARTY.md"), "utf8");
  for (const f of [...FUENTES, ...MONOS]) {
    if (f.nombre === null) {
      assert.doesNotMatch(f.pila, /"/, "la del sistema no nombra ninguna fuente");
      continue;
    }
    assert.ok(f.pila.startsWith(`"${f.nombre}"`), f.id);
    assert.ok(familias.has(f.nombre), `falta el @font-face de ${f.nombre}`);
    assert.ok(terceros.includes(f.nombre.replace(/ (Sans|Mono)$/, "")), `falta ${f.nombre} en THIRD_PARTY.md`);
  }
  assert.doesNotMatch(css, /fonts\.(googleapis|gstatic)|https?:\/\/[^"')]*\.woff2/, "nada de fuentes por red");
});

test("el CSS escala con la letra: tamaños en rem, <html> sigue a --letra", () => {
  assert.match(css, /html\s*\{\s*font-size:\s*calc\(var\(--letra, 13\) \/ 13 \* 16px\)/);
  for (const archivo of ["src/index.css", "src/paneles/paneles.css"]) {
    const texto = readFileSync(path.join(raiz, archivo), "utf8");
    const enPx = texto.split("\n").filter((l) => /^\s*(font-size|line-height|padding|margin|gap|width|height|min-width|max-width)[a-z-]*:.*\d{2,}(\.\d+)?px/.test(l) && !l.includes("var(--letra"));
    assert.deepEqual(enPx, [], `${archivo}: medidas en px que no siguen al tamaño de letra`);
  }
});
