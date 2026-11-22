// B152 / NOCHE-11: el candado de contenido (secreto, repo con secretos, red o ruta de afuera) con un otro motor.
// Un -m explícito a otro motor NO cae a Claude (sale 96, diga lo que lo disparó y las dos salidas); un modelo que eligió reparto (o una
// sustitución) sí cae, pero sólo con Claude instalado y con sesión. Un motivo que no es el candado se queda como siempre.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main, type Deps } from "../electron/cli/pa/cli.ts";
import type { Env, Io } from "../electron/cli/pa/entorno.ts";
import { chequeoAgy, type ResultadoChequeo } from "../electron/cli/pa/motores/chequeo.ts";
import type { Llamada } from "../electron/cli/pa/politica.ts";
import type { Reparto } from "../electron/cli/pa/programas.ts";

function sandbox(extra: Env = {}): Env {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-pa-candado-")));
  const home = path.join(raiz, "home");
  const proyecto = path.join(raiz, "demo");
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  mkdirSync(proyecto, { recursive: true });
  spawnSync("git", ["-C", proyecto, "init", "-q", "-b", "main"]);
  const reg = path.join(home, ".config", "proyectos", "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  Object.assign(env, {
    HOME: home,
    USER: "gonza",
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PA_STATE: path.join(raiz, "estado"),
    PROYECTOS_REGISTRY: reg,
    TRAMA_MODELOS: path.join(home, "no-hay.json"),
    PA_JEFE: "",
    PA_JEFE_ID: "",
    ...extra,
  });
  return env;
}

const CANDADO: ResultadoChequeo = { texto: "el pedido necesita red o leer fuera del worktree (una URL)", candado: true };
const OTRO: ResultadoChequeo = "agy no está en el PATH";

function repartoDe(modelo: string): Reparto {
  return {
    ruta: "/falso/reparto",
    ejecutable: () => true,
    enfriado: async () => null,
    elegir: async () => ({ rc: 0, salida: JSON.stringify({ modelo, effort: "low", motivo: "el que alcanza" }) }),
    tabla: async () => "",
    cuentaPara: async () => "",
    plan: () => 0,
  };
}

interface Caso {
  /** `-m` explícito, o reparto elige este modelo. */
  via: "explicito" | "reparto";
  modelo: string;
  motivo: ResultadoChequeo;
  /** Claude instalado y con sesión (por defecto sí). */
  claude?: "si" | "sin-instalar" | "sin-sesion";
  env?: Env;
}

async function correr(c: Caso): Promise<{ rc: number; e: string; l: Llamada | null }> {
  let e = "";
  let l: Llamada | null = null;
  const io: Io = { out: () => {}, err: (s) => void (e += s) };
  const chequeo = async () => c.motivo;
  const claude = c.claude ?? "si";
  const deps: Deps = {
    reparto: () => repartoDe(c.modelo),
    motores: { chequearGemini: chequeo, chequearCodex: chequeo, chequearDsh: chequeo },
    esEjecutable: (f) => claude !== "sin-instalar" && /claude/i.test(f),
    claudeConSesion: () => claude === "si",
    proyecto: { lanzar: (x) => ((l = x), 0) },
  };
  const argv = c.via === "explicito" ? ["demo", "-m", c.modelo, "hacé algo"] : ["demo", "--tipo", "codigo-acotado", "hacé algo"];
  const rc = await main(argv, sandbox(c.env), io, deps);
  return { rc, e, l };
}

const MODELOS = [
  ["gemini", "gemini-4-argon-low"],
  ["codex", "codex:gpt-6-luna-low"],
  ["dsh", "dsh:deepseek/chat"],
] as const;

for (const [motor, modelo] of MODELOS) {
  test(`candado + -m explícito a ${motor}: no cae a Claude, sale 96 con el motivo y las dos salidas`, async () => {
    const r = await correr({ via: "explicito", modelo, motivo: CANDADO });
    assert.equal(r.rc, 96, r.e);
    assert.equal(r.l, null);
    assert.match(r.e, /el pedido necesita red o leer fuera del worktree \(una URL\)/);
    assert.match(r.e, /Sacá eso del brief, o relanzá con -m claude-…/);
  });

  test(`candado + -m explícito a ${motor}: sin_cupo no cambia nada (ni otro ni fallar)`, async () => {
    for (const v of ["otro", "fallar"]) {
      const f = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-pa-candado-m-"))), "m.json");
      writeFileSync(f, JSON.stringify({ version: 1, sin_cupo: v }));
      const r = await correr({ via: "explicito", modelo, motivo: CANDADO, env: { TRAMA_MODELOS: f } });
      assert.equal(r.rc, 96, `${v}: ${r.e}`);
      assert.equal(r.l, null);
      assert.match(r.e, /Sacá eso del brief/);
    }
  });

  test(`candado + -m explícito a ${motor} sin Claude: igual 96`, async () => {
    const r = await correr({ via: "explicito", modelo, motivo: CANDADO, claude: "sin-instalar" });
    assert.equal(r.rc, 96, r.e);
    assert.equal(r.l, null);
  });

  test(`candado + reparto eligió ${motor} + Claude con sesión: cae a Claude con lo que lo disparó`, async () => {
    const r = await correr({ via: "reparto", modelo, motivo: CANDADO });
    assert.equal(r.rc, 0, r.e);
    assert.match(r.l?.modelo ?? "", /^claude-/);
    assert.equal(r.l?.geminiPedido, modelo);
    assert.match(r.e, /el pedido necesita red o leer fuera del worktree \(una URL\)/);
  });

  test(`candado + reparto eligió ${motor} sin Claude instalado o sin sesión: 96`, async () => {
    for (const claude of ["sin-instalar", "sin-sesion"] as const) {
      const r = await correr({ via: "reparto", modelo, motivo: CANDADO, claude });
      assert.equal(r.rc, 96, `${claude}: ${r.e}`);
      assert.equal(r.l, null);
      assert.match(r.e, /no hay una Claude instalada y con sesión adonde caer/);
    }
  });
}

test("otro motivo (no el candado) + -m explícito a gemini: sigue como siempre (sin_cupo=otro cae a Claude, sin mirar si hay Claude)", async () => {
  const r = await correr({ via: "explicito", modelo: "gemini-4-argon-low", motivo: OTRO, claude: "sin-instalar" });
  assert.equal(r.rc, 0, r.e);
  assert.match(r.l?.modelo ?? "", /^claude-/);
  assert.match(r.e, /agy no está en el PATH/);
});

test("otro motivo + -m explícito a codex con sin_cupo=fallar: 96 por sin_cupo, no por el candado", async () => {
  const f = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-pa-candado-m-"))), "m.json");
  writeFileSync(f, JSON.stringify({ version: 1, sin_cupo: "fallar" }));
  const r = await correr({ via: "explicito", modelo: "codex:gpt-6-luna-low", motivo: "codex no tiene sesión iniciada (codex login)", env: { TRAMA_MODELOS: f } });
  assert.equal(r.rc, 96, r.e);
  assert.match(r.e, /modelos\.json dice sin_cupo=fallar/);
});

test("otro motivo + reparto eligió gemini sin Claude: cae como hoy (no se mira Claude)", async () => {
  const r = await correr({ via: "reparto", modelo: "gemini-4-argon-low", motivo: OTRO, claude: "sin-instalar" });
  assert.equal(r.rc, 0, r.e);
  assert.match(r.l?.modelo ?? "", /^claude-/);
});

test("otro motivo + -m dsh explícito: 95 como siempre (no es del candado)", async () => {
  const r = await correr({ via: "explicito", modelo: "dsh:deepseek/chat", motivo: "dsh no está instalado" });
  assert.equal(r.rc, 95, r.e);
});

test("el chequeo de verdad: un brief con URL y -m gemini explícito sale 96 (sin agy instalado, el candado va primero)", async () => {
  let e = "";
  const env = sandbox();
  const io: Io = { out: () => {}, err: (s) => void (e += s) };
  const rc = await main(["demo", "-m", "gemini-4-argon-low", "mirá https://ejemplo.com/x"], env, io, {
    motores: { chequearGemini: async (_m, l) => chequeoAgy({ proyecto: l.proyecto, tarea: l.tarea, env, plat: "linux" }) },
    esEjecutable: (f) => /claude/i.test(f),
    claudeConSesion: () => true,
    proyecto: { lanzar: () => 0 },
  });
  assert.equal(rc, 96, e);
  assert.match(e, /una URL/);
  assert.match(e, /Pediste ese modelo con -m/);
});
