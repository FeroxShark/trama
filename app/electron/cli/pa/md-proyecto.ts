// `pa <proyecto> --agents-md` y `pa <proyecto> --unificar-md [--aplicar]`: port de agents_md_plantilla, cmd_unificar_md y el bloque
// `agents_md` de motor/bin/pa. AGENTS.md como única fuente de las instrucciones del proyecto: CLAUDE.md y GEMINI.md quedan como stubs
// que lo importan con `@AGENTS.md`. Sin --aplicar sólo se muestra el plan; con --aplicar se guarda antes cada archivo que cambia en
// `$STATE/<slug>/md-backup/<fecha>/` y se escribe (nunca hace git commit). Las mismas reglas las tiene electron/unificar-md.ts.
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AGENTS_MAX_DEFECTO, agentsMdArchivo, mdStubTexto, mdVacio } from "./motores/prompt.ts";
import type { DeProyecto } from "./cli.ts";

/** `agents_md_plantilla`: lo que se imprime para que el jefe la llene. */
export const AGENTS_PLANTILLA: string[] = [
  "# AGENTS.md",
  "",
  "Lo que un agente que NO conoce este proyecto necesita para trabajar sin preguntar. Corto y concreto:",
  "sólo lo que se verificó, nada aspiracional.",
  "",
  "## Qué es",
  "<una o dos líneas: qué hace el proyecto y para quién>",
  "",
  "## Build y arranque",
  "- Instalar: `<comando>`",
  "- Build: `<comando>`",
  "- Correr: `<comando>`",
  "",
  "## Tests y verificación",
  "- Todos los tests: `<comando>`",
  "- Uno solo: `<comando con ejemplo>`",
  "- Lint / tipos: `<comando>`",
  "- Antes de dar algo por listo se corre: `<comando>`",
  "",
  "## Convenciones",
  "- Idioma de código, comentarios y commits: <...>",
  "- Estilo y formato: <...>",
  "- Estructura: <carpetas principales y qué va en cada una>",
  "",
  "## No tocar",
  "- <archivos generados, vendored, migraciones ya aplicadas, secretos, etc.>",
  "",
  "## Trampas conocidas",
  "- <cosas que ya mordieron: puertos, orden de comandos, variables de entorno>",
];

/** `MD_STUB`: lo que queda en CLAUDE.md / GEMINI.md. */
export const MD_STUB = "<!-- Editá AGENTS.md, no este archivo: acá sólo se importa para que cada modelo (Claude, Gemini, …) lea las mismas instrucciones. -->\n@AGENTS.md";

const MAX_MD = 1048576;
const ESP = "[ \\t\\n\\v\\f\\r]";
const finBlancos = new RegExp(`${ESP}+$`);
const iniBlancos = new RegExp(`^${ESP}+`);

const leer = (f: string): string => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};
const lstat = (f: string) => {
  try {
    return lstatSync(f);
  } catch {
    return null;
  }
};
const esEnlace = (f: string) => lstat(f)?.isSymbolicLink() ?? false;
/** `[[ -e f ]]` (sigue enlaces). */
const existe = (f: string) => {
  try {
    statSync(f);
    return true;
  } catch {
    return false;
  }
};
/** `[[ -f f ]]` (sigue enlaces). */
const esArch = (f: string) => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
};
const tam = (f: string) => {
  try {
    return statSync(f).size;
  } catch {
    return 9999999;
  }
};
/** `readlink -f` (el último componente puede faltar). */
function readlinkF(f: string): string {
  try {
    return realpathSync(f);
  } catch {
    try {
      return path.resolve(path.dirname(f), readlinkSync(f));
    } catch {
      return path.resolve(f);
    }
  }
}
/** `wc -m`. */
const cars = (t: string) => Array.from(t).length;

/** `md_limpio`: sin \r y sin blancos al final de todo. */
export const mdLimpio = (f: string): string => leer(f).replace(/\r/g, "").replace(finBlancos, "");
/** `md_norm`: lo de `md_limpio` y sin blancos al principio. */
export const mdNorm = (f: string): string => mdLimpio(f).replace(iniBlancos, "");
/** `md_es_stub`: sólo `@AGENTS.md`, comentarios HTML de una línea y blancos; o un enlace simbólico a AGENTS.md. */
function mdEsStub(f: string, agents: string): boolean {
  if (esEnlace(f)) return readlinkF(f) === readlinkF(agents);
  return mdStubTexto(leer(f).replace(/\n+$/, ""));
}

/** `pa <proyecto> --agents-md`. */
export const cmdAgentsMd: DeProyecto = (l, pa, p) => {
  const f = agentsMdArchivo([p.ruta]);
  if (f && !l.force) {
    pa.io.err(
      `pa: '${p.slug}' ya tiene ${f} (${cars(leer(f))} caracteres). Actualizalo con lo que aprendas (build, tests, convenciones, qué no tocar) en vez de rehacerlo; --force imprime la plantilla igual.\n`,
    );
  } else {
    pa.io.err(
      `pa: plantilla para ${p.ruta}/AGENTS.md. Llenala con lo que VERIFICASTE del proyecto (comandos que corrés de verdad) y guardala ahí; los workers que no son Claude la reciben en el contrato (tope ${pa.env.PA_AGENTS_MAX || AGENTS_MAX_DEFECTO} caracteres). Si ya tenés un CLAUDE.md, mejor: pa '${l.proyecto}' --unificar-md.\n`,
    );
    pa.io.out(`${AGENTS_PLANTILLA.join("\n")}\n`);
  }
  return 0;
};

const dos = (n: number) => String(n).padStart(2, "0");
/** `date +%Y%m%d-%H%M%S`. */
const sello = (d = new Date()) => `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;

type Tipo = "falta" | "stub" | "enlace" | "vacio" | "real";
type Accion = { nom: string; que: string; det: string };

/** `escribir_md`: temporal en la misma carpeta, 644 y rename. false si falla. */
function escribirMd(ruta: string, nom: string, contenido: string): boolean {
  const t = path.join(ruta, `.${nom}.pa-${Math.random().toString(36).slice(2, 8).padEnd(6, "x")}`);
  try {
    writeFileSync(t, `${contenido}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(t, 0o644);
    renameSync(t, path.join(ruta, nom));
    return true;
  } catch {
    rmSync(t, { force: true });
    return false;
  }
}

/** `pa <proyecto> --unificar-md [--aplicar]` (cmd_unificar_md). */
export const cmdUnificarMd: DeProyecto = (l, pa, p) => {
  const { io } = pa;
  const { ruta, slug, dir } = p;
  const aplicar = l.aplicar;
  const A = path.join(ruta, "AGENTS.md");
  const noms = ["CLAUDE.md", "GEMINI.md"] as const;
  const tipo: Record<string, Tipo> = {};
  const texto: Record<string, string> = {};
  const fuentes: string[] = [];
  const avisos: string[] = [];
  const acciones: Accion[] = [];

  let hayA = (lstat(A)?.isFile() ?? false) && !esEnlace(A);
  if (esEnlace(A)) {
    io.err(`pa: ${A} es un enlace simbólico: no lo toco. Unificá a mano.\n`);
    return 1;
  }
  // un AGENTS.md en blanco es como si faltara (se guarda igual en el backup)
  if (hayA && mdVacio(leer(A))) hayA = false;
  for (const nom of noms) {
    const f = path.join(ruta, nom);
    if (!existe(f) && !esEnlace(f)) tipo[nom] = "falta";
    else if (esEnlace(f)) {
      if (hayA && mdEsStub(f, A)) tipo[nom] = "stub";
      else {
        tipo[nom] = "enlace";
        avisos.push(`${nom} es un enlace simbólico que no apunta a AGENTS.md: no lo toco.`);
      }
    } else if (!esArch(f)) {
      tipo[nom] = "enlace";
      avisos.push(`${nom} no es un archivo común: no lo toco.`);
    } else if (tam(f) > MAX_MD) {
      tipo[nom] = "enlace";
      avisos.push(`${nom} pesa más de 1 MB: no lo toco.`);
    } else if (mdVacio(leer(f))) tipo[nom] = "vacio";
    else if (mdEsStub(f, A)) tipo[nom] = "stub";
    else {
      tipo[nom] = "real";
      fuentes.push(nom);
      texto[nom] = mdLimpio(f);
    }
  }
  if (hayA && tam(A) > MAX_MD) {
    io.err("pa: AGENTS.md pesa más de 1 MB: no lo toco.\n");
    return 1;
  }
  const base = hayA ? mdLimpio(A) : "";
  let nuevoA = "";
  if (!hayA) {
    if (fuentes.length === 0) {
      io.out(`pa: '${slug}' no tiene CLAUDE.md ni GEMINI.md con contenido que pasar a AGENTS.md: nada que unificar. Para empezar de cero: pa '${l.proyecto}' --agents-md\n`);
      return 0;
    }
    if (fuentes.length === 1) {
      nuevoA = texto[fuentes[0]!]!;
      acciones.push({ nom: "AGENTS.md", que: "crea", det: `con el contenido de ${fuentes[0]}` });
    } else if (mdNorm(path.join(ruta, "CLAUDE.md")) === mdNorm(path.join(ruta, "GEMINI.md"))) {
      nuevoA = texto["CLAUDE.md"]!;
      acciones.push({ nom: "AGENTS.md", que: "crea", det: "con el contenido de CLAUDE.md (GEMINI.md decía lo mismo)" });
    } else {
      nuevoA = `# AGENTS.md\n\n<!-- Unificado desde CLAUDE.md y GEMINI.md, que decían cosas distintas: revisá y juntá lo repetido. -->\n\n## Desde CLAUDE.md\n\n${texto["CLAUDE.md"]}\n\n## Desde GEMINI.md\n\n${texto["GEMINI.md"]}`;
      acciones.push({ nom: "AGENTS.md", que: "crea", det: "juntando CLAUDE.md y GEMINI.md en secciones (decían cosas distintas)" });
    }
  } else {
    nuevoA = base;
    for (const nom of fuentes) {
      if (mdNorm(path.join(ruta, nom)) === mdNorm(A) || base.includes(texto[nom]!.replace(iniBlancos, ""))) {
        acciones.push({ nom, que: "sin-cambio-en-agents", det: "ya está dentro de AGENTS.md" });
      } else {
        nuevoA += `\n\n## Desde ${nom} (unificado acá; revisalo y juntá lo repetido)\n\n${texto[nom]}`;
        acciones.push({ nom: "AGENTS.md", que: "anexa", det: `con lo de ${nom} que no estaba` });
      }
    }
  }
  for (const nom of noms) {
    if (tipo[nom] === "real" || tipo[nom] === "vacio") acciones.push({ nom, que: "stub", det: "se reemplaza por un stub que importa @AGENTS.md" });
    else if (tipo[nom] === "falta" && nom === "CLAUDE.md")
      acciones.push({ nom, que: "crea-stub", det: "se crea un stub que importa @AGENTS.md (Claude Code no lee AGENTS.md solo)" });
  }
  const cambios = acciones.some((a) => ["crea", "anexa", "stub", "crea-stub"].includes(a.que));
  io.out(`pa: unificar las instrucciones de '${slug}' (${ruta}) en AGENTS.md${aplicar ? "" : " — vista previa, no se escribió nada (usá --aplicar)"}\n`);
  for (const a of avisos) io.out(`  aviso: ${a}\n`);
  if (!cambios) {
    io.out("  Ya está unificado: AGENTS.md es la fuente y CLAUDE.md / GEMINI.md no tienen contenido propio. Nada que hacer.\n");
    return 0;
  }
  for (const a of acciones) io.out(`  ${a.nom.padEnd(10)} ${a.que === "sin-cambio-en-agents" ? "sin cambios" : a.que}: ${a.det}\n`);
  if (!aplicar) {
    if (!hayA || nuevoA !== base) io.out(`\n--- AGENTS.md (queda así; ${nuevoA.split("\n").length} líneas) ---\n${nuevoA}\n`);
    io.out(`\n--- CLAUDE.md / GEMINI.md (los que cambian) quedan así ---\n${MD_STUB}\n`);
    io.out(`\nPara aplicarlo: pa '${l.proyecto}' --unificar-md --aplicar  (guarda antes lo que cambia en ${dir}/md-backup/<fecha>/; no hace commit).\n`);
    return 0;
  }
  const bk = path.join(dir, "md-backup", sello());
  mkdirSync(bk, { recursive: true });
  for (const nom of ["AGENTS.md", ...noms]) {
    const f = path.join(ruta, nom);
    const s = lstat(f);
    if (s?.isFile()) {
      try {
        copyFileSync(f, path.join(bk, nom));
        chmodSync(path.join(bk, nom), s.mode & 0o7777);
        utimesSync(path.join(bk, nom), s.atime, s.mtime);
      } catch {
        /* `cp -p` */
      }
    }
  }
  for (const nom of noms) if (esEnlace(path.join(ruta, nom))) writeFileSync(path.join(bk, `${nom}.enlace`), `${nom} -> ${readlinkSync(path.join(ruta, nom))}\n`);
  if ((!hayA || nuevoA !== base) && !escribirMd(ruta, "AGENTS.md", nuevoA)) {
    io.err("pa: no pude escribir AGENTS.md.\n");
    return 1;
  }
  for (const nom of noms) {
    if (tipo[nom] === "real" || tipo[nom] === "vacio") {
      if (!escribirMd(ruta, nom, MD_STUB)) {
        io.err(`pa: no pude escribir ${nom} (el original está en ${bk}).\n`);
        return 1;
      }
    } else if (tipo[nom] === "falta" && nom === "CLAUDE.md" && !escribirMd(ruta, nom, MD_STUB)) return 1;
  }
  io.out(
    `\npa: listo. Lo anterior quedó en ${bk}. No hice git commit: commiteá AGENTS.md y CLAUDE.md juntos (sin AGENTS.md en el repo, el stub de CLAUDE.md no apunta a nada en los worktrees de los workers).\n`,
  );
  const tope = /^[0-9]+$/.test(pa.env.PA_AGENTS_MAX || "") ? Number(pa.env.PA_AGENTS_MAX) : AGENTS_MAX_DEFECTO;
  const nA = cars(nuevoA);
  if (nA > tope) io.err(`pa: ojo: AGENTS.md tiene ${nA} caracteres y los modelos que no son Claude reciben sólo los primeros ${tope} (PA_AGENTS_MAX).\n`);
  return 0;
};
