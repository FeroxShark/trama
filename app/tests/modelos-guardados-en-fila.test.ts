// REPARTO-CUPOS-12: los guardados de modelos.json de NIM y de OpenCode Go van en la misma fila que `guardarModelos`:
// dos simultáneos no se pisan (ninguno pierde su clave) ni comparten el temporal.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { guardarModelosNim } from "../electron/nvidia-nim.ts";
import { guardarPlanOpencode } from "../electron/opencode-go.ts";

test("guardar la lista de NIM y el plan de Go a la vez conserva las dos claves y no deja temporales", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "modelos-fila-"));
  const ruta = path.join(dir, "modelos.json");
  const env = { TRAMA_MODELOS: ruta };
  await writeFile(ruta, JSON.stringify({ version: 1, perfil: "ahorro" }));
  const lista = ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-v4.1-flash"];
  await Promise.all([guardarModelosNim(lista, env, dir), guardarPlanOpencode("go", env, dir), guardarModelosNim([...lista].reverse(), env, dir)]);
  const j = JSON.parse(await readFile(ruta, "utf8"));
  assert.equal(j.perfil, "ahorro");
  assert.equal(j.opencode_plan, "go");
  assert.deepEqual(j.nvidia_modelos, [...lista].reverse());
  assert.deepEqual(await readdir(dir), ["modelos.json"]);
});
