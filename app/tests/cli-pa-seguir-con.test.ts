// `pa <proyecto> --seguir-con <modelo> --id <id>` (electron/cli/pa/seguir-con.ts): la misma conversación de una corrida con otro
// modelo. Primero el parseo y el armado de la tarea con el reparto y el lanzamiento falsos; después el recorrido entero con el
// `claude` con guion (tests/paridad/claude-guion.mjs): una corrida de verdad en un worktree y su --seguir-con, que tiene que caer en
// el mismo puesto y la misma rama, con sesión limpia, el modelo elegido y el resumen de la anterior como tarea.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testPosix } from "./plataforma.ts";
import { main, type Deps } from "../electron/cli/pa/cli.ts";
import type { Env, Io } from "../electron/cli/pa/entorno.ts";
import { escapar } from "../electron/cli/pa/lanzar.ts";
import { deps as depsReales } from "../electron/cli/pa.ts";
import type { Llamada } from "../electron/cli/pa/politica.ts";
import type { Reparto } from "../electron/cli/pa/programas.ts";

const GUION = path.join(import.meta.dirname, "paridad", "claude-guion.mjs");
const ID = "20261101-120000-4242";
const SID = "11111111-2222-4333-8444-555555555555";

const captura = (): Io & { o: string; e: string } => {
  const c = { o: "", e: "", out: (s: string) => void (c.o += s), err: (s: string) => void (c.e += s) };
  return c;
};

function sandbox(): { env: Env; raiz: string; proyecto: string; estado: string; proj: string } {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-pa-seguir-con-")));
  const home = path.join(raiz, "home");
  const proyecto = path.join(raiz, "demo");
  const estado = path.join(raiz, "estado");
  const proj = path.join(home, ".claude", "projects");
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  mkdirSync(proyecto, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", ["-C", proyecto, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(proyecto, "a.ts"), "export const a = 1;\n");
  git("add", "a.ts");
  git("commit", "-qm", "base");
  const reg = path.join(home, ".config", "proyectos", "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE|GUION_)/.test(k)) env[k] = v;
  Object.assign(env, { HOME: home, USER: "gonza", XDG_CONFIG_HOME: path.join(home, ".config"), PA_STATE: estado, PA_PROJ: proj, PROYECTOS_REGISTRY: reg, TRAMA_MODELOS: path.join(home, "no-hay.json"), PA_JEFE: "", PA_JEFE_ID: "" });
  return { env, raiz, proyecto, estado, proj };
}

const repartoFalso = (): Reparto => ({
  ruta: "/falso/reparto",
  ejecutable: () => true,
  enfriado: async () => null,
  elegir: async () => ({ rc: 1, salida: "" }),
  tabla: async () => "",
  cuentaPara: async () => "",
  plan: () => 0,
});

const linea = (type: string, content: unknown) => JSON.stringify({ type, message: { role: type, content } });
const TRANSCRIPT = [
  linea("user", "Arreglá a.ts del proyecto demo."),
  linea("assistant", [{ type: "text", text: "Decisión: dejo la constante exportada." }, { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/x/a.ts" } }]),
  linea("assistant", [{ type: "text", text: "Falta: el test de a.ts." }]),
].join("\n");

/** Una corrida vieja en el estado: .corrida (con rama), .sid, .hilo y su transcript. */
function corridaVieja(s: ReturnType<typeof sandbox>, o: { rutaTrabajo?: string; conTranscript?: boolean } = {}): string {
  const dir = path.join(s.estado, "demo");
  mkdirSync(dir, { recursive: true });
  const rt = o.rutaTrabajo ?? s.proyecto;
  writeFileSync(path.join(dir, `${ID}.corrida`), `ruta_trabajo=${rt}\nrama=pa/demo/${ID}\nbase=abc\nproyecto=demo\norigen=\nleer=0\npuesto=1\n`);
  writeFileSync(path.join(dir, `${ID}.sid`), SID);
  writeFileSync(path.join(dir, `${ID}.hilo`), `tarea=Arreglá a.ts\nmodelo=claude-opus-5-5\neffort=high\nproyecto=demo\nrama=pa/demo/${ID}\n`);
  if (o.conTranscript !== false) {
    mkdirSync(path.join(s.proj, escapar(rt)), { recursive: true });
    writeFileSync(path.join(s.proj, escapar(rt), `${SID}.jsonl`), `${TRANSCRIPT}\n`);
  }
  return dir;
}

async function pa(argv: string[], env: Env, deps: Deps = {}): Promise<{ rc: number; o: string; e: string; l: Llamada | null }> {
  const io = captura();
  let l: Llamada | null = null;
  const rc = await main(argv, env, io, { reparto: () => repartoFalso(), ...deps, proyecto: { lanzar: (x) => ((l = x), 0), ...deps.proyecto } });
  return { rc, o: io.o, e: io.e, l };
}

test("--seguir-con: el modelo es el pedido, la tarea es el resumen + el pedido extra y retoma la corrida", async () => {
  const s = sandbox();
  corridaVieja(s);
  const r = await pa(["demo", "--sin-jefe", "--seguir-con", "claude-haiku-5-5", "--id", ID, "Terminá sólo el test."], s.env);
  assert.equal(r.rc, 0, r.e);
  assert.equal(r.l?.modelo, "claude-haiku-5-5");
  assert.equal(r.l?.retomaDe, ID);
  assert.equal(r.l?.seguir, false, "no retoma la sesión del otro modelo: sesión limpia");
  const t = r.l?.tarea ?? "";
  assert.match(t, /^# Traspaso/);
  assert.match(t, /claude-opus-5-5/);
  assert.match(t, /Arreglá a\.ts del proyecto demo/);
  assert.match(t, /\/x\/a\.ts/);
  assert.match(t, /- Falta: el test de a\.ts\./);
  assert.match(t, /Terminá sólo el test\./);
});

test("--seguir-con: sin transcript arma el resumen con el pedido de la .hilo y el resultado de la .json", async () => {
  const s = sandbox();
  const dir = corridaVieja(s, { conTranscript: false });
  writeFileSync(path.join(dir, `${ID}.json`), JSON.stringify({ result: "RESULTADO: avancé a medias.\nSIGUE: falta el test." }));
  const r = await pa(["demo", "--sin-jefe", "--seguir-con", "claude-haiku-5-5", "--id", ID], s.env);
  assert.equal(r.rc, 0, r.e);
  assert.match(r.l?.tarea ?? "", /Arreglá a\.ts/);
  assert.match(r.l?.tarea ?? "", /avancé a medias/);
});

test("--seguir-con: lo que no va sale con 2 (o 1) y sin lanzar", async () => {
  const s = sandbox();
  const dir = corridaVieja(s, { conTranscript: false });
  const casos: [string[], number, RegExp][] = [
    [["--seguir-con", "claude-haiku-5-5"], 2, /va con --id/],
    [["--seguir-con", "a,b", "--id", ID], 2, /UN modelo/],
    [["--seguir-con", "claude-haiku-5-5", "--id", ID, "--seguir"], 2, /no va con --seguir/],
    [["--seguir-con", "claude-haiku-5-5", "--id", ID, "--aca"], 2, /no va con/],
    [["--seguir-con", "claude-haiku-5-5", "--id", "no-existe"], 2, /no hay una corrida 'no-existe'/],
    [["--seguir-con", "claude-haiku-5-5", "--id", "../x"], 2, /no es un id de corrida/],
  ];
  for (const [a, rc, re] of casos) {
    const r = await pa(["demo", "--sin-jefe", ...a], s.env);
    assert.equal(r.rc, rc, `${a.join(" ")}: ${r.e}`);
    assert.match(r.e, re, a.join(" "));
    assert.equal(r.l, null, "no lanza");
  }
  // sin transcript, sin pedido y sin resultado no hay de dónde armarlo
  rmSync(path.join(dir, `${ID}.hilo`));
  const vacia = await pa(["demo", "--sin-jefe", "--seguir-con", "claude-haiku-5-5", "--id", ID], s.env);
  assert.equal(vacia.rc, 1);
  assert.match(vacia.e, /no tengo de dónde armar el resumen/);
  // una corrida viva (su .pid es un proceso que existe) no se sigue con otro modelo
  writeFileSync(path.join(dir, `${ID}.pid`), String(process.pid));
  const viva = await pa(["demo", "--sin-jefe", "--seguir-con", "claude-haiku-5-5", "--id", ID], s.env);
  assert.equal(viva.rc, 75);
  assert.match(viva.e, /sigue viva/);
});

testPosix("recorrido entero con claude con guion: el --seguir-con cae en el mismo puesto y la misma rama, con sesión limpia", async () => {
  const s = sandbox();
  const aux = path.join(s.raiz, "aux");
  mkdirSync(aux, { recursive: true });
  mkdirSync(path.join(s.raiz, "shim"), { recursive: true });
  const log = path.join(s.raiz, "claude-argv.jsonl");
  const respuesta = (result: string) => ({ json: { type: "result", subtype: "success", is_error: false, result, session_id: "@SID@", num_turns: 3, duration_ms: 1000, total_cost_usd: 0.1 } });
  writeFileSync(path.join(aux, "guion.json"), JSON.stringify([respuesta("RESULTADO: primera parte.\nVERIFICACION: ninguna\nDECISION: nada\nSIGUE: el test"), respuesta("RESULTADO: segunda parte.\nVERIFICACION: ninguna\nDECISION: nada\nSIGUE: nada")]));
  const shim = path.join(s.raiz, "shim", "claude");
  writeFileSync(shim, `#!/bin/sh\nGUION_DIR='${aux}' GUION_PROY='${s.proyecto}' exec "${process.execPath}" "${GUION}" "$@"\n`);
  chmodSync(shim, 0o755);
  const env: Env = { ...s.env, PATH: `${path.join(s.raiz, "shim")}${path.delimiter}${s.env.PATH ?? ""}`, TRAMA_FALSO_LOG: log, PA_RAM_MIN_MB: "0" };
  const BRIEF = "Objetivo: arreglar a.ts\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";

  const io1 = captura();
  const rc1 = await main(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", BRIEF], { ...env, PA_TS: "20261101-130000-1" }, io1, { ...depsReales, reparto: () => repartoFalso() });
  assert.equal(rc1, 0, io1.e);
  const dir = path.join(s.estado, "demo");
  const id1 = readdirSync(dir).find((f) => f.endsWith(".corrida"))!.replace(/\.corrida$/, "");
  const campo = (f: string, k: string) => readFileSync(f, "utf8").split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? "";
  const rama1 = campo(path.join(dir, `${id1}.corrida`), "rama");
  const rt1 = campo(path.join(dir, `${id1}.corrida`), "ruta_trabajo");
  const puesto1 = campo(path.join(dir, `${id1}.corrida`), "puesto");
  assert.ok(rama1 && existsSync(rt1), "la primera corrida tuvo rama y worktree");
  // el transcript de la primera (el claude falso no lo escribe)
  const sid1 = readFileSync(path.join(dir, `${id1}.sid`), "utf8").trim();
  mkdirSync(path.join(s.proj, escapar(rt1)), { recursive: true });
  writeFileSync(path.join(s.proj, escapar(rt1), `${sid1}.jsonl`), `${TRANSCRIPT}\n`);

  const io2 = captura();
  const rc2 = await main(["demo", "--sin-jefe", "--seguir-con", "claude-haiku-5-5", "--id", id1, "Cerrá lo que falta."], { ...env, PA_TS: "20261101-130000-2" }, io2, { ...depsReales, reparto: () => repartoFalso() });
  assert.equal(rc2, 0, io2.e);
  const llamadas = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { args: string[]; cwd: string });
  assert.equal(llamadas.length, 2);
  const [a, b] = llamadas;
  assert.equal(realpathSync(b!.cwd), realpathSync(a!.cwd), "el mismo worktree");
  assert.ok(b!.args.includes("claude-haiku-5-5"), "el modelo elegido");
  assert.ok(!b!.args.includes("--resume"), "sesión limpia: no retoma la del otro modelo");
  const prompt = b!.args[b!.args.indexOf("-p") + 1] ?? b!.args.join("\n");
  assert.match(b!.args.join("\n"), /# Traspaso/);
  assert.match(b!.args.join("\n"), /Cerrá lo que falta\./);
  assert.ok(prompt.length > 0);
  const id2 = readdirSync(dir).filter((f) => f.endsWith(".corrida")).map((f) => f.replace(/\.corrida$/, "")).find((i) => i !== id1)!;
  assert.equal(campo(path.join(dir, `${id2}.corrida`), "rama"), rama1, "la misma rama");
  assert.equal(campo(path.join(dir, `${id2}.corrida`), "puesto"), puesto1, "el mismo puesto");
  assert.equal(campo(path.join(dir, `${id2}.corrida`), "origen"), id1, "anotada como seguida de la primera");
  assert.equal(campo(path.join(dir, `${id2}.hilo`), "modelo"), "claude-haiku-5-5");
});

testPosix("--seguir en caché frío: la sesión nueva recibe el resumen de traspaso antes del pedido (en caliente retoma la sesión sin resumen)", async () => {
  const s = sandbox();
  const aux = path.join(s.raiz, "aux");
  mkdirSync(aux, { recursive: true });
  mkdirSync(path.join(s.raiz, "shim"), { recursive: true });
  const log = path.join(s.raiz, "claude-argv.jsonl");
  const respuesta = (result: string) => ({ json: { type: "result", subtype: "success", is_error: false, result, session_id: "@SID@", num_turns: 3, duration_ms: 1000, total_cost_usd: 0.1 } });
  writeFileSync(path.join(aux, "guion.json"), JSON.stringify([respuesta("RESULTADO: uno.\nSIGUE: el test"), respuesta("RESULTADO: dos.\nSIGUE: nada"), respuesta("RESULTADO: tres.\nSIGUE: nada")]));
  const shim = path.join(s.raiz, "shim", "claude");
  writeFileSync(shim, `#!/bin/sh\nGUION_DIR='${aux}' GUION_PROY='${s.proyecto}' exec "${process.execPath}" "${GUION}" "$@"\n`);
  chmodSync(shim, 0o755);
  const env: Env = { ...s.env, PATH: `${path.join(s.raiz, "shim")}${path.delimiter}${s.env.PATH ?? ""}`, TRAMA_FALSO_LOG: log, PA_RAM_MIN_MB: "0" };
  const BRIEF = "Objetivo: arreglar a.ts\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";
  const dir = path.join(s.estado, "demo");

  const io1 = captura();
  assert.equal(await main(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", BRIEF], { ...env, PA_TS: "20261101-130000-1" }, io1, { ...depsReales, reparto: () => repartoFalso() }), 0, io1.e);
  const id1 = readdirSync(dir).find((f) => f.endsWith(".corrida"))!.replace(/\.corrida$/, "");
  const rt1 = readFileSync(path.join(dir, `${id1}.corrida`), "utf8").split("\n").find((l) => l.startsWith("ruta_trabajo="))!.slice("ruta_trabajo=".length);
  const sid1 = readFileSync(path.join(dir, `${id1}.sid`), "utf8").trim();
  const transcript = path.join(s.proj, escapar(rt1), `${sid1}.jsonl`);
  mkdirSync(path.dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${TRANSCRIPT}\n`);
  const argvs = () => readFileSync(log, "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { args: string[] }).args);

  // en caliente: retoma la sesión y no hay resumen
  const io2 = captura();
  assert.equal(await main(["demo", "--sin-jefe", "--seguir", "--id", id1, "Seguí con el test."], { ...env, PA_TS: "20261101-130000-2" }, io2, { ...depsReales, reparto: () => repartoFalso() }), 0, io2.e);
  const caliente = argvs()[1]!;
  assert.ok(caliente.includes("--resume"), "caliente: retoma la sesión");
  assert.ok(!caliente.join("\n").includes("# Traspaso"), "caliente: sin resumen");

  // en frío (la sesión pasó la hora): sesión nueva con el resumen y el pedido al final
  const vieja = new Date(Date.now() - 3 * 3600 * 1000);
  utimesSync(transcript, vieja, vieja);
  const io3 = captura();
  assert.equal(await main(["demo", "--sin-jefe", "--seguir", "--id", id1, "Cerrá el test de a.ts."], { ...env, PA_TS: "20261101-130000-3" }, io3, { ...depsReales, reparto: () => repartoFalso() }), 0, io3.e);
  assert.match(io3.e, /caché frío/);
  const frio = argvs()[2]!;
  assert.ok(!frio.includes("--resume"), "frío: sesión nueva");
  const texto = frio.join("\n");
  assert.match(texto, /# Traspaso/);
  assert.match(texto, /caché frío: sesión nueva/);
  assert.match(texto, /Arreglá a\.ts del proyecto demo/, "lleva el pedido original de la sesión fría");
  assert.match(texto, /- Falta: el test de a\.ts\./);
  assert.ok(texto.indexOf("# Traspaso") < texto.indexOf("Cerrá el test de a.ts."), "el resumen va antes del pedido");
});
