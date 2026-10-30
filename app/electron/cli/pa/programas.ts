// Los programas externos que consulta la política de `pa` (bin/reparto y bin/cuentas), detrás de interfaces: en Linux se llaman
// como siempre (`$PA_REPARTO` o motor/bin/reparto, `$PA_CUENTAS_BIN` o motor/bin/cuentas); cuando reparto y cuentas pasen a TS
// (etapas 12-13) se enchufa otra implementación sin tocar la política. Nada de esto tira: una falla vuelve como código.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { comandoPropio, entornoCmd, HERRAMIENTAS_PROPIAS } from "../../binario.ts";
import { esEjecutable } from "../base/buscar.ts";
import { correr } from "../base/proc.ts";
import type { Env, Pa } from "./entorno.ts";

export interface Reparto {
  /** La ruta que se nombra en los mensajes (`$REPARTO`). */
  readonly ruta: string;
  /** `[[ -x "$REPARTO" ]]`. */
  ejecutable(): boolean;
  /** `reparto --enfriado <m>`: hasta cuándo, o null si no está enfriado (o no contesta). */
  enfriado(modelo: string): Promise<string | null>;
  /** `reparto --enfriar <m> [--horas N]`: marca ese modelo de OpenCode como enfriado (nunca rompe). */
  enfriar?(modelo: string, horas?: string): Promise<void>;
  /** `reparto --opencode-limite` con lo que dijo OpenCode por stdin: si era su límite gratis, agota el grupo opencode-free (nunca rompe). */
  opencodeLimite?(salida: string): Promise<void>;
  /** `reparto --tipo T [--cuenta C] --json` (con REPARTO_RESERVAR=1 si `reservar`). rc 124/137 = venció el tope, 127 = no está. */
  elegir(tipo: string, o?: { reservar?: boolean; sinDsh?: boolean; cuenta?: string; noDisponible?: string[]; conChequeo?: boolean }): Promise<{ rc: number; salida: string }>;
  /** `reparto --sustituir <claude-*> [--tipo T] [--effort E] --registrar --json`: ¿conviene correr ese modelo por agy? rc 0 = sí (`a` en el JSON). Opcional: los falsos de los tests no lo tienen. */
  sustituir?(modelo: string, o?: { tipo?: string; effort?: string }): Promise<{ rc: number; salida: string }>;
  /** `reparto --otro-camino <agy:claude-*> --json`: el mismo modelo por el Claude oficial, si está habilitado. rc 0 = hay. */
  otroCamino?(modelo: string): Promise<{ rc: number; salida: string }>;
  /** `reparto --agotar <m> [--hasta ISO] [--cuenta C]`: marca agotado el camino de ese modelo (nunca rompe). */
  agotar?(modelo: string, o?: { hasta?: string; cuenta?: string }): Promise<void>;
  /** `reparto --agy-modelos [--refrescar] [--cuenta C]`: los modelos (con el id de pa) que ofrece el agy de esta cuenta, o null si no se sabe. Opcional: los falsos de los tests no lo tienen. */
  agyModelos?(o?: { refrescar?: boolean; cuenta?: string }): Promise<string[] | null>;
  /** `reparto --tabla --json` ("" si falla). */
  tabla(): Promise<string>;
  /** `reparto --cuenta-para <m>` ("" si falla). */
  cuentaPara(modelo: string): Promise<string>;
  /** `reparto --plan <sub> [args]` con la salida a la vista; devuelve el código. */
  plan(sub: string, args: string[]): number;
}

export interface Cuentas {
  /** `cuentas env <id> --json` (stdout y stderr juntos, como `2>&1`). */
  env(id: string): Promise<{ rc: number; salida: string }>;
}

/** `${PA_REPARTO_TIMEOUT_S:-15}`. */
export const topeReparto = (env: Env) => env.PA_REPARTO_TIMEOUT_S || "15";

/** `$(…)`: la salida sin los saltos de línea del final. */
const recortar = (s: string) => s.replace(/\n+$/, "");

/**
 * Qué se lanza para correr `nombre`: Linux `[<ruta>]`, como siempre; Windows `[node, <app>\dist-electron\cli\<nombre>.js]` (el ayudante `comandoPropio`,
 * nunca un `.cmd`). `anulada` es lo que pone la variable de `pa` (`PA_REPARTO`, `PA_CUENTAS_BIN`), que gana si está.
 */
export function prefijoDe(pa: Pa, nombre: string, anulada: string | undefined, ruta: string): string[] {
  if (pa.plat !== "win32") return [ruta];
  const env = { ...pa.env, ...(anulada && anulada !== "0" ? { [HERRAMIENTAS_PROPIAS[nombre]!]: anulada } : {}) };
  return comandoPropio(nombre, env, pa.home, (f) => esEjecutable(f, pa.plat), "win32");
}

/** reparto como proceso (lo de siempre en Linux). */
export function repartoProceso(pa: Pa): Reparto {
  // PA_REPARTO=0 apaga la elección automática (modelos.reparto()), no el comando.
  const ruta = pa.env.PA_REPARTO && pa.env.PA_REPARTO !== "0" ? pa.env.PA_REPARTO : path.join(pa.bin, "reparto");
  const prefijo = prefijoDe(pa, "reparto", pa.env.PA_REPARTO, ruta);
  const entorno = (extra: Env = {}): Env => ({ ...pa.env, REPARTO_STATE: pa.env.REPARTO_STATE || path.join(pa.state, "reparto"), PA_STATE: pa.state, ...extra });
  const ms = () => Number(topeReparto(pa.env)) * 1000;
  const llamar = (args: string[], extra: Env = {}, tope = true, entrada = "") =>
    correr(prefijo[0]!, [...prefijo.slice(1), ...args], { env: entornoCmd(prefijo, entorno(extra)), timeoutMs: tope ? ms() : undefined, input: entrada });
  return {
    ruta: prefijo[prefijo.length - 1]!,
    ejecutable: () => esEjecutable(prefijo[prefijo.length - 1]!, pa.plat),
    async enfriado(modelo) {
      const r = await llamar(["--enfriado", modelo], {}, false);
      return r.codigo === 0 ? recortar(r.salida) : null;
    },
    async enfriar(modelo, horas) {
      await llamar(["--enfriar", modelo, ...(horas ? ["--horas", horas] : [])]).catch(() => {});
    },
    async opencodeLimite(salida) {
      await llamar(["--opencode-limite"], {}, true, salida).catch(() => {});
    },
    async elegir(tipo, o = {}) {
      const extra: Env = {};
      if (o.reservar) extra.REPARTO_RESERVAR = "1";
      if (o.reservar) extra.REPARTO_SIN_DSH = o.sinDsh ? "1" : "";
      if (o.reservar) extra.REPARTO_NO_DISPONIBLE = (o.noDisponible ?? []).join(",");
      if (o.conChequeo) extra.REPARTO_CON_CHEQUEO = "1";
      const r = await llamar(["--tipo", tipo, ...(o.cuenta ? ["--cuenta", o.cuenta] : []), "--json"], extra);
      return { rc: r.codigo, salida: recortar(r.salida) };
    },
    async sustituir(modelo, o = {}) {
      const r = await llamar(["--sustituir", modelo, ...(o.tipo ? ["--tipo", o.tipo] : []), ...(o.effort ? ["--effort", o.effort] : []), "--registrar", "--json"]);
      return { rc: r.codigo, salida: recortar(r.salida) };
    },
    async otroCamino(modelo) {
      const r = await llamar(["--otro-camino", modelo, "--json"]);
      return { rc: r.codigo, salida: recortar(r.salida) };
    },
    async agotar(modelo, o = {}) {
      await llamar(["--agotar", modelo, ...(o.hasta ? ["--hasta", o.hasta] : []), ...(o.cuenta ? ["--cuenta", o.cuenta] : [])], {}, false).catch(() => {});
    },
    async agyModelos(o = {}) {
      const r = await llamar(["--agy-modelos", ...(o.refrescar ? ["--refrescar"] : []), ...(o.cuenta ? ["--cuenta", o.cuenta] : [])]);
      return r.codigo === 0 ? recortar(r.salida).split("\n").filter((x) => x !== "") : null;
    },
    async tabla() {
      const r = await llamar(["--tabla", "--json"]);
      return r.codigo === 0 ? recortar(r.salida) : "";
    },
    async cuentaPara(modelo) {
      const r = await llamar(["--cuenta-para", modelo]);
      return r.codigo === 0 ? recortar(r.salida) : "";
    },
    plan(sub, args) {
      const r = spawnSync(prefijo[0]!, [...prefijo.slice(1), "--plan", sub, ...args], { env: entornoCmd(prefijo, entorno()) as NodeJS.ProcessEnv, stdio: "inherit" });
      return r.status ?? (r.error ? 127 : 1);
    },
  };
}

/** cuentas como proceso. */
export function cuentasProceso(pa: Pa): Cuentas {
  const prefijo = prefijoDe(pa, "cuentas", pa.env.PA_CUENTAS_BIN, pa.env.PA_CUENTAS_BIN || path.join(pa.bin, "cuentas"));
  return {
    async env(id) {
      const r = await correr(prefijo[0]!, [...prefijo.slice(1), "env", id, "--json"], { env: entornoCmd(prefijo, pa.env), input: "" });
      return { rc: r.codigo, salida: recortar(r.salida + r.errores) };
    },
  };
}
