// PUENTES-9: cuando un mensaje espera en la cola del puente y arranca solo al cerrarse el turno anterior, el puente avisa
// `system/status requesting` (lider.ts lo usa para volver a marcar al líder como ocupado). Gemini y ChatGPT (con sus CLI falsos).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { esperarHasta } from "./esperar.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "puentes-requesting-"));
const trabajo = path.join(tmp, "trabajo");
mkdirSync(trabajo, { recursive: true });
mkdirSync(path.join(tmp, "home"), { recursive: true });
const hijos: ReturnType<typeof spawn>[] = [];
after(() => {
  for (const h of hijos) h.kill("SIGTERM");
  rmSync(tmp, { recursive: true, force: true });
});

async function dosMensajes(puente: string, fake: string, varBin: string, extra: string[]) {
  const sid = "33333333-0000-4000-8000-000000000001";
  const h = spawn(process.execPath, [path.join(import.meta.dirname, "..", "electron", puente), "--sid", sid, "--nombre", "trama-test", "--cwd", trabajo, ...extra], {
    env: { ...process.env, HOME: path.join(tmp, "home"), [varBin]: path.join(import.meta.dirname, "..", "scripts", fake), HILOS_STATE: path.join(tmp, puente, "estado"), HILOS_SESIONES: path.join(tmp, puente, "sesiones"), TRAMA_DUENO: "Ana", TRAMA_FALSO_MS: "10" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  hijos.push(h);
  const lineas: any[] = [];
  createInterface({ input: h.stdout! }).on("line", (l) => {
    try {
      lineas.push(JSON.parse(l));
    } catch {
      /* ruido */
    }
  });
  const msg = (t: string) => JSON.stringify({ type: "user", message: { role: "user", content: t } }) + "\n";
  h.stdin!.write(msg("uno") + msg("dos")); // juntos: el segundo queda en la cola del puente
  await esperarHasta(() => lineas.filter((l) => l.type === "result").length === 2, { tope: 30_000 });
  const tipos = lineas.map((l) => (l.type === "result" ? "result" : l.type === "system" && l.status === "requesting" ? "requesting" : ""));
  return tipos.filter(Boolean);
}

test("PUENTES-9: el puente de Gemini avisa «requesting» al arrancar el mensaje que esperaba en la cola", { timeout: 60_000 }, async () => {
  assert.deepEqual(await dosMensajes("agy-puente.ts", "agy-falso.mjs", "HILOS_AGY", ["--modelo", "gemini-4-argon"]), ["result", "requesting", "result"]);
});

test("PUENTES-9: el puente de ChatGPT avisa «requesting» al arrancar el mensaje que esperaba en la cola", { timeout: 60_000 }, async () => {
  assert.deepEqual(await dosMensajes("codex-puente.ts", "codex-falso.mjs", "HILOS_CODEX", ["--modelo", "codex:gpt-6.1-sol", "--effort", "high", "--modo", "default"]), ["result", "requesting", "result"]);
});

test("PUENTES-18: si `agy plugin list` falla una vez, el siguiente initialize vuelve a preguntar (no queda la lista vacía)", { timeout: 60_000 }, async () => {
  const h = spawn(process.execPath, [path.join(import.meta.dirname, "..", "electron", "agy-puente.ts"), "--sid", "33333333-0000-4000-8000-000000000018", "--nombre", "trama-test", "--cwd", trabajo, "--modelo", "gemini-4-argon"], {
    env: { ...process.env, HOME: path.join(tmp, "home"), HILOS_AGY: path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs"), HILOS_STATE: path.join(tmp, "estado-18"), HILOS_SESIONES: path.join(tmp, "ses-18"), TRAMA_FALSO_PLUGINS_FALLA_UNA: path.join(tmp, "plugins-falla") },
    stdio: ["pipe", "pipe", "inherit"],
  });
  hijos.push(h);
  const respuestas: any[] = [];
  createInterface({ input: h.stdout! }).on("line", (l) => {
    try {
      const o = JSON.parse(l);
      if (o.type === "control_response") respuestas.push(o.response);
    } catch {
      /* ruido */
    }
  });
  const init = (id: string) => h.stdin!.write(JSON.stringify({ type: "control_request", request_id: id, request: { subtype: "initialize" } }) + "\n");
  init("i1");
  await esperarHasta(() => respuestas.length === 1, { tope: 15_000 });
  init("i2");
  await esperarHasta(() => respuestas.length === 2, { tope: 15_000 });
  assert.deepEqual(respuestas[0].response.commands, []);
  assert.ok(respuestas[1].response.commands.length > 0, JSON.stringify(respuestas[1]));
});
