// Los worktrees de los workers de `pa` no son proyectos ni "De Claude Code" (Linux y Windows, rutas inventadas).
import assert from "node:assert/strict";
import test from "node:test";
import { vistaConvs, type ConvListada } from "../electron/claude-code.ts";
import { esWorktreePa, proyectoDeWorktree } from "../electron/worktrees-pa.ts";

test("esWorktreePa: rutas de Linux y de Windows, con /, con \\ y con otra capitalización", () => {
  assert.equal(esWorktreePa("/home/ana/.local/state/pa/worktrees/atlas"), true);
  assert.equal(esWorktreePa("/home/ana/.local/state/pa/worktrees/atlas@2/src"), true);
  assert.equal(esWorktreePa("C:\\Users\\ana\\AppData\\Local\\Trama\\state\\pa\\worktrees\\atlas"), true);
  assert.equal(esWorktreePa("C:\\Users\\ana\\AppData\\Local\\Trama\\state\\pa\\worktrees\\atlas-3\\src"), true);
  assert.equal(esWorktreePa("c:/users/ana/appdata/local/trama/state/PA/Worktrees/atlas"), true);
  assert.equal(esWorktreePa("/home/ana/.local/state/pa/worktrees"), true);
  assert.equal(esWorktreePa("/home/ana/proyectos/atlas"), false);
  assert.equal(esWorktreePa("C:\\Users\\ana\\proyectos\\worktrees\\atlas"), false);
  assert.equal(esWorktreePa("C:\\Users\\ana"), false);
});

test("esWorktreePa: también la carpeta worktrees del estado de pa cuando no se llama pa", () => {
  const w = "D:\\datos\\trama-estado\\worktrees";
  assert.equal(esWorktreePa("D:\\datos\\trama-estado\\worktrees\\atlas-2", [w]), true);
  assert.equal(esWorktreePa("d:\\datos\\Trama-Estado\\worktrees\\atlas", [w]), true);
  assert.equal(esWorktreePa("D:\\datos\\trama-estado\\worktrees-viejos\\atlas", [w]), false);
  assert.equal(esWorktreePa("/srv/estado/worktrees/atlas@3", ["/srv/estado/worktrees"]), true);
  assert.equal(esWorktreePa("/srv/estado/otra/atlas", ["/srv/estado/worktrees"]), false);
});

test("proyectoDeWorktree: el proyecto real por el nombre del worktree", () => {
  assert.equal(proyectoDeWorktree("/home/ana/.local/state/pa/worktrees/atlas"), "atlas");
  assert.equal(proyectoDeWorktree("/home/ana/.local/state/pa/worktrees/atlas@2/src"), "atlas");
  assert.equal(proyectoDeWorktree("C:\\Users\\ana\\AppData\\Local\\Trama\\state\\pa\\worktrees\\Atlas-12\\app"), "atlas");
  assert.equal(proyectoDeWorktree("C:\\Users\\ana\\atlas"), null);
});

const c = (n: number, cwd: string): ConvListada => ({ sid: `0000000${n}-0000-4000-8000-000000000000`, titulo: `t${n}`, ms: n, modelo: null, cwd, ajena: false });

test("vistaConvs en Windows: los workers no salen, la carpeta personal se reconoce aunque cambien las mayúsculas y el proyecto es el de la ruta más larga", async () => {
  const casa = "C:\\Users\\ana";
  const convs = [
    c(1, "C:\\Users\\ana"),
    c(2, "c:\\users\\ANA"),
    c(3, "C:\\Users\\ana\\proyectos\\atlas\\src"),
    c(4, "C:\\Users\\ana\\AppData\\Local\\Trama\\state\\pa\\worktrees\\atlas"),
    c(5, "C:\\Users\\ana\\AppData\\Local\\Trama\\state\\pa\\worktrees\\atlas-2"),
    c(6, "D:\\datos\\estado\\worktrees\\duna"),
    c(7, "C:\\Users\\ana\\proyectos\\atlas-viejo"),
  ];
  const r = await vistaConvs(convs, {
    excluidas: new Set(),
    rutas: [["C:\\Users\\ana\\Proyectos\\Atlas", "atlas"]],
    casa,
    real: async (p) => p,
    existe: async () => true,
    worktrees: ["D:\\datos\\estado\\worktrees"],
    plat: "win32",
  });
  assert.deepEqual(r.map((v) => [v.sid.slice(7, 8), v.proyecto]), [
    ["1", "general"],
    ["2", "general"],
    ["3", "atlas"],
    ["7", null],
  ]);
});

test("vistaConvs en Linux: los workers no salen, ni siquiera con el estado de pa en otra carpeta", async () => {
  const convs = [c(1, "/home/ana"), c(2, "/home/ana/.local/state/pa/worktrees/atlas@2"), c(3, "/srv/estado/worktrees/duna"), c(4, "/home/ana/proyectos/atlas")];
  const r = await vistaConvs(convs, {
    excluidas: new Set(),
    rutas: [["/home/ana/proyectos/atlas", "atlas"]],
    casa: "/home/ana",
    real: async (p) => p,
    existe: async () => true,
    worktrees: ["/srv/estado/worktrees"],
    plat: "linux",
  });
  assert.deepEqual(r.map((v) => [v.sid.slice(7, 8), v.proyecto]), [["1", "general"], ["4", "atlas"]]);
});
