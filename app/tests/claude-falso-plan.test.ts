// Aprobar un plan: la app contesta allow y pide bypass en dos líneas seguidas. Que lleguen en el mismo
// trozo o separadas, el claude falso tiene que terminar en bypass (carrera que hacía fallar a veces
// "aprobar vuelve a bypass" en `npm run prueba`). Sin Electron: sólo el falso por stdin/stdout.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const FALSO = path.resolve(import.meta.dirname, "../scripts/claude-falso.mjs");
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Modo con el que queda el falso tras aprobar el plan; `separadas` = ms entre las dos líneas (0: juntas). */
async function aprobar(separadas: number): Promise<string | undefined> {
  const p = spawn(process.execPath, [FALSO, "--permission-mode", "plan"], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, TRAMA_FALSO_MS: "1" } });
  const modos: string[] = [];
  let buf = "";
  let pedido: string | null = null;
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (t: string) => {
    buf += t;
    const ls = buf.split("\n");
    buf = ls.pop() ?? "";
    for (const l of ls) {
      const o = JSON.parse(l);
      if (o.type === "system" && o.subtype === "status" && o.permissionMode) modos.push(o.permissionMode);
      if (o.type === "control_response" && o.response?.response?.mode) modos.push(o.response.response.mode);
      if (o.type === "control_request" && o.request?.tool_name === "ExitPlanMode") pedido = o.request_id;
    }
  });
  p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "armá algo" } }) + "\n");
  for (let i = 0; i < 100 && !pedido; i++) await espera(20);
  assert.ok(pedido, "el falso pide ExitPlanMode");
  const allow = JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: pedido, response: { behavior: "allow", updatedInput: {} } } });
  const modo = JSON.stringify({ type: "control_request", request_id: "m1", request: { subtype: "set_permission_mode", mode: "bypassPermissions" } });
  if (separadas) {
    p.stdin.write(allow + "\n");
    await espera(separadas);
    p.stdin.write(modo + "\n");
  } else p.stdin.write(allow + "\n" + modo + "\n");
  await espera(400);
  p.kill();
  return modos.at(-1);
}

test("aprobar el plan termina en bypass con las dos líneas juntas", async () => {
  assert.equal(await aprobar(0), "bypassPermissions");
});

test("aprobar el plan termina en bypass con las dos líneas separadas", async () => {
  assert.equal(await aprobar(60), "bypassPermissions");
});
