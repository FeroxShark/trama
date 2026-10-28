// Casos de paridad del CLI de `pa` (etapa 5): el bash contra electron/cli/pa.ts en lo que ya está portado (subcomandos chicos,
// parseo, validaciones, política de modelos, rúbrica, modelos.json). Cada caso termina ANTES de lanzar un worker (eso es de la
// etapa 6): en un error de uso, en una negativa de la política o en «falta la tarea».
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const M = "claude-sonnet-5-5";
const RUB = "A=chico B=ejecutar C=completo D=bajo E=si";

/** Un caso del CLI. */
const cli = (nombre: string, args: Caso["args"], rc: number, extra: Partial<Caso> = {}): Caso => ({ herramienta: "pa-cli", nombre: `pa-cli: ${nombre}`, args, rc, ...extra });

/** Escribe un modelos.json en el sandbox y devuelve el env que lo apunta. */
const conModelos = (conf: unknown) => (c: Contexto) => {
  const f = path.join(c.aux, "modelos.json");
  writeFileSync(f, typeof conf === "string" ? conf : JSON.stringify(conf));
  return { TRAMA_MODELOS: f };
};
const archivo = (rel: string, texto: string) => (c: Contexto) => {
  const f = path.join(c.aux, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, texto);
};

export const casosPaCli: Caso[] = [
  // --- subcomandos chicos ---
  cli("ayuda", ["--ayuda"], 0),
  cli("ayuda con -h", ["-h"], 0),
  cli("versión", ["--version"], 0),
  cli("plantilla del brief", ["--brief"], 0),
  cli("plan vigente", ["--plan"], 0),
  { herramienta: "pa-cli", nombre: "pa-cli: plan max y vigente", pasos: [{ args: ["--plan", "MAX"], rc: 0 }, { args: ["--plan"], rc: 0 }] },
  cli("plan pro con PA_PLAN=max avisa", ["--plan", "pro"], 0, { env: { PA_PLAN: "max" } }),
  cli("plan inválido", ["--plan", "ultra"], 2),
  cli("plan ver (lo contesta reparto)", ["--plan", "ver"], 0),
  cli("nota sin texto", ["--nota"], 2),
  cli("nota con texto", ["--nota", "SIGUE: algo\nen dos líneas  "], 0, { env: { PA_JEFE_ID: "jefe/uno" } }),
  cli("sin argumentos", [], 2),

  // --- rúbrica (pa --rubrica) ---
  cli("rúbrica: fila 10", ["--rubrica", RUB], 0),
  cli("rúbrica: --json", ["--rubrica", "A=1,B=Decidir,C=completo,D=alto,E=SÍ", "--json"], 0),
  cli("rúbrica: fila 9 con tipo, --json", ["--rubrica", `${RUB} M=si`, "--json"], 0),
  cli("rúbrica: fila 1b con D=alto", ["--rubrica", "A=grande B=ejecutar C=completo D=alto E=si I=si"], 0),
  cli("rúbrica: no se lanza (3)", ["--rubrica", "A=grande B=ejecutar C=completo D=bajo E=si"], 3),
  cli("rúbrica: no se lanza, --json", ["--rubrica", "A=12 B=ejecutar C=ninguno D=bajo E=si", "--json"], 3),
  cli("rúbrica: valor que no va", ["--rubrica", "A=enorme B=ejecutar C=completo D=bajo E=si"], 2),
  cli("rúbrica: clave desconocida", ["--rubrica", `${RUB} Z=si`], 2),
  cli("rúbrica: sin CLAVE=valor", ["--rubrica", "chico"], 2),
  cli("rúbrica: faltan respuestas", ["--rubrica", "A=chico B=ejecutar"], 2),
  cli("rúbrica: sin texto", ["--rubrica"], 2),
  cli("rúbrica: dos textos", ["--rubrica", RUB, RUB], 2),
  cli("rúbrica: modelo excluido (98)", ["--rubrica", RUB], 98, { env: conModelos({ version: 1, excluir: ["haiku"] }) }),
  cli("rúbrica: effort apagado (98)", ["--rubrica", RUB], 98, { env: conModelos({ version: 1, efforts_permitidos: { haiku: ["low", "high"] } }) }),

  // --- prólogo ---
  cli("PA_PUESTOS inválido", ["--brief"], 2, { env: { PA_PUESTOS: "0" } }),
  cli("PA_TOPE inválido", ["--brief"], 2, { env: { PA_TOPE: "x" } }),
  cli("PA_RAM_WORKER_MB inválido", ["--brief"], 2, { env: { PA_RAM_WORKER_MB: "-1" } }),
  cli("PA_AUTOCOMPACT inválido avisa y sigue", ["--brief"], 0, { env: { PA_AUTOCOMPACT: "5" } }),
  cli("plan inválido en PA_PLAN avisa y sigue", ["--plan"], 0, { env: { PA_PLAN: "ultra" } }),
  cli("worker no delega", ["demo", "x"], 1, { env: { PA_WORKER: "1" } }),
  cli("modelo local no delega", ["demo", "x"], 88, { env: { CLAUDE_LOCAL: "1" } }),

  // --- parseo ---
  cli("opción desconocida", ["demo", "--no-existe", "x"], 2),
  cli("flag sin valor", ["demo", "--tipo"], 2),
  cli("-m sin valor", ["demo", "--sin-jefe", "-m"], 2),
  cli("--max-turns no numérico", ["demo", "--max-turns", "7x", "x"], 2),
  cli("--max-budget-usd no numérico", ["demo", "--max-budget-usd", "2,5", "x"], 2),
  cli("--effort que no existe", ["demo", "--effort", "ULTRA", "x"], 2),
  cli("--tests sin --integrar", ["demo", "--tests", "x"], 2),
  cli("--brief-archivo inexistente", ["demo", "--brief-archivo", "/no/existe.md", "x"], 2),
  {
    ...cli("--brief-archivo vacío", (c) => ["demo", "-m", M, "--brief-archivo", path.join(c.aux, "vacio.md")], 2),
    preparar: archivo("vacio.md", "  \n\n"),
  },
  cli("--test-inline inexistente", ["demo", "-m", M, "--test-inline", "/no/existe.test.ts", "x"], 2),
  cli("--auditar con --seguir", ["demo", "--auditar", "abc", "--seguir", "x"], 2),
  cli("--decisiones sin --auditar", ["demo", "--decisiones", "/tmp/d.md", "x"], 2),
  cli("--nota pegada y después un error", ["demo", "--nota", "pedido: algo", "--effort", "nada", "x"], 2, { env: { PA_JEFE_ID: "j1" } }),
  cli("--espejo inexistente", ["demo", "--espejo", "/no/existe.ts", "x"], 2),
  {
    ...cli("--espejo se mueve antes de seguir", (c) => ["demo", "--sin-jefe", "-m", M, "--espejo", path.join(c.aux, "tareas", "gate.test.ts")], 2),
    preparar: archivo("tareas/gate.test.ts", "test('x', () => {});\n"),
  },

  // --- tipo, fase, tarea, subtarea ---
  cli("--tipo que no existe", ["demo", "-m", M, "--tipo", "Rapido", "x"], 2),
  cli("PA_TIPO que no existe", ["demo", "-m", M, "x"], 2, { env: { PA_TIPO: "cualquiera" } }),
  cli("--tipo malo no traba --olvidar", ["demo", "--tipo", "malo", "--olvidar"], 0),
  cli("--tipo Diseño vale", ["demo", "--sin-jefe", "-m", M, "--tipo", "Diseño"], 2),
  cli("--fase con espacios", ["demo", "-m", M, "--fase", "F 4", "x"], 2),
  cli("--subtarea con caracteres raros", ["demo", "-m", M, "--subtarea", "T1/2", "x"], 2),
  cli("--tarea demasiado larga", ["demo", "-m", M, "--tarea", "t".repeat(41), "x"], 2),

  // --- rúbrica en una corrida ---
  cli("--rubrica elige modelo", ["demo", "--sin-jefe", "--rubrica", RUB], 2),
  cli("--rubrica con -m avisa que vale el -m", ["demo", "--sin-jefe", "-m", M, "--rubrica", RUB], 2),
  cli("--rubrica que no se lanza", ["demo", "--rubrica", "A=grande B=ejecutar C=completo D=bajo E=si", "x"], 3),
  cli("--rubrica mal armada", ["demo", "--rubrica", "A=chico", "x"], 2),

  // --- política: fable, max, excluir, efforts_permitidos ---
  cli("fable sin --ok-dueno", ["demo", "-m", "claude-fable-5-1", "x"], 2),
  cli("fable con --ok-dueno pasa", ["demo", "--sin-jefe", "-m", "claude-fable-5-1", "--ok-dueno"], 2),
  cli("fable con el alias --ok-<usuario>", ["demo", "--sin-jefe", "-m", "claude-fable-5-1", "--ok-gonza"], 2, { env: { USER: "gonza" } }),
  cli("effort max con opus", ["demo", "-m", "claude-opus-5-5", "--effort", "max", "x"], 2),
  cli("effort max desde PA_EFFORT", ["demo", "-m", M, "x"], 2, { env: { PA_EFFORT: "max" } }),
  cli("effort max con haiku pasa", ["demo", "--sin-jefe", "-m", "claude-haiku-5-5", "--effort", "max"], 2),
  cli("permitir_max deja max con sonnet", ["demo", "--sin-jefe", "-m", M, "--effort", "max"], 2, { env: conModelos({ version: 1, permitir_max: true }) }),
  cli("-m excluido (98)", ["demo", "-m", "claude-opus-5-5", "x"], 98, { env: conModelos({ version: 1, excluir: [" Opus "] }) }),
  cli("-m excluido con --ok-dueno pasa", ["demo", "--sin-jefe", "-m", "claude-opus-5-5", "--ok-dueno"], 2, { env: conModelos({ version: 1, excluir: ["claude-opus-5-5"] }) }),
  cli("effort apagado (98)", ["demo", "-m", M, "--effort", "low", "x"], 98, { env: conModelos({ version: 1, efforts_permitidos: { sonnet: ["medium", "high"] } }) }),
  cli("sin effort permitido (98)", ["demo", "-m", M, "x"], 98, { env: conModelos({ version: 1, efforts_permitidos: { "claude-sonnet-5-5": [] } }) }),
  cli("el default apagado va al primero permitido", ["demo", "--sin-jefe", "-m", M], 2, { env: conModelos({ version: 1, efforts_permitidos: { sonnet: ["xhigh", "low"] } }) }),
  cli("-m a,b con un modelo vacío", ["demo", "-m", "claude-haiku-5-5,,claude-opus-5-5", "x"], 2),
  cli("-m a,b todos apagados (98)", ["demo", "-m", "claude-opus-5-5,claude-fable-5-1", "--effort", "high", "x"], 98, {
    env: conModelos({ version: 1, excluir: ["fable"], efforts_permitidos: { opus: ["medium"] } }),
  }),

  // --- modelos.json ---
  cli("modelos.json roto avisa", ["demo", "--sin-jefe", "-m", M], 2, { env: conModelos("{no es json") }),
  cli("modelos.json con versión mala avisa", ["demo", "--sin-jefe"], 2, { env: conModelos({ version: 2 }) }),
  cli("modelos.json con un worker mal armado", ["demo", "--sin-jefe", "--tipo", "debug"], 2, { env: conModelos({ version: 1, workers: { debug: { modelo: "gpt-9" } } }) }),
  cli("modelos.json con un local mal armado", ["demo", "--sin-jefe", "-m", M], 2, { env: conModelos({ version: 1, locales: [{ id: "x" }] }) }),
  cli("modelos.json elige por tipo", ["demo", "--sin-jefe", "--tipo", "frontend"], 2, {
    env: conModelos({ version: 1, workers: { frontend: { modelo: "claude-opus-5-5", effort: "high" }, default: { modelo: "claude-haiku-5-5" } } }),
  }),
  cli("modelos.json: el default", ["demo", "--sin-jefe", "--tipo", "debug"], 2, { env: conModelos({ version: 1, workers: { default: { modelo: "claude-haiku-5-5" } } }) }),

  // --- otros motores: lo que se valida sin mirar afuera ---
  cli("agy: modelo que no existe", ["demo", "-m", "gemini-9-ultra", "x"], 2),
  cli("agy: --effort aparte", ["demo", "-m", "gemini-4-argon-high", "--effort", "high", "x"], 2),
  cli("agy: --seguir", ["demo", "-m", "gemini-4-argon-high", "--seguir", "x"], 2),
  cli("agy: --max-budget-usd", ["demo", "-m", "agy:gpt-oss-120b-medium", "--max-budget-usd", "1", "x"], 2),
  cli("codex: modelo que no existe", ["demo", "-m", "codex:gpt-5", "x"], 2),
  cli("codex: --mcp", ["demo", "-m", "codex:gpt-6-sol-high", "--mcp", "x"], 2),
  cli("opencode: mal armado", ["demo", "-m", "opencode:suelto", "x"], 2),
  cli("dsh: mal armado", ["demo", "-m", "DSH:Otro/x", "x"], 2),
  cli("dsh: --effort", ["demo", "-m", "dsh:ollama/qwen3", "--effort", "high", "x"], 2),
  cli("dsh: --leer", ["demo", "-m", "dsh:deepseek/chat", "--leer", "x"], 2),
  cli("dsh: --cuenta", ["demo", "-m", "dsh:deepseek/chat", "--cuenta", "otra", "x"], 2),
  cli("ollama: mal armado", ["demo", "-m", "ollama:", "x"], 2),
  cli("ollama: --effort", ["demo", "-m", "Ollama:qwen3", "--effort", "low", "x"], 2),
  cli("ollama: --cuenta", ["demo", "-m", "ollama:qwen3", "--cuenta", "otra", "x"], 2),
  cli("cuenta de otro proveedor", ["demo", "-m", M, "--cuenta", "google", "x"], 2),

  // --- después de la política ---
  cli("proyecto que no existe", ["fantasma", "-m", M, "x"], 1),
  cli("falta la tarea", ["demo", "--sin-jefe", "-m", M], 2),
  cli("sin -m avisa y falta la tarea", ["demo", "--sin-jefe"], 2),
  cli("--tipo mecanico sin -m va con haiku", ["demo", "--sin-jefe", "--tipo", "mecanico"], 2),
  cli("--seguir sin tarea", ["demo", "--sin-jefe", "--seguir", "-m", M], 2),
  cli("--aplicar sin --unificar-md", ["demo", "--aplicar"], 2),
  cli("--olvidar", ["demo", "--olvidar"], 0),
  cli("--actualizar de una corrida que no existe", ["demo", "--actualizar", "20260101-000000-1"], 2),
  cli("--actualizar con --leer", ["demo", "--actualizar", "x", "--leer"], 2),
];
