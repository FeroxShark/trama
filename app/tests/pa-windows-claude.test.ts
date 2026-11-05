/* En Windows nativo, pa, orquesta y lanzar encuentran claude aunque esté fuera del PATH (%USERPROFILE%\.local\bin\claude.exe o %APPDATA%\npm\claude.cmd), y lanzan los .cmd con paraLanzar. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claudeRc, correrClaude, type Lanzamiento } from "../electron/cli/pa/lanzar.ts";
import { main, type Deps } from "../electron/cli/pa/cli.ts";
import type { Pa } from "../electron/cli/pa/entorno.ts";

const HOME = "C:\\Users\\ana";
const LOCAL = "C:\\Users\\ana\\AppData\\Local";
const APPDATA = "C:\\Users\\ana\\AppData\\Roaming";
const WENV1 = "C:\\Windows\\System32;C:\\Program Files\\nodejs";
const WENV = {
  USERPROFILE: HOME,
  LOCALAPPDATA: LOCAL,
  APPDATA,
  Path: WENV1,
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
};

/* Disco falso: compara rutas ignorando mayésculas/miNésculas y normalizando barras. */
const disco = (...archivos: string[]) => {
  const norm = (s: string) => s.toLowerCase().replaceAll("/", "\\");
  const set = new Set(archivos.map(norm));
  return (f: string) => set.has(norm(f));
};

function armarPa(extra: {
  env?: Record<string, string | undefined>;
  esEjecutable?: (f: string) => boolean;
} = {}): Pa {
  return {
    env: { ...WENV, ...(extra.env ?? {}) },
    io: { out: () => {}, err: () => {} },
    plat: "win32",
    home: HOME,
    state: `${LOCAL}\\trama\\estado\\pa`,
    lockdir: `${LOCAL}\\trama\\estado\\pa\\lock`,
    bin: `${LOCAL}\\trama\\bin`,
    plan: "pro",
    autocompact: null,
    puestos: 3,
    tope: 100,
    ramWorkerMb: 1024,
    ramReservaMb: 512,
    ramRecienMin: 10,
    esEjecutable: extra.esEjecutable,
  };
}

test("Windows: claudeRc con claude.exe en %USERPROFILES%\.local\bin fuera del PATH da 81 (resuelto), no 84 (fuera del PATH)", () => {
  const exe = `${HOME}\\.local\\bin\\claude.exe`;
  const pa = armarPa({ esEjecutable: disco(exe) });
  /* Sin el resolvedor, enPath("claude") daba null y conocido existía -> 84 (fuera del PATH).

     Con el resolvedor, claude se encuentra -> no es fallo de PATH, da 81 si falla. */
  assert.equal(claudeRc(pa), 81);
});

test("Windows: claudeRc da 84 cuando claude sólo existe en CLAUDE_CONOCIDO ajeno a .local\bin", () => {
  const conocido = "C:\\Tools\\claude.exe";
  const pa = armarPa({ env: { CLAUDE_CONOCIDO: conocido }, esEjecutable: disco(conocido) });
  assert.equal(claudeRc(pa), 84);
});

test("Windows: correrClaude resuelve claude.exe en %USERPROFILE%\.local\bin y no intenta claude pelado", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-win-claude-"));
  try {
    const exe = `${HOME}\\.local\\bin\\claude.exe`;
    const pa = armarPa({ esEjecutable: disco(exe) });
    const out = path.join(tmp, "out.json");
    const err = path.join(tmp, "out.err");
    const lz = {
      pa,
      c: { rutaTrabajo: tmp, motor: "claude" },
      args: ["--version"],
      out,
      err,
    } as unknown as Lanzamiento;

    const rc = await correrClaude(lz);
    assert.equal(rc, 127);
    const errText = readFileSync(err, "utf8");
    assert.ok(errText.includes(exe), `se esperaba la ruta resuelta en: ${errText}`);
    assert.ok(!errText.includes("pa: no pude lanzar claude:"), "no debe intentar claude pelado");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Windows: correrClaude con npm claude.cmd usa paraLanzar y no intenta claude pelado", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-win-npm-"));
  try {
    const cmd = `${APPDATA}\\npm\\claude.cmd`;
    const pa = armarPa({ esEjecutable: disco(cmd) });
    const out = path.join(tmp, "out.json");
    const err = path.join(tmp, "out.err");
    const lz = {
      pa,
      c: { rutaTrabajo: tmp, motor: "claude" },
      args: ["--version"],
      out,
      err,
    } as unknown as Lanzamiento;

    const rc = await correrClaude(lz);
    assert.equal(rc, 127);
    const errText = readFileSync(err, "utf8");
    assert.ok(errText.includes(cmd), `se esperaba claude.cmd en: ${errText}`);
    assert.ok(!errText.includes("pa: no pude lanzar claude:"), "no debe intentar claude pelado");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Windows: pa CLI detecta claude.exe fuera del PATH para el fallback de dsh (claudeEnPath)", async () => {
  const exe = `${HOME}\\.local\\bin\\claude.exe`;
  let errSalida = "";
  let outSalida = "";
  const io = { out: (s: string) => { outSalida += s; }, err: (s: string) => { errSalida += s; } };

  const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-win-cli-"));
  try {
    const registry = path.join(tmp, "registry.json");
    const proyDir = path.join(tmp, "demo");
    mkdirSync(proyDir, { recursive: true });
    writeFileSync(registry, JSON.stringify({ projects: [{ name: "demo", path: proyDir }] }));

    const env = {
      ...WENV,
      PROYECTOS_REGISTRY: registry,
      PA_STATE: path.join(tmp, "estado"),
      PA_DELEGADO: "1",
    };

    const deps: Deps = {
      plat: "win32",
      esEjecutable: disco(exe),
      motores: {
        chequearDsh: async () => "sin conexión",
      },
      reparto: () => ({
        elegir: async () => ({ rc: 0, salida: JSON.stringify({ modelo: "dsh:deepseek/chat", effort: "high" }) }),
        plan: () => 0,
        ejecutable: () => true,
        ruta: "reparto",
        enfriado: () => 0,
        tabla: async () => "",
      } as any),
      proyecto: {
        matar: async () => 0,
      },
    };

    const rc = await main(["demo", "--tipo", "codigo-acotado", "hacer algo"], env, io, deps);
    assert.ok(errSalida.includes("claude-sonnet-5-5 effort high: sin conexión"), `errSalida: ${errSalida}`);
    assert.notEqual(rc, 95);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
