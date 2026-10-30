// Falta de cupo con reparto (lo que orquesta.ts dejaba en noPortado): esperar cupo con sin_cupo=esperar (el hijo de --async hace cola
// sin puesto) y relanzar, en la misma corrida y el mismo id, con el candidato que reparto ofrece cuando el Claude oficial dice límite
// (sin_cupo=otro, hasta 3 veces). Port del bloque `reparto_esperar` y del `while (( reintentos_cupo < 3 ))` de motor/bin/pa.
// Sólo corre Claude: si el candidato es de agy, codex o dsh, el pa de TypeScript lo dice y sigue como si reparto no hubiera ofrecido
// otro (el bash cambia de motor; eso es de quien porte esos motores).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { correr } from "../base/proc.ts";
import { git } from "../base/git.ts";
import { esEjecutable } from "../base/buscar.ts";
import { entornoCmd } from "../../binario.ts";
import type { Pa } from "./entorno.ts";
import { carpetaProyectos, contratoClaude, escapar, hiloPoner, limiteDe, type Corrida, type Ganchos, type Lanzamiento } from "./lanzar.ts";
import { Modelos, esCodex, esDsh, esGemini, esLocal } from "./modelos.ts";
import { cuentaProveedor, modeloFlojo, proveedorDe, type DepsPolitica, type Llamada } from "./politica.ts";
import type { Admision } from "./puestos.ts";
import { cuentasProceso, prefijoDe, repartoProceso, topeReparto } from "./programas.ts";
import { motoresDe } from "./otros-motores.ts";
import { leerSalida, epochReset, textoResultado } from "./resultado-lanzar.ts";

const dormirMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const num = (s: string | undefined, def: number) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : def);

/** El comando de reparto (`$REPARTO`) con su prefijo, o null si no se puede ejecutar. */
function comandoReparto(pa: Pa): string[] | null {
  const ruta = pa.env.PA_REPARTO && pa.env.PA_REPARTO !== "0" ? pa.env.PA_REPARTO : path.join(pa.bin, "reparto");
  const prefijo = prefijoDe(pa, "reparto", pa.env.PA_REPARTO, ruta);
  return esEjecutable(prefijo[prefijo.length - 1]!, pa.plat) ? prefijo : null;
}

/** `reparto <args>` con REPARTO_STATE y PA_STATE; `tope` = el `timeout ${PA_REPARTO_TIMEOUT_S:-15}`. Nunca tira: una falla vuelve como código. */
async function reparto(pa: Pa, args: string[], tope: boolean): Promise<{ rc: number; salida: string }> {
  const prefijo = comandoReparto(pa);
  if (!prefijo) return { rc: 127, salida: "" };
  const env = { ...pa.env, REPARTO_STATE: pa.env.REPARTO_STATE || path.join(pa.state, "reparto"), PA_STATE: pa.state };
  const r = await correr(prefijo[0]!, [...prefijo.slice(1), ...args], {
    env: entornoCmd(prefijo, env),
    timeoutMs: tope ? Number(topeReparto(pa.env)) * 1000 : undefined,
    input: "",
  });
  return { rc: r.codigo, salida: r.salida.replace(/\n+$/, "") };
}

type Candidato = { modelo: string; effort: string; motivo: string; cuenta: string; todoLleno: boolean };
/** Lo que contestó `reparto --tipo T --json` ("" si no contestó). */
function candidatoDe(salida: string): Candidato {
  let j: Record<string, unknown> = {};
  try {
    const x = JSON.parse(salida) as unknown;
    if (x && typeof x === "object" && !Array.isArray(x)) j = x as Record<string, unknown>;
  } catch {
    /* sin JSON: sin candidato */
  }
  const t = (x: unknown) => (x === null || x === undefined || x === false ? "" : typeof x === "string" ? x : JSON.stringify(x));
  return { modelo: t(j.modelo), effort: t(j.effort), motivo: t(j.motivo).replace(/[\r\n\t|]+/g, " "), cuenta: t(j.cuenta), todoLleno: j.todo_lleno === true };
}

/**
 * sin_cupo=esperar con todo lleno (sólo el hijo de --async llega acá): cola SIN puesto ni lugar del tope, preguntándole a reparto cada
 * PA_GEMINI_ESPERA_S (300 s) hasta que haya un candidato con cupo; a los PA_GEMINI_ESPERA_MAX_MIN (720) sale 96. Si el candidato cambió,
 * corre con ése (si es de Claude). Devuelve el código si hay que cortar (96), o null y la llamada ya con el modelo que corre.
 */
export async function esperarCupo(pa: Pa, l: Llamada, adm: Pick<Admision, "escribirCola" | "reiniciarCola">, dir: string, ts: string): Promise<number | null> {
  const tipo = l.repartoTipoRelanzable;
  if (!l.repartoEsperar || !tipo || !comandoReparto(pa)) return null;
  const { io } = pa;
  const tope = num(pa.env.PA_GEMINI_ESPERA_MAX_MIN, 720) * 60_000;
  const cola = path.join(dir, `${ts}.cola`);
  const ini = Date.now();
  let c: Candidato;
  for (;;) {
    const r = await reparto(pa, ["--tipo", tipo, "--json"], true);
    c = r.rc === 0 ? candidatoDe(r.salida) : candidatoDe("");
    if (c.modelo && !c.todoLleno) break;
    if (Date.now() - ini >= tope) {
      rmSync(cola, { force: true });
      io.err(`pa: sigue sin haber cupo para ${tipo} y modelos.json dice sin_cupo=esperar: dejo de esperar.\n`);
      return 96;
    }
    adm.reiniciarCola();
    adm.escribirCola(`sin cupo: todo lleno para ${tipo}; espera cupo (sin_cupo=esperar)`);
    await dormirMs(num(pa.env.PA_GEMINI_ESPERA_S, 300) * 1000);
  }
  rmSync(cola, { force: true });
  if (c.modelo !== l.modelo && !esLocal(c.modelo)) {
    io.err(`pa: volvió el cupo: corro con ${c.modelo}${c.effort ? ` effort ${c.effort}` : ""} (reparto).\n`);
    if (esGemini(c.modelo) || esCodex(c.modelo) || esDsh(c.modelo)) {
      io.err(`pa: ${c.modelo} no lo corre este pa de TypeScript (sólo Claude); sigo con el modelo de antes.\n`);
    } else {
      l.modelo = c.modelo;
      l.esfuerzo = c.effort;
      l.efVacio = "";
    }
  }
  return null;
}

/** `cuenta_preparar` sin tocar nada: la cuenta y su entorno (`env -u A K=V`), o null si no va con ese proveedor. */
async function prepararCuenta(pa: Pa, id: string, prov: string): Promise<{ cuenta: string; env: NonNullable<Corrida["cuentaEnv"]> } | null> {
  const vacio = { poner: {}, quitar: [] };
  if (["claude", "google", "chatgpt", "opencode"].includes(id)) return id === prov ? { cuenta: id, env: vacio } : null;
  const r = await cuentasProceso(pa).env(id);
  if (r.rc !== 0) return null;
  let j: { proveedor?: unknown; sacar?: unknown; poner?: unknown } = {};
  try {
    j = JSON.parse(r.salida);
  } catch {
    j = {};
  }
  if (j.proveedor !== prov) return null;
  const quitar = (Array.isArray(j.sacar) ? j.sacar : []).map(String);
  const poner: Record<string, string> = {};
  if (j.poner && typeof j.poner === "object") for (const [k, v] of Object.entries(j.poner)) poner[k] = typeof v === "string" ? v : JSON.stringify(v);
  return { cuenta: id, env: { poner, quitar } };
}

/** `claude_sin_cupo`: el texto del result habla de un límite de uso. */
export const claudeSinCupo = (texto: string) => /session limit|usage limit|weekly limit|hit your limit|rate.?limit|(^|[^0-9])429([^0-9]|$)/i.test(texto);

/** `agy_modelo_invalido`: agy no conoce el modelo (el catálogo depende de la cuenta, la región y la versión). */
export const agyModeloInvalido = (texto: string) => /invalid model selection|model .* is not recognized/i.test(texto);

/** `agy_sin_cupo`: agy contesta RESOURCE_EXHAUSTED / "Individual quota reached" (o un 429) cuando el grupo se quedó sin cupo. */
export const agySinCupo = (texto: string) => /RESOURCE_EXHAUSTED|Individual quota reached|(^|[^0-9])429([^0-9]|$)/i.test(texto);

/** Cuándo vuelve el cupo según agy ("Resets in 149h", "resets after 6d 5h 3m"): epoch en segundos, o null si el texto no lo dice. */
export function agyResetHasta(texto: string, ahoraS: number): number | null {
  const m = /resets?\s+(?:in|after)\s+((?:\d+\s*[dhm]\s*)+)/i.exec(texto);
  if (!m) return null;
  let s = 0;
  for (const x of m[1]!.matchAll(/(\d+)\s*([dhm])/gi)) s += Number(x[1]) * { d: 86400, h: 3600, m: 60 }[x[2]!.toLowerCase() as "d" | "h" | "m"];
  return s > 0 ? ahoraS + s : null;
}

/** `sin_trabajo_hecho`: el worktree está limpio y no hay commits sobre la base. */
async function sinTrabajoHecho(pa: Pa, c: Corrida): Promise<boolean> {
  const s = await git(["-C", c.rutaTrabajo, "status", "--porcelain"], { env: pa.env });
  if (s.codigo !== 0 || s.salida.replace(/\n+$/, "") !== "") return false;
  const n = await git(["-C", c.rutaTrabajo, "rev-list", "--count", `${c.base || "HEAD"}..HEAD`], { env: pa.env });
  return (n.codigo === 0 ? n.salida.replace(/\n+$/, "") : "1") === "0";
}

/**
 * El `elif agy_modelo_invalido` del `while` de motor/bin/pa: agy rechazó el modelo (no existe en esta cuenta). No es el cupo del grupo: se vuelve a
 * pedir la lista a agy (`reparto --agy-modelos --refrescar`), ese modelo queda enfriado PA_ENFRIAR_AGY_H horas (24) y, si lo había elegido reparto
 * y no se hizo trabajo, se relanza con el siguiente candidato de agy (el mismo motor y la misma cuenta). null = no es este caso.
 */
async function relanzarPorModeloAgy(pa: Pa, l: Llamada, lz: Lanzamiento): Promise<boolean | null> {
  const c = lz.c;
  if (c.motor !== "agy") return null;
  let err = "";
  try {
    err = readFileSync(lz.err, "utf8");
  } catch {
    /* sin stderr */
  }
  if (!agyModeloInvalido(`${err}\n${textoResultado(leerSalida(lz.out))}`)) return null;
  const { io } = pa;
  const mAnt = c.modelo;
  const quien = `agy no reconoce ${mAnt}`;
  const cuentaAgy = c.cuenta && !["claude", "google", "chatgpt"].includes(c.cuenta) ? ["--cuenta", c.cuenta] : [];
  const tipo = l.repartoTipoRelanzable;
  const avisoOfrece = async () => {
    const r = await reparto(pa, ["--agy-modelos", "--refrescar", ...cuentaAgy], true);
    const ofrecidos = r.rc === 0 ? r.salida.split("\n").filter((x) => x !== "").join(" ") : "";
    io.err(`pa: agy no reconoce el modelo '${mAnt}' en esta cuenta${ofrecidos ? `; ofrece: ${ofrecidos}` : ""}. Usá uno de ésos con -m, o sin -m para que reparto elija.\n`);
    return false;
  };
  if (!tipo || !comandoReparto(pa) || !(await sinTrabajoHecho(pa, c))) return avisoOfrece();
  await reparto(pa, ["--agy-modelos", "--refrescar", ...cuentaAgy], true);
  await reparto(pa, ["--enfriar", mAnt, "--horas", pa.env.PA_ENFRIAR_AGY_H || "24"], true);
  const pAnt = proveedorDe(mAnt);
  const r = await reparto(pa, ["--tipo", tipo, ...(pAnt ? ["--mismo-proveedor", pAnt] : []), "--json"], true);
  const cand = r.rc === 0 ? candidatoDe(r.salida) : candidatoDe("");
  const mRep = cand.todoLleno ? "" : cand.modelo.toLowerCase();
  if (!mRep || mRep === mAnt || !esGemini(mRep)) {
    if (mRep && mRep !== mAnt)
      io.err(`pa: ${quien} (modelo que esta cuenta no ofrece) con ${mAnt}; reparto ofrece ${mRep}, pero este pa de TypeScript sólo relanza dentro de agy; sigo como falló.\n`);
    else io.err(`pa: ${quien} (modelo que esta cuenta no ofrece) con ${mAnt}, lo dejé de ofrecer, pero reparto no ofrece otro candidato con cupo; sigo como falló.\n`);
    return avisoOfrece();
  }
  // el siguiente candidato pasa por los mismos candados que el primero (privacidad, agy en el PATH, el plugin pa-worker)
  const motivo = (await motoresDe(pa).chequearGemini?.(mRep, l)) ?? "";
  if (motivo) {
    io.err(`pa: ${quien} (modelo que esta cuenta no ofrece) con ${mAnt}; reparto ofrece ${mRep} pero no puede correr (${motivo}); sigo como falló.\n`);
    return avisoOfrece();
  }
  io.err(`pa: ${quien} (modelo que esta cuenta no ofrece) con ${mAnt}: lo dejo de ofrecer ${pa.env.PA_ENFRIAR_AGY_H || "24"} h y relanzo con ${mRep}: ${cand.motivo}\n`);
  // cambiar_de_modelo (agy): el mismo motor y la misma cuenta; sólo cambia el modelo (el effort va en el nombre).
  c.modelo = mRep;
  c.esfuerzo = "";
  if (!c.leer) c.modeloFlojo = (await modeloFlojo(pa, { reparto: repartoProceso(pa) } as DepsPolitica, mRep)) !== null;
  lz.contrato = contratoClaude(pa, c);
  if (existsSync(path.join(lz.dir, `${c.ts}.hilo`))) {
    await hiloPoner(lz.dir, c.ts, "modelo", mRep);
    await hiloPoner(lz.dir, c.ts, "effort", "-");
    await hiloPoner(lz.dir, c.ts, "cuenta", c.cuenta);
  }
  return true;
}

const iso = (ep: number) => new Date(ep * 1000).toISOString().replace(/\.\d+Z$/, "Z");

/** cambiar_de_modelo (Claude): modelo, effort, cuenta y, si no se retoma una sesión, sesión nueva (la del intento que chocó el límite puede haber quedado creada). */
async function pasarAClaude(pa: Pa, lz: Lanzamiento, mRep: string, effort: string, cuenta: { cuenta: string; env: NonNullable<Corrida["cuentaEnv"]> }): Promise<void> {
  const c = lz.c;
  c.motor = "claude";
  c.modelo = mRep;
  c.esfuerzo = effort;
  c.efVacio = "";
  c.cuenta = cuenta.cuenta;
  c.cuentaEnv = cuenta.env;
  if (!c.resume) {
    c.sid = randomUUID();
    try {
      writeFileSync(path.join(lz.dir, `${c.ts}.sid`), c.sid);
    } catch {
      /* nada */
    }
  }
  lz.transcript = path.join(carpetaProyectos(pa), escapar(c.rutaTrabajo), `${c.sid}.jsonl`);
  c.autocompact = new Modelos(pa.env, pa.io, pa.home, pa.plat).autocompactDe(mRep, pa.autocompact);
  if (!c.leer) c.modeloFlojo = (await modeloFlojo(pa, { reparto: repartoProceso(pa) } as DepsPolitica, mRep)) !== null;
  lz.contrato = contratoClaude(pa, c);
  if (existsSync(path.join(lz.dir, `${c.ts}.hilo`))) {
    await hiloPoner(lz.dir, c.ts, "modelo", mRep);
    await hiloPoner(lz.dir, c.ts, "effort", effort || "settings");
    await hiloPoner(lz.dir, c.ts, "cuenta", cuenta.cuenta);
  }
}

/**
 * Un `-m` a mano (o sustituido por agy) que agy corta por cupo al arrancar, sin trabajo hecho y sin tipo de reparto para elegir otro: ese
 * camino queda agotado hasta el reset que diga agy (`reparto --agotar`) y, con sin_cupo=otro, la corrida sigue con el MISMO modelo por el
 * Claude oficial (`reparto --otro-camino`), sin tocar de cuenta de Claude. null = no es este caso; false = no se pudo relanzar; true = cambió.
 */
async function relanzarPorOtroCamino(pa: Pa, l: Llamada, lz: Lanzamiento): Promise<boolean | null> {
  const c = lz.c;
  if (c.motor !== "agy" || l.repartoTipoRelanzable || !comandoReparto(pa)) return null;
  let err = "";
  try {
    err = readFileSync(lz.err, "utf8");
  } catch {
    /* sin stderr */
  }
  const texto = `${err}\n${textoResultado(leerSalida(lz.out))}`;
  if (!agySinCupo(texto) || !(await sinTrabajoHecho(pa, c))) return null;
  const { io } = pa;
  const mAnt = c.modelo;
  const hasta = agyResetHasta(texto, Math.floor(Date.now() / 1000));
  await reparto(pa, ["--agotar", mAnt, ...(hasta !== null ? ["--hasta", iso(hasta)] : []), ...(c.cuenta ? ["--cuenta", c.cuenta] : [])], false);
  if (l.politica.sinCupo !== "otro") return false;
  const r = await reparto(pa, ["--otro-camino", mAnt, "--json"], true);
  const cand = r.rc === 0 ? candidatoDe(r.salida) : candidatoDe("");
  const camino = (() => {
    try {
      return (JSON.parse(r.salida) as { camino?: unknown }).camino === true;
    } catch {
      return false;
    }
  })();
  const sinOtro = () => io.err(`pa: agy dijo sin cupo con ${mAnt}, lo marqué como agotado, pero no hay otro camino con cupo para el mismo modelo; sigo como falló.\n`);
  if (!camino || !cand.modelo) {
    sinOtro();
    return false;
  }
  const pRep = proveedorDe(cand.modelo);
  const cRep = cand.cuenta && cuentaProveedor(cand.cuenta, pa) === pRep ? cand.cuenta : pRep;
  const cuenta = await prepararCuenta(pa, cRep, pRep);
  if (!cuenta) {
    sinOtro();
    return false;
  }
  io.err(`pa: agy dijo sin cupo con ${mAnt}: lo marco agotado hasta que vuelva y relanzo con ${cand.modelo}${cand.effort ? ` effort ${cand.effort}` : ""}: ${cand.motivo}\n`);
  await pasarAClaude(pa, lz, cand.modelo, cand.effort, cuenta);
  return true;
}

/**
 * El gancho `relanzarPorCupo` de `lanzarClaude`: si el Claude oficial dijo límite al arrancar (sin trabajo hecho) y el modelo lo había
 * elegido reparto, marca agotado el grupo hasta su reset y cambia la corrida al candidato que reparto ofrece ahora, con la misma sesión
 * de pa y el mismo id. true si cambió y hay que correr de nuevo.
 */
export function relanzarPorCupo(pa: Pa, l: Llamada): NonNullable<Ganchos["relanzarPorCupo"]> {
  return async (lz: Lanzamiento) => {
    const rechazo = await relanzarPorModeloAgy(pa, l, lz);
    if (rechazo !== null) return rechazo;
    const otroCamino = await relanzarPorOtroCamino(pa, l, lz);
    if (otroCamino !== null) return otroCamino;
    const tipo = l.repartoTipoRelanzable;
    if (l.politica.sinCupo !== "otro" || !tipo || !comandoReparto(pa)) return false;
    const c = lz.c;
    const texto = textoResultado(leerSalida(lz.out));
    if (!claudeSinCupo(texto) || !(await sinTrabajoHecho(pa, c))) return false;
    const { io } = pa;
    const mAnt = c.modelo;
    const quien = "Claude dijo límite";
    const hastaArgs: string[] = [];
    const hasta = epochReset(texto, pa.env);
    if (hasta !== null) {
      try {
        writeFileSync(limiteDe(pa, c.cuenta), String(hasta));
      } catch {
        /* nada */
      }
      hastaArgs.push("--hasta", iso(hasta));
    }
    // Se agota el grupo de ESA cuenta; el siguiente candidato es del mismo proveedor (en la misma cuenta) o de otro, nunca de otra cuenta.
    const cAnt = c.cuenta;
    const pAnt = proveedorDe(mAnt);
    await reparto(pa, ["--agotar", mAnt, ...hastaArgs, ...(cAnt ? ["--cuenta", cAnt] : [])], false);
    const r = await reparto(pa, ["--tipo", tipo, ...(pAnt ? ["--mismo-proveedor", pAnt] : []), "--json"], true);
    const cand = r.rc === 0 ? candidatoDe(r.salida) : candidatoDe("");
    const mRep = cand.todoLleno ? "" : cand.modelo;
    const pRep = proveedorDe(mRep);
    const cRep = cand.cuenta && cuentaProveedor(cand.cuenta, pa) === pRep ? cand.cuenta : pRep;
    const sinOtro = () => io.err(`pa: ${quien} (sin cupo) con ${mAnt}, lo marqué como agotado, pero reparto no ofrece otro candidato con cupo; sigo como falló.\n`);
    // Nunca de una cuenta a otra del mismo proveedor por falta de cupo: esa elección es de la persona (`cuentas preferir`, --cuenta).
    if (!mRep || (mRep === mAnt && cRep === (cAnt || pAnt)) || (pAnt && pRep === pAnt && cRep !== (cAnt || pAnt)) || esLocal(mRep) || !/^(claude-|gemini-|agy:|codex:|dsh:|opencode:)/i.test(mRep)) {
      sinOtro();
      return false;
    }
    if (esGemini(mRep) || esCodex(mRep) || esDsh(mRep)) {
      io.err(`pa: ${quien} (sin cupo) con ${mAnt}; reparto ofrece ${mRep}, pero este pa de TypeScript sólo corre Claude; sigo como falló.\n`);
      return false;
    }
    const cuenta = await prepararCuenta(pa, cRep, pRep);
    if (!cuenta) {
      sinOtro();
      return false;
    }
    const cTxt = cuenta.cuenta !== cAnt && !["claude", "google", "chatgpt"].includes(cuenta.cuenta) ? ` (cuenta ${cuenta.cuenta})` : "";
    io.err(`pa: ${quien} (sin cupo) con ${mAnt}: lo marco agotado hasta que vuelva y relanzo con ${mRep}${cand.effort ? ` effort ${cand.effort}` : ""}${cTxt}: ${cand.motivo}\n`);

    await pasarAClaude(pa, lz, mRep, cand.effort, cuenta);
    return true;
  };
}

/**
 * El gancho `relanzarPorFallback` de `lanzarClaude` (`fb_siguiente` y el bloque 97 de motor/bin/pa, `-m a,b,c` con --async): OpenCode cortó
 * por límite con el modelo lanzado y el intento no dejó nada. La MISMA corrida (mismo id y puesto) sigue con el próximo de `l.fbResto` que
 * no esté apagado en modelos.json ni enfriado en reparto; lo que queda de la lista vuelve a `l.fbResto`. true si cambió.
 * Sólo pasa a otro modelo de OpenCode (dsh): el motor de la corrida se elige al arrancar. Con un modelo de otro motor, para aquí con 97.
 */
export function relanzarPorFallback(pa: Pa, l: Llamada): NonNullable<Ganchos["relanzarPorFallback"]> {
  return async (lz: Lanzamiento) => {
    const c = lz.c;
    if (!pa.env.PA_ASYNC || !l.fbResto || !(await sinTrabajoHecho(pa, c))) return false;
    const { io } = pa;
    const modelos = new Modelos(pa.env, io, pa.home, pa.plat);
    const ef = l.esfPedido ? l.esfuerzo : "";
    const items = l.fbResto.split(",");
    for (let i = 0; i < items.length; i++) {
      const x = items[i]!;
      // los que el dueño apagó en modelos.json (excluir, o el effort pedido en efforts_permitidos) se saltean, salvo con --ok-dueno
      if (!l.okDueno) {
        const excl = modelos.excluidoPor(x);
        if (excl !== null) {
          io.err(`pa: -m: ${x} está excluido en modelos.json (excluir: ${excl}): lo salteo.\n`);
          continue;
        }
        const ap = ef ? modelos.effortApagado(x, ef) : null;
        if (ap !== null) {
          io.err(`pa: -m: effort '${ef}' con ${x} está apagado en modelos.json (efforts_permitidos: ${ap.replace(/ /g, ", ")}): lo salteo.\n`);
          continue;
        }
      }
      if ((await repartoProceso(pa).enfriado(x)) !== null) {
        io.err(`pa: -m: ${x} sigue enfriado (cortó por límite): lo salteo.\n`);
        continue;
      }
      const mAnt = c.modelo;
      if (!esDsh(x)) {
        io.err(`pa: OpenCode cortó por límite con ${mAnt}; el siguiente de la lista (${x}) no es de OpenCode y esta corrida no cambia de motor: sigo como salió 97.\n`);
        return false;
      }
      io.err(`pa: OpenCode cortó por límite con ${mAnt}: sigo con ${x} (lista de fallback, mismo id).\n`);
      // cambiar_de_modelo (dsh): modelo y motor, sin effort ni cuenta de Claude
      c.modelo = x;
      c.esfuerzo = "";
      c.efVacio = "-";
      c.cuenta = "";
      c.cuentaEnv = undefined;
      if (existsSync(path.join(lz.dir, `${c.ts}.hilo`))) {
        await hiloPoner(lz.dir, c.ts, "modelo", x);
        await hiloPoner(lz.dir, c.ts, "effort", "-");
        await hiloPoner(lz.dir, c.ts, "cuenta", "");
      }
      l.fbResto = items.slice(i + 1).join(",");
      return true;
    }
    return false;
  };
}
