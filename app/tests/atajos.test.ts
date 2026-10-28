// La tabla de atajos (src/atajos.ts): la lista que ve Ana con `?` sale de la misma tabla que usan los manejadores
// de teclas. Los imports de src/ van sin extensión: acá un hook les busca el `.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const { ATAJOS, es, listaAtajos } = await import("../src/atajos.ts");
const { en } = await import("../src/i18n/en.ts");
const { es: dicEs } = await import("../src/i18n/es.ts");

const tecla = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

test("cada atajo se explica en los dos idiomas y tiene teclas que mostrar", () => {
  for (const [id, a] of Object.entries(ATAJOS)) {
    assert.ok(a.desc in en && a.desc in dicEs, `${id}: ${a.desc}`);
    assert.ok(a.teclas.length > 0 && a.teclas.every((c) => c.length > 0 && c.every((k) => k.trim())), id);
  }
  for (const g of ["global", "barra", "caja"]) assert.ok(`atajos.grupo.${g}` in en && `atajos.grupo.${g}` in dicEs, g);
});

test("la lista de la app es la tabla entera, agrupada", () => {
  const ids = listaAtajos().flatMap((g) => g.items.map((i) => i.id));
  assert.deepEqual([...ids].sort(), Object.keys(ATAJOS).sort());
  assert.ok(listaAtajos().every((g) => g.items.length > 0));
});

test("las teclas que reconoce", () => {
  assert.ok(es("buscar", tecla("k", { ctrlKey: true })));
  assert.ok(es("buscar", tecla("K", { metaKey: true })));
  assert.ok(!es("buscar", tecla("k")));
  assert.ok(es("siguiente", tecla("j")) && es("siguiente", tecla("ArrowDown")));
  assert.ok(!es("siguiente", tecla("j", { ctrlKey: true })));
  assert.ok(es("anterior", tecla("k")) && !es("buscar", tecla("k")));
  assert.ok(es("atajos", tecla("?", { shiftKey: true })) && !es("atajos", tecla("?", { ctrlKey: true })));
  assert.ok(es("enviar", tecla("Enter")) && !es("enviar", tecla("Enter", { shiftKey: true })));
  assert.ok(es("renglon", tecla("Enter", { shiftKey: true })));
  // Ya no hay "Mandar ya": lo escrito a mitad de un turno entra solo en la próxima pausa, así que Ctrl/Cmd+Enter es un Enter más.
  assert.ok(es("enviar", tecla("Enter", { ctrlKey: true })) && es("enviar", tecla("Enter", { metaKey: true })));
  assert.ok(es("modo", tecla("Tab", { shiftKey: true })) && !es("modo", tecla("Tab")));
  assert.ok(es("letraMas", tecla("=", { ctrlKey: true })) && es("letraMenos", tecla("-", { ctrlKey: true })) && es("letraBase", tecla("0", { ctrlKey: true })));
});

test("dos atajos de la barra no se pisan con una misma tecla", () => {
  const ids = (Object.keys(ATAJOS) as (keyof typeof ATAJOS)[]).filter((id) => ATAJOS[id].grupo === "barra");
  for (const k of ["j", "k", "c", "w", "t", "?", "Enter", "ArrowDown", "ArrowUp"]) {
    const quienes = ids.filter((id) => es(id, tecla(k)));
    assert.ok(quienes.length <= 1, `${k}: ${quienes.join(", ")}`);
  }
});

test("los manejadores de teclas preguntan a la tabla: cada atajo con tecla propia se usa en el código", () => {
  const archivos: string[] = [];
  const barrer = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) barrer(p);
      else if (/\.tsx?$/.test(f) && f !== "atajos.ts") archivos.push(p);
    }
  };
  barrer(path.join(import.meta.dirname, "..", "src"));
  const fuente = archivos.map((f) => readFileSync(f, "utf8")).join("\n");
  // Estos se muestran pero no tienen un manejador propio: la letra la resuelve `atajoLetra` (src/apariencia.ts) y el menú de "/" sale del texto.
  const sinManejador = new Set(["letraMas", "letraMenos", "letraBase", "comandos", "renglon"]);
  for (const id of Object.keys(ATAJOS)) if (!sinManejador.has(id)) assert.ok(fuente.includes(`es("${id}"`), `${id} no lo usa ningún manejador`);
});
