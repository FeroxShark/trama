// Cuentas y el reparto entienden igual el listado de `agy models`: el parser es uno solo (electron/agy-modelos.ts) y los tres formatos
// (id solo, id con tabulación, nombre legible) cuentan como Google conectado; los mensajes sin modelos, no.
import test from "node:test";
import assert from "node:assert/strict";
import { sondearAgy, type Deps, type Salida } from "../electron/cuentas.ts";
import { agyParsearModelos } from "../electron/cli/reparto.ts";

const salida = (stdout: string): Salida => ({ code: 0, stdout, stderr: "", tiempo: false, noExiste: false });
const deps = (stdout: string): Deps => ({ env: { PATH: "/bin" }, home: "/home/x", plat: "linux", esEjecutable: () => true, correr: async () => salida(stdout) });

const FORMATOS: Record<string, string> = {
  "id con tabulación": "gemini-4-argon-high\tGemini 4 Argon (High)\n",
  "id solo": "Fetching available models...\ngemini-4-hydrogen-high\nclaude-opus-5-5\n",
  "nombre legible": "Claude Opus 4.6 (Thinking)\nGemini 4 Hydrogen (High)\n",
};

for (const [nombre, texto] of Object.entries(FORMATOS)) {
  test(`${nombre}: Cuentas dice conectado igual que el reparto`, async () => {
    assert.ok(agyParsearModelos(texto).length > 0);
    assert.deepEqual(await sondearAgy(deps(texto)), { instalado: true, logueado: true, cuenta: null, error: null });
  });
}

test("sin modelos (aviso de sesión o carga): sin conectar, como el reparto", async () => {
  for (const texto of ["", "Fetching available models...\n", "Auth mode is unspecified, skipping fetchAvailableModels\n"]) {
    assert.equal(agyParsearModelos(texto).length, 0);
    assert.equal((await sondearAgy(deps(texto))).logueado, false);
  }
});
