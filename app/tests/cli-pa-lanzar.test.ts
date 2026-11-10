// lanzar.ts y resultado-lanzar.ts (etapa 6 del port de pa). Los parsers del bloque del worker se comparan con las funciones del bash
// (sacadas de motor/bin/pa por patrón de texto); lo demás (settings de Windows, .ultimo/.listo de al_salir, hora de reset) se
// prueba directo. El recorrido entero contra el bash está en tests/paridad/lanzar.test.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testPosix } from "./plataforma.ts";
import type { Pa } from "../electron/cli/pa/entorno.ts";
import { alSalir, argsCierre, argsClaude, armarLanzamiento, configClaudeDe, contratoClaude, envDeLaLlamada, lineaSkillsDiseno, promptDe, settingsWorker, skillsDisenoInstaladas, type Corrida } from "../electron/cli/pa/lanzar.ts";
import { campoDe, decisionEsNada, epochReset, verificadoDe } from "../electron/cli/pa/resultado-lanzar.ts";

const PA = path.join(import.meta.dirname, "..", "..", "motor", "bin", "pa");

/** Una función del bash (de `nombre() {` hasta la primera `}` sola en su línea). */
function funcionBash(nombre: string): string {
  const ls = readFileSync(PA, "utf8").split("\n");
  const i = ls.findIndex((l) => l.startsWith(`${nombre}() {`));
  assert.ok(i >= 0, `no encontré ${nombre} en motor/bin/pa`);
  const j = ls.findIndex((l, k) => k > i && l === "}");
  return ls.slice(i, j + 1).join("\n");
}

const TEXTOS = [
  "RESULTADO: hice x.\nARCHIVOS: a.ts\nDECISION: nada\nSIGUE: nada",
  "**RESULTADO:** hice x.\n**DECISIÓN:** Decidir si se borra la tabla.\nSIGUE: publicar",
  "RESULTADO: y\nDECISION:\n\nDecidir algo\nen dos líneas\n\notro párrafo\nSIGUE: nada",
  "- DECISION: nada. Supuestos: ninguno\n- SIGUE: integrar",
  "texto suelto con decision: no DECISION: elegir A SIGUE: B",
  "sin bloque",
  "",
  "RESULTADO: z\nVERIFICACION: `npm test`\n  ok 12\nDECISION: nada",
  "RESULTADO: z\n**Verificación:** ninguna, no había tests\nDECISION: nada",
  "RESULTADO: z\nVERIFICACION:\nSIGUE: nada",
  "RESULTADO: z\nVERIFICACION: N/A\nDECISION: **nada**.",
  "DECISION: " + "á".repeat(450),
];

testPosix("campo_de, decision_es_nada y verificado_de dan lo mismo que el bash", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lanzar-campos-"));
  const guion = [funcionBash("campo_de"), funcionBash("decision_es_nada"), funcionBash("verificacion_de"), funcionBash("verificado_de"), 'res="$(cat "$1")"',
    `printf '%s\\x1f' "$(campo_de 'DECISI(O|Ó)N' <<<"$res")" "$(campo_de 'DECISI(O|Ó)N' todo <<<"$res")" "$(campo_de SIGUE <<<"$res")"`,
    `decision_es_nada "$(campo_de 'DECISI(O|Ó)N' <<<"$res")" && printf '1\\x1f' || printf '0\\x1f'`,
    `verificado_de <<<"$res" && printf 1 || printf 0`].join("\n");
  writeFileSync(path.join(dir, "g.sh"), guion);
  for (const t of TEXTOS) {
    writeFileSync(path.join(dir, "t"), t);
    const r = spawnSync("bash", [path.join(dir, "g.sh"), path.join(dir, "t")], { encoding: "utf8", env: { ...process.env, LC_ALL: "C.UTF-8" } });
    assert.equal(r.status, 0, r.stderr);
    const ts = [campoDe("DECISI(O|Ó)N", t), campoDe("DECISI(O|Ó)N", t, true), campoDe("SIGUE", t), decisionEsNada(campoDe("DECISI(O|Ó)N", t)) ? "1" : "0", verificadoDe(t) ? "1" : "0"];
    assert.deepEqual(ts, r.stdout.split("\x1f"), `con ${JSON.stringify(t)}`);
  }
});

test("epochReset: la próxima vez que sea esa hora, en la zona del texto", () => {
  const ahora = Date.UTC(2026, 9, 28, 12, 0, 0);
  assert.equal(epochReset("You've hit your session limit · resets 7pm (UTC)", { TZ: "UTC" }, ahora), Date.UTC(2026, 9, 28, 19, 0) / 1000);
  assert.equal(epochReset("resets 9am (UTC)", { TZ: "UTC" }, ahora), Date.UTC(2026, 9, 29, 9, 0) / 1000);
  assert.equal(epochReset("resets 5:30pm (America/Argentina/Buenos_Aires)", { TZ: "UTC" }, ahora), Date.UTC(2026, 9, 28, 20, 30) / 1000);
  assert.equal(epochReset("resets 12am (UTC)", { TZ: "UTC" }, ahora), Date.UTC(2026, 9, 29, 0, 0) / 1000);
  assert.equal(epochReset("sin hora", { TZ: "UTC" }, ahora), null);
});

function paFalso(raiz: string, plat: Pa["plat"] = "linux"): Pa {
  return {
    env: { PATH: "" },
    io: { out: () => {}, err: () => {} },
    plat,
    home: path.join(raiz, "home"),
    state: path.join(raiz, "estado"),
    lockdir: path.join(raiz, "estado", "lock"),
    bin: path.join(raiz, "motor", "bin"),
    plan: "pro",
    autocompact: null,
    puestos: 3,
    tope: 10,
    ramWorkerMb: 2048,
    ramReservaMb: 6144,
    ramRecienMin: 3,
  };
}

const corrida = (raiz: string, o: Partial<Corrida> = {}): Corrida => ({
  proyecto: "demo", slug: "demo", ts: "20261028-000000-1", ruta: path.join(raiz, "proy"), rutaTrabajo: path.join(raiz, "proy"), rama: "", base: "", origen: "",
  puesto: "aca", leer: false, usaWorktree: false, tengoLock: true, modelo: "claude-sonnet-5-5", esfuerzo: "high", cuenta: "claude", tarea: "x", tareaJefe: "x",
  lanzo: "jefe", sid: "00000000-0000-4000-8000-000000000001", resume: false, conMcp: false, maxTurns: "100", maxBudget: "", autocompact: "", baseDelta: [],
  jefe: "", jefeId: "", async: false, ...o,
});

test("skills de diseño: frontend y diseño cargan las instaladas (en ~/.claude/skills o en un plugin habilitado); otro tipo, --leer u otro motor no", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-skills-"));
  try {
    const pa = paFalso(raiz);
    const claude = path.join(pa.home, ".claude");
    assert.deepEqual(skillsDisenoInstaladas(pa.home), []);
    assert.doesNotMatch(contratoClaude(pa, corrida(raiz, { tipo: "frontend" })), /herramienta Skill/);
    // taste-skill en ~/.claude/skills; frontend-design en un plugin habilitado (el otro plugin no está instalado)
    mkdirSync(path.join(claude, "skills", "taste-skill"), { recursive: true });
    writeFileSync(path.join(claude, "skills", "taste-skill", "SKILL.md"), "---\nname: taste-skill\n---\n");
    const plug = path.join(raiz, "plugins", "frontend-design");
    mkdirSync(path.join(plug, "skills", "frontend-design"), { recursive: true });
    writeFileSync(path.join(plug, "skills", "frontend-design", "SKILL.md"), "---\nname: frontend-design\n---\n");
    writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "frontend-design@x": true, "otro@x": true } }));
    mkdirSync(path.join(claude, "plugins"), { recursive: true });
    writeFileSync(path.join(claude, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "frontend-design@x": [{ installPath: plug }] } }));
    const instaladas = ["frontend-design:frontend-design", "taste-skill"];
    assert.deepEqual(skillsDisenoInstaladas(pa.home), instaladas);
    const linea = lineaSkillsDiseno(instaladas);
    assert.match(linea, /instaladas en esta máquina: frontend-design:frontend-design, taste-skill\. Son parte/);
    for (const tipo of ["frontend", "diseno"]) {
      const lineas = contratoClaude(pa, corrida(raiz, { tipo })).split("\n");
      assert.ok(lineas.includes(linea), tipo);
      assert.ok(!lineas.some((l) => l.includes("ui-ux-pro-max")), "ui-ux-pro-max no está instalada: no se nombra");
    }
    // deshabilitado el plugin: frontend-design sale; sin nada que cargar, no hay línea
    writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "frontend-design@x": false } }));
    assert.deepEqual(skillsDisenoInstaladas(pa.home), ["taste-skill"]);
    writeFileSync(path.join(claude, "settings.json"), "{ roto");
    assert.deepEqual(skillsDisenoInstaladas(pa.home), ["taste-skill"]);
    // otros tipos, --leer y otro motor: nada
    assert.doesNotMatch(contratoClaude(pa, corrida(raiz, { tipo: "codigo-acotado" })), /herramienta Skill/);
    assert.doesNotMatch(contratoClaude(pa, corrida(raiz, { tipo: "frontend", leer: true })), /herramienta Skill/);
    assert.doesNotMatch(contratoClaude(pa, corrida(raiz, { tipo: "frontend", motor: "agy" })), /herramienta Skill/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("settings en Windows: hooks .mjs con node y el deny del espejo", () => {
  const pa = paFalso("C:\\Users\\x", "win32");
  pa.home = "C:\\Users\\x";
  pa.bin = "C:\\trama\\app\\motor\\bin";
  const s = JSON.parse(settingsWorker(pa, { hb: "C:\\estado\\demo.heartbeat", leer: true, espejo: "C:\\Users\\x\\estado\\espejos\\1\\t.test.ts", node: "C:\\trama\\node\\node.exe" }));
  const cmds = [s.hooks.PreToolUse[0].hooks[0].command, s.hooks.PreToolUse[1].hooks[0].command, s.hooks.PostToolUse[0].hooks[0].command] as string[];
  assert.ok(cmds.every((c) => c.startsWith("C:/trama/node/node.exe '") && !c.includes("bash") && !c.includes(".sh'")), cmds.join("\n"));
  assert.match(cmds[1]!, /latido\.mjs' 'C:\/estado\/demo\.heartbeat' pre leer$/);
  assert.equal(s.permissions.deny.length, 3);
});

test("al_salir: .ultimo con el lock, .listo sólo en async, y el rastro vivo se borra", async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-salir-"));
  for (const [o, ultimo, listo] of [
    [{ async: false }, true, false],
    [{ async: true }, true, true],
    [{ async: true, leer: true, tengoLock: false, puesto: "" }, false, true],
  ] as [Partial<Corrida>, boolean, boolean][]) {
    const pa = paFalso(raiz);
    const l = armarLanzamiento(pa, corrida(raiz, o));
    mkdirSync(l.dir, { recursive: true });
    writeFileSync(l.run, "pid=\n");
    writeFileSync(l.ult, "del que escribe\n");
    const listoF = path.join(l.dir, `${l.c.ts}.listo`);
    await alSalir(l, 78);
    const esperado = `salida=${l.out}\nrc=78\nsid=${l.c.sid}\n`;
    assert.equal(readFileSync(l.ult, "utf8"), ultimo ? esperado : "del que escribe\n");
    assert.equal(existsSync(listoF), listo);
    if (listo) assert.equal(readFileSync(listoF, "utf8"), esperado);
    assert.equal(existsSync(l.run), false);
    rmSync(listoF, { force: true });
  }
});

test("MCP: el worker va sin MCP por defecto (escritores y --leer); --mcp se los devuelve", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-mcp-"));
  const pa = paFalso(raiz);
  const estricto = (a: string[]) => a.includes("--strict-mcp-config") && a.includes("--mcp-config");
  for (const [o, sin] of [
    [{}, true],
    [{ conMcp: true }, false],
    [{ leer: true }, true],
    [{ leer: true, conMcp: true }, false],
  ] as [Partial<Corrida>, boolean][]) {
    const l = armarLanzamiento(pa, corrida(raiz, o));
    assert.equal(estricto(l.args), sin, JSON.stringify(o));
    assert.equal(estricto(argsCierre(pa, l.c, { contrato: "k", settings: "{}", nombre: "n", sid: l.c.sid })), sin, `cierre ${JSON.stringify(o)}`);
  }
});

test("argv: sin subagentes, sin comandos de slash (salvo diseño), y las secciones de la máquina fuera del system prompt", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-argv-"));
  const pa = paFalso(raiz);
  const o = { contrato: "k", settings: "{}", nombre: "n" };
  const escritor = argsClaude(pa, corrida(raiz), o);
  assert.ok(escritor.includes("--disallowedTools"), "el escritor no lanza subagentes");
  const apagadas = (a: string[]) => a[a.indexOf("--disallowedTools") + 1].split(",");
  // La lista queda fija: sólo herramientas que los workers no usan (medido en transcripts), nunca las de trabajo ni Skill ni la web.
  assert.deepEqual(apagadas(escritor), [
    "Agent", "Workflow", "CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "RemoteTrigger",
    "EnterWorktree", "ExitWorktree", "NotebookEdit", "DesignSync", "ReportFindings", "TodoWrite",
  ]);
  for (const t of ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "Skill", "ToolSearch", "SendMessage", "Monitor", "TaskStop", "WebFetch", "WebSearch"])
    assert.ok(!apagadas(escritor).includes(t), `no se baja ${t}`);
  assert.ok(escritor.includes("--disable-slash-commands"), "sin comandos de slash");
  assert.ok(escritor.includes("--exclude-dynamic-system-prompt-sections"), "las secciones de la máquina salen del system prompt");
  // un --leer tampoco usa subagentes ni comandos de slash
  const lector = argsClaude(pa, corrida(raiz, { leer: true }), o);
  assert.ok(lector.includes("--disable-slash-commands"));
  assert.ok(!lector.includes("--disallowedTools"), "un --leer no lanza subagentes de todas formas");
  // el worker de diseño carga las skills: no se le apagan los comandos
  for (const tipo of ["frontend", "diseno"]) {
    const a = argsClaude(pa, corrida(raiz, { tipo }), o);
    assert.ok(!a.includes("--disable-slash-commands"), tipo);
    assert.ok(a.includes("--disallowedTools"), tipo);
  }
  // el cierre: mismo criterio
  const cierre = argsCierre(pa, corrida(raiz), { contrato: "k", settings: "{}", nombre: "n", sid: "x" });
  assert.ok(cierre.includes("--disable-slash-commands"));
  assert.equal(apagadas(cierre).join(","), apagadas(escritor).join(","), "el cierre apaga lo mismo");
  assert.ok(!apagadas(argsClaude(pa, corrida(raiz, { tipo: "frontend" }), o)).includes("Skill"), "frontend conserva Skill");
});

test("el system prompt es idéntico entre corridas y lo que cambia va al final del prompt", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-contrato-"));
  const pa = paFalso(raiz);
  const c1 = corrida(raiz, { rama: "pa/demo/1", rutaTrabajo: path.join(raiz, "wt1"), usaWorktree: true, paralelos: "- 20260101-000000-2 (puesto 2): otra cosa" });
  const c2 = corrida(raiz, { rama: "pa/demo/2", rutaTrabajo: path.join(raiz, "wt2"), usaWorktree: true, jefe: "otro-jefe" });
  const k1 = contratoClaude(pa, c1);
  const k2 = contratoClaude(pa, c2);
  assert.equal(k1, k2, "el system prompt no cambia entre corridas");
  assert.ok(!k1.includes("wt1"), "el worktree no está en el system prompt");
  assert.ok(!k1.includes("pa/demo/1"), "la rama no está en el system prompt");
  const p1 = promptDe(pa, c1);
  assert.ok(p1.includes("wt1"), "el worktree va en el prompt");
  assert.ok(p1.includes("pa/demo/1"), "la rama va en el prompt");
  assert.ok(p1.includes("20260101-000000-2"), "los otros writers van en el prompt");
  assert.ok(promptDe(pa, c2).includes("otro-jefe"), "el jefe va en el prompt");
  assert.ok(p1.trimEnd().endsWith("se resuelve al integrar."), "el bloque variable va al final del prompt");
});

test("PA_RECORTE: 150 en plan pro y 300 en max", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-recorte-"));
  const pa = paFalso(raiz);
  assert.equal(envDeLaLlamada(pa, corrida(raiz)).PA_RECORTE, "150");
  assert.equal(envDeLaLlamada({ ...pa, plan: "max" }, corrida(raiz)).PA_RECORTE, "300");
  assert.equal(envDeLaLlamada({ ...pa, plan: "max", env: { ...pa.env, PA_RECORTE: "42" } }, corrida(raiz)).PA_RECORTE, "42");
});

test("la guardia: si el settings del usuario ya la tiene, la nuestra no se registra (corre una vez por Bash)", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-guard-"));
  const pa = paFalso(raiz);
  const conGuard = (c: Corrida) => JSON.parse(settingsWorker(pa, { hb: "/e/hb", leer: false, configClaude: configClaudeDe(pa, c) })).hooks.PreToolUse as { matcher?: string; hooks: { command: string }[] }[];
  const sinGuard = conGuard(corrida(raiz));
  assert.ok(sinGuard.some((g) => g.matcher === "Bash" && /destructive-guard/.test(g.hooks[0]!.command)), "sin el del usuario, el nuestro");
  // el usuario tiene uno en su settings.json: no se registra el nuestro
  const claude = path.join(pa.home, ".claude");
  mkdirSync(claude, { recursive: true });
  writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash '/home/x/.claude/hooks/destructive-guard.sh'" }] }] } }));
  const conOtro = conGuard(corrida(raiz));
  assert.ok(!conOtro.some((g) => /destructive-guard/.test(g.hooks[0]?.command ?? "")), "el del usuario alcanza");
  assert.ok(conOtro.some((g) => /latido/.test(g.hooks[0]?.command ?? "")), "el latido sigue");
});

test("MCP: la búsqueda diferida de herramientas queda activa en el worker, salvo que el usuario fije la suya", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-tool-search-"));
  const pa = paFalso(raiz);
  assert.equal(envDeLaLlamada(pa, corrida(raiz)).ENABLE_TOOL_SEARCH, "true");
  assert.equal(envDeLaLlamada({ ...pa, env: { ...pa.env, ENABLE_TOOL_SEARCH: "false" } }, corrida(raiz)).ENABLE_TOOL_SEARCH, undefined);
});

test("agyResetHasta: «Resets in 149h» / «6d 5h 3m» y lo mismo que el agy_reset_epoch del bash", async () => {
  const { agyResetHasta, agySinCupo } = await import("../electron/cli/pa/cupo.ts");
  assert.equal(agyResetHasta("RESOURCE_EXHAUSTED. Resets in 149h", 1000), 1000 + 149 * 3600);
  assert.equal(agyResetHasta("quota reached, resets after 6d 5h 3m.", 0), 6 * 86400 + 5 * 3600 + 3 * 60);
  assert.equal(agyResetHasta("RESOURCE_EXHAUSTED sin hora", 0), null);
  assert.ok(agySinCupo("Individual quota reached") && agySinCupo("HTTP 429 Too Many") && !agySinCupo("error 4290"));
});

test("herramientas: un --leer puede buscar en internet (WebSearch/WebFetch) sin poder escribir; un escritor no restringe herramientas", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "lanzar-web-"));
  const pa = paFalso(raiz);
  const o = { contrato: "k", settings: "{}", nombre: "n" };
  const tools = (a: string[]) => a[a.indexOf("--tools") + 1]?.split(",");
  const leer = tools(argsClaude(pa, corrida(raiz, { leer: true }), o));
  assert.ok(leer, "--leer lleva --tools");
  for (const t of ["WebSearch", "WebFetch", "Read", "Grep", "Bash"]) assert.ok(leer.includes(t), t);
  for (const t of ["Edit", "Write", "NotebookEdit"]) assert.ok(!leer.includes(t), `--leer no debe tener ${t}`);
  // Un escritor no pasa --tools (tiene todas las de claude, web incluida) ni las baja con --disallowedTools.
  const esc = argsClaude(pa, corrida(raiz), o);
  assert.equal(esc.includes("--tools"), false);
  assert.ok(!esc.join(" ").match(/--disallowedTools\s+\S*Web/));
  // El contrato de --leer le avisa que tiene la web y que no es por curl.
  assert.match(contratoClaude(pa, corrida(raiz, { leer: true })), /WebSearch y WebFetch/);
  // El bash (respaldo en Linux) pasa la misma lista.
  assert.ok(readFileSync(PA, "utf8").includes(`--tools "${leer.join(",")}"`), "motor/bin/pa debe pasar la misma lista");
});
