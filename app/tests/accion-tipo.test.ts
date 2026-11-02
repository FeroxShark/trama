// El mapa de acción → ícono de las pastillas del trabajo y las filas de llamada (src/hilo/accion-tipo.ts): cada tipo tiene el suyo,
// lo desconocido cae en «otra herramienta» y un grupo muestra hasta tres tipos, los más usados primero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ICONO_ACCION, iconoAccion, MAX_ICONOS, tipoAccion, tiposDe, type TipoAccion } from "../src/hilo/accion-tipo.ts";

const u = (nombre: string, entrada: Record<string, unknown> = {}, resultado = false) => ({
  nombre,
  det: { nombre, entrada, ...(resultado ? { resultado: { texto: "", error: false } } : {}) } as never,
});

test("cada herramienta cae en su tipo", () => {
  const caso: [ReturnType<typeof u>, TipoAccion][] = [
    [u("Read"), "leer"],
    [u("NotebookRead"), "leer"],
    [u("Edit"), "editar"],
    [u("MultiEdit"), "editar"],
    [u("Write"), "escribir"],
    [u("Bash", { command: "git status" }), "comando"],
    [u("Grep"), "buscar"],
    [u("Glob"), "buscar"],
    [u("ToolSearch"), "buscar"],
    [u("Skill", { skill: "ferox-orquestar" }), "skill"],
    [u("Agent"), "agente"],
    [u("Task"), "agente"],
    [u("Bash", { command: 'pa trama "arreglar el índice"' }), "agente"],
    [u("Bash", { command: "pa trama --esperar 2026" }), "esperar"],
    [u("Bash", { command: "sleep 30 && echo ok" }), "esperar"],
    [u("Monitor"), "esperar"],
    [u("WebSearch"), "web"],
    [u("WebFetch"), "web"],
    [u("mcp__trama__estado_workers"), "mcp"],
    [u("Bash", { command: "npm test", run_in_background: true }), "fondo"],
    [u("Agent", { run_in_background: true }), "fondo"],
    [u("TodoWrite"), "otra"],
    [u("AlgoNuevo"), "otra"],
  ];
  for (const [x, tipo] of caso) assert.equal(tipoAccion(x), tipo, `${x.nombre} ${JSON.stringify(x.det?.entrada)}`);
  // pa en modo gestión (integrar, listar) es un comando más.
  assert.equal(tipoAccion(u("Bash", { command: "pa trama --integrar 1 --tests" })), "comando");
  // Sin detalle (un evento viejo "Bash: ...") también clasifica.
  assert.equal(tipoAccion({ nombre: "Bash", det: null }), "comando");
});

test("el mapa tiene un ícono por tipo y un respaldo para lo desconocido", () => {
  const tipos: TipoAccion[] = ["leer", "editar", "escribir", "comando", "buscar", "skill", "agente", "esperar", "web", "mcp", "fondo", "otra"];
  assert.deepEqual(Object.keys(ICONO_ACCION).sort(), [...tipos].sort());
  for (const k of tipos) assert.ok(iconoAccion(k), k);
  // Los tipos no comparten ícono: si dos se confunden, el mapa no sirve.
  assert.equal(new Set(tipos.map((k) => iconoAccion(k))).size, tipos.length);
  for (const raro of ["", "nuevo", "toString", "__proto__"]) assert.equal(iconoAccion(raro), ICONO_ACCION.otra, raro);
});

test("un grupo muestra hasta tres tipos, los más usados primero", () => {
  assert.deepEqual(tiposDe([]), []);
  assert.deepEqual(tiposDe([u("Bash"), u("Bash")]), ["comando"]);
  assert.deepEqual(tiposDe([u("Read"), u("Bash"), u("Bash"), u("Edit")]), ["comando", "leer", "editar"]);
  assert.equal(MAX_ICONOS, 3);
  const muchos = [u("Read"), u("Edit"), u("Grep"), u("WebFetch"), u("Grep")];
  assert.deepEqual(tiposDe(muchos), ["buscar", "leer", "editar"]);
  assert.deepEqual(tiposDe(muchos, 1), ["buscar"]);
});
