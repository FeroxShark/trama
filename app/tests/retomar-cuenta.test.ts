/* Retomar o traer un líder de Claude que no era de la app: sale con la cuenta que la persona dejó como principal (`cuentas preferir`),
   no con la de siempre. Con una de la app que ya tenía cuenta, no se toca. Mismo armado que tests/retomar-lider.test.ts. */
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
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

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-retomar-cta-")));
const cuentasJson = path.join(tmp, "config", "cuentas.json");
mkdirSync(path.dirname(cuentasJson), { recursive: true });
const escribirCuentas = (preferida: string | null) =>
  writeFileSync(cuentasJson, JSON.stringify({ cuentas: [{ id: "max-curat", proveedor: "claude", nombre: "Max" }], preferidas: preferida ? { claude: preferida } : {} }));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_CUENTAS = cuentasJson;
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_LOG = path.join(tmp, "claude.log");
process.env.TRAMA_FALSO_MS = "20";

const lider = await import("../electron/lider.ts");
after(() => lider.cerrarTodos(true));

const M = { modelo: "claude-opus-5-5", effort: "high" };
function transcript(sid: string) {
  const d = path.join(tmp, "claude", "projects", "-una-carpeta");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${sid}.jsonl`), [{ type: "user", cwd: tmp, sessionId: sid, message: { role: "user", content: "hola" } }].map((x) => JSON.stringify(x)).join("\n") + "\n");
}
const cuentaDe = async (sid: string) => (await lider.lideresApp()).find((l) => l.sid === sid)?.cuenta;

test("retomar: con una cuenta elegida como principal, el líder anotado sale con ella", async () => {
  escribirCuentas("max-curat");
  const sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  transcript(sid);
  assert.deepEqual(await lider.retomar({ sid, ...M }), { ok: true });
  assert.equal(await cuentaDe(sid), "max-curat");
});

test("retomar: sin cuenta elegida (o con la de siempre) sigue sin cuenta propia", async () => {
  escribirCuentas(null);
  const sid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  transcript(sid);
  assert.deepEqual(await lider.retomar({ sid, ...M }), { ok: true });
  assert.equal(await cuentaDe(sid), undefined);
});

test("retomar: uno que ya era de la app conserva su cuenta aunque después cambie la principal", async () => {
  escribirCuentas(null);
  const sid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  transcript(sid);
  assert.deepEqual(await lider.retomar({ sid, ...M }), { ok: true });
  escribirCuentas("max-curat");
  assert.deepEqual(await lider.retomar({ sid, ...M }), { ok: true });
  assert.equal(await cuentaDe(sid), undefined, "nada cambia la cuenta de uno existente");
});
