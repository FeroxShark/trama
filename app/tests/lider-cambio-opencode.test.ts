// Claude → opencode en el mismo líder (electron/lider.ts → dsh-puente.ts con `opencode acp` → scripts/openai-falso.mjs): el modelo nuevo recibe lo
// hablado con Claude en su primer pedido (el relevo viaja por un archivo y el puente lo suma al prefacio) y la conversación sigue en su transcript.
// Sin `opencode` (TRAMA_OPENCODE_BIN…) se saltea.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arrancarFalso, entornoTmp, hasta, usuarios } from "./dsh-ayuda.ts";
import { MODELO_FALSO, OPENCODE, SIN_OPENCODE, entornoOpencodeTmp } from "./opencode-ayuda.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { tmp, home } = entornoTmp("lider-cambio-oc");
const falso = await arrancarFalso(tmp);
Object.assign(process.env, entornoOpencodeTmp(home, falso.baseURL));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "modelos.json");
process.env.TRAMA_CLAVES = path.join(tmp, "config", "claves.env");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
if (OPENCODE) process.env.HILOS_OPENCODE = OPENCODE;
process.env.HILOS_PA = path.join(tmp, "fuera-del-path", "pa");
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");

const lider = await import("../electron/lider.ts");
const { dirProyecto } = await import("../electron/lider-arma.ts");
const eventos: { sid: string; e: any }[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  falso.cerrar();
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});
const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);

test("Claude → opencode: el pedido del modelo nuevo trae lo hablado con Claude, y la vista junta los dos transcripts", { skip: SIN_OPENCODE, timeout: 150_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "empiezo con claude" });
  await hasta(() => de(sid, "fin").length === 1, 45_000);
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", dirProyecto(home));
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now() - 60_000;
  const l = (k: number, rol: string, content: unknown, extra: object = {}) =>
    JSON.stringify({ uuid: `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`, parentUuid: k > 1 ? `00000000-0000-4000-8000-${String(k - 1).padStart(12, "0")}` : null, sessionId: sid, cwd: home, timestamp: new Date(t0 + k * 1000).toISOString(), type: rol, message: { role: rol, content, ...extra } });
  writeFileSync(path.join(dir, `${sid}.jsonl`), [l(1, "user", "Necesito migrar la base"), l(2, "assistant", [{ type: "text", text: "Uso pg_dump para exportar" }], { id: "m2", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 } })].join("\n") + "\n");

  await lider.mandar({ sid, texto: "seguí con opencode", modelo: MODELO_FALSO, effort: "high" });
  await hasta(() => de(sid, "fin").length === 2, 120_000, `no terminó: ${JSON.stringify(de(sid, "fin"))}`);
  assert.equal(de(sid, "fin")[1].error, null);
  const todo = usuarios(falso.pedidos().at(-1)!).join("\n");
  assert.match(todo, /líder de Trama/, "se conserva el prefacio de líder de opencode");
  assert.match(todo, /Ana: Necesito migrar la base/);
  assert.match(todo, /Uso pg_dump para exportar/);
  assert.match(todo, /seguí con opencode/);
  const g = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(g.modelo, MODELO_FALSO);
  assert.equal(await lider.transcriptDe(sid), path.join(process.env.HILOS_STATE!, "opencode", `${sid}.jsonl`));
  const pag = await lider.conversacionLider({ sid, n: 100 });
  const filas = pag.mensajes.map((m: any) => (m.cambio ? "---" : m.texto));
  assert.ok(filas.indexOf("---") > filas.indexOf("Uso pg_dump para exportar"));
  assert.ok(filas.indexOf("seguí con opencode") > filas.indexOf("---"));
});
