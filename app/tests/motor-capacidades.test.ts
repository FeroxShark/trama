// La tabla de capacidades por motor (src/hilo/motor-capacidades.ts): cada motor da sí o no para cada capacidad, y cada columna del
// selector cae en su motor. Lo que dice la tabla está en sus comentarios; estos casos sólo cuidan la forma y lo que sí se verificó.
import test from "node:test";
import assert from "node:assert/strict";
import { CAPACIDADES, capacidadesDe, MOTORES, MOTOR_DE_EMPRESA, motorDeEmpresa, type Motor } from "../src/hilo/motor-capacidades.ts";

const MOTORES_CONOCIDOS: Motor[] = ["claude", "agy", "dsh", "opencode", "local"];

test("cada motor tiene un sí o un no para cada una de las cuatro capacidades", () => {
  assert.deepEqual(CAPACIDADES, ["skills", "mcp", "subagentes", "imagenes"]);
  for (const m of MOTORES_CONOCIDOS) {
    assert.deepEqual(Object.keys(MOTORES[m]).sort(), [...CAPACIDADES].sort(), m);
    for (const c of CAPACIDADES) assert.equal(typeof MOTORES[m][c], "boolean", `${m}.${c}`);
  }
});

test("Claude Code trae todo; Gemini (agy) no tiene MCP, lo que AGENTS.md dice que figura como no disponible", () => {
  assert.deepEqual(capacidadesDe("claude"), [["skills", true], ["mcp", true], ["subagentes", true], ["imagenes", true]]);
  assert.equal(MOTORES.agy.mcp, false);
  assert.equal(MOTORES.agy.skills, true, "agy expone las skills de sus plugins (agy-puente.ts)");
});

test("cada columna del selector cae en un motor; una empresa desconocida no cae en ninguno", () => {
  assert.equal(motorDeEmpresa("anthropic"), "claude");
  assert.equal(motorDeEmpresa("google"), "agy");
  assert.equal(motorDeEmpresa("dsh"), "dsh");
  assert.equal(motorDeEmpresa("opencode"), "opencode");
  assert.equal(motorDeEmpresa("local"), "local");
  assert.equal(motorDeEmpresa("ollama"), "local", "Ollama corre por el mismo Claude Code");
  assert.equal(motorDeEmpresa("nadie"), null);
  assert.equal(motorDeEmpresa("constructor"), null, "no toma las propiedades del objeto");
  assert.equal(motorDeEmpresa(null), null);
  for (const m of Object.values(MOTOR_DE_EMPRESA)) assert.ok(MOTORES_CONOCIDOS.includes(m), m);
});
