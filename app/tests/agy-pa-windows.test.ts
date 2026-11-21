// Filtro de privacidad de motor/hooks/agy-pa.mjs en Windows (win32 inyectado por PA_AGY_PLAT): rutas C:\...,
// barras mezcladas (C:/Users/...), %USERPROFILE% y raíces sensibles de Windows.
// Todo con rutas literales de Windows y el usuario ficticio trama-falso (docs/reglas/tests.md).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOOK = path.join(import.meta.dirname, "..", "..", "motor", "hooks", "agy-pa.mjs");
const CASA = "C:\\Users\\trama-falso";
const RAIZ = `${CASA}\\proyecto`;
const TEMP_WIN = `${CASA}\\AppData\\Local\\Temp`;
const PPAL = "D:\\repos\\principal";
const MAPA = `${CASA}\\AppData\\Local\\trama\\mapa\\proy.md`;

function conWorkerWin(
  f: (pre: (nombre: string, args: Record<string, unknown>, extra?: Record<string, string>) => { decision?: string; reason?: string } | null) => void,
  raiz = RAIZ,
) {
  const dir = mkdtempSync(path.join(tmpdir(), "trama-agy-win-"));
  try {
    const base: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|CLAUDE|LOCALAPPDATA|APPDATA|TMPDIR)/.test(k)) base[k] = v;
    const env: NodeJS.ProcessEnv = {
      ...base,
      HOME: CASA,
      USERPROFILE: CASA,
      LOCALAPPDATA: `${CASA}\\AppData\\Local`,
      APPDATA: `${CASA}\\AppData\\Roaming`,
      TEMP: TEMP_WIN,
      TMP: TEMP_WIN,
      PA_AGY_PLAT: "win32",
      PA_STATE: path.join(dir, "estado"),
      PA_AGY_HB: path.join(dir, "hb"),
      PA_AGY_RAIZ: raiz,
      PA_AGY_PPAL: PPAL,
      PA_AGY_MAPA: MAPA,
      PA_AGY_RAMA: "rama-x",
      PA_MAX_TURNS: "30",
    };
    f((nombre, args, extra = {}) => {
      const input = JSON.stringify({ toolCall: { name: nombre, args } });
      const r = spawnSync(process.execPath, [HOOK, "pre"], { input, encoding: "utf8", env: { ...env, ...extra } });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout ? JSON.parse(r.stdout) : null;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("win32: una ruta dentro del worktree no se bloquea en read_file, write_file, edit_file ni en comandos", () => {
  conWorkerWin((pre) => {
    const dentro = `${RAIZ}\\src\\a.ts`;
    assert.equal(pre("read_file", { Path: dentro }), null);
    assert.equal(pre("write_file", { Path: dentro }), null);
    assert.equal(pre("edit_file", { Path: dentro }), null);
    assert.equal(pre("view_file", { AbsolutePath: dentro }), null);
    assert.equal(pre("write_to_file", { TargetFile: dentro, CodeContent: "x" }), null);
    assert.equal(pre("replace_file_content", { TargetFile: dentro }), null);
    assert.equal(pre("list_dir", { DirectoryPath: `${RAIZ}\\src` }), null);
    assert.equal(pre("grep_search", { SearchPath: `${RAIZ}\\src`, Query: "x" }), null);
    assert.equal(pre("find_by_name", { SearchDirectory: `${RAIZ}\\src`, Pattern: "*.ts" }), null);
    // relativas e insensibles a mayúsculas
    assert.equal(pre("read_file", { Path: "src\\a.ts" }), null);
    assert.equal(pre("read_file", { Path: "c:\\users\\trama-falso\\proyecto\\src\\a.ts" }), null);
    assert.equal(pre("write_file", { Path: "c:\\users\\TRAMA-FALSO\\proyecto\\src\\a.ts" }), null);
    assert.equal(pre("edit_file", { Path: "c:/users/trama-falso/proyecto/src/a.ts" }), null);
    // comandos, Cwd, glob dentro del worktree, TEMP y mapa
    assert.equal(pre("run_command", { CommandLine: `type ${dentro}` }), null);
    assert.equal(pre("run_command", { CommandLine: `node "${dentro}"` }), null);
    assert.equal(pre("bash", { CommandLine: `cat "${dentro}"` }), null);
    assert.equal(pre("run_command", { CommandLine: `dir ${RAIZ}\\src\\*.ts` }), null);
    assert.equal(pre("run_command", { CommandLine: `cd /d ${RAIZ} && dir` }), null);
    assert.equal(pre("run_command", { CommandLine: "dir", Cwd: `${RAIZ}\\src` }), null);
    assert.equal(pre("write_file", { Path: `${TEMP_WIN}\\out.txt` }), null);
    assert.equal(pre("write_file", { Path: "%TEMP%\\out.txt" }), null);
    assert.equal(pre("write_file", { Path: MAPA }), null);
  });
});

test("win32: rutas fuera del worktree (.ssh, otra carpeta del usuario, sistema, raíz, UNC y ..\\) se bloquean", () => {
  conWorkerWin((pre) => {
    const ssh = `${CASA}\\.ssh\\id_rsa`;
    const otraUsuario = `${CASA}\\Documentos\\secreto.txt`;
    const otroProy = `${CASA}\\Proyectos\\trama\\a.ts`;
    const otroUsuarioMaq = "C:\\Users\\otro\\secreto.txt";
    const hosts = "C:\\Windows\\System32\\drivers\\etc\\hosts";
    const progData = "C:\\ProgramData\\trama\\secreto.json";
    const unc = "\\\\servidor\\compartido\\secreto.txt";

    for (const p of [ssh, otraUsuario, otroProy, otroUsuarioMaq, hosts, progData, unc, "..\\.ssh\\id_rsa", `${RAIZ}\\..\\.ssh\\id_rsa`]) {
      assert.match(pre("read_file", { Path: p })?.reason ?? "", /privacidad/, `read_file ${p}`);
      assert.match(pre("write_file", { Path: p })?.reason ?? "", /privacidad|fuera de tu worktree/, `write_file ${p}`);
      assert.match(pre("edit_file", { Path: p })?.reason ?? "", /privacidad|fuera de tu worktree/, `edit_file ${p}`);
    }
    assert.match(pre("write_file", { Path: "D:\\otro\\a.ts" })?.reason ?? "", /fuera de tu worktree/);
    assert.match(pre("edit_file", { Path: "D:\\otro\\a.ts" })?.reason ?? "", /fuera de tu worktree/);

    for (const cmd of [
      `type ${ssh}`,
      `type "${otraUsuario}"`,
      `cat ${otroProy}`,
      `type ${otroUsuarioMaq}`,
      `type ${hosts}`,
      `type ${progData}`,
      `dir ${unc}`,
      "dir C:\\",
      "type ..\\.ssh\\id_rsa",
      `type ${RAIZ}\\..\\.ssh\\id_rsa`,
      `dir ${CASA}\\*`,
      `dir ${RAIZ}\\..\\*`,
      "dir C:\\Win*",
      "dir C:\\*",
      "type ~\\.ssh\\id_rsa",
      "type $HOME\\.ssh\\id_rsa",
      "Get-Content $env:USERPROFILE\\.ssh\\id_rsa",
      "type %LOCALAPPDATA%\\trama\\claves.env",
    ]) {
      assert.match(pre("run_command", { CommandLine: cmd })?.reason ?? "", /privacidad/, cmd);
    }
    assert.match(pre("bash", { CommandLine: `cat ${ssh}` })?.reason ?? "", /privacidad/);
    assert.match(pre("run_command", { CommandLine: "type %LOCALAPPDATA%\\trama\\claves.env" }, { LOCALAPPDATA: "" })?.reason ?? "", /privacidad/);
    assert.match(pre("run_command", { CommandLine: "dir", Cwd: `${CASA}\\.ssh` })?.reason ?? "", /privacidad/);
    assert.match(pre("run_command", { CommandLine: `cd ${PPAL}` })?.reason ?? "", /tree principal/);
    assert.match(pre("run_command", { CommandLine: `cd /d ${PPAL.replaceAll("\\", "/")}` })?.reason ?? "", /tree principal/);
  });
});

test("win32: %USERPROFILE% y barras mezcladas (C:/Users/...) se tratan igual que C:\\Users\\...", () => {
  conWorkerWin((pre) => {
    const dentroVar = "%USERPROFILE%\\proyecto\\src\\a.ts";
    const dentroVarMin = "%userprofile%/proyecto/src/a.ts";
    const dentroBarra = "C:/Users/trama-falso/proyecto/src/a.ts";
    const dentroMezcla = "C:\\Users\\trama-falso/proyecto\\src/a.ts";
    for (const p of [dentroVar, dentroVarMin, dentroBarra, dentroMezcla]) {
      assert.equal(pre("read_file", { Path: p }), null, `read_file ${p}`);
      assert.equal(pre("write_file", { Path: p }), null, `write_file ${p}`);
      assert.equal(pre("edit_file", { Path: p }), null, `edit_file ${p}`);
      assert.equal(pre("run_command", { CommandLine: `type "${p}"` }), null, `cmd ${p}`);
    }

    const fueraVar = "%USERPROFILE%\\.ssh\\id_rsa";
    const fueraVarOtro = "%userprofile%/Documentos/secreto.txt";
    const fueraBarra = "C:/Users/trama-falso/.ssh/id_rsa";
    const fueraMezcla = "C:\\Users\\trama-falso/Proyectos\\otro/a.ts";
    for (const p of [fueraVar, fueraVarOtro, fueraBarra, fueraMezcla]) {
      assert.match(pre("read_file", { Path: p })?.reason ?? "", /privacidad/, `read_file ${p}`);
      assert.match(pre("write_file", { Path: p })?.reason ?? "", /privacidad|fuera de tu worktree/, `write_file ${p}`);
      assert.match(pre("edit_file", { Path: p })?.reason ?? "", /privacidad|fuera de tu worktree/, `edit_file ${p}`);
      assert.match(pre("run_command", { CommandLine: `type "${p}"` })?.reason ?? "", /privacidad/, `cmd ${p}`);
    }
    assert.match(pre("run_command", { CommandLine: "dir %USERPROFILE%" })?.reason ?? "", /privacidad/);
    assert.match(pre("run_command", { CommandLine: "dir", Cwd: "%USERPROFILE%\\.ssh" })?.reason ?? "", /privacidad/);
  });

  // También si PA_AGY_RAIZ viene con barras `/` mientras el modelo usa `\` (y al revés)
  conWorkerWin((pre) => {
    assert.equal(pre("read_file", { Path: `${RAIZ}\\src\\a.ts` }), null);
    assert.equal(pre("write_file", { Path: `${RAIZ}\\src\\a.ts` }), null);
    assert.equal(pre("edit_file", { Path: `${RAIZ}\\src\\a.ts` }), null);
    assert.match(pre("read_file", { Path: `${CASA}\\.ssh\\id_rsa` })?.reason ?? "", /privacidad/);
  }, RAIZ.replaceAll("\\", "/"));
});

test("win32: mensajes de commit, URLs, objetos JS y comillas no dan falsos positivos; red (.exe) sigue bloqueada", () => {
  conWorkerWin((pre) => {
    assert.equal(pre("run_command", { CommandLine: `git commit -m "arregla ${CASA}\\.ssh y %USERPROFILE%"` }), null);
    assert.equal(pre("run_command", { CommandLine: 'echo "https://ejemplo.com/a/b"' }), null);
    assert.equal(pre("run_command", { CommandLine: 'node -e "const o = {c: 1}; console.log(o)"' }), null);
    assert.equal(pre("run_command", { CommandLine: 'echo "\\\\"' }), null);
    assert.match(pre("run_command", { CommandLine: "dir \\" })?.reason ?? "", /privacidad/);
    assert.match(pre("run_command", { CommandLine: "curl.exe https://ejemplo.com" })?.reason ?? "", /sin red/);
  });
});
