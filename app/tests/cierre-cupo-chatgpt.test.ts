// ChatGPT en el cierre por cupo: `reparto --cupos` lo llama «openai» (sin `proveedor` ni `cuenta`) y la señal lo guarda como `chatgpt`.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { lecturasDeUso, type EntradaCierre } from "../electron/cierre-cupo.ts";
import { cierreDe } from "../electron/cli/cierre-cupo-lectura.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});
const { parsearCuposReparto } = await import("../electron/cupos.ts");

test("una suscripción «openai» de reparto llega al vigilante como chatgpt", () => {
  const cupos = parsearCuposReparto(
    JSON.stringify({ version: 1, suscripciones: [{ id: "openai", nombre: "ChatGPT", grupos: [{ id: "codex", ventanas: [{ id: "5h", usado: 0.99, vuelve: "2026-11-21T15:00:00Z" }] }] }] }),
    Date.parse("2026-11-21T12:00:00Z"),
  );
  assert.ok(cupos);
  const l = lecturasDeUso({ suscripciones: cupos.suscripciones });
  assert.equal(l.length, 1);
  assert.deepEqual([l[0]!.proveedor, l[0]!.cuenta, l[0]!.grupo], ["chatgpt", "chatgpt", "codex"]);
});

test("la señal de chatgpt cierra al candidato de la cuenta «openai» de reparto", () => {
  const e: EntradaCierre = { proveedor: "chatgpt", cuenta: "chatgpt", ventana: "5h", restante: 1, umbral: 5, vuelve: 2000, desde: 1000 };
  assert.equal(cierreDe([e], "chatgpt", "openai"), e);
  assert.equal(cierreDe([e], "chatgpt", "otra"), null);
});
