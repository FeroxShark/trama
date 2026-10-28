// Casos de paridad, declarativos. Ver «Cómo agregar un caso» en motor/docs/port-windows-plan.md.
// Cada caso corre en un sandbox nuevo (proyecto git `demo`, estado vacío, claude falso headless). El claude falso
// contesta «ok» sin bloque RESULTADO, así que una tarea lanzada de verdad termina en 78: es deterministico y alcanza
// para comparar argv, salida y archivos de estado.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso } from "./arnes.ts";
import { casosHerramientas } from "./casos-herramientas.ts";
import { casosHooks } from "./casos-hooks.ts";
import { casosAsync } from "./casos-async.ts";

const M = "claude-sonnet-5-5";
const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";

export const casosPa: Caso[] = [
  // --- ayuda y errores de uso ---
  { nombre: "ayuda: --ayuda", args: ["--ayuda"], rc: 0 },
  { nombre: "uso: sin argumentos", args: [], rc: 2 },
  { nombre: "uso: opción desconocida", args: ["demo", "--no-existe", "x"], rc: 2 },
  { nombre: "uso: proyecto que no existe", args: ["fantasma", "--sin-jefe", "x"], rc: 1 },
  { nombre: "uso: proyecto sin tarea", args: ["demo", "--sin-jefe"], rc: 2 },
  { nombre: "brief: plantilla (--brief)", args: ["--brief"], rc: 0 },
  { nombre: "brief: --brief-archivo inexistente", args: ["demo", "--sin-jefe", "--brief-archivo", "/no/existe.md"], rc: 2 },

  // --- consulta sin lanzar nada ---
  { nombre: "plan: ver", args: ["--plan", "ver"], rc: 0 },
  { nombre: "plan: max y ver (escribe el estado)", pasos: [{ args: ["--plan", "max"] }, { args: ["--plan", "ver"] }] },
  { nombre: "plan: valor inválido", args: ["--plan", "ultra"] },
  { nombre: "modelos: tabla", args: ["--modelos"], rc: 0 },
  { nombre: "modelos: --json", args: ["--modelos", "--json"], rc: 0 },
  { nombre: "proyectos: --json", args: ["--proyectos", "--json"], rc: 0 },
  { nombre: "estado: sin corridas", args: ["--estado"], rc: 0 },
  { nombre: "hilos: --json vacío", args: ["--hilos", "--json"], rc: 0 },
  { nombre: "lecciones: anotar y leer", pasos: [{ args: ["demo", "--leccion", "usar tabs"], rc: 0 }, { args: ["demo", "--lecciones"], rc: 0 }] },

  // --- lanzar ---
  { nombre: "lanzar: tarea simple con modelo explícito", args: ["demo", "--sin-jefe", "-m", M, "hacé algo"], rc: 78 },
  { nombre: "lanzar: brief completo no avisa", args: ["demo", "--sin-jefe", "-m", M, "--tipo", "codigo-acotado", BRIEF], rc: 78 },
  { nombre: "lanzar: --tipo mecanico sin -m", args: ["demo", "--sin-jefe", "--tipo", "mecanico", "renombrá x"], rc: 78 },
  { nombre: "lanzar: --effort medio y --max-turns", args: ["demo", "--sin-jefe", "-m", M, "--effort", "medium", "--max-turns", "7", "hacé algo"], rc: 78 },
  {
    nombre: "lanzar: --brief-archivo",
    preparar: (c) => writeFileSync(path.join(c.aux, "brief.md"), BRIEF),
    args: (c) => ["demo", "--sin-jefe", "-m", M, "--tipo", "codigo-acotado", "--brief-archivo", path.join(c.aux, "brief.md")],
    rc: 78,
  },
  { nombre: "leer: --leer (sólo lectura)", args: ["demo", "--sin-jefe", "--leer", "-m", M, "¿qué hace esto?"], rc: 78 },
  { nombre: "aca: --aca en el tree principal", args: ["demo", "--sin-jefe", "--aca", "-m", M, "hacé algo"], rc: 78 },

  // --- async / esperar ---
  {
    nombre: "async: lanzar y esperar el resultado",
    pasos: [
      { args: ["demo", "--sin-jefe", "--async", "-m", M, "hacé algo"], rc: 0 },
      { args: ["--esperar", "demo", "--timeout", "60"], rc: 78 },
    ],
  },
  { nombre: "esperar: sin nada pendiente y con timeout corto", args: ["--esperar", "demo", "--timeout", "1"] },

  // --- rechazos de flags por motores no-claude ---
  { nombre: "rechazo: --max-budget-usd con agy", args: ["demo", "--sin-jefe", "-m", "agy:gpt-oss-120b-medium", "--max-budget-usd", "1", "x"], rc: 2 },
  { nombre: "rechazo: --effort max con sonnet", args: ["demo", "--sin-jefe", "-m", M, "--effort", "max", "x"], rc: 2 },
  { nombre: "rechazo: opencode con modelo mal armado", args: ["demo", "--sin-jefe", "-m", "opencode:suelto", "x"], rc: 2 },
  { nombre: "rechazo: opencode con --effort inválido de otro motor", args: ["demo", "--sin-jefe", "-m", "ollama:x", "--effort", "high", "x"] },
];

/** Todos los casos: `pa`, las herramientas chicas (proyecto-ruta, trama-estado, workers) y los hooks (.sh contra .mjs). */
export const casos: Caso[] = [...casosPa, ...casosHerramientas, ...casosHooks, ...casosAsync];
