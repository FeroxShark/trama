// El uso de OpenCode en la barra lateral, como el de cualquier otro proveedor. OpenCode no dice cuánto se gastó (ni del cupo gratis ni del plan
// Go: no lo expone por API ni por CLI), así que Trama cuenta los pedidos que ELLA le hace: cada corrida anota una línea en
// `opencode-pedidos.jsonl`, junto al agotado.json de `reparto` (`{"t": epoch s, "m": "opencode-go/<modelo>", "n": pedidos}`). La escriben el
// runner de workers (motor/opencode/correr.mjs: un pedido por `step_finish`) y el puente de los líderes (dsh-puente.ts: uno por `usage_update`
// de ACP, al menos uno por turno que contestó). Lo que la persona hace con `opencode` por fuera de Trama no se ve: la barra dice «contados por trama».
// La ventana es como la de Claude: arranca con el primer pedido y dura 5 h. Con Go, el tope de cada modelo sale de go-topes.json y el % es
// pedidos / tope; sin Go, los gratis no tienen tope publicado: se dice cuántos pedidos van y, si un 429 lo marcó, que se acabó. Node puro.
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { GrupoCupo, SuscripcionCupo, VentanaCupo } from "./cupos.ts";
import { dirEstadoReparto, GRUPO_OPENCODE_GRATIS, grupoModeloGo } from "./opencode-agotado.ts";
import { esGratis, esModeloGo, esNvidia, PROVEEDOR_GO, type PlanOpencode } from "./opencode.ts";
import { esPlanGo, normalizarSlug, type TablaGo } from "./opencode-go.ts";
import { cuentasDeEstaMaquinaVarias, listarCuentas, type ListaCuentas, type PerfilCuenta } from "./cuentas-varias.ts";
import { cuentaAgregadaDe } from "./opencode-cuenta.ts";

/** Lo que dura una ventana de OpenCode (la de los topes de Go: «pedidos cada 5 h»). */
export const VENTANA_OC_S = 5 * 3600;
/** Lo que se guarda: con un día alcanza para saber dónde arrancó la ventana de ahora. */
const GUARDAR_S = 24 * 3600;
/** Pasado este tamaño, al anotar se tiran las líneas de más de un día. */
const PODAR_BYTES = 256 * 1024;

export const archivoPedidos = (env: NodeJS.ProcessEnv = process.env) => path.join(dirEstadoReparto(env), "opencode-pedidos.jsonl");

/** `c`: la cuenta agregada de OpenCode con que se hicieron (sin ella, la de siempre). */
export type Pedidos = { t: number; m: string; n: number; c?: string };

/** `opencode:opencode-go/Kimi-K3.1-Pro` → `opencode-go/kimi-k3.1-pro`: como se anota (sin el prefijo de Trama, en minúsculas). */
const claveModelo = (m: string): string => m.replace(/^opencode:/, "").toLowerCase();

/** Se cuentan sólo los que tienen cupo: los gratis (uno solo, compartido), los de Go (uno por modelo) y los de NVIDIA NIM (por minuto, uno por modelo). Los de pago por uso, no. */
export const cuentaPedidos = (modelo: string): boolean => esGratis(claveModelo(modelo)) || esModeloGo(claveModelo(modelo)) || esNvidia(claveModelo(modelo));

function leerTodo(env: NodeJS.ProcessEnv): Pedidos[] {
  let texto = "";
  try {
    texto = readFileSync(archivoPedidos(env), "utf8");
  } catch {
    return [];
  }
  const out: Pedidos[] = [];
  for (const l of texto.split("\n")) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      if (typeof o?.t === "number" && Number.isFinite(o.t) && typeof o.m === "string" && o.m && typeof o.n === "number" && o.n > 0)
        out.push({ t: o.t, m: claveModelo(o.m), n: Math.round(o.n), ...(typeof o.c === "string" && o.c && o.c !== "opencode" ? { c: o.c } : {}) });
    } catch {
      /* una línea rota (dos escritores a la vez) no tira las demás */
    }
  }
  return out;
}

/**
 * Anota `n` pedidos de `modelo` ahora. Lo que no tiene cupo, o `n` < 1, no se anota. `false` si no se pudo escribir (no es un error: se cuenta menos).
 * Con `TRAMA_OPENCODE_CUENTA` en `env` (un líder de una cuenta agregada) la línea lleva `c`: cada cuenta cuenta lo suyo (`suscripcionOpencode`).
 */
export function anotarPedidos(modelo: string, n: number, env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): boolean {
  if (!cuentaPedidos(modelo) || !(n >= 1)) return false;
  const f = archivoPedidos(env);
  try {
    mkdirSync(path.dirname(f), { recursive: true });
    const cuenta = cuentaAgregadaDe(env);
    appendFileSync(f, JSON.stringify({ t: Math.floor(ahoraMs / 1000), m: claveModelo(modelo), n: Math.round(n), ...(cuenta ? { c: cuenta } : {}) }) + "\n");
    if (statSync(f).size > PODAR_BYTES) {
      const desde = ahoraMs / 1000 - GUARDAR_S;
      const tmp = `${f}.${process.pid}`;
      writeFileSync(tmp, leerTodo(env).filter((p) => p.t >= desde).map((p) => JSON.stringify(p) + "\n").join(""));
      renameSync(tmp, f);
    }
    return true;
  } catch {
    return false;
  }
}

/** Los pedidos del último día, del más viejo al más nuevo. */
export function leerPedidos(env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): Pedidos[] {
  const desde = ahoraMs / 1000 - GUARDAR_S;
  return leerTodo(env).filter((p) => p.t >= desde).sort((a, b) => a.t - b.t);
}

/** La ventana de ahora de una serie de pedidos: cuántos van y cuándo se reinicia (epoch s). `null`: no hay una abierta (nada en las últimas 5 h). */
export function ventanaActual(ps: readonly Pedidos[], ahoraS: number, largoS = VENTANA_OC_S): { usados: number; vuelve: number } | null {
  let inicio: number | null = null;
  let usados = 0;
  for (const p of ps) {
    if (inicio === null || p.t >= inicio + largoS) {
      inicio = p.t;
      usados = 0;
    }
    usados += p.n;
  }
  return inicio === null || ahoraS >= inicio + largoS ? null : { usados, vuelve: inicio + largoS };
}

/**
 * Las suscripciones de `reparto --cupos` sin las de OpenCode: la fila de OpenCode (y la de cada cuenta agregada) la arma Trama con `suscripcionOpencode`.
 * `reparto` lista las suyas vacías («proveedor sin lectura de cupo: no se reparte»); si pasaban las dos, la barra mostraba OpenCode repetido.
 */
export const sinOpencodeDeReparto = <T extends { id: string; proveedor?: string }>(subs: readonly T[]): T[] => subs.filter((s) => (s.proveedor ?? s.id) !== "opencode");

export type EntradaOpencode = {
  /** Una cuenta agregada de OpenCode (`cuentas`); sin ella, la de siempre (id `opencode`). */
  cuenta?: { id: string; nombre: string };
  plan: PlanOpencode;
  tabla: TablaGo | null;
  pedidos: readonly Pedidos[];
  /** Hasta cuándo está agotado el uso gratis (epoch ms), `null`: no lo está. */
  gratisHasta: number | null;
  /** Los modelos de Go agotados: grupo (`opencode:opencode-go/<modelo>`) → hasta cuándo (epoch ms). */
  goAgotados: Readonly<Record<string, number>>;
  ahoraMs: number;
};

/**
 * La fila de OpenCode de la barra, con la forma de las de `reparto` (una suscripción con grupos): el grupo de los gratis (`opencode-free`: cuántos
 * pedidos van en la ventana, sin tope publicado, y la marca si un 429 lo agotó) y, con Go, un grupo por cada modelo de Go que se usó en su ventana o
 * está agotado (`opencode:opencode-go/<modelo>`, el mismo id que la marca de `reparto`: el selector lo sigue leyendo igual), con su % del tope. Con Go
 * y ningún modelo usado, un solo grupo `opencode-go` en 0 %: no se pinta una fila por cada modelo de la tabla.
 */
export function suscripcionOpencode(e: EntradaOpencode): SuscripcionCupo {
  const ahoraS = Math.floor(e.ahoraMs / 1000);
  const vivo = (ms: number | null | undefined) => (ms && ms > e.ahoraMs ? Math.round(ms / 1000) : undefined);
  const ventana = (ps: readonly Pedidos[], tope: number | null): VentanaCupo => {
    const v = ventanaActual(ps, ahoraS);
    const usados = v?.usados ?? 0;
    return {
      id: "5h",
      pct: tope ? Math.min(100, Math.round((usados / tope) * 100)) : null,
      vuelve: v?.vuelve ?? null,
      pedidos: usados,
      ...(tope ? { tope } : {}),
    };
  };
  // Sólo los pedidos de esta cuenta (los de la de siempre no traen `c`).
  const pedidos = e.pedidos.filter((p) => (p.c ?? null) === (e.cuenta?.id ?? null));
  const gratis = pedidos.filter((p) => esGratis(p.m));
  const agotadoGratis = vivo(e.gratisHasta);
  const grupos: GrupoCupo[] = [{ id: GRUPO_OPENCODE_GRATIS, nombre: "OpenCode gratis", ventanas: [ventana(gratis, null)], ...(agotadoGratis ? { agotado: agotadoGratis } : {}) }];
  if (esPlanGo(e.plan)) {
    const plan = e.plan;
    const go = pedidos.filter((p) => esModeloGo(p.m));
    const usados = new Set<string>();
    for (const m of e.tabla?.modelos ?? []) {
      const id = grupoModeloGo(`${PROVEEDOR_GO}/${m.slug}`);
      const suyos = go.filter((p) => normalizarSlug(p.m) === normalizarSlug(m.slug));
      // El 429 se anota con el id que listó opencode (puede traer otro slug): se empareja igual que los pedidos.
      const marca = Object.entries(e.goAgotados).find(([g]) => normalizarSlug(g) === normalizarSlug(m.slug))?.[1];
      const agotado = vivo(marca);
      if (!ventanaActual(suyos, ahoraS) && !agotado) continue;
      usados.add(id);
      grupos.push({ id, nombre: m.nombre, ventanas: [ventana(suyos, m.topes[plan]?.pedidos5h ?? null)], ...(agotado ? { agotado } : {}) });
    }
    if (!usados.size) grupos.push({ id: "opencode-go", nombre: "OpenCode Go", ventanas: [{ id: "5h", pct: 0, vuelve: null, pedidos: 0 }] });
  }
  // Sin plan Go, un modelo de Go marcado (de cuando lo había) igual se dice: el selector lo sigue rotulando.
  for (const [id, hasta] of Object.entries(e.goAgotados)) {
    const agotado = vivo(hasta);
    if (agotado && !grupos.some((g) => normalizarSlug(g.id) === normalizarSlug(id)))
      grupos.push({ id: id.toLowerCase(), nombre: `OpenCode Go · ${id.slice(id.indexOf("/") + 1)}`, ventanas: [{ id: "5h", pct: null, vuelve: null }], agotado });
  }
  const c = e.cuenta;
  return { id: c?.id ?? "opencode", nombre: c?.nombre ?? "OpenCode", proveedor: "opencode", cuenta: c?.id ?? "opencode", ts: ahoraS, grupos };
}

/** NVIDIA NIM da ~40 pedidos por minuto y por modelo (sin tope diario): la ventana es de un minuto que se mueve con el reloj. */
export const VENTANA_NIM_S = 60;

/**
 * La fila de NVIDIA NIM de la barra: un grupo (`nvidia-nim`, el mismo id que usa `reparto`) con una ventana de 1 minuto. El % es el del modelo más
 * cargado del último minuto contra el tope por modelo (el límite es de cada modelo, no de todos juntos); `vuelve` es cuándo sale del minuto su pedido
 * más viejo. Nunca hay marca de agotado: un 429 de NIM dura un minuto y `pa` sólo enfría ese modelo. `null`: sin clave o sin modelos prendidos.
 */
export function suscripcionNvidia(e: { hayClave: boolean; modelos: readonly string[]; tope: number; pedidos: readonly Pedidos[]; ahoraMs: number }): SuscripcionCupo | null {
  if (!e.hayClave || !e.modelos.length) return null;
  const ahoraS = Math.floor(e.ahoraMs / 1000);
  const porModelo = new Map<string, { n: number; viejo: number }>();
  for (const p of e.pedidos) {
    if (!esNvidia(p.m) || p.t <= ahoraS - VENTANA_NIM_S) continue;
    const a = porModelo.get(p.m);
    porModelo.set(p.m, { n: (a?.n ?? 0) + p.n, viejo: Math.min(a?.viejo ?? p.t, p.t) });
  }
  let mejor: { n: number; viejo: number } | null = null;
  for (const v of porModelo.values()) if (!mejor || v.n > mejor.n) mejor = v;
  const usados = mejor?.n ?? 0;
  const ventana: VentanaCupo = {
    id: "1m",
    pct: Math.min(100, Math.round((usados / e.tope) * 100)),
    vuelve: mejor ? mejor.viejo + VENTANA_NIM_S : null,
    pedidos: usados,
    tope: e.tope,
  };
  return { id: "nvidia-nim", nombre: "NVIDIA NIM", proveedor: "nvidia", cuenta: "nvidia-nim", ts: ahoraS, grupos: [{ id: "nvidia-nim", nombre: "NVIDIA NIM", ventanas: [ventana] }] };
}

/** De todas las marcas de OpenCode (`marcasOpencode`), las de una cuenta (`null`: la de siempre), sin el sufijo `@<cuenta>`. */
export function marcasDeCuenta(marcas: Readonly<Record<string, number>>, cuenta: string | null): { gratisHasta: number | null; goAgotados: Record<string, number> } {
  const goAgotados: Record<string, number> = {};
  let gratisHasta: number | null = null;
  for (const [g, ms] of Object.entries(marcas)) {
    const i = g.lastIndexOf("@");
    if ((i < 0 ? null : g.slice(i + 1)) !== cuenta) continue;
    const base = i < 0 ? g : g.slice(0, i);
    if (base === GRUPO_OPENCODE_GRATIS) gratisHasta = ms;
    else goAgotados[base] = ms;
  }
  return { gratisHasta, goAgotados };
}

// --- Las cuentas agregadas de OpenCode, para la barra: las dice el CLI `cuentas` (se guardan 1 min; la barra no espera) ----------

const TTL_CUENTAS_MS = 60_000;
let cuentasCache: PerfilCuenta[] = [];
let cuentasEn = 0;
let cuentasVuelo: Promise<void> | null = null;

/** Las cuentas agregadas de OpenCode (con su plan) de la última lectura; si venció, relee de fondo. Sin `cuentas`: ninguna. */
export function cuentasOpencode(leer: () => Promise<ListaCuentas | null> = () => listarCuentas(cuentasDeEstaMaquinaVarias(undefined)), ahoraMs = Date.now()): PerfilCuenta[] {
  if (process.env.HILOS_PRUEBA === "1" || process.env.HILOS_CAPTURA === "1") return [];
  if (!cuentasVuelo && ahoraMs - cuentasEn >= TTL_CUENTAS_MS) {
    cuentasEn = ahoraMs;
    cuentasVuelo = leer()
      .then((l) => void (cuentasCache = (l?.cuentas ?? []).filter((c) => c.proveedor === "opencode" && !c.defecto)))
      .catch(() => undefined)
      .finally(() => (cuentasVuelo = null));
  }
  return cuentasCache;
}
