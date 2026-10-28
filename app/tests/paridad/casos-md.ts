// Casos de paridad de `pa <proyecto> --agents-md` y `--unificar-md [--aplicar]` (electron/cli/pa/md-proyecto.ts). Mismo formato que
// casos.ts. Los archivos del proyecto no se comparan solos: después de --aplicar se vuelve a pedir la vista previa y --agents-md,
// que cuentan lo que quedó escrito (líneas y caracteres); los backups sí salen en el estado (md-backup/).
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto, Paso } from "./arnes.ts";

const escribir = (c: Contexto, nombre: string, texto: string) => writeFileSync(path.join(c.proyecto, nombre), texto);
const con = (archivos: Record<string, string>) => (c: Contexto) => {
  for (const [n, t] of Object.entries(archivos)) escribir(c, n, t);
};
const unificar: Paso = { args: ["demo", "--unificar-md"], rc: 0 };
const aplicar: Paso = { args: ["demo", "--unificar-md", "--aplicar"], rc: 0 };
const agents: Paso = { args: ["demo", "--agents-md"], rc: 0 };

const STUB = "<!-- Editá AGENTS.md, no este archivo: acá sólo se importa. -->\n@AGENTS.md\n";
const CLAUDE = "# Proyecto\n\nCorrer `npm test` antes de dar algo por listo.\n\n- Comentarios en español\r\n";
const GEMINI = "# Gemini\n\nUsar pnpm.\n";

export const casosMd: Caso[] = ([
  { nombre: "agents-md: sin nada imprime la plantilla", args: ["demo", "--agents-md"], rc: 0 },
  { nombre: "agents-md: con AGENTS.md avisa y no imprime", preparar: con({ "AGENTS.md": "# AGENTS.md\n\nañá: ñandú\n" }), args: ["demo", "--agents-md"], rc: 0 },
  { nombre: "agents-md: --force imprime la plantilla igual", preparar: con({ "AGENTS.md": "# Algo\n" }), args: ["demo", "--agents-md", "--force"], rc: 0 },
  { nombre: "agents-md: un CLAUDE.md que es sólo un stub no cuenta", preparar: con({ "CLAUDE.md": STUB }), args: ["demo", "--agents-md"], rc: 0 },
  { nombre: "agents-md: un CLAUDE.md con contenido cuenta", preparar: con({ "CLAUDE.md": CLAUDE }), args: ["demo", "--agents-md"], rc: 0 },
  { nombre: "agents-md: PA_AGENTS_MAX sale en la plantilla", env: { PA_AGENTS_MAX: "500" }, args: ["demo", "--agents-md"], rc: 0 },

  { nombre: "unificar-md: sin archivos no hay nada que unificar", pasos: [unificar] },
  { nombre: "unificar-md: --aplicar sola sale 2", args: ["demo", "--aplicar"], rc: 2 },
  { nombre: "unificar-md: sólo CLAUDE.md, vista previa", preparar: con({ "CLAUDE.md": CLAUDE }), pasos: [unificar] },
  { nombre: "unificar-md: sólo CLAUDE.md, aplicar y volver a mirar", preparar: con({ "CLAUDE.md": CLAUDE }), pasos: [aplicar, unificar, agents] },
  { nombre: "unificar-md: sólo GEMINI.md, aplicar", preparar: con({ "GEMINI.md": GEMINI }), pasos: [aplicar, unificar, agents] },
  { nombre: "unificar-md: CLAUDE.md y GEMINI.md iguales", preparar: con({ "CLAUDE.md": CLAUDE, "GEMINI.md": `\n${CLAUDE}\n\n` }), pasos: [unificar, aplicar, unificar] },
  { nombre: "unificar-md: CLAUDE.md y GEMINI.md distintos van en secciones", preparar: con({ "CLAUDE.md": CLAUDE, "GEMINI.md": GEMINI }), pasos: [unificar, aplicar, unificar, agents] },
  {
    nombre: "unificar-md: AGENTS.md y CLAUDE.md distintos, anexa",
    preparar: con({ "AGENTS.md": "# AGENTS.md\n\nBuild: `make`.\n\n\n", "CLAUDE.md": CLAUDE }),
    pasos: [unificar, aplicar, unificar],
  },
  { nombre: "unificar-md: lo de CLAUDE.md ya está dentro de AGENTS.md", preparar: con({ "AGENTS.md": `# AGENTS.md\n\n${CLAUDE}\nMás cosas.\n`, "CLAUDE.md": CLAUDE }), pasos: [unificar, aplicar] },
  { nombre: "unificar-md: ya unificado (stubs) no hace nada", preparar: con({ "AGENTS.md": "# AGENTS.md\n\nHola.\n", "CLAUDE.md": STUB, "GEMINI.md": "@AGENTS.md\n" }), pasos: [unificar, aplicar] },
  { nombre: "unificar-md: AGENTS.md y falta CLAUDE.md crea el stub", preparar: con({ "AGENTS.md": "# AGENTS.md\n\nHola.\n" }), pasos: [unificar, aplicar, unificar] },
  { nombre: "unificar-md: un CLAUDE.md vacío se reemplaza por el stub", preparar: con({ "AGENTS.md": "# AGENTS.md\n\nHola.\n", "CLAUDE.md": " \n\n", "GEMINI.md": "" }), pasos: [aplicar, unificar] },
  { nombre: "unificar-md: AGENTS.md en blanco es como si faltara", preparar: con({ "AGENTS.md": "  \n\n", "CLAUDE.md": CLAUDE }), pasos: [unificar, aplicar, unificar] },
  {
    nombre: "unificar-md: AGENTS.md enlace simbólico sale 1",
    preparar: (c) => {
      writeFileSync(path.join(c.aux, "otro.md"), "x\n");
      symlinkSync(path.join(c.aux, "otro.md"), path.join(c.proyecto, "AGENTS.md"));
    },
    args: ["demo", "--unificar-md"],
    rc: 1,
  },
  {
    nombre: "unificar-md: CLAUDE.md enlace a otro lado avisa y no lo toca",
    preparar: (c) => {
      writeFileSync(path.join(c.aux, "otro.md"), "instrucciones de otro lado\n");
      symlinkSync(path.join(c.aux, "otro.md"), path.join(c.proyecto, "CLAUDE.md"));
      escribir(c, "GEMINI.md", GEMINI);
    },
    pasos: [unificar, aplicar, unificar],
  },
  {
    nombre: "unificar-md: CLAUDE.md enlace a AGENTS.md ya está unificado",
    preparar: (c) => {
      escribir(c, "AGENTS.md", "# AGENTS.md\n\nHola.\n");
      symlinkSync("AGENTS.md", path.join(c.proyecto, "CLAUDE.md"));
    },
    pasos: [unificar, aplicar],
  },
  {
    nombre: "unificar-md: GEMINI.md es una carpeta",
    preparar: (c) => {
      escribir(c, "CLAUDE.md", CLAUDE);
      mkdirSync(path.join(c.proyecto, "GEMINI.md"));
    },
    pasos: [unificar, aplicar],
  },
  { nombre: "unificar-md: AGENTS.md más largo que PA_AGENTS_MAX avisa al aplicar", env: { PA_AGENTS_MAX: "10" }, preparar: con({ "CLAUDE.md": CLAUDE }), pasos: [aplicar] },
  { nombre: "unificar-md: PA_AGENTS_MAX inválido usa el default", env: { PA_AGENTS_MAX: "mucho" }, preparar: con({ "CLAUDE.md": CLAUDE }), pasos: [aplicar] },
  { nombre: "unificar-md: dos aplicar seguidos", preparar: con({ "CLAUDE.md": CLAUDE, "GEMINI.md": GEMINI }), pasos: [aplicar, aplicar] },
] as Caso[]).map((c) => ({ ...c, herramienta: "pa-cli", nombre: `pa-cli: ${c.nombre}` }));
