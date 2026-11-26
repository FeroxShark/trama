// Aviso de `pa` al pedir Opus a mano (`-m`) en frontend o codigo-multi: una línea por stderr, sin bloquear ni cambiar el modelo.
// `reparto` ya descarta a Opus en esos tipos (TIPOS_SIN_OPUS), pero con `-m` entra igual (13 corridas desde el 11/11).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { avisoOpusAMano, main, type Deps } from "../electron/cli/pa/cli.ts";
import type { Env } from "../electron/cli/pa/entorno.ts";
import type { Llamada } from "../electron/cli/pa/politica.ts";
import type { Reparto } from "../electron/cli/pa/programas.ts";

test("avisoOpusAMano: Opus a mano en frontend o codigo-multi, en una línea con los números y la salida", () => {
  for (const m of ["claude-opus-5-5", "agy:claude-opus-5-5-high", "opus"]) {
    for (const t of ["frontend", "codigo-multi"]) {
      const a = avisoOpusAMano(m, t);
      assert.match(a, new RegExp(`^pa: aviso: pediste ${m.replace(/[:.]/g, "\\$&")} con --tipo ${t}: `));
      assert.match(a, /17 a 30 % integrada sin retrabajo y US\$ 21 a 47 por corrida buena/);
      assert.match(a, /partí la tarea o dejá que elija reparto/);
      assert.equal(a.split("\n").length, 2, "una sola línea (y el salto final)");
    }
  }
});

test("avisoOpusAMano: nada con otro modelo, otro tipo, sin tipo o retomando una corrida", () => {
  assert.equal(avisoOpusAMano("claude-sonnet-5-5", "frontend"), "");
  assert.equal(avisoOpusAMano("agy:claude-sonnet-5-5-high", "codigo-multi"), "");
  assert.equal(avisoOpusAMano("claude-opus-5-5", "codigo-acotado"), "");
  assert.equal(avisoOpusAMano("claude-opus-5-5", "diseno"), "");
  assert.equal(avisoOpusAMano("claude-opus-5-5", ""), "");
  assert.equal(avisoOpusAMano("", "frontend"), "");
  assert.equal(avisoOpusAMano("claude-opus-5-5", "frontend", { seguir: true }), "");
  assert.equal(avisoOpusAMano("claude-opus-5-5", "frontend", { seguirCon: "claude-sonnet-5-5" }), "");
  assert.equal(avisoOpusAMano("claude-opus-5-5", "frontend", { actualizar: "20261125-100000-1" }), "");
});

const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-aviso-opus-")));
after(() => rmSync(raiz, { recursive: true, force: true }));
const home = path.join(raiz, "home");
const proyecto = path.join(raiz, "demo");
mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
mkdirSync(proyecto, { recursive: true });
spawnSync("git", ["-C", proyecto, "init", "-q", "-b", "main"], { windowsHide: true });
const registry = path.join(home, ".config", "proyectos", "registry.json");
writeFileSync(registry, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));

const entorno = (): Env => {
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  return Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    USER: "gonza",
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PA_STATE: path.join(raiz, "estado"),
    PROYECTOS_REGISTRY: registry,
    TRAMA_MODELOS: path.join(home, "no-hay.json"),
    PA_JEFE: "",
    PA_JEFE_ID: "",
  });
};
const repartoFalso: Reparto = {
  ruta: "/falso/reparto",
  ejecutable: () => true,
  enfriado: async () => null,
  elegir: async () => ({ rc: 1, salida: "" }),
  tabla: async () => "",
  cuentaPara: async () => "",
  plan: () => 0,
};
/** `pa` en proceso con el lanzamiento reemplazado: devuelve stderr y el modelo con el que habría lanzado. */
async function correr(args: string[]): Promise<{ e: string; modelo: string }> {
  let e = "";
  let modelo = "";
  const deps: Deps = {
    reparto: () => repartoFalso,
    proyecto: {
      lanzar: (l: Llamada) => {
        modelo = l.modelo;
        return 0;
      },
    },
  };
  await main(["demo", ...args], entorno(), { out: () => {}, err: (s) => (e += s) }, deps);
  return { e, modelo };
}

test("pa -m claude-opus --tipo frontend avisa una vez por stderr y lanza con ese mismo modelo", async () => {
  const r = await correr(["-m", "claude-opus-5-5", "--tipo", "frontend", "--", "Objetivo: x\nListo cuando: y\nCómo verificar: z"]);
  assert.equal(r.e.match(/pediste claude-opus-5-5 con --tipo frontend/g)?.length, 1);
  assert.equal(r.modelo, "claude-opus-5-5", "no cambia el modelo");
});

test("pa --seguir con Opus en frontend, o Opus en otro tipo, no avisa", async () => {
  const a = await correr(["-m", "claude-opus-5-5", "--tipo", "frontend", "--seguir", "--", "seguí"]);
  assert.doesNotMatch(a.e, /pediste claude-opus/);
  const b = await correr(["-m", "claude-opus-5-5", "--tipo", "debug", "--", "Objetivo: x\nListo cuando: y\nCómo verificar: z"]);
  assert.doesNotMatch(b.e, /pediste claude-opus/);
});
