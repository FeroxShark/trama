// `pa --preset`, `--advisor` y `--autocompact` (sólo TS): parseo, el viaje al hijo de --async, el settings de Claude, el aislamiento
// de skills de codex y opencode, el aviso de agy y las familias de `autocompact_de`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { argsHijo } from "../electron/cli/pa/async.ts";
import { prologo, type Pa } from "../electron/cli/pa/entorno.ts";
import { argsCierre, argsClaude, armarLanzamiento, escribirHilo, settingsWorker, usaSkills, type Corrida } from "../electron/cli/pa/lanzar.ts";
import { Modelos } from "../electron/cli/pa/modelos.ts";
import { opcionesIniciales, parsearOpciones } from "../electron/cli/pa/opciones.ts";
import { aislarSkills, ejecutarOtro } from "../electron/cli/pa/otros-motores.ts";
import { presetsFabrica } from "../electron/presets-tipos.ts";
import { configTrama } from "../electron/rutas.ts";

const mudo = { out: () => {}, err: () => {} };
const SKILLS = ["taste-skill", "trama-orquestar", "otra"];

function armar(t: TestContext, extra: Record<string, string> = {}) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "presets-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const env: Record<string, string> = { HOME: raiz, USERPROFILE: raiz, LOCALAPPDATA: path.join(raiz, "local"), PA_STATE: path.join(raiz, "estado"), CLAUDE_CONFIG_DIR: path.join(raiz, "claude"), ...extra };
  for (const s of SKILLS) {
    const d = path.join(env.CLAUDE_CONFIG_DIR!, "skills", s);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "SKILL.md"), "x\n");
  }
  const pa = prologo([], env, mudo);
  return { raiz, env, pa, cfg: configTrama(pa.env, pa.home, pa.plat) };
}

const corrida = (raiz: string, o: Partial<Corrida> = {}): Corrida => ({
  proyecto: "demo", slug: "demo", ts: "1", ruta: raiz, rutaTrabajo: raiz, rama: "", base: "", origen: "", puesto: "",
  leer: true, usaWorktree: false, tengoLock: false, modelo: "claude-sonnet-5-5", esfuerzo: "", cuenta: "claude", tarea: "x", tareaJefe: "x",
  lanzo: "jefe", sid: "sesion", resume: false, conMcp: false, maxTurns: "", maxBudget: "", autocompact: "", baseDelta: [], jefe: "", jefeId: "", async: false, ...o,
});

function parsear(args: string[]) {
  const err: string[] = [];
  const o = parsearOpciones(args, opcionesIniciales("demo", {}, "max"), { env: {}, io: { out: () => {}, err: (s) => err.push(s) }, dueno: "x", anotar: () => {} });
  return { o, err };
}

test("--preset, --advisor y --autocompact: parseo y validación", () => {
  const { o } = parsear(["--preset", "codigo", "--advisor", "OPUS", "--autocompact", "200000", "tarea"]);
  assert.deepEqual([o.preset, o.advisor, o.autocompactPedido, o.tarea], ["codigo", "opus", "200000", "tarea"]);
  assert.equal(parsear(["--autocompact", "nativo", "t"]).o.autocompactPedido, "nativo");
  for (const mal of [["--preset", "a b"], ["--preset", "x".repeat(41)], ["--advisor", "gpt"], ["--autocompact", "99999"], ["--autocompact", "1000001"], ["--autocompact", "2e5"], ["--preset"]])
    assert.throws(() => parsear(mal), undefined, mal.join(" "));
});

test("argsHijo propaga preset, advisor y autocompact sólo si vienen", () => {
  const base = { proyecto: "demo", modelo: "m", tarea: "t" };
  assert.deepEqual(argsHijo({ ...base, preset: "", advisor: "", autocompactPedido: "" }), argsHijo(base));
  const a = argsHijo({ ...base, preset: "diseno", advisor: "opus", autocompactPedido: "nativo" });
  assert.deepEqual(a.slice(-8), ["--preset", "diseno", "--advisor", "opus", "--autocompact", "nativo", "--", "t"]);
});

test("settingsWorker: el preset suma skillOverrides sobre el apagado global sin tocar sus archivos", (t) => {
  const { raiz, pa, cfg } = armar(t);
  mkdirSync(cfg, { recursive: true });
  const global = JSON.stringify({ skillOverrides: { global: "off" } });
  writeFileSync(path.join(cfg, "apagados-claude.json"), global);
  writeFileSync(path.join(cfg, "apagados.json"), JSON.stringify({ skills: ["global"] }));
  const over = (o: { preset?: string; tipo?: string; leer?: boolean }) =>
    Object.keys((JSON.parse(settingsWorker(pa, { hb: path.join(raiz, "hb"), leer: false, ...o })) as { skillOverrides: object }).skillOverrides).sort();
  assert.deepEqual(over({}), ["global"]);
  assert.deepEqual(over({ tipo: "frontend" }), ["global"], "sin presets.json ni --preset, nada");
  assert.deepEqual(over({ preset: "codigo" }), ["global", "taste-skill", "trama-orquestar"]);
  assert.deepEqual(over({ preset: "diseno" }), ["global", "otra", "trama-orquestar"]);
  assert.deepEqual(over({ preset: "minimo" }), ["global", "otra", "taste-skill", "trama-orquestar"]);
  assert.deepEqual(over({ preset: "todo" }), ["global"]);
  writeFileSync(path.join(cfg, "presets.json"), JSON.stringify(presetsFabrica()));
  assert.deepEqual(over({ tipo: "diseño" }), ["global", "otra", "trama-orquestar"], "con presets.json, el del tipo");
  assert.equal(readFileSync(path.join(cfg, "apagados-claude.json"), "utf8"), global);
});

test("usaSkills y el .hilo: sin preset como antes; con preset, sí salvo el que no carga ninguna", (t) => {
  const { raiz, pa } = armar(t);
  assert.equal(usaSkills({ tipo: "frontend" }), true);
  assert.equal(usaSkills({ tipo: "debug" }), false);
  assert.equal(usaSkills({ tipo: "debug", preset: "codigo" }, pa), true);
  assert.equal(usaSkills({ tipo: "frontend", preset: "minimo" }, pa), false);
  for (const [ts, preset] of [["1", undefined], ["2", "codigo"]] as const) {
    const l = armarLanzamiento(pa, corrida(raiz, { ts, preset }));
    mkdirSync(l.dir, { recursive: true });
    escribirHilo(l);
    assert.equal(/^preset=codigo$/m.test(readFileSync(path.join(l.dir, `${ts}.hilo`), "utf8")), Boolean(preset));
    assert.equal(l.args.includes("--disable-slash-commands"), !preset);
  }
});

test("--advisor: sólo pedido, con un par válido y sin nada que lo apague; nunca heredado de modelos.json", (t) => {
  const { raiz, env, pa, cfg } = armar(t);
  mkdirSync(cfg, { recursive: true });
  writeFileSync(path.join(cfg, "modelos.json"), JSON.stringify({ version: 1, advisor: { sonnet: "opus" } }));
  const o = { contrato: "c", settings: "{}", nombre: "n" };
  const asesor = (p: Pa, c: Partial<Corrida>) => {
    const a = argsClaude(p, corrida(raiz, c), o);
    return a.includes("--advisor") ? a[a.indexOf("--advisor") + 1] : undefined;
  };
  assert.equal(asesor(pa, { advisor: "opus" }), "opus");
  assert.ok(argsCierre(pa, corrida(raiz, { advisor: "opus" }), { ...o, sid: "s" }).includes("--advisor"));
  assert.equal(asesor(pa, {}), undefined);
  assert.equal(asesor(pa, { advisor: "haiku" }), undefined);
  assert.equal(asesor(pa, { advisor: "opus", modelo: "claude-opus-5-5" }), undefined);
  assert.equal(asesor(pa, { advisor: "opus", motor: "ollama" }), undefined);
  assert.equal(asesor({ ...pa, env: { ...env, DISABLE_TELEMETRY: "1" } }, { advisor: "opus" }), undefined);
  writeFileSync(path.join(env.CLAUDE_CONFIG_DIR!, "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } }));
  assert.equal(asesor(pa, { advisor: "opus" }), undefined);
});

test("codex y opencode: config temporal con las skills del preset, enlazada a la original y borrada sin atravesarla", (t) => {
  const { raiz, env, pa } = armar(t);
  const codex = path.join(raiz, ".codex");
  const xdg = path.join(raiz, ".config");
  mkdirSync(codex, { recursive: true });
  mkdirSync(path.join(xdg, "opencode"), { recursive: true });
  mkdirSync(path.join(xdg, "git"), { recursive: true });
  writeFileSync(path.join(codex, "auth.json"), "a");
  writeFileSync(path.join(codex, "config.toml"), "c");
  writeFileSync(path.join(xdg, "opencode", "opencode.json"), "{}");
  writeFileSync(path.join(xdg, "git", "config"), "g");
  const preset = presetsFabrica().presets.codigo!;

  const a = aislarSkills("codex", pa, env, preset);
  const home = a.env.CODEX_HOME!;
  assert.notEqual(home, codex);
  assert.deepEqual(readdirSync(path.join(home, "skills")), ["otra"]);
  assert.equal(readFileSync(path.join(home, "auth.json"), "utf8"), "a");
  assert.equal(readFileSync(path.join(home, "config.toml"), "utf8"), "c");
  writeFileSync(path.join(home, "sessions", "rollout"), "r");
  a.limpiar();
  assert.equal(existsSync(home), false);
  assert.equal(readFileSync(path.join(codex, "auth.json"), "utf8"), "a");
  assert.equal(readFileSync(path.join(codex, "sessions", "rollout"), "utf8"), "r");
  assert.ok(existsSync(path.join(env.CLAUDE_CONFIG_DIR!, "skills", "otra", "SKILL.md")));

  const b = aislarSkills("opencode", pa, env, preset);
  const dir = b.env.XDG_CONFIG_HOME!;
  assert.deepEqual(readdirSync(path.join(dir, "opencode", "skills")), ["otra"]);
  assert.equal(readFileSync(path.join(dir, "opencode", "opencode.json"), "utf8"), "{}");
  assert.equal(readFileSync(path.join(dir, "git", "config"), "utf8"), "g");
  b.limpiar();
  assert.equal(existsSync(dir), false);
  assert.equal(readFileSync(path.join(xdg, "git", "config"), "utf8"), "g");
});

test("ejecutarOtro: codex corre con su CODEX_HOME aislado y lo borra; agy avisa que no se aísla", { skip: process.platform === "win32" }, async (t) => {
  const { raiz, env } = armar(t);
  const bin = path.join(raiz, "bin");
  mkdirSync(bin, { recursive: true });
  const visto = path.join(raiz, "visto.json");
  writeFileSync(path.join(bin, "codex"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(visto)}, JSON.stringify({ home: process.env.CODEX_HOME, skills: fs.readdirSync(process.env.CODEX_HOME + "/skills") }));
`, { mode: 0o755 });
  const agy = path.join(raiz, "agy.mjs");
  writeFileSync(agy, `process.stderr.write("ruido de agy\\n");`);
  const pa = prologo([], { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HILOS_AGY: agy }, mudo);
  const correr = async (c: Partial<Corrida>) => {
    const l = armarLanzamiento(pa, corrida(raiz, c));
    mkdirSync(l.dir, { recursive: true });
    await ejecutarOtro(l, { alArrancar: () => {} });
    return readFileSync(l.err, "utf8");
  };
  await correr({ ts: "1", motor: "codex", modelo: "codex:gpt-6.2-sol-high", preset: "codigo" });
  const v = JSON.parse(readFileSync(visto, "utf8")) as { home: string; skills: string[] };
  assert.deepEqual(v.skills, ["otra"]);
  assert.equal(existsSync(v.home), false);
  assert.equal(existsSync(path.join(raiz, ".codex", "skills")), false, "la carpeta global no se toca");

  const err = await correr({ ts: "2", motor: "agy", modelo: "gemini-4-neon-high", preset: "codigo" });
  assert.match(err, /pa: preset 'codigo' no se aísla por proceso en agy \(usa apagados\.json global\)\./);
});

test("autocompact_de: gemini y codex tienen familia propia", (t) => {
  const { env, pa, cfg } = armar(t);
  mkdirSync(cfg, { recursive: true });
  writeFileSync(path.join(cfg, "modelos.json"), JSON.stringify({ version: 1, autocompact: { por_modelo: { gemini: 400000, codex: 250000 } } }));
  const m = new Modelos(env, mudo, pa.home, pa.plat);
  assert.equal(m.autocompactDe("gemini-4-neon-high", null), "400000");
  assert.equal(m.autocompactDe("agy:gemini-4-neon", null), "400000");
  assert.equal(m.autocompactDe("codex:gpt-6.2-sol-high", null), "250000");
  assert.equal(m.autocompactDe("claude-sonnet-5-5", null), "");
});
