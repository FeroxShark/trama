// La línea bajo el título de un worker (src/hilo/cabecera-worker.ts): proyecto, modelo y esfuerzo, commits y archivos. Lo que no se sabe o es
// cero no sale, y el plural sigue el idioma (es: "archivo"; en: "file"). Sin React: se prueba la función con los datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineaCabeceraWorker } from "../src/hilo/cabecera-worker.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";

const base = { proyecto: "trama", modelo: "claude-haiku-5-5", effort: "xhigh", commits: 2, archivos: 5 };

test("cabecera del worker: en español, con plural de commits y archivos", () => {
  cambiarIdioma("es");
  try {
    assert.equal(lineaCabeceraWorker(base), "trama · Haiku 5.5 xhigh · 2 commits · 5 archivos");
    assert.equal(lineaCabeceraWorker({ ...base, commits: 1, archivos: 1 }), "trama · Haiku 5.5 xhigh · 1 commit · 1 archivo");
  } finally {
    cambiarIdioma("en");
  }
});

test("cabecera del worker: en inglés, con plural de commits y files", () => {
  cambiarIdioma("en");
  assert.equal(lineaCabeceraWorker(base), "trama · Haiku 5.5 xhigh · 2 commits · 5 files");
  assert.equal(lineaCabeceraWorker({ ...base, commits: 1, archivos: 1 }), "trama · Haiku 5.5 xhigh · 1 commit · 1 file");
});

test("cabecera del worker: los ceros se ocultan, sin dejar separadores sueltos", () => {
  cambiarIdioma("en");
  assert.equal(lineaCabeceraWorker({ ...base, commits: 0, archivos: 0 }), "trama · Haiku 5.5 xhigh");
  assert.equal(lineaCabeceraWorker({ ...base, commits: 0 }), "trama · Haiku 5.5 xhigh · 5 files");
  assert.equal(lineaCabeceraWorker({ ...base, archivos: 0 }), "trama · Haiku 5.5 xhigh · 2 commits");
});

test("cabecera del worker: un modelo que no está en la tabla no se inventa (ni su esfuerzo)", () => {
  cambiarIdioma("en");
  assert.equal(lineaCabeceraWorker({ ...base, modelo: "modelo-que-no-existe" }), "trama · 2 commits · 5 files");
  assert.equal(lineaCabeceraWorker({ ...base, modelo: null }), "trama · 2 commits · 5 files");
  assert.equal(lineaCabeceraWorker({ ...base, modelo: undefined, commits: 0, archivos: 0 }), "trama");
});

test("cabecera del worker: sin esfuerzo, el modelo va solo", () => {
  cambiarIdioma("en");
  assert.equal(lineaCabeceraWorker({ ...base, effort: null, commits: 0, archivos: 0 }), "trama · Haiku 5.5");
  assert.equal(lineaCabeceraWorker({ ...base, effort: "", commits: 0, archivos: 0 }), "trama · Haiku 5.5");
});
