// Google (`agy /quota`): una lectura en caché con un reinicio ya cruzado no vale como actual: se vuelve a leer, y si agy no contesta ese
// bucket queda «sin dato» en vez de seguir lleno por el porcentaje de la ventana anterior. Con un `agy` falso que cuenta sus llamadas.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO_TS = path.join(import.meta.dirname, "..", "electron", "cli", "reparto.ts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-quota-reinicio-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const leido = Math.floor(Date.now() / 1000) - 60;
const RESET = new Date((leido + 3600) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const mas = (s: number) => new Date((leido + 3600 + s) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const quota = (rf: number, reset: string) => JSON.stringify({ command: { data: { groups: [{ name: "Gemini 4 Neon", buckets: [{ window: "5h", remaining_fraction: rf, reset_time: reset }] }] } } });

function escenario(nombre: string, agyContesta: boolean) {
  const bin = path.join(tmp, `bin-${nombre}`);
  const estado = path.join(tmp, `estado-${nombre}`);
  mkdirSync(bin, { recursive: true });
  mkdirSync(estado, { recursive: true });
  writeFileSync(path.join(bin, "quota.json"), quota(1, mas(18000)));
  writeFileSync(
    path.join(bin, "agy"),
    `#!/bin/sh
echo "$*" >> '${path.join(bin, "llamadas.log")}'
${agyContesta ? `if [ "$1" = "models" ]; then printf 'gemini-4-neon-high\\tGemini 4 Neon\\n'; else cat '${path.join(bin, "quota.json")}'; fi` : ""}
exit 0
`,
  );
  chmodSync(path.join(bin, "agy"), 0o755);
  // La misma caché para las dos horas: casi llena (3 % libre), con su reinicio en RESET.
  writeFileSync(path.join(estado, "quota.json"), JSON.stringify({ leido, json: JSON.parse(quota(0.03, RESET)) }));
  return { bin, estado };
}
const llamadas = (bin: string) => (existsSync(path.join(bin, "llamadas.log")) ? readFileSync(path.join(bin, "llamadas.log"), "utf8").trim().split("\n").filter(Boolean) : []);

function cupos(bin: string, estado: string, ahora: string) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PA_|REPARTO_|TRAMA_)/.test(k) && k !== "STATE"));
  const r = spawnSync(process.execPath, [REPARTO_TS, "--cupos", "--json"], {
    encoding: "utf8",
    env: {
      ...base,
      HOME: tmp,
      PATH: `${bin}:${process.env.PATH}`,
      REPARTO_STATE: estado,
      REPARTO_AHORA: ahora,
      PA_STATE: path.join(tmp, "pa-estado"),
      REPARTO_CUENTAS_BIN: path.join(tmp, "no-hay-cuentas"),
      REPARTO_AVISAR: "0",
      REPARTO_CACHE_S: "600", // la caché de la lectura de hace un minuto sigue vigente por reloj: lo que cuenta es el reinicio
      REPARTO_CODEX: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]",
      TRAMA_MODELOS: path.join(tmp, "no-hay.json"),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(r.stdout).suscripciones.find((s: { id: string }) => s.id === "google")?.grupos.find((x: { id: string }) => x.id === "gemini");
  return g.ventanas.find((w: { id: string }) => w.id === "5h") as { usado: number | null; vuelve: string | null };
}

test("antes del reinicio vale la caché; después se vuelve a leer y se ve la ventana nueva", () => {
  const { bin, estado } = escenario("ok", true);
  const antes = cupos(bin, estado, mas(-120));
  assert.equal(antes.usado, 0.97);
  assert.equal(llamadas(bin).filter((l) => l.includes("quota")).length, 0, "con la caché fresca no se llama a agy");
  const despues = cupos(bin, estado, mas(120));
  assert.equal(despues.usado, 0, "ya no sigue lleno por el porcentaje de la ventana anterior");
  assert.equal(despues.vuelve, mas(18000));
  assert.ok(llamadas(bin).some((l) => l.includes("quota")), "cruzado el reinicio, se relee");
});

test("si agy no contesta tras el reinicio, el bucket vencido queda sin dato (no lleno)", () => {
  const { bin, estado } = escenario("mudo", false);
  assert.equal(cupos(bin, estado, mas(-120)).usado, 0.97);
  const despues = cupos(bin, estado, mas(120));
  assert.equal(despues.usado, null);
});
