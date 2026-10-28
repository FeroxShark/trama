// Casos de paridad de la etapa 9 del port (app/electron/cli/pa/ramas.ts, lecciones.ts, auditar.ts): --ramas, --integrar,
// --descartar, las lecciones y las validaciones de --actualizar / --auditar. Mismo formato que casos.ts. Los commits del sandbox
// se rehacen con fecha e identidad fijas (`fijo`) para que los shas, y los cortos de 7 que salen en los mensajes, sean los mismos
// en las dos corridas.
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const M = "claude-sonnet-5-5";
const ID = "20261028-101010-4242";
const ID2 = "20261028-111111-4343";
const SLUG = "proy"; // basename de c.proyecto
const FECHA = "2026-10-01T12:00:00+00:00";

function gitFijo(c: Contexto, ...a: string[]) {
  const r = spawnSync("git", ["-C", c.proyecto, ...a], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: FECHA, GIT_COMMITTER_DATE: FECHA, GIT_AUTHOR_NAME: "x", GIT_AUTHOR_EMAIL: "a@b", GIT_COMMITTER_NAME: "x", GIT_COMMITTER_EMAIL: "a@b" },
  });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** El commit inicial con fecha fija y la identidad del repo (los rebase de pa commitean). */
function fijo(c: Contexto) {
  gitFijo(c, "config", "user.email", "a@b");
  gitFijo(c, "config", "user.name", "x");
  gitFijo(c, "commit", "-q", "--amend", "--allow-empty", "-m", "init");
}

const escribir = (c: Contexto, rel: string, texto: string) => {
  const f = path.join(c.proyecto, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, texto);
};

/** Un commit en main con esos archivos. */
function enMain(c: Contexto, archivos: Record<string, string>, msg = "main") {
  for (const [k, v] of Object.entries(archivos)) escribir(c, k, v);
  gitFijo(c, "add", "-A");
  gitFijo(c, "commit", "-q", "-m", msg);
}

/** La rama de una corrida (sacada de main) con esos archivos, y su `.corrida`. Devuelve la base. */
function corrida(c: Contexto, id: string, archivos: Record<string, string> | null, o: { rama?: string; corrida?: boolean } = {}) {
  const rama = o.rama ?? `pa/${SLUG}/${id}`;
  const base = gitFijo(c, "rev-parse", "HEAD");
  gitFijo(c, "checkout", "-q", "-b", rama);
  if (archivos) {
    for (const [k, v] of Object.entries(archivos)) escribir(c, k, v);
    gitFijo(c, "add", "-A");
    gitFijo(c, "commit", "-q", "-m", `trabajo de ${id}`);
  }
  gitFijo(c, "checkout", "-q", "main");
  if (o.corrida !== false) {
    const dir = path.join(c.estado, SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${id}.corrida`),
      `ruta_trabajo=${c.proyecto}\nrama=${rama}\nbase=${base}\nproyecto=demo\norigen=\nleer=0\npuesto=1\njefe=\njefe_id=\n`,
    );
  }
  return base;
}

const registroConTests = (c: Contexto, tests: string) =>
  writeFileSync(path.join(c.home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: c.proyecto, tests }] }));

const lecciones = (c: Contexto, n: number) => {
  const dir = path.join(c.estado, SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "lecciones.md"), Array.from({ length: n }, (_, i) => `- 2026-10-01 lección ${i + 1}\n`).join(""));
};

const una = (c: Contexto) => {
  fijo(c);
  corrida(c, ID, { "a.txt": "hola\n" });
};

export const casosRamas: Caso[] = [
  // --- --ramas ---
  { nombre: "ramas: sin ramas", args: ["demo", "--ramas"], rc: 0, preparar: fijo },
  {
    nombre: "ramas: una pendiente y una vacía",
    args: ["demo", "--ramas"],
    rc: 0,
    preparar: (c) => {
      una(c);
      corrida(c, ID2, null);
    },
  },
  {
    nombre: "ramas: poda la que ya está entera en main y adopta la huérfana",
    args: ["demo", "--ramas"],
    rc: 0,
    preparar: (c) => {
      una(c);
      gitFijo(c, "merge", "-q", "--ff-only", `pa/${SLUG}/${ID}`);
      corrida(c, "huerfano-20261028-090000-1", { "h.txt": "h\n" }, { rama: `pa/${SLUG}/huerfano-20261028-090000-1`, corrida: false });
    },
  },

  // --- --integrar ---
  { nombre: "integrar: ff simple", args: ["demo", "--integrar", ID], rc: 0, preparar: una },
  {
    nombre: "integrar: main se movió, rebasea sin choque",
    args: ["demo", "--integrar", ID],
    rc: 0,
    preparar: (c) => {
      una(c);
      enMain(c, { "b.txt": "otro\n" });
    },
  },
  {
    nombre: "integrar: el rebase choca (80)",
    args: ["demo", "--integrar", ID],
    rc: 80,
    preparar: (c) => {
      una(c);
      enMain(c, { "a.txt": "distinto\n" });
    },
  },
  {
    nombre: "integrar: el tree principal tiene sucio lo que toca la rama (79)",
    args: ["demo", "--integrar", ID],
    rc: 79,
    preparar: (c) => {
      fijo(c);
      enMain(c, { "a.txt": "v1\n" });
      corrida(c, ID, { "a.txt": "v2\n" });
      escribir(c, "a.txt", "sucio\n");
    },
  },
  {
    nombre: "integrar: symlink peligroso (83)",
    args: ["demo", "--integrar", ID],
    rc: 83,
    preparar: (c) => {
      fijo(c);
      gitFijo(c, "checkout", "-q", "-b", `pa/${SLUG}/${ID}`);
      symlinkSync("/etc/passwd", path.join(c.proyecto, "enlace"));
      gitFijo(c, "add", "-A");
      gitFijo(c, "commit", "-q", "-m", "symlink");
      gitFijo(c, "checkout", "-q", "main");
      const base = gitFijo(c, "rev-parse", "HEAD");
      mkdirSync(path.join(c.estado, SLUG), { recursive: true });
      writeFileSync(path.join(c.estado, SLUG, `${ID}.corrida`), `ruta_trabajo=${c.proyecto}\nrama=pa/${SLUG}/${ID}\nbase=${base}\nproyecto=demo\npuesto=1\n`);
    },
  },
  { nombre: "integrar: corrida que no existe", args: ["demo", "--integrar", ID], rc: 1, preparar: fijo },
  { nombre: "integrar: rama sin commits", args: ["demo", "--integrar", ID], rc: 1, preparar: (c) => (fijo(c), corrida(c, ID, null)) },
  {
    nombre: "integrar: dos veces (la segunda ya está integrada)",
    preparar: una,
    pasos: [{ args: ["demo", "--integrar", ID], rc: 0 }, { args: ["demo", "--integrar", ID], rc: 0 }],
  },
  {
    nombre: "integrar: ya entera en main a mano",
    args: ["demo", "--integrar", ID],
    rc: 0,
    preparar: (c) => {
      una(c);
      gitFijo(c, "merge", "-q", "--ff-only", `pa/${SLUG}/${ID}`);
    },
  },
  {
    nombre: "integrar: avisa el solapamiento con otra rama sin integrar",
    args: ["demo", "--integrar", ID],
    rc: 0,
    preparar: (c) => {
      una(c);
      corrida(c, ID2, { "a.txt": "otra versión\n" });
    },
  },
  { nombre: "integrar: --tests sin tests en el registry", args: ["demo", "--integrar", ID, "--tests"], rc: 2, preparar: una },
  {
    nombre: "integrar: --tests verdes",
    args: ["demo", "--integrar", ID, "--tests"],
    rc: 0,
    preparar: (c) => {
      una(c);
      registroConTests(c, "test -f a.txt && echo bien");
    },
  },
  {
    nombre: "integrar: --tests rojos (93)",
    args: ["demo", "--integrar", ID, "--tests"],
    rc: 93,
    preparar: (c) => {
      una(c);
      registroConTests(c, "echo se rompió; exit 3");
    },
  },
  { nombre: "integrar: --tests sin --integrar", args: ["demo", "--tests", "--ramas"], rc: 2 },

  // --- --descartar ---
  { nombre: "descartar: por proyecto", args: ["demo", "--descartar", ID], rc: 0, preparar: una },
  { nombre: "descartar: por id, sin proyecto", args: ["--descartar", ID], rc: 0, preparar: una },
  { nombre: "descartar: id que no existe", args: ["--descartar", ID], rc: 1, preparar: fijo },
  { nombre: "descartar: corrida que no existe en el proyecto", args: ["demo", "--descartar", ID], rc: 1, preparar: fijo },
  {
    nombre: "descartar: y después integrar dice que se descartó",
    preparar: una,
    pasos: [{ args: ["demo", "--descartar", ID], rc: 0 }, { args: ["demo", "--integrar", ID], rc: 1 }],
  },

  // --- lecciones ---
  { nombre: "lecciones: sin lecciones", args: ["demo", "--lecciones"], rc: 0 },
  {
    nombre: "lecciones: la misma dos veces no se repite",
    pasos: [{ args: ["demo", "--leccion", "correr npm test antes de commitear"], rc: 0 }, { args: ["demo", "--leccion", "correr npm test antes de commitear"], rc: 0 }, { args: ["demo", "--lecciones"], rc: 0 }],
  },
  { nombre: "lecciones: texto vacío", args: ["demo", "--leccion", "  \t "], rc: 2 },
  { nombre: "lecciones: pasadas del tope piden poda", args: ["demo", "--leccion", "una más"], rc: 0, preparar: (c) => lecciones(c, 30) },
  { nombre: "lecciones: el tope duro corta en 45", pasos: [{ args: ["demo", "--leccion", "la 46"], rc: 0 }, { args: ["demo", "--lecciones"], rc: 0 }], preparar: (c) => lecciones(c, 45) },
  { nombre: "lecciones: --lecciones-podar", args: ["demo", "--lecciones-podar"], rc: 0, preparar: (c) => lecciones(c, 31) },

  // --- --auditar / --actualizar (sólo lo que se niega antes de lanzar) ---
  { nombre: "auditar: rama que no existe", args: ["demo", "--sin-jefe", "-m", M, "--auditar", "pa/proy/nada"], rc: 2, preparar: fijo },
  { nombre: "auditar: con --seguir", args: ["demo", "--sin-jefe", "-m", M, "--seguir", "--auditar", ID, "x"], rc: 2 },
  { nombre: "auditar: --decisiones sin --auditar", args: ["demo", "--sin-jefe", "-m", M, "--decisiones", "/no/existe", "x"], rc: 2 },
  { nombre: "auditar: --decisiones que no se puede leer", args: ["demo", "--sin-jefe", "-m", M, "--auditar", ID, "--decisiones", "/no/existe.md"], rc: 2, preparar: una },
  { nombre: "actualizar: corrida que no existe", args: ["demo", "--sin-jefe", "-m", M, "--actualizar", ID], rc: 2, preparar: fijo },
  { nombre: "actualizar: con --leer", args: ["demo", "--sin-jefe", "-m", M, "--leer", "--actualizar", ID], rc: 2, preparar: una },
  {
    nombre: "actualizar: la rama ya no existe",
    args: ["demo", "--sin-jefe", "-m", M, "--actualizar", ID],
    rc: 2,
    preparar: (c) => {
      una(c);
      gitFijo(c, "branch", "-q", "-D", `pa/${SLUG}/${ID}`);
    },
  },
];
