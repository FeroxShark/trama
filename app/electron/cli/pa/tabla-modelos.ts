// `pa --modelos [--json]`, `pa --cupo-gemini` y `pa --gemini-proyectos` (cmd_modelos, cmd_cupo_gemini y cmd_gemini_proyectos de
// motor/bin/pa): la tabla efectiva tipo → modelo (de dónde salió y qué elige reparto hoy), el líder, la política de cupo, los locales
// que responden y los catálogos de dsh y opencode. La lee Trama (`--json`); el texto es para el jefe.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { entornoCmd } from "../../binario.ts";
import { correr } from "../base/proc.ts";
import { type Pa } from "./entorno.ts";
import { dshBin, dshClave, clavesEnv, localDe, localEstado, localTags, opencodeBin, type Local } from "./motores/chequeo.ts";
import { DSH_DEEPSEEK_MODELOS, OC_GRATIS_CONOCIDOS } from "./motores/modelos.ts";
import { esCodex, esDsh, esGemini, esLocal, Modelos, problemaModelos, TIPOS_VALIDOS } from "./modelos.ts";
import { prefijoDe, repartoProceso } from "./programas.ts";
import { jsonJq } from "./rinde.ts";

type Json = unknown;
const esObj = (x: Json): x is Record<string, Json> => !!x && typeof x === "object" && !Array.isArray(x);
/** Una cadena de jq: `//` deja pasar todo menos null y false. */
const alt = (x: Json, d: Json): Json => (x === null || x === undefined || x === false ? d : x);
/** El valor como lo escribe `join` o una interpolación de jq (tira si es un objeto o una lista). */
function texto(x: Json): string {
  if (x === null || x === undefined) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  throw new Error("no se puede unir");
}
/** `"\(x)"` de jq. */
const interpolar = (x: Json) => (typeof x === "string" ? x : JSON.stringify(x ?? null));
const parsear = (s: string): Json => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
/** El motor de un modelo (`motor($m)` del jq de cmd_modelos). */
function motor(m: string): string {
  if (m.startsWith("ollama:")) return "ollama";
  if (m.startsWith("dsh:")) return "dsh";
  if (m.startsWith("opencode:")) return "opencode";
  if (m.startsWith("codex:")) return "codex";
  if (m.startsWith("gemini") || m.startsWith("agy:")) return "agy";
  return "claude";
}

// ------------------------------------------------------------------------------------------- catálogos

/** `dsh_catalogo`: una línea por modelo: id, gratis (1|0), disponible (1|0), detalle. */
export async function dshCatalogo(pa: Pa, locales: Local[] | null): Promise<string[]> {
  const salida: string[] = [];
  const ruta = dshBin(pa.env, pa.plat) ? "" : "no está instalado dsh";
  const k = dshClave("DEEPSEEK_API_KEY", pa.env, pa.plat) !== "";
  for (const m of DSH_DEEPSEEK_MODELOS) {
    const ok = !ruta && k ? 1 : 0;
    salida.push(`dsh:deepseek/${m}\t0\t${ok}\t${ruta || (k ? "se paga con tu key" : "falta DEEPSEEK_API_KEY")}`);
  }
  const url = localDe("ollama:x", locales, pa.env).url;
  const t = ruta ? null : await localTags(url, pa.env);
  if (t !== null) {
    const j = parsear(t);
    const ms = esObj(j) && Array.isArray(j.models) ? j.models : [];
    for (const x of ms) {
      const nombre = esObj(x) ? x.name : undefined;
      if (typeof nombre === "string" && nombre !== "") salida.push(`dsh:ollama/${nombre}\t1\t1\tlocal, gratis (${url})`);
    }
  }
  return salida;
}

/** `opencode_catalogo`: los gratis que lista `opencode models` o, si no contesta, los conocidos. */
export async function opencodeCatalogo(pa: Pa, archivoModelos = ""): Promise<string[]> {
  const inst = opencodeBin(pa.env, pa.plat);
  let lista: string[] = [];
  if (inst) {
    const r = await correr(inst, ["models"], { env: entornoCmd([inst], pa.env), timeoutMs: 10_000, input: "" });
    // eslint-disable-next-line no-control-regex
    const limpio = r.salida.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    lista = limpio
      .split("\n")
      .map((l) => /^opencode\/(big-pickle|[^ \t\n\v\f\r]*-free)$/.exec(l)?.[0]?.replace(/^opencode\//, ""))
      .filter((l): l is string => !!l);
  }
  if (!lista.length) lista = OC_GRATIS_CONOCIDOS;
  const detalle = inst ? "con tu login de OpenCode Console (opencode → /connect)" : "no está instalado opencode";
  const out = lista.map((m) => `opencode:opencode/${m}\t1\t${inst ? 1 : 0}\t${detalle}`);
  // NVIDIA NIM: los de `nvidia_modelos` de modelos.json (default deepseek-ai/deepseek-v4.1-flash); disponibles con NVIDIA_API_KEY.
  const hayKey = !!inst && dshClave("NVIDIA_API_KEY", pa.env, pa.plat) !== "";
  const detNv = !inst ? "no está instalado opencode" : hayKey ? "con tu NVIDIA_API_KEY (NVIDIA NIM, ~40 pedidos por minuto)" : `falta NVIDIA_API_KEY (build.nvidia.com; en ${clavesEnv(pa.env, pa.plat)})`;
  let nv: string[] = ["deepseek-ai/deepseek-v4.1-flash"];
  try {
    const j = parsear(readFileSync(archivoModelos, "utf8"));
    if (esObj(j) && Array.isArray(j.nvidia_modelos)) nv = j.nvidia_modelos.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(x));
  } catch {
    /* sin modelos.json: el default */
  }
  return out.concat(nv.map((m) => `opencode:nvidia/${m}\t1\t${hayKey ? 1 : 0}\t${detNv}`));
}

// ------------------------------------------------------------------------------------------- pa --modelos

/** El error de un modelos.json que no vale (`MODELOS_ERR`): "" si vale, no existe o está vacío. */
function errorDeModelos(archivo: string): string {
  let txt = "";
  try {
    if (!statSync(archivo).isFile()) return "";
    txt = readFileSync(archivo, "utf8");
  } catch {
    return "";
  }
  if (!txt.trim()) return "";
  const c = parsear(txt);
  if (c === undefined) return "no es JSON válido";
  return problemaModelos(c);
}

/** `modelo_de_pa`: modelo y effort de pa sin archivo. */
const modeloDePa = (t: string): [string, string] => (t === "mecanico" ? ["claude-haiku-5-5", "xhigh"] : ["claude-sonnet-5-5", "high"]);

interface FilaTipo {
  t: string;
  m: string;
  e: string;
  de: string;
  repM: string;
  repE: string;
  repMot: string;
}

/** Lo que pide el `jq` de la fila de reparto: modelo, effort y motivo (sin `\r \n \t |`), o todo vacío si no se entiende. */
function lecturaReparto(salida: string): { m: string; e: string; mot: string } {
  const j = parsear(salida);
  const vacio = { m: "", e: "", mot: "" };
  if (!esObj(j)) return vacio;
  try {
    const mot = alt(j.motivo, "");
    if (typeof mot !== "string") return vacio;
    return { m: texto(alt(j.modelo, "")), e: texto(alt(j.effort, "")), mot: mot.replace(/[\r\n\t|]+/g, " ") };
  } catch {
    return vacio;
  }
}

/** El `unique_by(.id)` de jq sobre las entradas de `reparto --tabla`. */
function tablaInteligencia(salida: string): { id: Json; calidad: Json; estimada: Json; gratis: Json; permitido: Json }[] {
  const j = parsear(salida);
  if (!esObj(j) || !Array.isArray(j.modelos)) return [];
  const filas = [];
  for (const x of j.modelos) {
    if (x !== null && !esObj(x)) return [];
    const o = (x ?? {}) as Record<string, Json>;
    filas.push({ id: o.id ?? null, calidad: o.calidad ?? null, estimada: o.estimada ?? null, gratis: o.gratis ?? null, permitido: o.permitido ?? null });
  }
  const orden = (a: Json, b: Json): number => {
    const rango = (v: Json) => (v === null ? 0 : v === false ? 1 : v === true ? 2 : typeof v === "number" ? 3 : typeof v === "string" ? 4 : 5);
    if (rango(a) !== rango(b)) return rango(a) - rango(b);
    if (typeof a === "number" && typeof b === "number") return a - b;
    const x = String(typeof a === "string" ? a : JSON.stringify(a));
    const y = String(typeof b === "string" ? b : JSON.stringify(b));
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const ordenadas = filas.map((f, i) => ({ f, i })).sort((p, q) => orden(p.f.id, q.f.id) || p.i - q.i);
  return ordenadas.filter((x, i) => i === 0 || orden(ordenadas[i - 1]!.f.id, x.f.id) !== 0).map((x) => x.f);
}

/** `pa --modelos [--json]`. */
export async function cmdModelos(pa: Pa, args: string[]): Promise<number> {
  const json = args[0] === "--json";
  if (args[0] && args[0] !== "--json") {
    pa.io.err("uso: pa --modelos [--json]\n");
    return 2;
  }
  const modelos = new Modelos(pa.env, pa.io, pa.home, pa.plat);
  const valido = modelos.cargar(); // avisa una sola vez si el archivo no va
  const pol = modelos.politica();
  const repModo = modelos.reparto();
  const reparto = repartoProceso(pa);
  const auto = repModo === "auto" && reparto.ejecutable();

  const filas: FilaTipo[] = [];
  for (const t of ["default", ...TIPOS_VALIDOS.split("|")]) {
    const r = modelos.worker(t === "default" ? "" : t);
    let m: string;
    let e: string;
    let de: string;
    if (r) {
      m = r.modelo;
      e = r.effort;
      de = `modelos.json (workers.${r.clave})`;
      if (!e && !esGemini(m) && !esCodex(m) && !esLocal(m) && !esDsh(m)) {
        const x = m.toLowerCase();
        if (x.includes("haiku")) e = "xhigh";
        else if (x.includes("sonnet")) e = "high";
        else if (x.includes("opus")) e = pa.plan === "pro" ? "medium" : "settings";
      }
      if (esGemini(m) || esCodex(m) || esLocal(m) || esDsh(m)) e = "-";
    } else {
      [m, e] = modeloDePa(t);
      de = "default de pa";
    }
    let repM = "";
    let repE = "";
    let repMot = "";
    if (auto) {
      const x = await reparto.elegir(t === "default" ? "codigo-acotado" : t);
      if (x.salida) {
        const l = lecturaReparto(x.salida);
        [repM, repE, repMot] = [l.m, l.e, l.mot];
      }
    }
    filas.push({ t, m, e: e || "-", de, repM, repE: repE || "-", repMot });
  }
  const tab = auto ? tablaInteligencia(await reparto.tabla()) : [];

  const confClave = (k: string) => modelos.clave(k);
  let lid: { modelo: string; effort: string } | null = null;
  if (valido) {
    const l = parsear(confClave("lider"));
    if (esObj(l)) lid = { modelo: texto(l.modelo), effort: texto(alt(l.effort, "")) };
  }
  const dshBinRuta = dshBin(pa.env, pa.plat);
  const ocBinRuta = opencodeBin(pa.env, pa.plat);
  const localesConf = valido ? parsear(confClave("locales")) : undefined;
  const locales: Local[] | null = Array.isArray(localesConf) ? (localesConf.filter(esObj) as unknown as Local[]) : null;
  const dshs = valido ? await dshCatalogo(pa, locales) : await dshCatalogo(pa, null);
  const ocs = await opencodeCatalogo(pa, modelos.archivo);
  const locs: string[][] = [];
  if (valido && Array.isArray(localesConf)) {
    for (const l of localesConf) {
      if (!esObj(l)) continue;
      const k = texto(l.id);
      const url = texto(l.url);
      const mod = texto(l.modelo);
      locs.push([k, texto(alt(l.nombre, l.modelo)), url, mod, await localEstado(url, mod, pa.env)]);
    }
  }
  const lineasCat = (ls: string[]) => ls.map((l) => l.split("\t"));
  const excluirTxt = confClave("excluir");
  const reservaTxt = confClave("reserva");

  if (json) {
    const archivo = modelos.archivo;
    let existe = false;
    try {
      existe = statSync(archivo).isFile();
    } catch {
      existe = false;
    }
    const err = valido ? "" : errorDeModelos(archivo);
    const inteligencia: Record<string, unknown> = {};
    for (const x of tab) inteligencia[interpolar(x.id)] = { calidad: x.calidad, estimada: x.estimada, gratis: x.gratis, permitido: x.permitido };
    const excluir = excluirTxt ? parsear(excluirTxt) ?? [] : [];
    const reserva = reservaTxt ? parsear(reservaTxt) ?? null : null;
    const workers: Record<string, unknown> = {};
    for (const f of filas) {
      workers[f.t] = {
        modelo: f.m,
        effort: f.e === "-" ? null : f.e,
        motor: motor(f.m),
        origen: f.de,
        ...(f.repM === ""
          ? { reparto: null }
          : { reparto: { modelo: f.repM, effort: f.repE === "-" || f.repE === "" ? null : f.repE, motor: motor(f.repM), motivo: f.repMot } }),
      };
    }
    const cat = (ls: string[]) =>
      lineasCat(ls).map((c) => ({ id: c[0], gratis: c[1] === "1", disponible: c[2] === "1", detalle: c[3] ?? null }));
    pa.io.out(
      `${jsonJq({
        archivo,
        existe,
        valido,
        error: err === "" ? null : err,
        plan: pa.plan,
        reparto: repModo,
        inteligencia,
        excluir,
        permitir_max: pol.permitirMax,
        sin_cupo: pol.sinCupo,
        sin_cupo_de: pol.sinCupoDe,
        reserva,
        lider: lid ? { modelo: lid.modelo, effort: lid.effort === "" ? null : lid.effort, motor: motor(lid.modelo) } : null,
        workers,
        locales: locs.map((c) => ({ id: c[0], nombre: c[1], url: c[2], modelo: c[3], responde: c[4] === "ok", detalle: c[4] === "ok" ? null : c[4] })),
        dsh: { instalado: dshBinRuta !== "", ruta: dshBinRuta === "" ? null : dshBinRuta, modelos: cat(dshs) },
        opencode: { instalado: ocBinRuta !== "", ruta: ocBinRuta === "" ? null : ocBinRuta, modelos: cat(ocs) },
      })}\n`,
    );
    return 0;
  }

  const o = (s: string) => pa.io.out(`${s}\n`);
  if (valido) o(`archivo: ${modelos.archivo}`);
  else {
    const err = errorDeModelos(modelos.archivo);
    o(err ? `archivo: ${modelos.archivo} (inválido: ${err}; no se usa)` : `archivo: ${modelos.archivo} (no existe: modelos de siempre)`);
  }
  if (lid) o(`líder: ${lid.modelo}${lid.effort ? ` effort ${lid.effort}` : ""}`);
  o(`${"tipo".padEnd(15)} ${"modelo".padEnd(26)} ${"effort".padEnd(8)} de dónde`);
  for (const f of filas) {
    const rep = f.repM !== "" ? `  (reparto hoy: ${f.repM}${f.repE !== "-" && f.repE !== "" ? ` ${f.repE}` : ""})` : "";
    o(`${f.t.padEnd(15)} ${f.m.padEnd(26)} ${f.e.padEnd(8)} ${f.de}${rep}`);
  }
  o(`reparto: modo ${repModo} (el cupo lo elige reparto)`);
  let excl = "";
  if (excluirTxt) {
    const x = parsear(excluirTxt);
    excl = Array.isArray(x) ? (x.length === 0 ? "nada" : x.map((v) => texto(v)).join(", ")) : "nada";
  }
  o(`sin cupo: ${pol.sinCupo} (${pol.sinCupoDe}); excluir: ${excl}; reserva del Claude oficial: ${reservaTxt || "ninguna"}; max sin --ok-dueno: ${pol.permitirMax ? "sí" : "no"}`);
  if (tab.length) {
    o('inteligencia (unidades de Artificial Analysis: índice de inteligencia general, al esfuerzo que se usaría; ~ = estimada por el nombre; editable en Ajustes > Modelos o con "calidad" en modelos.json; reparto --tabla):');
    for (const x of tab) {
      const val = `${interpolar(x.calidad)}${alt(x.estimada, false) ? "~" : ""}${alt(x.gratis, false) ? " · gratis" : ""}${alt(x.permitido, false) ? "" : " · NO permitido"}`;
      o(`  ${interpolar(x.id).padEnd(52)} ${val}`);
    }
  }
  if (locs.length) {
    o("locales:");
    for (const [k, , url, , est] of locs) o(est === "ok" ? `  ${k!.padEnd(30)} ${url}  responde` : `  ${k!.padEnd(30)} ${url}  NO: ${est}`);
  }
  if (dshs.length) {
    o(`dsh (-m dsh:<proveedor>/<modelo>; las keys van en el entorno o en ${clavesEnv(pa.env, pa.plat)}):`);
    for (const [k, nom, est, mod] of lineasCat(dshs)) o(`  ${k!.padEnd(44)} ${est === "1" ? "disponible" : "NO disponible"}${nom === "1" ? " · gratis" : ""}${mod ? ` · ${mod}` : ""}`);
  }
  if (ocs.length) {
    o("opencode (-m opencode:<proveedor>/<modelo>; los gratis usan tu login de OpenCode Console: `opencode` → /connect):");
    for (const [k, nom, est, mod] of lineasCat(ocs)) o(`  ${k!.padEnd(52)} ${est === "1" ? "disponible" : "NO disponible"}${nom === "1" ? " · gratis" : ""}${mod ? ` · ${mod}` : ""}`);
  }
  o("(-m en pa siempre le gana al archivo)");
  return 0;
}

// ------------------------------------------------------------------------------------------- cupo y proyectos de Gemini

/** `pa --cupo-gemini [--json]`: `reparto --cupos` con la salida a la vista. */
export async function cmdCupoGemini(pa: Pa, args: string[]): Promise<number> {
  const rep = repartoProceso(pa);
  if (!rep.ejecutable()) {
    pa.io.err(`pa: no encuentro ${rep.ruta}.\n`);
    return 1;
  }
  const ruta = pa.env.PA_REPARTO && pa.env.PA_REPARTO !== "0" ? pa.env.PA_REPARTO : path.join(pa.bin, "reparto");
  const prefijo = prefijoDe(pa, "reparto", pa.env.PA_REPARTO, ruta);
  const env = { ...pa.env, REPARTO_STATE: pa.env.REPARTO_STATE || path.join(pa.state, "reparto"), PA_STATE: pa.state };
  const r = await correr(prefijo[0]!, [...prefijo.slice(1), "--cupos", ...args], { env: entornoCmd(prefijo, env), input: "" });
  if (r.salida) pa.io.out(r.salida);
  if (r.errores) pa.io.err(r.errores);
  return r.codigo;
}

/** `pa --gemini-proyectos`: Gemini corre en todos los proyectos (ya no hay lista). */
export function cmdGeminiProyectos(pa: Pa, args: string[]): number {
  const a = args[0] ?? "";
  if (a === "") pa.io.out("Gemini: habilitado en todos los proyectos.\n");
  else if (a === "--marcar" || a === "--desmarcar") pa.io.out(`pa: ${a} ya no hace nada: Gemini corre en todos los proyectos (sin lista de prohibidos ni excluidos).\n`);
  else {
    pa.io.err("uso: pa --gemini-proyectos\n");
    return 2;
  }
  return 0;
}
