// Rutas y textos de Windows contra Linux (CTX-52, 55, 58, 59, 60, 61 del análisis de contexto): con `plat: "win32"` y rutas `path.win32`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nombreDueno, type Pa } from "../electron/cli/pa/entorno.ts";
import { carpetaProyectos, denyEspejo, mapaDe } from "../electron/cli/pa/lanzar.ts";
import { mismaCarpeta } from "../electron/cli/pa/hilos.ts";
import { carpetaProyectosClaude } from "../electron/cli/pa/worktrees.ts";
import { excluida } from "../electron/contexto-desglose.ts";
import { claudeDe, hooksDeArranque, memoriaDe, skillOrquestar } from "../electron/contexto-local.ts";
import { afueraEn } from "../electron/cli/pa/motores/privacidad.ts";
import { chequearDsh, chequearOpencode } from "../electron/cli/pa/motores/chequeo.ts";
import { promptOtroMotor } from "../electron/cli/pa/motores/prompt.ts";
import { leccionesBloque } from "../electron/cli/pa/lecciones.ts";
import { testsRegistry } from "../electron/cli/pa/ramas.ts";
import { Tablero } from "../electron/cli/tablero.ts";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "win-ctx-"));
const HOME_W = "C:\\Users\\Ana";
const ENV_W = { USERPROFILE: HOME_W, LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" };
const CONFIG_W = "C:\\Users\\Ana\\AppData\\Local\\trama\\config";

test("CTX-52: mapaDe en Windows cuelga de la carpeta de configuración de Trama (%LOCALAPPDATA%), no de ~/.config", () => {
  const pa = { env: ENV_W, home: HOME_W, plat: "win32" } as unknown as Pa;
  assert.equal(mapaDe(pa, "demo"), `${CONFIG_W}\\mapa\\demo.md`);
  assert.equal(mapaDe({ ...pa, env: { ...ENV_W, PA_MAPA_DIR: "D:\\m" } } as unknown as Pa, "demo"), "D:\\m\\demo.md");
  // Linux no cambia (con y sin XDG_CONFIG_HOME)
  const pl = (env: Record<string, string>) => ({ env, home: "/home/ana", plat: "linux" }) as unknown as Pa;
  assert.equal(mapaDe(pl({}), "demo"), "/home/ana/.config/trama/mapa/demo.md");
  assert.equal(mapaDe(pl({ XDG_CONFIG_HOME: "/x" }), "demo"), "/x/trama/mapa/demo.md");
});

test("CTX-52: nombreDueno en Windows lee perfil.json de %LOCALAPPDATA%\\trama\\config", () => {
  // el perfil real de Windows no existe en este disco: la ruta que busca se ve por el TRAMA_PERFIL ausente → cae al usuario
  assert.equal(nombreDueno({ ...ENV_W, USERNAME: "ana" }, HOME_W, "win32"), "Ana");
  // y con TRAMA_PERFIL manda ese archivo
  const d = tmp();
  const f = path.join(d, "perfil.json");
  writeFileSync(f, JSON.stringify({ version: 1, dueno: "Lucía" }));
  assert.equal(nombreDueno({ ...ENV_W, TRAMA_PERFIL: f }, HOME_W, "win32"), "Lucía");
  rmSync(d, { recursive: true, force: true });
});

test("CTX-61: el Tablero en Windows busca el perfil en configTrama (LOCALAPPDATA), el de Linux en ~/.config/trama", () => {
  const io = { out: () => {}, err: () => {} };
  const w = new Tablero({ ...ENV_W, USERNAME: "bruno" }, io as never, () => "", "win32");
  assert.equal(w.home, HOME_W);
  assert.equal(w.dueno, "Bruno"); // sin perfil: el usuario (y no un ~/.config de Linux)
  // Linux: el perfil de ~/.config/trama/perfil.json (XDG_CONFIG_HOME lo mueve)
  const d = tmp();
  mkdirSync(path.join(d, "trama"), { recursive: true });
  writeFileSync(path.join(d, "trama", "perfil.json"), JSON.stringify({ dueno: "Carla" }));
  const l = new Tablero({ HOME: "/home/x", XDG_CONFIG_HOME: d }, io as never, () => "", "linux");
  assert.equal(l.dueno, "Carla");
  rmSync(d, { recursive: true, force: true });
});

test("CTX-55: el deny de --espejo en Windows usa rutas de Windows y cubre PowerShell; el de Linux no cambia", () => {
  const dw = denyEspejo("C:\\Users\\Ana\\proy\\espejos\\1\\x.md", HOME_W, "win32");
  assert.ok(dw.includes("Read(//c/Users/Ana/proy/espejos/1/**)"), dw.join(" | "));
  assert.ok(dw.some((r) => r.startsWith("PowerShell(*") && r.includes("C:\\Users\\Ana\\proy\\espejos\\1")));
  assert.ok(dw.some((r) => r.startsWith("Bash(*") && r.includes("C:/Users/Ana/proy/espejos/1")));
  assert.ok(dw.some((r) => r.includes("~/proy/espejos/1")), "la forma con ~ también");
  assert.deepEqual(denyEspejo("/home/ana/p/espejos/1/x.md", "/home/ana", "linux"), ["Read(//home/ana/p/espejos/1/**)", "Bash(*/home/ana/p/espejos/1*)", "Bash(*~/p/espejos/1*)"]);
});

test("CTX-55: privacidad detecta rutas de Windows fuera del proyecto y deja pasar las de adentro (sin mayúsculas ni barras)", () => {
  const proy = "C:\\Users\\Ana\\proy";
  assert.match(afueraEn("leé C:\\Users\\Ana\\.ssh\\config", proy, HOME_W), /una ruta fuera del proyecto: C:\\Users\\Ana\\.ssh\\config/);
  assert.match(afueraEn("mirá \\\\srv\\share\\datos.csv", proy, HOME_W), /fuera del proyecto: \\\\srv\\share/);
  assert.match(afueraEn("mirá %APPDATA%\\x", proy, HOME_W), /fuera del proyecto: %APPDATA%\\x/);
  assert.match(afueraEn("mirá D:/datos/a.txt", proy, HOME_W), /fuera del proyecto: D:\/datos\/a.txt/);
  assert.equal(afueraEn("tocá c:/users/ana/PROY/src/a.ts y C:\\Users\\Ana\\proy", proy, HOME_W), "");
  assert.match(afueraEn("tocá C:\\Users\\Ana\\proy-otro\\a.ts", proy, HOME_W), /fuera del proyecto/);
  // con un proyecto de Linux, el texto con una ruta de Windows no cambia (paridad con el bash)
  assert.equal(afueraEn("tocá C:\\Users\\Ana\\x", "/home/ana/p", "/home/ana"), "");
});

test("CTX-58: dsh y opencode en Windows no piden node en el PATH (Trama corre los runners con el suyo)", async () => {
  const env = { ...ENV_W, PATH: "" };
  const d = { proyecto: "demo", tarea: "x", env, plat: "win32" as const };
  assert.doesNotMatch(chequearOpencode("opencode:opencode/big-pickle", d), /node no está/);
  assert.doesNotMatch(await chequearDsh("dsh:deepseek/x", d), /node no está/);
});

test("CTX-59: los CLAUDE.md y lecciones.md con CRLF llegan al prompt sin \\r", () => {
  const d = tmp();
  const md = path.join(d, "CLAUDE.md");
  writeFileSync(md, "# Reglas\r\n- una\r\n- dos\r\n");
  const p = promptOtroMotor({ contrato: "C", mds: [md], carpetas: [], tarea: "T", env: {}, io: { err: () => {} } });
  assert.doesNotMatch(p, /\r/);
  assert.match(p, /- una\n- dos/);
  writeFileSync(path.join(d, "lecciones.md"), "- 2026-11-01 uno\r\n- 2026-11-02 dos\r\n");
  const b = leccionesBloque(d);
  assert.doesNotMatch(b, /\r/);
  assert.match(b, /- 2026-11-01 uno\n- 2026-11-02 dos$/);
  rmSync(d, { recursive: true, force: true });
});

test("CTX-60: el comando de tests del registry puede ser por plataforma (tests_windows / tests_linux), con `tests` de respaldo", () => {
  const d = tmp();
  const proy = path.join(d, "proy");
  mkdirSync(proy);
  const reg = path.join(d, "registry.json");
  const escribir = (extra: Record<string, string>) => writeFileSync(reg, JSON.stringify({ projects: [{ name: "proy", path: proy, tests: "npm test", ...extra }] }));
  const pa = (plat: "win32" | "linux") => ({ env: { PROYECTOS_REGISTRY: reg }, home: d, plat }) as unknown as Pa;
  const slug = path.basename(proy);
  escribir({});
  assert.equal(testsRegistry(pa("win32"), slug), "npm test");
  assert.equal(testsRegistry(pa("linux"), slug), "npm test");
  escribir({ tests_windows: "node scripts\\t.mjs", tests_linux: "bash ./t.sh" });
  assert.equal(testsRegistry(pa("win32"), slug), "node scripts\\t.mjs");
  assert.equal(testsRegistry(pa("linux"), slug), "bash ./t.sh");
  rmSync(d, { recursive: true, force: true });
});

test("CTX-56: mismaCarpeta en Windows no distingue \\ de /, mayúsculas ni barra final; en Linux sí distingue mayúsculas", () => {
  assert.ok(mismaCarpeta("c:\\Users\\Ana\\proy", "C:/Users/Ana/proy/", "win32"));
  assert.ok(mismaCarpeta("C:\\Users\\Ana\\proy\\", "C:\\users\\ana\\PROY", "win32"));
  assert.ok(!mismaCarpeta("C:\\Users\\Ana\\proy", "C:\\Users\\Ana\\otro", "win32"));
  // el par Linux
  assert.ok(mismaCarpeta("/home/ana/proy/", "/home/ana/proy", "linux"));
  assert.ok(!mismaCarpeta("/home/ana/Proy", "/home/ana/proy", "linux"));
});

test("CTX-56: excluida compara sin mayúsculas en Windows (ruta exacta y glob) y con mayúsculas en Linux", () => {
  assert.ok(excluida("C:\\Users\\Ana\\CLAUDE.md", ["c:/users/ana/claude.md"], "win32"));
  assert.ok(excluida("C:\\Users\\Ana\\proy\\CLAUDE.md", ["c:\\USERS\\*\\proy\\CLAUDE.md"], "win32"));
  assert.ok(!excluida("C:\\Users\\Ana\\proy\\CLAUDE.md", ["c:\\users\\ana\\otro\\*"], "win32"));
  assert.ok(!excluida("/home/Ana/CLAUDE.md", ["/home/ana/claude.md"], "linux"));
  assert.ok(!excluida("/home/Ana/p/CLAUDE.md", ["/home/ana/*/CLAUDE.md"], "linux"));
  assert.ok(excluida("/home/ana/p/CLAUDE.md", ["/home/ana/*/CLAUDE.md"], "linux"));
});

test("CTX-56: la carpeta de configuración de Claude respeta CLAUDE_CONFIG_DIR (proyectos, memoria, hooks de arranque, skill de orquestación)", async () => {
  const pl = (env: Record<string, string>) => ({ env, home: "/home/ana", plat: "linux" }) as unknown as Pa;
  assert.equal(carpetaProyectos(pl({})), "/home/ana/.claude/projects");
  assert.equal(carpetaProyectos(pl({ CLAUDE_CONFIG_DIR: "/cfg/c" })), "/cfg/c/projects");
  assert.equal(carpetaProyectos(pl({ CLAUDE_CONFIG_DIR: "/cfg/c", PA_PROJ: "/p" })), "/p");
  assert.equal(carpetaProyectosClaude(pl({})), "/home/ana/.claude/projects");
  assert.equal(carpetaProyectosClaude(pl({ CLAUDE_CONFIG_DIR: "/cfg/c" })), "/cfg/c/projects");
  // Windows: la misma regla con `path.win32`
  const pw = (env: Record<string, string>) => ({ env, home: HOME_W, plat: "win32" }) as unknown as Pa;
  assert.equal(carpetaProyectosClaude(pw({ CLAUDE_CONFIG_DIR: "D:\\claude" })), "D:\\claude\\projects");
  assert.equal(carpetaProyectosClaude(pw({})), "C:\\Users\\Ana\\.claude\\projects");
  // contexto-local (líderes que no son Claude): lo mismo, con el entorno que se le pasa
  assert.equal(claudeDe("/home/ana"), "/home/ana/.claude");
  assert.equal(claudeDe("/home/ana", { CLAUDE_CONFIG_DIR: "/cfg/c" }), "/cfg/c");
  assert.equal(memoriaDe("/home/ana", "/home/ana", { CLAUDE_CONFIG_DIR: "/cfg/c" }), "/cfg/c/projects/-home-ana/memory/MEMORY.md");
  const leidos: string[] = [];
  await hooksDeArranque("/home/ana", async (r) => (leidos.push(r), null), { CLAUDE_CONFIG_DIR: "/cfg/c" });
  assert.deepEqual(leidos, ["/cfg/c/settings.json"]);
  const d = tmp();
  mkdirSync(path.join(d, "skills", "mi-orquestar"), { recursive: true });
  writeFileSync(path.join(d, "skills", "mi-orquestar", "SKILL.md"), "x");
  assert.equal(await skillOrquestar("/home/ana", { CLAUDE_CONFIG_DIR: d }), "mi-orquestar");
  assert.equal(await skillOrquestar("/home/ana-sin-nada", {}), "trama-orquestar");
  rmSync(d, { recursive: true, force: true });
});
