// proyecto-ruta <nombre> — resuelve el nombre de un proyecto a su RUTA REAL canónica. Port a TypeScript de motor/bin/proyecto-ruta
// (misma CLI, misma salida, mismos códigos de salida). Única fuente de verdad de "nombre → carpeta".
//
//   proyecto-ruta omc        -> $HOME/omc
//   proyecto-ruta cartera    -> $HOME/cartera-usd   (match por substring)
//   proyecto-ruta --listar   -> nombres, uno por línea
//
// Un proyecto también responde a su nombre para mostrar (`titulo`) y a sus `alias`/`aliases` del registry. Se resuelve a la
// ruta real y no al symlink de ~/Proyectos porque el cwd es la clave con la que Claude indexa la memoria de la sesión.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { homeDe, registroProyectos } from "../rutas.ts";
import { esPrincipal } from "./base/principal.ts";

type Env = Record<string, string | undefined>;
export type Salida = { out: (s: string) => void; err: (s: string) => void };
export type Resolucion = { ok: true; ruta: string } | { ok: false; codigo: number; mensaje: string };

type Proyecto = Record<string, unknown>;

const minus = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase()); // ascii_downcase de jq
const esTexto = (v: unknown): v is string => typeof v === "string";
const comoTexto = (v: unknown) => (esTexto(v) ? v : JSON.stringify(v ?? null)); // lo que imprime `jq -r`

/** Los `.projects[]` del registry. Tira si no se puede leer como el registry que espera el motor. */
export class ErrorRegistry extends Error {
  codigo: number;
  constructor(mensaje: string, codigo: number) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export function leerProyectos(registry: string): Proyecto[] {
  let j: unknown;
  try {
    j = JSON.parse(readFileSync(registry, "utf8"));
  } catch (e) {
    throw new ErrorRegistry(`jq: error: no se pudo leer ${registry}: ${(e as Error).message}`, 2);
  }
  const ps = (j as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(ps)) throw new ErrorRegistry("jq: error: Cannot iterate over " + (ps === undefined || ps === null ? "null" : typeof ps), 5);
  return ps.map((p) => (p && typeof p === "object" && !Array.isArray(p) ? (p as Proyecto) : {}));
}

/** Nombres únicos y ordenados (`sort -u`). */
export const nombres = (ps: Proyecto[]): string[] => [...new Set(ps.map((p) => comoTexto(p.name)))].sort();

/** Nombre para mostrar y alias del proyecto, en minúsculas ASCII. */
function nombresAlternos(p: Proyecto): string[] {
  const lista = (v: unknown): unknown[] => (v === undefined || v === null || v === false ? [] : Array.isArray(v) ? v : [v]);
  return [...lista(p.titulo), ...lista(p.alias), ...lista(p.aliases)].filter((x): x is string => esTexto(x) && x !== "").map(minus);
}

/** `readlink -f`: la ruta real aunque falte el último componente; null si falta más de uno. */
export function rutaReal(r: string): string | null {
  const abs = path.resolve(r);
  try {
    return realpathSync(abs);
  } catch {
    const padre = path.dirname(abs);
    if (padre === abs) return null;
    try {
      return path.join(realpathSync(padre), path.basename(abs));
    } catch {
      return null;
    }
  }
}

const esArchivo = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const esCarpeta = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** `~` al principio → HOME (`${r/#\~/$HOME}`). */
const expandir = (r: string, home: string) => (r.startsWith("~") ? home + r.slice(1) : r);

export function resolverProyecto(sel: string, env: Env = process.env, registry = registroProyectos(env)): Resolucion {
  const home = homeDe(env);
  if (!existsSync(registry) || !esArchivo(registry)) return { ok: false, codigo: 1, mensaje: `no existe el registry: ${registry}\n` };
  const ps = leerProyectos(registry);
  // jq `contains("")` matchea TODO: un nombre vacío no puede resolver al primer proyecto del registry.
  if (sel === "") return { ok: false, codigo: 2, mensaje: "proyecto-ruta: nombre vacío\n" };
  const q = minus(sel);

  // match exacto primero, después exacto sin mayúsculas, después por nombre para mostrar/alias, al final por substring
  let ruta = "";
  const exacto = ps.find((p) => p.name === sel);
  if (exacto) ruta = comoTexto(exacto.path);
  if (!ruta) {
    const ci = ps.find((p) => esTexto(p.name) && minus(p.name) === q);
    if (ci) ruta = comoTexto(ci.path);
  }
  if (!ruta) {
    const porAlias = ps.filter((p) => nombresAlternos(p).includes(q)).map((p) => `${comoTexto(p.name)}\t${comoTexto(p.path)}`);
    if (porAlias.length > 0) {
      // varios nombres para la MISMA carpeta no son ambiguos (el path puede venir con ~ o con symlink: se compara resuelto)
      const reales = new Set(
        porAlias.map((l) => {
          let r = expandir(l.split("\t")[1] ?? "", home);
          if (esArchivo(r)) r = path.dirname(r);
          return rutaReal(r) ?? r;
        }),
      );
      if (reales.size > 1) {
        return { ok: false, codigo: 1, mensaje: `proyecto-ruta: '${sel}' es el nombre de más de un proyecto:\n${porAlias.map((l) => `  ${l}\n`).join("")}usá el nombre exacto del registry.\n` };
      }
      ruta = porAlias[0]!.slice(porAlias[0]!.indexOf("\t") + 1);
    }
  }
  if (!ruta) {
    // Ambigüedad: falla y muestra los candidatos en vez de elegir el primero en silencio.
    const cands = ps
      .filter((p) => (esTexto(p.name) && minus(p.name).includes(q)) || (esTexto(p.titulo) && q !== "" && minus(p.titulo).includes(q)))
      .map((p) => `${comoTexto(p.name)}\t${comoTexto(p.path)}`);
    // Varios nombres que apuntan a la MISMA carpeta no son ambiguos: son alias.
    const rutasUnicas = new Set(cands.map((l) => l.slice(l.indexOf("\t") + 1))).size;
    if (cands.length > 1 && rutasUnicas > 1) {
      return { ok: false, codigo: 1, mensaje: `proyecto-ruta: '${sel}' es ambiguo, hay ${cands.length} candidatos:\n${cands.map((l) => `  ${l}\n`).join("")}usá el nombre exacto.\n` };
    }
    if (cands.length >= 1) ruta = cands[0]!.slice(cands[0]!.indexOf("\t") + 1);
  }
  if (!ruta) return { ok: false, codigo: 1, mensaje: `no encontré '${sel}'. Proyectos:\n${nombres(ps).map((n) => n + "\n").join("")}` };

  ruta = expandir(ruta, home);
  // el registry puede apuntar a un archivo (los proyectos de un solo script): voy a su carpeta
  if (esArchivo(ruta)) ruta = path.dirname(ruta);
  const real = rutaReal(ruta);
  if (real === null) return { ok: false, codigo: 1, mensaje: "" }; // `readlink -f` falló: el original sale mudo con 1
  if (!esCarpeta(real)) return { ok: false, codigo: 1, mensaje: `la ruta no existe: ${real}\n` };
  return { ok: true, ruta: real };
}

/** La herramienta. Devuelve el código de salida. */
export function main(argv: string[], env: Env = process.env, io: Salida = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }): number {
  const registry = registroProyectos(env);
  try {
    if (!existsSync(registry) || !esArchivo(registry)) {
      io.err(`no existe el registry: ${registry}\n`);
      return 1;
    }
    if (argv[0] === "--listar") {
      io.out(nombres(leerProyectos(registry)).map((n) => n + "\n").join(""));
      return 0;
    }
    if (argv.length !== 1) {
      io.err("uso: proyecto-ruta <nombre> | --listar\n");
      return 2;
    }
    const r = resolverProyecto(argv[0]!, env, registry);
    if (r.ok) {
      io.out(r.ruta + "\n");
      return 0;
    }
    io.err(r.mensaje);
    return r.codigo;
  } catch (e) {
    if (e instanceof ErrorRegistry) {
      io.err(e.message + "\n");
      return e.codigo;
    }
    throw e;
  }
}

if (esPrincipal(import.meta.url)) process.exitCode = main(process.argv.slice(2));
