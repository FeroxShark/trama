// `reparto --tabla` lanza juntas las lecturas lentas (agy /quota y agy models) en vez de una tras otra, y si agy no contesta
// a tiempo usa la lectura de cupo de hace poco (hasta REPARTO_CACHE_RESPALDO_S) antes que dejarla sin dato. Con un `agy` falso
// en el PATH: el /quota sólo contesta si `agy models` ya arrancó (en serie no arrancaría nunca: el /quota va primero).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-paralelo-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const QUOTA = JSON.stringify({ command: { data: { groups: [{ name: "Gemini 4 Argon", buckets: [{ window: "weekly", remaining_fraction: 0.37, reset_time: "2099-01-01T00:00:00Z" }] }] } } });

/** Un `agy` falso: `models` deja una marca y lista Argon; `/quota` espera esa marca (hasta 5 s) y sólo entonces contesta. */
function agyFalso(dir: string, modo: "espera-models" | "colgado") {
  mkdirSync(dir, { recursive: true });
  const marca = path.join(dir, "models-empezo");
  const quota = path.join(dir, "quota.json");
  writeFileSync(quota, QUOTA);
  const guion =
    modo === "colgado"
      ? "#!/bin/sh\nsleep 30\n"
      : `#!/bin/sh
if [ "$1" = "models" ]; then : > '${marca}'; printf 'gemini-4-argon-high\\tGemini 4 Argon\\n'; exit 0; fi
i=0
while [ ! -e '${marca}' ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
[ -e '${marca}' ] && cat '${quota}'
exit 0
`;
  writeFileSync(path.join(dir, "agy"), guion);
  chmodSync(path.join(dir, "agy"), 0o755);
}

function tabla(bin: string, estado: string, extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(REPARTO, ["--tabla", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      REPARTO_STATE: estado,
      PA_STATE: path.join(tmp, "pa-estado"),
      REPARTO_CUENTAS_BIN: path.join(tmp, "no-hay-cuentas"),
      REPARTO_CODEX: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]',
      TRAMA_MODELOS: path.join(tmp, "no-hay.json"),
      ...extra,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const argon = (JSON.parse(r.stdout).modelos as { id: string; cupo_libre: number | null }[]).find((m) => m.id === "gemini-4-argon-high");
  assert.ok(argon, "la tabla trae gemini-4-argon-high");
  return argon;
}

test("--tabla corre agy /quota y agy models a la vez", () => {
  const bin = path.join(tmp, "bin-paralelo");
  agyFalso(bin, "espera-models");
  assert.equal(tabla(bin, path.join(tmp, "estado-paralelo")).cupo_libre, 0.37);
});

test("si agy no contesta a tiempo, vale la lectura de cupo de hace 5 min", () => {
  const bin = path.join(tmp, "bin-colgado");
  agyFalso(bin, "colgado");
  const estado = path.join(tmp, "estado-respaldo");
  mkdirSync(estado, { recursive: true });
  writeFileSync(path.join(estado, "quota.json"), JSON.stringify({ leido: Date.now() / 1000 - 300, json: JSON.parse(QUOTA) }));
  writeFileSync(path.join(estado, "agy-modelos.json"), JSON.stringify({ leido: Date.now() / 1000, modelos: [{ id: "gemini-4-argon-high", nombre: "Gemini 4 Argon" }] }));
  assert.equal(tabla(bin, estado, { REPARTO_AGY_S: "0.5" }).cupo_libre, 0.37);
});

test("una lectura de cupo más vieja que el respaldo no vale: sin dato", () => {
  const bin = path.join(tmp, "bin-colgado");
  agyFalso(bin, "colgado");
  const estado = path.join(tmp, "estado-viejo");
  mkdirSync(estado, { recursive: true });
  writeFileSync(path.join(estado, "quota.json"), JSON.stringify({ leido: Date.now() / 1000 - 3600, json: JSON.parse(QUOTA) }));
  writeFileSync(path.join(estado, "agy-modelos.json"), JSON.stringify({ leido: Date.now() / 1000, modelos: [{ id: "gemini-4-argon-high", nombre: "Gemini 4 Argon" }] }));
  assert.notEqual(tabla(bin, estado, { REPARTO_AGY_S: "0.5" }).cupo_libre, 0.37);
});
