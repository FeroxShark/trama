// El prompt de un turno de agy nunca va en el argv (tope de la línea de comandos de Windows: ENAMETOOLONG con un relevo largo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { llamadaAgy } from "../electron/agy-llamada.ts";

const GRANDE = "ñandú ".repeat(16_700); // ~100 000 caracteres

/** La línea de comandos como la arma Windows (CreateProcess): comillas y espacios; tope 32 767 (8191 por cmd.exe). */
const lineaWin32 = (args: string[]) => ["agy.exe", ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");

test("un prompt de 100 000 caracteres va por stdin y la línea de comandos queda corta (win32)", () => {
  const { args, stdin } = llamadaAgy({ prompt: GRANDE, modelo: "claude-opus-5-5-high", conversacion: "c0ffee", timeout: "600s" });
  assert.ok(GRANDE.length >= 100_000);
  assert.ok(lineaWin32(args).length < 8191, `línea de ${lineaWin32(args).length} caracteres`);
  assert.ok(!args.includes("-p") && args.every((a) => a.length < 200), "ningún argumento lleva el prompt");
  assert.deepEqual(args.slice(args.indexOf("--conversation")), ["--conversation", "c0ffee"]);
  const m = JSON.parse(stdin);
  assert.equal(m.event, "user");
  assert.equal(m.message.content[0].text, GRANDE);
  assert.ok(stdin.endsWith("\n") && stdin.indexOf("\n") === stdin.length - 1, "una sola línea NDJSON");
});

test("sin conversación no hay --conversation", () => {
  const { args } = llamadaAgy({ prompt: "hola", modelo: "m", conversacion: null, timeout: "1s" });
  assert.ok(!args.includes("--conversation"));
});

test("el agy falso lee los 100 000 caracteres por stdin y contesta", async () => {
  const { args, stdin } = llamadaAgy({ prompt: `${GRANDE}\nMensaje de Ana:\nhola largo`, modelo: "m", conversacion: null, timeout: "1s" });
  const falso = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
  const p = spawn(process.execPath, [falso, ...args], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, HILOS_STATE: path.join(process.env.TMPDIR ?? "/tmp", `agy-llamada-${process.pid}`) } });
  let out = "";
  p.stdout.on("data", (t) => (out += t));
  p.stdin.end(stdin);
  await new Promise((r) => p.on("close", r));
  assert.match(out, /eco: hola largo/);
});
