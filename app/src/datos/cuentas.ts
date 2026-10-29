// Varias cuentas por proveedor, del lado de la vista: la forma de lo que dice `cuentas --json` (ya validada en el main, acá se
// vuelve a mirar porque llega de afuera), cómo se llama cada fila de la barra de cupos cuando hay más de una cuenta ("Claude ·
// trabajo") y en qué orden van. Puro: lo prueba tests/cuentas-vista.test.ts. Quien tiene una sola cuenta por proveedor no pasa por acá.
import type { SuscripcionCupo } from "./contrato";

export type ProveedorCuenta = "claude" | "google" | "chatgpt" | "opencode";
export const PROVEEDORES: readonly ProveedorCuenta[] = ["claude", "google", "chatgpt", "opencode"];
/** Cómo se nombra el proveedor delante de la cuenta (la tarjeta de Plan y cupos lleva el nombre largo de cada plan). */
export const MARCA: Record<ProveedorCuenta, string> = { claude: "Claude", google: "Google", chatgpt: "ChatGPT", opencode: "OpenCode" };

export type PlanCuentaOc = "gratis" | "go" | "go-plus";
const PLANES_OC: readonly string[] = ["gratis", "go", "go-plus"];

/**
 * `logueado`: `null` = no se preguntó (o el CLI no lo sabe). `defecto`: la de siempre, cuyo id es el del proveedor. `plan`: el de OpenCode de una
 * cuenta agregada de OpenCode (el de la de siempre es `opencode_plan` de modelos.json). `planDetectado`: el que dijo `opencode models` de esa cuenta
 * (sólo en la lista verificada; no distingue Go de Go Plus); ausente = no se preguntó o no se pudo saber. `preferida`: la que usan primero los
 * líderes y workers nuevos de su proveedor (una por proveedor).
 */
export type PerfilCuenta = { id: string; proveedor: ProveedorCuenta; nombre: string; defecto: boolean; preferida: boolean; logueado: boolean | null; plan?: PlanCuentaOc; planDetectado?: PlanCuentaOc };
export type ListaCuentas = { version: 1; cuentas: PerfilCuenta[] };
export type ResultadoCuenta = { ok: true; id?: string } | { ok: false; error: string };

const esProveedor = (x: unknown): x is ProveedorCuenta => typeof x === "string" && (PROVEEDORES as readonly string[]).includes(x);

/** Sólo la forma esperada; cualquier otra cosa es «no hay varias cuentas» (`null`), y la app se ve como siempre. */
export function listaValida(x: unknown): ListaCuentas | null {
  const o = x as { version?: unknown; cuentas?: unknown } | null;
  if (!o || o.version !== 1 || !Array.isArray(o.cuentas)) return null;
  const cuentas: PerfilCuenta[] = [];
  for (const c of o.cuentas) {
    const p = (c ?? {}) as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id || !esProveedor(p.proveedor)) continue;
    cuentas.push({
      id: p.id,
      proveedor: p.proveedor,
      nombre: typeof p.nombre === "string" && p.nombre ? p.nombre : p.id,
      defecto: p.defecto === true || p.id === p.proveedor,
      preferida: p.preferida === true,
      logueado: typeof p.logueado === "boolean" ? p.logueado : null,
      ...(p.proveedor === "opencode" && p.id !== "opencode" ? { plan: PLANES_OC.includes(p.plan as string) ? (p.plan as PlanCuentaOc) : "gratis" } : {}),
      ...(p.proveedor === "opencode" && PLANES_OC.includes(p.plan_detectado as string) ? { planDetectado: p.plan_detectado as PlanCuentaOc } : {}),
    });
  }
  return cuentas.length ? { version: 1, cuentas } : null;
}

export const resultadoValido = (x: unknown): ResultadoCuenta => {
  const o = x as { ok?: unknown; id?: unknown; error?: unknown } | null;
  if (o?.ok === true) return typeof o.id === "string" ? { ok: true, id: o.id } : { ok: true };
  return { ok: false, error: typeof o?.error === "string" && o.error ? o.error : "main.cuentasFallo" };
};

/** Las cuentas de un proveedor, la de siempre primero. */
export const deProveedor = (l: ListaCuentas | null, p: ProveedorCuenta): PerfilCuenta[] =>
  (l?.cuentas ?? []).filter((c) => c.proveedor === p).sort((a, b) => Number(b.defecto) - Number(a.defecto));

/** El proveedor de una suscripción de la barra; sin el dato de `reparto`, su id es el proveedor (así era antes de las cuentas). */
export const proveedorDe = (s: Pick<SuscripcionCupo, "id" | "proveedor">): string => s.proveedor ?? s.id;

/**
 * El nombre de una cuenta delante del proveedor cuando hay varias del mismo: "Claude · trabajo". La de siempre sin renombrar
 * (su nombre es el del proveedor) es la «principal»; si la renombraron, va con su nombre.
 */
export function etiquetaCuenta(proveedor: string, nombre: string, defecto: boolean, principal: string, nombresDeFabrica: readonly string[] = []): string {
  const marca = (MARCA as Record<string, string>)[proveedor] ?? nombre;
  return `${marca} · ${parteCuenta(proveedor, nombre, defecto, principal, nombresDeFabrica)}`;
}

/** Sólo la cuenta ("trabajo", "principal"): lo que cabe en la fila de la barra, donde el logo ya dice el proveedor. */
export function parteCuenta(proveedor: string, nombre: string, defecto: boolean, principal: string, nombresDeFabrica: readonly string[] = []): string {
  const marca = (MARCA as Record<string, string>)[proveedor] ?? nombre;
  const deFabrica = defecto && (!nombre.trim() || nombre === marca || nombresDeFabrica.includes(nombre));
  return deFabrica ? principal : nombre;
}

/**
 * `primera`: abre un proveedor nuevo (lleva el separador delante); las cuentas de Claude cuelgan de su fila de siempre.
 * `nombre`: el entero ("Claude · trabajo", para el tooltip); `corto`: lo que se escribe en la fila.
 * `cuenta`: la fila es una cuenta agregada que cuelga de la fila de su proveedor (se pinta debajo, sangrada y sin logo, con el nombre de la cuenta);
 * las demás son la fila del proveedor (logo y nombre del proveedor, con los datos de la cuenta de siempre).
 */
export type FilaSusc = { s: SuscripcionCupo; nombre: string; corto: string; proveedor: string; primera: boolean; cuenta: boolean };
export type FilasCupos = {
  /** Cómo se llama la fila de Claude (la de siempre) en el tooltip: `null` = como hoy, cuando es la única de Claude. */
  claude: string | null;
  /** Lo que lleva la fila de Claude: `null` = "Claude" (la de siempre sin renombrar); si la renombraron, su nombre. */
  claudeCorto: string | null;
  filas: FilaSusc[];
};

/** ¿La suscripción trae algún dato (un porcentaje o pedidos contados)? Una vacía es un renglón de "sin lectura" (`—`). */
function conDato(s: SuscripcionCupo): boolean {
  const ventanas = [...(s.ventanas ?? []), ...(s.grupos ?? []).flatMap((g) => g.ventanas)];
  return ventanas.some((v) => v.pct !== null || v.pedidos !== undefined) || (s.grupos ?? []).some((g) => g.agotado !== undefined);
}

/**
 * Una sola suscripción por proveedor y cuenta: si dos fuentes dicen la misma (p. ej. `reparto --cupos` y la cuenta de OpenCode que arma Trama), se queda la
 * que trae datos (y, con las dos igual, la última); va en el lugar de la primera. Sin esto una cuenta contaba dos y el proveedor parecía tener varias.
 */
export function sinRepetir(lista: readonly SuscripcionCupo[]): SuscripcionCupo[] {
  const lugar = new Map<string, number>();
  const out: SuscripcionCupo[] = [];
  for (const s of lista) {
    const k = `${proveedorDe(s)}\u0000${s.cuenta ?? s.id}`;
    const i = lugar.get(k);
    if (i === undefined) {
      lugar.set(k, out.length);
      out.push(s);
    } else if (conDato(s) || !conDato(out[i])) out[i] = s;
  }
  return out;
}

/**
 * La suscripción de la cuenta de siempre de un proveedor, la que lee la barra (por proveedor, no por id): con varias del mismo proveedor, la de siempre
 * si está y, si no, la primera. `undefined`: no hay ninguna. Ajustes > Plan y cupos pinta sus tarjetas con esto, para no divergir de la barra.
 */
export function suscripcionDe(subs: readonly SuscripcionCupo[] | undefined, proveedor: string): SuscripcionCupo | undefined {
  const delProveedor = sinRepetir(subs ?? []).filter((s) => proveedorDe(s) === proveedor);
  return delProveedor.find(esDefecto) ?? delProveedor[0];
}

/**
 * Las filas de la barra de cupos. Con una sola cuenta por proveedor no hay filas de cuenta: los datos van en la fila del proveedor, con su nombre de siempre.
 * Con más de una, las de un proveedor van juntas: la fila del proveedor (la cuenta de siempre; si la renombraron, con su nombre) y debajo, sangrada y con
 * el nombre de la cuenta, una fila por cada agregada ("Claude · trabajo" en el tooltip).
 * `claudeNombre`: cómo se llama la de siempre de Claude; `principal`: la palabra para la que no se renombró (sólo en los tooltips).
 */
export function filasDeCupos(subs: readonly SuscripcionCupo[] | undefined, claudeNombre: string | undefined, principal: string): FilasCupos {
  const lista = sinRepetir(subs ?? []);
  const contar = new Map<string, number>();
  const contarDe = (p: string) => (contar.get(p) ?? 0) + (p === "claude" ? 1 : 0);
  for (const s of lista) {
    const p = proveedorDe(s);
    contar.set(p, (contar.get(p) ?? 0) + 1);
  }
  const varias = (p: string) => contarDe(p) > 1;
  const fabrica = ["Claude", "Google AI Pro", "ChatGPT", "OpenCode"];
  // La de siempre sin renombrar la dice el proveedor mismo ("Google"): su fila es la del proveedor, no una cuenta.
  const sinRenombrar = (p: string, nombre: string) => parteCuenta(p, nombre, true, principal, fabrica) === principal;

  // Orden: la fila de Claude va siempre primera (la arma la cabecera), sus agregadas detrás; el resto por proveedor, agrupado.
  const orden: string[] = [];
  for (const s of lista) {
    const p = proveedorDe(s);
    if (!orden.includes(p)) orden.push(p);
  }
  orden.sort((a, b) => Number(b === "claude") - Number(a === "claude"));
  const filas: FilaSusc[] = [];
  for (const p of orden) {
    const delProveedor = lista.filter((s) => proveedorDe(s) === p).sort((a, b) => Number(esDefecto(b)) - Number(esDefecto(a)));
    delProveedor.forEach((s, i) => {
      const cuelga = varias(p) && (p === "claude" || i > 0);
      const nombre = varias(p) ? etiquetaCuenta(p, s.nombre, esDefecto(s), principal, fabrica) : s.nombre;
      const corto = !varias(p) ? s.nombre : cuelga ? s.nombre : esDefecto(s) && sinRenombrar(p, s.nombre) ? ((MARCA as Record<string, string>)[p] ?? s.nombre) : s.nombre;
      filas.push({ s, nombre, corto, proveedor: p, primera: i === 0 && p !== "claude", cuenta: cuelga });
    });
  }
  const cNombre = claudeNombre ?? "Claude";
  return {
    claude: varias("claude") ? etiquetaCuenta("claude", cNombre, true, principal, fabrica) : null,
    claudeCorto: varias("claude") && !sinRenombrar("claude", cNombre) ? cNombre : null,
    filas,
  };
}

/** La de siempre: su cuenta (o, sin ese dato, su id) es el proveedor. */
const esDefecto = (s: SuscripcionCupo): boolean => (s.cuenta ?? s.id) === proveedorDe(s);

/**
 * La cuenta de una fila de la barra que se puede elegir con «Usar primero» (o que está en uso). Sólo si su proveedor tiene más de una cuenta en la lista;
 * no se ofrece una cuenta sin conectar (igual que en Ajustes). `cuenta`: la de la fila (la de siempre tiene el id del proveedor). `null`: la fila queda como hoy.
 */
export function cuentaParaElegir(l: ListaCuentas | null, proveedor: string, cuenta: string): PerfilCuenta | null {
  const delProveedor = (l?.cuentas ?? []).filter((c) => c.proveedor === proveedor);
  if (delProveedor.length < 2) return null;
  const perfil = delProveedor.find((c) => c.id === cuenta);
  return perfil && (perfil.preferida || perfil.logueado !== false) ? perfil : null;
}
