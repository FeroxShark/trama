// La terminal de los agentes en Windows: PowerShell por defecto (la variable y la línea del prompt de sistema), Git Bash
// como alternativa, y nada de eso fuera de Windows. Con la plataforma inyectada: corre igual en Linux.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { argvLider } from "../electron/lider-arma.ts";
import { envTerminalAgentes, esTerminalAgentes, LINEA_CACHE, LINEA_CHAT, lineaCache, LINEA_POWERSHELL, lineaChat, lineaSistemaLider, lineaTerminalAgentes, TERMINAL_AGENTES_DEFAULT } from "../electron/terminal-agentes.ts";

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

test("lineaSistemaLider: todo líder sabe cómo poner una imagen en su lugar; en Windows con PowerShell, también lo de la terminal", () => {
  assert.equal(lineaSistemaLider("linux", "powershell"), `${LINEA_CHAT} ${lineaCache("linux")}`);
  assert.match(LINEA_CHAT, /!\[descripción\]\(ruta absoluta/);
  assert.equal(lineaSistemaLider("win32", "powershell"), `${lineaChat("win32")} ${lineaCache("win32")} ${LINEA_POWERSHELL}`);
  assert.equal(lineaSistemaLider("win32", "gitbash"), `${lineaChat("win32")} ${lineaCache("win32")}`);
  assert.ok(!/[\r\n]/.test(lineaSistemaLider("win32", "powershell")), "una línea: en Windows puede pasar por cmd.exe");
});

test("lineaChat: en Linux sigue pidiendo rutas con / o ~/; en Windows, con la unidad (C:\\) o ~\\", () => {
  assert.equal(lineaChat("linux"), LINEA_CHAT);
  assert.match(LINEA_CHAT, /empieza con \/ o ~\//);
  const w = lineaChat("win32");
  assert.doesNotMatch(w, /empieza con \/ o ~\//);
  assert.match(w, /la unidad, como `C:\\Users\\\.\.\.`/);
  assert.match(w, /!\[descripción\]\(ruta absoluta/);
  assert.ok(!/[\r\n]/.test(w), "una línea: en Windows puede pasar por cmd.exe");
});

test("lineaCache: todo líder sabe cómo ahorrar cupo y dónde está la guía para ordenar un proyecto, en una línea y sin %", () => {
  assert.match(LINEA_CACHE, /subagente, 5 min/);
  assert.match(lineaCache("linux"), /`~\/\.claude\/skills\/trama-orquestar\/ordenar-proyecto\.md`/);
  assert.match(lineaCache("win32"), /`~\\\.claude\\skills\\trama-orquestar\\ordenar-proyecto\.md`/);
  for (const plat of ["linux", "win32"]) {
    assert.ok(!/RUTA_GUIA|[\r\n%]/.test(lineaCache(plat)), plat);
  }
  // La guía existe en la skill que se instala en las dos plataformas (motor/skills entero va en el paquete de Windows).
  assert.ok(existsSync(fileURLToPath(new URL("../../motor/skills/trama-orquestar/ordenar-proyecto.md", import.meta.url))));
});
