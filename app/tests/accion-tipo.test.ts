// El mapa de acción → ícono de las pastillas del trabajo y las filas de llamada (src/hilo/accion-tipo.ts): cada tipo tiene el suyo,
// lo desconocido cae en «otra herramienta» y un grupo muestra hasta tres tipos, los más usados primero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FilePen, FilePlus, FileText, Globe, ListChecks, Plug, Search, Sparkles, SquareTerminal, Users, Wrench } from "lucide-react";
import { CLASE_ACCION, claseAccion, ICONO_ACCION, iconoAccion, MAX_ICONOS, TIPO_DE_CLAVE, tipoAccion, tiposDe, type TipoAccion } from "../src/hilo/accion-tipo.ts";

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
    [u("Skill", { skill: "orquestar-workers" }), "skill"],
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
    [u("TodoWrite"), "tareas"],
    [u("Fabricar"), "otra"],
    [u("AlgoNuevo"), "otra"],
  ];
  for (const [x, tipo] of caso) assert.equal(tipoAccion(x), tipo, `${x.nombre} ${JSON.stringify(x.det?.entrada)}`);
  // pa en modo gestión (integrar, listar) es un comando más.
  assert.equal(tipoAccion(u("Bash", { command: "pa trama --integrar 1 --tests" })), "comando");
  // Sin detalle (un evento viejo "Bash: ...") también clasifica.
  assert.equal(tipoAccion({ nombre: "Bash", det: null }), "comando");
});

test("el mapa tiene un ícono por tipo y un respaldo para lo desconocido", () => {
  const tipos: TipoAccion[] = ["leer", "editar", "escribir", "comando", "buscar", "skill", "agente", "esperar", "web", "mcp", "fondo", "tareas", "otra"];
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

test("la tabla pedida: cada herramienta, su ícono lineal (agentes con personas, no un robot)", () => {
  const esperado: [string, unknown][] = [
    ["Bash", SquareTerminal],
    ["Read", FileText],
    ["Write", FilePlus],
    ["Edit", FilePen],
    ["Grep", Search],
    ["Glob", Search],
    ["WebFetch", Globe],
    ["WebSearch", Globe],
    ["Task", Users],
    ["Agent", Users],
    ["Skill", Sparkles],
    ["TodoWrite", ListChecks],
    ["mcp__trama__estado_workers", Plug],
    ["Algo", Wrench],
  ];
  for (const [nombre, icono] of esperado) assert.equal(iconoAccion(tipoAccion(u(nombre))), icono, nombre);
});

test("el color es por clase: leer azul, escribir ámbar, comando verde, web violeta, el resto gris", () => {
  const clase = (nombre: string, entrada: Record<string, unknown> = {}) => claseAccion(tipoAccion(u(nombre, entrada)));
  assert.equal(clase("Read"), "leer");
  assert.equal(clase("Grep"), "leer");
  assert.equal(clase("Glob"), "leer");
  assert.equal(clase("Write"), "escribir");
  assert.equal(clase("Edit"), "escribir");
  assert.equal(clase("Bash", { command: "ls" }), "comando");
  assert.equal(clase("WebFetch"), "web");
  for (const n of ["Task", "Skill", "TodoWrite", "mcp__x__y", "Raro"]) assert.equal(clase(n), "neutro", n);
  // Todo tipo tiene clase, y lo desconocido es gris.
  assert.deepEqual(Object.keys(CLASE_ACCION).sort(), Object.keys(ICONO_ACCION).sort());
  for (const raro of ["", "toString", "__proto__"]) assert.equal(claseAccion(raro), "neutro", raro);
});

test("las claves propias de la tarjeta de actividad y del worker caen en el mismo tipo", () => {
  assert.equal(TIPO_DE_CLAVE.correr, "comando");
  assert.equal(TIPO_DE_CLAVE.delegar, "agente");
  for (const k of Object.values(TIPO_DE_CLAVE)) assert.ok(Object.hasOwn(ICONO_ACCION, k), k);
  for (const propia of ["pensar", "texto", "permiso"]) assert.equal(TIPO_DE_CLAVE[propia], undefined, propia);
});
