// barrerGrupo (electron/lider.ts): al salir un líder se barre su grupo de procesos, así lo que dejó
// corriendo desde sus herramientas (un watcher con su `pactl subscribe`) no queda huérfano. lider.ts importa sus vecinos con `.js` (lo compila tsc): acá un
// hook de resolución los lleva al `.ts`. El entorno va antes del import (lider.ts
// lo lee al cargar): estado, sesiones y config de Claude en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-lider-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
// Turnos lentos: cada delta tarda 1 s (el interrupt corta en el primero).
process.env.TRAMA_FALSO_MS = "1000";

const { barrerGrupo } = await import("../electron/lider.ts");
const viva = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("barrerGrupo mata a los hijos que dejó el líder, no a un proceso de otro grupo", async () => {
  const { spawn } = await import("node:child_process");
  // El "líder" es un bash que deja un hijo suelto (sleep) y sale: el sleep queda huérfano en el grupo del líder.
  const lider = spawn("bash", ["-c", "sleep 300 & echo $!; exit 0"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  let salida = "";
  lider.stdout.on("data", (t) => (salida += t));
  await new Promise((r) => lider.on("exit", r));
  await espera(50);
  const huerfano = Number(salida.trim());
  const ajeno = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  assert.ok(viva(huerfano), "el hijo suelto sigue vivo tras salir el líder");
  barrerGrupo(lider.pid, process.kill, 100);
  await espera(300);
  assert.ok(!viva(huerfano), "el barrido lo mató");
  assert.ok(viva(ajeno.pid!), "otro grupo no se toca");
  process.kill(ajeno.pid!, "SIGKILL");
});

test("barrerGrupo no tira con un grupo vacío ni con pids imposibles", () => {
  barrerGrupo(undefined);
  barrerGrupo(0);
  barrerGrupo(1);
  barrerGrupo(2_000_000_000, process.kill, 10);
});
