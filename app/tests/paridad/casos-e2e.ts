// Casos de paridad de punta a punta de la etapa 11: el `pa` bash (A) contra cli/pa.ts entero (B), con varios comandos seguidos
// en el mismo sandbox (lanzar, esperar, ver las ramas, integrar, descartar, retomar). Usan el claude con guion de casos-lanzar.ts.
import { readdirSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";
import { ponerGuion, type Respuesta } from "./casos-lanzar.ts";

const M = "claude-sonnet-5-5";
const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";
const BLOQUE = "RESULTADO: hice x.\nARCHIVOS: nuevo.txt\nVERIFICACION: npm test\n  ok 3 tests\nDECISION: nada\nSIGUE: nada";
const PREGUNTA =
  "RESULTADO: hice x.\nARCHIVOS: nuevo.txt\nVERIFICACION: npm test\n  ok 3 tests\nDECISION: Decidir cómo se publica.\nSIGUE: publicar\n\nPREGUNTA: ¿Publico ya?\nCONTEXTO: está listo\nOPCION: Sí\nOPCION: No\nDEFECTO: 1\nPROBAR: abrir la pantalla nueva y mirar el botón";
const ok = (result: string, extra: Record<string, unknown> = {}): Respuesta => ({
  json: { type: "result", subtype: "success", is_error: false, result, session_id: "@SID@", num_turns: 3, duration_ms: 4200, total_cost_usd: 0.12345, ...extra },
});

/** El id de la primera corrida del proyecto `demo` (el slug del sandbox es `proy`). */
const idDe = (c: Contexto, ext = "corrida"): string => {
  const f = readdirSync(path.join(c.estado, "proy")).filter((n) => n.endsWith(`.${ext}`)).sort();
  return f.length ? f[0]!.slice(0, -(ext.length + 1)) : "no-hay";
};
const guion = (g: Respuesta[]) => (c: Contexto) => ponerGuion(c, g);
const e2e = (nombre: string, x: Omit<Caso, "nombre">): Caso => ({ nombre: `e2e: ${nombre}`, ...x });

const LANZA = ["demo", "--sin-jefe", "-m", M, BRIEF];

export const casosE2e: Caso[] = [
  e2e("lanzar en worktree, ver las ramas e integrar", {
    preparar: guion([{ ...ok(BLOQUE), commitear: ["nuevo.txt"] }]),
    pasos: [
      { args: LANZA, rc: 0 },
      { args: ["demo", "--ramas"], rc: 0 },
      { args: (c) => ["demo", "--integrar", idDe(c)], rc: 0 },
      { args: ["demo", "--ramas"], rc: 0 },
    ],
  }),
  e2e("lanzar en worktree y descartar la rama", {
    preparar: guion([{ ...ok(BLOQUE), commitear: ["nuevo.txt"] }]),
    pasos: [{ args: LANZA, rc: 0 }, { args: (c) => ["demo", "--descartar", idDe(c)], rc: 0 }, { args: ["demo", "--ramas"], rc: 0 }],
  }),
  e2e("--async, esperar e integrar", {
    preparar: guion([{ ...ok(BLOQUE), commitear: ["nuevo.txt"] }]),
    pasos: [
      { args: ["demo", "--sin-jefe", "--async", "-m", M, BRIEF], rc: 0 },
      { args: ["--esperar", "demo", "--timeout", "60"], rc: 0 },
      { args: (c) => ["demo", "--integrar", idDe(c)], rc: 0 },
    ],
  }),
  e2e("--async --leer y esperar", {
    preparar: guion([ok("RESULTADO: lee cosas.\nARCHIVOS: ninguno\nVERIFICACION: ninguna\nDECISION: nada\nSIGUE: nada")]),
    pasos: [
      { args: ["demo", "--sin-jefe", "--async", "--leer", "-m", M, "¿qué hace esto?"], rc: 0 },
      { args: (c) => ["--esperar", "demo", "--id", idDe(c, "leer"), "--timeout", "60"], rc: 0 },
    ],
  }),
  e2e("--seguir retoma la sesión de la corrida anterior", {
    preparar: guion([ok(BLOQUE)]),
    pasos: [
      { args: ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], rc: 0 },
      { args: ["demo", "--sin-jefe", "--aca", "--seguir", "-m", M, "cerrá lo que falta"], rc: 0 },
    ],
  }),
  e2e("--seguir --id sobre una corrida con worktree", {
    preparar: guion([{ ...ok(BLOQUE), commitear: ["nuevo.txt"] }]),
    pasos: [{ args: LANZA, rc: 0 }, { args: (c) => ["demo", "--sin-jefe", "--seguir", "--id", idDe(c), "-m", M, "seguí"], rc: 0 }],
  }),
  e2e("--seguir sin sesión guardada arranca limpio", {
    preparar: guion([ok(BLOQUE)]),
    args: ["demo", "--sin-jefe", "--aca", "--seguir", "-m", M, BRIEF],
    rc: 0,
  }),
  e2e("--actualizar una rama", {
    preparar: guion([{ ...ok(BLOQUE), commitear: ["nuevo.txt"] }]),
    pasos: [{ args: LANZA, rc: 0 }, { args: (c) => ["demo", "--sin-jefe", "--actualizar", idDe(c), "-m", M], rc: 0 }],
  }),
  e2e("--auditar una rama", {
    preparar: guion([{ ...ok(BLOQUE), commitear: ["nuevo.txt"] }]),
    pasos: [{ args: LANZA, rc: 0 }, { args: (c) => ["demo", "--sin-jefe", "--auditar", idDe(c), "-m", M], rc: 0 }],
  }),
  e2e("preguntas y PROBAR en el resultado", { preparar: guion([ok(PREGUNTA)]), args: ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], rc: 0 }),
  e2e("--tarea y --subtarea escriben el estado de la tarea", {
    preparar: guion([ok(BLOQUE)]),
    args: ["demo", "--sin-jefe", "--aca", "-m", M, "--tarea", "madre", "--subtarea", "uno", BRIEF],
    rc: 0,
  }),
  e2e("--parar de una corrida que no existe", { args: ["--parar", "20261028-101010-111"], rc: 1 }),
  e2e("--matar sin nada corriendo", { args: ["demo", "--matar", "--sin-jefe"] }),
  e2e("dos corridas seguidas en el tree principal", {
    preparar: (c) => {
      ponerGuion(c, [ok(BLOQUE)]);
    },
    pasos: [
      { args: ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], rc: 0 },
      { args: ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], rc: 0 },
    ],
  }),
];
