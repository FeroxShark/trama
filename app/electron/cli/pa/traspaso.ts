// `pa --traspaso` (cmd_traspaso de motor/bin/pa): el resumen en markdown que el jefe lee al retomar: sus notas, lo que corre, lo que
// terminó sin cobrar, lo cobrado en las últimas 12 h y las ramas sin integrar. Lectura pura del estado en disco: no gasta tokens.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { notasDeJefe } from "./cli.ts";
import { esArchivo, fechaHora, kill0, leerCampo, leerTexto, listar, masViejoQue, nombreRegistry, runningVivo, transcurrido, esCarpeta } from "./corridas.ts";
import { jefeId, jefeNombre, nombreDueno, type Pa } from "./entorno.ts";
import { commitsPendientes } from "./ramas-base.ts";

/** `cut -c1-N` / `substr($0, 1, N)`: los primeros N caracteres. */
const corte = (s: string, n: number) => [...s].slice(0, n).join("");

/** Los valores que imprime `jq -r '.result // …'` para el campo `result` (texto, o el JSON de lo que no sea texto). */
function resultadoDeJson(archivo: string, vacio: string): string | null {
  let j: unknown;
  try {
    j = JSON.parse(readFileSync(archivo, "utf8"));
  } catch {
    return null;
  }
  const r = j && typeof j === "object" ? (j as Record<string, unknown>).result : undefined;
  if (r === undefined || r === null || r === false) return vacio;
  return typeof r === "string" ? r : JSON.stringify(r);
}

/** `resultado_de`: «rc · primera línea de RESULTADO» de un `.listo` / `.entregado`. */
function resultadoDe(f: string): string {
  const o = leerCampo(f, "salida");
  const rc = leerCampo(f, "rc");
  let linea = "";
  const a = resultadoDeJson(o, "");
  if (a !== null) {
    // awk: la primera línea que empieza con RESULTADO:, cortada a 220 caracteres
    const l = a.split("\n").find((x) => x.startsWith("RESULTADO:"));
    linea = l === undefined ? "" : corte(l, 220);
  }
  if (!linea) {
    const b = resultadoDeJson(o, "(sin resultado)");
    linea = b === null ? "" : corte(b.split("\n")[0] ?? "", 220);
  }
  return `rc=${rc || "?"} · ${linea || "(sin resultado)"}`;
}

export async function cmdTraspaso(pa: Pa): Promise<number> {
  const { state } = pa;
  const yo = jefeId(pa);
  const nombre = jefeNombre(pa);
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  // `es_mia_t`: la corrida es de este jefe (o no tiene dueño anotado)
  const esMia = (d: string, t: string): boolean => {
    if (!yo) return true;
    let j = "";
    if (esArchivo(path.join(d, `${t}.corrida`))) j = leerCampo(path.join(d, `${t}.corrida`), "jefe_id");
    if (!j && esArchivo(path.join(d, `${t}.jefe`))) j = leerCampo(path.join(d, `${t}.jefe`), "jefe_id");
    return !j || j === yo;
  };
  const nombreDe = (slug: string) => nombreRegistry(pa, slug);
  // `"$STATE"/*/<ext>`: por carpeta, en el orden del glob
  const deCarpetas = (ext: string): { d: string; t: string; f: string }[] => {
    const r: { d: string; t: string; f: string }[] = [];
    for (const c of listar(state, (n) => esCarpeta(path.join(state, n)))) {
      const d = path.join(state, c);
      for (const n of listar(d, (x) => x.endsWith(ext) && x.length > ext.length)) r.push({ d, t: n.slice(0, -ext.length), f: path.join(d, n) });
    }
    return r;
  };

  p(`# Traspaso automático del jefe — ${fechaHora(new Date())}`);
  p();
  p(`Armado por \`pa --traspaso\` desde el estado en disco (no gastó tokens). Jefe: ${nombre || "?"} (id ${yo || "?"}).`);
  p();
  p(`## Notas del jefe (pedidos de ${nombreDueno(pa.env, pa.home)}, decisiones, qué sigue)`);
  const notas = notasDeJefe(pa);
  let tam = 0;
  try {
    tam = statSync(notas).size;
  } catch {
    /* sin notas */
  }
  if (tam > 0) {
    const ls = readFileSync(notas, "utf8").split("\n");
    if (ls[ls.length - 1] === "") ls.pop();
    for (const l of ls.slice(-40)) p(`- ${l}`);
  } else p("(no dejó notas)");
  p();

  p("## Corriendo ahora");
  let hubo = false;
  for (const n of listar(state, (x) => x.endsWith(".running") && x.length > ".running".length)) {
    const r = path.join(state, n);
    if (!runningVivo(r)) continue;
    const j = leerCampo(r, "jefe_id");
    if (!(!yo || !j || j === yo)) continue;
    hubo = true;
    p(`- ${nombreDe(leerCampo(r, "proyecto"))} · id ${leerCampo(r, "id")} · hace ${transcurrido(leerCampo(r, "inicio"))} · ${corte(leerCampo(r, "tarea"), 160)}`);
  }
  for (const { d, t, f } of deCarpetas(".pid")) {
    if ([".corrida", ".listo", ".entregado"].some((e) => existsSync(path.join(d, t + e)))) continue;
    if (!kill0(leerTexto(f))) continue;
    if (!esMia(d, t)) continue;
    hubo = true;
    p(`- ${nombreDe(path.basename(d))} · id ${t} · EN COLA`);
  }
  if (!hubo) p("(nada)");
  p();

  p("## Terminadas sin cobrar — cobralas con `pa --esperar <proyecto> --id <id>`");
  hubo = false;
  for (const { d, t, f } of deCarpetas(".listo")) {
    if (masViejoQue(f, 1440)) continue;
    if (!esMia(d, t)) continue;
    hubo = true;
    p(`- ${nombreDe(path.basename(d))} · id ${t} · ${resultadoDe(f)}`);
  }
  if (!hubo) p("(nada)");
  p();

  p("## Cobradas en las últimas 12 h");
  hubo = false;
  for (const { d, t, f } of deCarpetas(".entregado")) {
    if (!(Date.now() - statSync(f).mtimeMs < 720 * 60_000)) continue;
    if (!esMia(d, t)) continue;
    hubo = true;
    p(`- ${nombreDe(path.basename(d))} · id ${t} · ${resultadoDe(f)}`);
  }
  if (!hubo) p("(nada)");
  p();

  p("## Ramas sin integrar (todavía NO están en main)");
  hubo = false;
  for (const { d, t, f } of deCarpetas(".corrida")) {
    const r = leerCampo(f, "rama");
    if (!r) continue;
    if (!esMia(d, t)) continue;
    const trabajo = leerCampo(f, "ruta_trabajo");
    const n = await commitsPendientes({ pa, proyecto: "", ruta: "", slug: "", dir: "" }, trabajo, r);
    if (!(n > 0)) continue;
    const slug = nombreDe(path.basename(d));
    hubo = true;
    p(`- ${slug} · id ${t} · ${n} commit(s) · \`pa '${slug}' --integrar ${t}\``);
  }
  if (!hubo) p("(nada)");
  pa.io.out(`${out.join("\n")}\n`);
  return 0;
}
