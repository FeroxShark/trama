import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { readdirSync, readFileSync } from "node:fs";
import { cambiarIdioma, coma, idioma, t, textoMain } from "../src/i18n/index.ts";
import { textoT } from "../electron/errores.ts";

const variables = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("los dos diccionarios tienen las mismas claves", () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
});

test("cada clave tiene las mismas {variables} en los dos idiomas", () => {
  for (const k of Object.keys(en) as (keyof typeof en)[]) {
    assert.deepEqual(variables(es[k]), variables(en[k]), k);
  }
});

test("ningún texto vacío", () => {
  for (const [k, v] of [...Object.entries(en), ...Object.entries(es)]) assert.ok(v.trim(), k);
});

test("los botones de cerrar dicen lo que hacen, sin \"Settle\" a la vista", () => {
  assert.equal(es["accion.integrar"], "Integrar");
  assert.equal(es["accion.archivar"], "Archivar");
  for (const [k, v] of [...Object.entries(en), ...Object.entries(es)]) assert.doesNotMatch(v, /settle/i, k);
});

test("t() rellena las variables y sigue el idioma elegido", () => {
  assert.equal(idioma(), "en");
  assert.equal(t("comun.commits", { n: 3 }), "3 commits");
  assert.equal(t("barra.cerrados", { n: 4 }), "Closed · 4");
  assert.equal(coma("1.4"), "1.4");
  cambiarIdioma("es");
  try {
    assert.equal(t("barra.cerrados", { n: 4 }), "Cerrados · 4");
    assert.equal(t("estado.decision"), "Te necesita");
    assert.equal(coma("1.4"), "1,4");
  } finally {
    cambiarIdioma("en");
  }
});

test("cada clave que usa el main (errorT/textoT en electron/) existe, con sus variables", () => {
  const dir = new URL("../electron/", import.meta.url);
  let usadas = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && x !== "errores.ts")) {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const m of src.matchAll(/(?:errorT|textoT)\(\s*"([\w.]+)"(?:\s*,\s*\{([^}]*)\})?/g)) {
      usadas++;
      const k = m[1] as keyof typeof en;
      assert.ok(k in en, `${f}: ${k}`);
      const vars = [...(m[2] ?? "").matchAll(/(?:^|,)\s*(\w+)\s*(?=[:,]|$)/g)].map((x) => x[1]).sort();
      assert.deepEqual(vars, variables(en[k]), `${f}: ${k}`);
    }
    // Las claves que el main elige de una tabla (RARO en pa.ts, el bucle de lider-arma.ts).
    for (const m of src.matchAll(/"(main\.\w+)"/g)) assert.ok(m[1] in en, `${f}: ${m[1]}`);
  }
  assert.ok(usadas > 20, String(usadas));
});

test("textoMain: traduce lo codificado por el main (aunque venga envuelto) y deja lo demás como vino", () => {
  const e = textoT("main.idRaro", { v: "x-1" });
  assert.equal(textoMain(e), "Invalid id: x-1");
  assert.equal(textoMain(`Error invoking remote method 'lider:mandar': Error: ${textoT("main.mensajeVacio")}`), "Error invoking remote method 'lider:mandar': Error: Empty message");
  cambiarIdioma("es");
  try {
    assert.equal(textoMain(e), "id raro: x-1");
  } finally {
    cambiarIdioma("en");
  }
  assert.equal(textoMain("pa: modelo 'x' no va"), "pa: modelo 'x' no va");
  assert.equal(textoMain(textoT("no.existe")), textoT("no.existe"));
  assert.equal(textoMain(null), null);
});

test("textoMain: una clave pelada (sin marca) también se traduce, nunca se ve cruda; las variables que faltan quedan en ?", () => {
  assert.equal(textoMain("main.cuentasFallo"), "The accounts command failed (exit code ?)");
  assert.equal(textoMain("main.cuentasDato"), en["main.cuentasDato"]);
  assert.equal(textoMain("main.noExisteEstaClave"), "main.noExisteEstaClave");
  assert.equal(textoMain("main.cuentasFallo y más"), "main.cuentasFallo y más");
});

test("index.html lleva los textos del cartel \"Actualizando Trama…\" (los pinta antes de que cargue React) iguales a los diccionarios", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const tabla = JSON.parse(/<script type="application\/json" id="act-textos">([\s\S]*?)<\/script>/.exec(html)![1]) as Record<string, Record<string, string>>;
  const claves = Object.keys(en).filter((k) => k.startsWith("act."));
  assert.equal(claves.length, 5);
  for (const k of claves) {
    assert.equal(tabla.en[k], en[k as keyof typeof en], `en ${k}`);
    assert.equal(tabla.es[k], es[k as keyof typeof es], `es ${k}`);
  }
  assert.deepEqual(Object.keys(tabla.en).sort(), claves.sort());
  assert.deepEqual(Object.keys(tabla.es).sort(), claves.sort());
});
