// La línea de tiempo de la tarjeta de actividad (src/hilo/actividad-logica.ts): los pensamientos terminados y las herramientas, en el orden
// en que pasaron, sin que un pensamiento reemplace al anterior. Toca `herramientas.ts` (imports sin extensión): el hook los lleva al `.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Mensaje } from "../src/datos/contrato.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && ctx.parentURL) {
      const dir = path.dirname(fileURLToPath(ctx.parentURL));
      if (!path.extname(spec) && ctx.parentURL.includes("/src/")) {
        const base = path.join(dir, spec);
        for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
          if (existsSync(f)) return next(path.relative(dir, f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
      }
      if (spec.endsWith(".js") && ctx.parentURL.includes("/electron/") && existsSync(path.join(dir, spec.slice(0, -3) + ".ts")))
        return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { lineaDeTiempo } = await import("../src/hilo/linea-tiempo.ts");
const { primeraLineaPensada, ultimaFrasePensada } = await import("../src/hilo/actividad-logica.ts");

// La línea de tiempo de la tarjeta: los pensamientos terminados y las herramientas, en el orden en que pasaron.
const asis = (i: number, pensado: string | undefined, herramientas: string[] = [], det?: Mensaje["det"]): Mensaje => ({ i, rol: "assistant", texto: "", herramientas, ts: null, modelo: "claude-opus-5-5", ...(pensado ? { pensado } : {}), ...(det ? { det } : {}) });

test("la línea de tiempo: el pensamiento N no reemplaza al N-1 y las herramientas van entre medio", () => {
  const ls = lineaDeTiempo([asis(1, "Uno."), asis(2, "Dos.", ["Bash"]), asis(3, "Tres.", ["Read"]), asis(4, "Cuatro.")]);
  assert.deepEqual(
    ls.map((l) => (l.tipo === "pensamiento" ? l.texto : l.nombre)),
    ["Uno.", "Dos.", "Bash", "Tres.", "Read", "Cuatro."],
  );
  assert.equal(new Set(ls.map((l) => l.key)).size, ls.length, "cada línea tiene su clave");
  // La herramienta del último mensaje, sin resultado, está corriendo; las de antes no dicen nada (no se sabe).
  const h = ls.filter((l) => l.tipo === "herramienta");
  assert.equal(h[0].estado, null);
  const sola = lineaDeTiempo([asis(1, "Uno.", ["Bash"])]).find((l) => l.tipo === "herramienta");
  assert.equal(sola?.estado, "corriendo");
});

test("la primera línea de un pensamiento: sin títulos ni negritas, y vacío si no hay nada", () => {
  assert.equal(primeraLineaPensada("\n\n**Buscando el log**\nDespués sigo"), "Buscando el log");
  assert.equal(primeraLineaPensada("## Plan\npaso uno"), "Plan");
  assert.equal(primeraLineaPensada("   \n  "), "");
});

test("la última frase de un pensamiento que llega: la última línea, su última oración, sin marcas", () => {
  assert.equal(ultimaFrasePensada("Miro el test. Si es el orden de claves, es chico; si es la migración, reviso"), "si es la migración, reviso");
  assert.equal(ultimaFrasePensada("Primero esto.\n\n**Después** el log. Y luego\n  "), "Y luego");
  assert.equal(ultimaFrasePensada("  \n "), "");
});
