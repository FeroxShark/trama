// La terminal de los agentes en Windows: PowerShell por defecto (la variable y la línea del prompt de sistema), Git Bash
// como alternativa, y nada de eso fuera de Windows. Con la plataforma inyectada: corre igual en Linux.
import assert from "node:assert/strict";
import test from "node:test";
import { argvLider } from "../electron/lider-arma.ts";
import { envTerminalAgentes, esTerminalAgentes, LINEA_POWERSHELL, lineaTerminalAgentes, TERMINAL_AGENTES_DEFAULT } from "../electron/terminal-agentes.ts";

const SID = "8f3c2a10-1b2c-4d5e-9f00-112233445566";

test("por defecto es PowerShell y sólo acepta sus dos valores", () => {
  assert.equal(TERMINAL_AGENTES_DEFAULT, "powershell");
  assert.ok(esTerminalAgentes("powershell") && esTerminalAgentes("gitbash"));
  assert.ok(!esTerminalAgentes("bash") && !esTerminalAgentes(undefined));
});

test("Windows con PowerShell: CLAUDE_CODE_USE_POWERSHELL_TOOL=1 y la línea del prompt de sistema", () => {
  assert.deepEqual(envTerminalAgentes("win32", "powershell"), { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" });
  assert.equal(lineaTerminalAgentes("win32", "powershell"), "En Windows usá PowerShell para los comandos, no bash");
  assert.equal(LINEA_POWERSHELL, lineaTerminalAgentes("win32", "powershell"));
});

test("Windows con Git Bash: nada, se queda la terminal de siempre", () => {
  assert.deepEqual(envTerminalAgentes("win32", "gitbash"), {});
  assert.equal(lineaTerminalAgentes("win32", "gitbash"), null);
});

test("Linux no tiene la variable ni la línea, con PowerShell o sin él", () => {
  assert.deepEqual(envTerminalAgentes("linux", "powershell"), {});
  assert.deepEqual(envTerminalAgentes("linux", "gitbash"), {});
  assert.equal(lineaTerminalAgentes("linux", "powershell"), null);
  assert.equal(lineaTerminalAgentes("linux", "gitbash"), null);
  assert.equal(lineaTerminalAgentes("darwin", "powershell"), null);
});

test("argv del líder: la línea va como --append-system-prompt sólo cuando se le pasa", () => {
  const base = { modelo: "claude-sonnet-5-5", effort: "high", sid: SID, nombre: "t", resume: false };
  const linea = lineaTerminalAgentes("win32", "powershell");
  const con = argvLider({ ...base, ...(linea ? { lineaSistema: linea } : {}) });
  const i = con.indexOf("--append-system-prompt");
  assert.ok(i >= 0);
  assert.equal(con[i + 1], LINEA_POWERSHELL);
  const sin = argvLider({ ...base, ...(lineaTerminalAgentes("linux", "powershell") ? { lineaSistema: LINEA_POWERSHELL } : {}) });
  assert.ok(!sin.includes("--append-system-prompt"));
});
