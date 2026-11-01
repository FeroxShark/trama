// «Seguir con otro modelo» (#1791, parte 3), lo del main: los argumentos de `pa --seguir-con` de un worker (electron/paneles.ts) y el
// líder nuevo que arranca con el resumen de traspaso de otro (`seguirCon` de electron/lider.ts), en su misma carpeta y con su mismo modo.
// Mismo armado que tests/lider-carpeta.test.ts: claude falso, estado en un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esperarHasta } from "./esperar.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-seguir-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "sin-registry.json");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");
const dicho = path.join(tmp, "dicho.jsonl");
process.env.TRAMA_FALSO_DICHO = dicho;

const lider = await import("../electron/lider.ts");
const { dirProyecto } = await import("../electron/lider-arma.ts");
const { argvSeguirCon, MODELO_SEGUIR } = await import("../electron/paneles.ts");
after(() => lider.cerrarTodos(true));

const ID = "20261101-130000-2191095";
const motivo = (e: unknown) => String((e as Error).message);

test("worker: pa --seguir-con <modelo> --id <id> --async, colgado del mismo líder; ids y modelos raros no salen", async () => {
  const { args, env } = await argvSeguirCon({ id: ID, proyecto: "trama", jefe_id: "j1", jefe: "ana" }, "opencode:opencode/big-pickle");
  assert.deepEqual(args, ["trama", "--seguir-con", "opencode:opencode/big-pickle", "--id", ID, "--async"]);
  assert.equal(env.PA_JEFE_ID, "j1");
  assert.equal(env.PA_JEFE, "ana");
  const sinJefe = await argvSeguirCon({ id: ID, proyecto: "trama" }, "claude-sonnet-5-5");
  assert.deepEqual(sinJefe.args, ["trama", "--seguir-con", "claude-sonnet-5-5", "--id", ID, "--async"]);
  await assert.rejects(argvSeguirCon({ id: "../x", proyecto: "trama" }, "claude-sonnet-5-5"), (e) => /main\.idRaro/.test(motivo(e)));
  await assert.rejects(argvSeguirCon({ id: ID, proyecto: "-rm" }, "claude-sonnet-5-5"), (e) => /main\.proyectoRaro/.test(motivo(e)));
  for (const malo of ["", "-m", "a,b", "a b", "x;rm", "../x", "a\n"]) await assert.rejects(argvSeguirCon({ id: ID, proyecto: "trama" }, malo), (e) => /main\.modeloRaro/.test(motivo(e)), JSON.stringify(malo));
  assert.ok(MODELO_SEGUIR.test("dsh:deepseek/deepseek-v4"));
});

test("líder: arranca uno nuevo en la misma carpeta y con el mismo modo, y su primer mensaje es el resumen de la conversación", { timeout: 20_000 }, async () => {
  const carpeta = path.join(tmp, "casa", "mi-app");
  mkdirSync(carpeta, { recursive: true });
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola", carpeta, modo: "plan" });
  // El transcript que escribiría `claude` en la carpeta del líder.
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", dirProyecto(carpeta));
  mkdirSync(dir, { recursive: true });
  const usuario = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });
  const asistente = (text: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
  writeFileSync(path.join(dir, `${sid}.jsonl`), [usuario("Arreglá el login de la tienda demo."), asistente("Listo el botón.\nFalta: el test del caso vacío."), ""].join("\n"));

  const nuevo = await lider.seguirCon({ sid, modelo: "claude-sonnet-5-5", effort: "medium" });
  assert.notEqual(nuevo, sid);
  const guardados = JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "lideres.json"), "utf8")).lideres as { sid: string; cwd?: string; modo: string; modelo: string }[];
  const g = guardados.find((l) => l.sid === nuevo);
  assert.equal(g?.cwd, carpeta);
  assert.equal(g?.modo, "plan");
  assert.equal(g?.modelo, "claude-sonnet-5-5");
  // El original no se toca: sigue con su modelo y su carpeta.
  assert.equal(guardados.find((l) => l.sid === sid)?.modelo, "claude-opus-5-5");
  const dijo = () => (existsSync(dicho) ? readFileSync(dicho, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { sid: string; texto: string }) : []);
  await esperarHasta(() => dijo().some((d) => d.sid === nuevo));
  const texto = dijo().find((d) => d.sid === nuevo)!.texto;
  assert.match(texto, /Arreglá el login de la tienda demo\./);
  assert.match(texto, /test del caso vacío/);
});

test("líder: sin transcript no hay qué resumir y no nace ninguno; un sid raro se rechaza", { timeout: 20_000 }, async () => {
  const ya = () => (existsSync(path.join(process.env.HILOS_STATE!, "lideres.json")) ? (JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "lideres.json"), "utf8")).lideres as unknown[]).length : 0);
  const antes = ya();
  await assert.rejects(lider.seguirCon({ sid: "00000000-0000-4000-8000-000000000099", modelo: "claude-sonnet-5-5", effort: "medium" }), (e) => /main\.traspasoVacio/.test(motivo(e)));
  await assert.rejects(lider.seguirCon({ sid: "../x", modelo: "claude-sonnet-5-5", effort: "medium" }), (e) => /main\.sesionRara/.test(motivo(e)));
  assert.equal(ya(), antes);
});
