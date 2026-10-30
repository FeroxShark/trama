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
import { alSalir, armarLanzamiento, contratoClaude, lineaSkillsDiseno, settingsWorker, skillsDisenoInstaladas, type Corrida } from "../electron/cli/pa/lanzar.ts";
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
