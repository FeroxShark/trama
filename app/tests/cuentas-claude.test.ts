import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { listarCuentasClaude } = await import("../electron/cuentas-claude.ts");
const { listarCatalogo } = await import("../electron/herramientas-catalogo.ts");

test("cuentasClaude: listar devuelve una lista estructurada", () => {
  const res = listarCuentasClaude();
  assert.equal(typeof res, "object");
  assert.ok(Array.isArray(res.cuentas));
  assert.ok("activa" in res);
});

test("herramientasCatalogo: devuelve instalados y descubrir", () => {
  const cat = listarCatalogo();
  assert.ok(Array.isArray(cat.instalados));
  assert.ok(Array.isArray(cat.descubrir));
  assert.ok(cat.instalados.length > 0 || cat.descubrir.length > 0);

  const item = cat.instalados[0] || cat.descubrir[0];
  assert.ok(typeof item.id === "string");
  assert.ok(typeof item.nombre === "string");
  assert.ok(["mcp", "skill", "herramienta", "lider"].includes(item.tipo));
});
