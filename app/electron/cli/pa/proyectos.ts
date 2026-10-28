// `pa --proyectos [--json]` y `pa --renombrar <proyecto> <nombre> | --quitar` (cmd_proyectos, cmd_renombrar, nombre_invalido de
// motor/bin/pa): los proyectos del registry con su nombre para mostrar, slug y ruta, y cambiar ese nombre. Renombrar SÓLO cambia el
// `titulo` del registry: el slug, la ruta, las ramas pa/<slug>/… y el historial quedan como están. Las mismas reglas las valida la app
// (electron/proyectos-nombre.ts): si cambia una, cambia la otra.
import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFileSync } from "node:fs";
import path from "node:path";
import { registroProyectos } from "../../rutas.ts";
import { escribirAtomicoSync } from "../base/archivo.ts";
import { rutaReal } from "../proyecto-ruta.ts";
import { esArchivo, rutaDeProyecto, slugDe } from "./corridas.ts";
import type { Pa } from "./entorno.ts";
import { realpathM } from "./ramas-base.ts";

const NOMBRE_MAX = 40;

type Fila = Record<string, unknown>;
/** El valor como lo imprime `jq -r` / `@tsv`: "" para null/false, el texto, o el JSON de lo demás. */
const comoTexto = (v: unknown): string => (v === undefined || v === null || v === false ? "" : typeof v === "string" ? v : JSON.stringify(v));
/** Truthy de jq: todo salvo null y false (un "" cuenta). */
const verdad = (v: unknown) => v !== undefined && v !== null && v !== false;
const ctrl = (s: string) => /[\u0000-\u001f\u007f]/.test(s);
const largo = (s: string) => [...s].length;

/** `registro_json`. */
const registroDe = (pa: Pa) => registroProyectos(pa.env, pa.home, pa.plat);

/** Los proyectos del registry (`.projects[]?`); [] si el JSON no sirve. */
function leerProyectos(reg: string): Fila[] {
  try {
    const ps = (JSON.parse(readFileSync(reg, "utf8")) as { projects?: unknown } | null)?.projects;
    return Array.isArray(ps) ? ps.filter((p): p is Fila => !!p && typeof p === "object" && !Array.isArray(p)) : [];
  } catch {
    return [];
  }
}

/** `ruta_real_de`: el path crudo del registry → ruta real (~ al home, archivo → su carpeta, `realpath -m`). */
function rutaRealDe(pa: Pa, p: string): string {
  let r = p.startsWith("~") ? pa.home + p.slice(1) : p;
  if (esArchivo(r)) r = path.dirname(r);
  return realpathM(r);
}

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));

/** `cmd_proyectos`. */
export function cmdProyectos(pa: Pa, args: string[]): number {
  const { io } = pa;
  const json = args[0] === "--json";
  const reg = registroDe(pa);
  if (!esArchivo(reg)) {
    io.err(`pa: no existe el registry: ${reg}\n`);
    return 1;
  }
  const filas: { nombre: string; titulo: string | null; slug: string; ruta: string }[] = [];
  for (const p of leerProyectos(reg)) {
    if (!verdad(p.name)) continue;
    const n = comoTexto(p.name);
    if (!n) continue;
    const ruta = rutaRealDe(pa, comoTexto(p.path));
    const t = comoTexto(p.titulo ?? "");
    filas.push({ nombre: n, titulo: t === "" ? null : t, slug: slugDe(ruta), ruta });
  }
  if (json) {
    io.out(`${JSON.stringify(filas, null, 2)}\n`);
    return 0;
  }
  if (!filas.length) {
    io.out("pa: el registry no tiene proyectos.\n");
    return 0;
  }
  io.out(`${pad("NOMBRE", 24)} ${pad("MUESTRA", 24)} ${pad("SLUG", 24)} RUTA\n`);
  for (const f of filas) io.out(`${pad(f.nombre, 24)} ${pad(f.titulo ?? "-", 24)} ${pad(f.slug, 24)} ${f.ruta}\n`);
  io.out(
    "(MUESTRA es el nombre para mostrar: la app lo usa en todos lados y `pa <MUESTRA> …` vale igual que `pa <NOMBRE> …`. Se cambia con: pa --renombrar <proyecto> <nombre>.)\n",
  );
  return 0;
}

/** `nombre_invalido`: por qué un nombre para mostrar no va ("" si va). `propia` = ruta real del proyecto que se renombra. */
function nombreInvalido(pa: Pa, n: string, propia: string): string {
  if (!n) return "está vacío";
  if (largo(n) > NOMBRE_MAX) return `tiene más de ${NOMBRE_MAX} caracteres`;
  if (n.startsWith("-")) return "no puede empezar con '-' (parecería una opción)";
  if (ctrl(n)) return "tiene saltos de línea o caracteres de control";
  const q = n.toLowerCase();
  for (const p of leerProyectos(registroDe(pa))) {
    if (!verdad(p.name)) continue;
    const nom = comoTexto(p.name);
    if (!nom) continue;
    const r = rutaRealDe(pa, comoTexto(p.path));
    if (r === propia) continue;
    if (q === nom.toLowerCase()) return `ya es el nombre de otro proyecto ('${nom}')`;
    if (q === slugDe(r)) return `ya es el slug de otro proyecto ('${nom}')`;
    const lista = (v: unknown): unknown[] => (!verdad(v) ? [] : Array.isArray(v) ? v : [v]);
    const otros = [...lista(p.titulo), ...lista(p.alias), ...lista(p.aliases)].filter((x): x is string => typeof x === "string" && x !== "");
    for (const otro of otros) if (q === otro.toLowerCase()) return `ya lo usa otro proyecto ('${nom}')`;
  }
  return "";
}

/** `cmd_renombrar`. */
export function cmdRenombrar(pa: Pa, args: string[]): number {
  const { io } = pa;
  const sel = args[0] ?? "";
  if (!sel || args.length < 2) {
    io.err("uso: pa --renombrar <proyecto> <nombre>  |  pa --renombrar <proyecto> --quitar  (pa --proyectos los lista)\n");
    return 2;
  }
  let nuevo = args[1]!;
  let quitar = false;
  if (nuevo === "--quitar") {
    quitar = true;
    nuevo = "";
  }
  const reg = registroDe(pa);
  const rutaP = rutaDeProyecto(pa, sel);
  if (rutaP === null) return 1;
  const slugP = slugDe(rutaP);
  nuevo = nuevo.replace(/^\s+/, "").replace(/\s+$/, "");
  const propia = rutaReal(rutaP) ?? rutaP;
  let json: { projects?: unknown } & Record<string, unknown>;
  let ps: Fila[];
  try {
    json = JSON.parse(readFileSync(reg, "utf8")) as typeof json;
    ps = Array.isArray(json.projects) ? (json.projects as Fila[]) : [];
  } catch {
    return 1;
  }
  const idx: number[] = [];
  ps.forEach((p, i) => {
    if (p && typeof p === "object" && rutaRealDe(pa, comoTexto(p.path)) === propia) idx.push(i);
  });
  if (!idx.length) {
    io.err(`pa: no encuentro '${sel}' en el registry.\n`);
    return 1;
  }
  const n = comoTexto(ps[idx[0]!]!.name);
  if (!quitar) {
    const por = nombreInvalido(pa, nuevo, propia);
    if (por) {
      io.err(`pa: '${nuevo}' no sirve como nombre: ${por}.\n`);
      return 2;
    }
    // igual al nombre del registry: no hace falta guardar nada
    if (nuevo === n) quitar = true;
  }
  for (const i of idx) {
    if (quitar) delete ps[i]!.titulo;
    else ps[i]!.titulo = nuevo;
  }
  let modo: number | undefined;
  try {
    modo = statSync(reg).mode & 0o777;
  } catch {
    /* sin modo */
  }
  try {
    if (existsSync(reg)) copyFileSync(reg, `${reg}.bak`);
  } catch {
    /* `|| true` */
  }
  try {
    escribirAtomicoSync(reg, `${JSON.stringify(json, null, 2)}\n`, { modo });
  } catch {
    io.err("pa: no pude escribir el registry.\n");
    return 1;
  }
  if (quitar) io.out(`pa: '${n}' vuelve a mostrarse con su nombre del registry.\n`);
  else
    io.out(
      `pa: '${n}' ahora se muestra como '${nuevo}' (pa '${nuevo}' … vale igual que pa '${n}' …). Sólo cambia el nombre que se ve: el slug '${slugP}', la ruta, las ramas pa/${slugP}/… y el historial quedan como están.\n`,
    );
  return 0;
}
