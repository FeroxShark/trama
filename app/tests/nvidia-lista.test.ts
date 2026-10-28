// La lista de modelos de NVIDIA NIM de Ajustes y los textos de la sección (mismas claves en es y en).
import assert from "node:assert/strict";
import test from "node:test";
import { ID_NIM, listaNim, URL_NVIDIA } from "../src/paneles/nvidia-lista.ts";
import { es } from "../src/i18n/es.ts";
import { en } from "../src/i18n/en.ts";

test("la lista: el base primero, sin repetidos, y lo agregado en la sesión sigue ahí aunque se apague", () => {
  assert.deepEqual(listaNim({ base: "a/b", modelos: [] }, []), ["a/b"]);
  assert.deepEqual(listaNim({ base: "a/b", modelos: ["c/d", "a/b"] }, ["e/f", "c/d"]), ["a/b", "c/d", "e/f"]);
});

test("el id de un modelo es organizacion/modelo, sin espacios", () => {
  for (const ok of ["deepseek-ai/deepseek-v4.1-flash", "meta/llama-3.3-70b-instruct", "x"]) assert.ok(ID_NIM.test(ok), ok);
  for (const mal of ["", " a/b", "a b", "a/b;c", "/a", "a\\b"]) assert.equal(ID_NIM.test(mal), false, JSON.stringify(mal));
});

test("la ayuda apunta a build.nvidia.com", () => {
  assert.equal(URL_NVIDIA, "https://build.nvidia.com");
});

test("los textos de NVIDIA NIM existen en los dos idiomas con las mismas variables", () => {
  const claves = Object.keys(es).filter((k) => /^(ajustes\.nim|cu\.nvidia|cu\.g[cd]?\.nvidia|cu\.v\.1m|uso\.minLargo|main\.nim)/.test(k));
  assert.ok(claves.length >= 30, `solo ${claves.length}`);
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of claves) {
    assert.ok(k in en, `falta en en.ts: ${k}`);
    assert.equal(vars((es as Record<string, string>)[k]), vars((en as Record<string, string>)[k]), k);
  }
});
