// Los programas externos que consulta la política de `pa` (bin/reparto y bin/cuentas), detrás de interfaces: en Linux se llaman
// como siempre (`$PA_REPARTO` o motor/bin/reparto, `$PA_CUENTAS_BIN` o motor/bin/cuentas); cuando reparto y cuentas pasen a TS
// (etapas 12-13) se enchufa otra implementación sin tocar la política. Nada de esto tira: una falla vuelve como código.
import { spawnSync } from "node:child_process";
import path from "node:path";
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
  /** `reparto --tipo T [--cuenta C] --json` (con REPARTO_RESERVAR=1 si `reservar`). rc 124/137 = venció el tope, 127 = no está. */
  elegir(tipo: string, o?: { reservar?: boolean; sinDsh?: boolean; cuenta?: string }): Promise<{ rc: number; salida: string }>;
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

/** reparto como proceso (lo de siempre en Linux). */
export function repartoProceso(pa: Pa): Reparto {
  // PA_REPARTO=0 apaga la elección automática (modelos.reparto()), no el comando.
  const ruta = pa.env.PA_REPARTO && pa.env.PA_REPARTO !== "0" ? pa.env.PA_REPARTO : path.join(pa.bin, "reparto");
  const entorno = (extra: Env = {}): Env => ({ ...pa.env, REPARTO_STATE: pa.env.REPARTO_STATE || path.join(pa.state, "reparto"), PA_STATE: pa.state, ...extra });
  const ms = () => Number(topeReparto(pa.env)) * 1000;
  const llamar = (args: string[], extra: Env = {}, tope = true) =>
    correr(ruta, args, { env: entorno(extra), timeoutMs: tope ? ms() : undefined, input: "" });
  return {
    ruta,
    ejecutable: () => esEjecutable(ruta, pa.plat),
    async enfriado(modelo) {
      const r = await llamar(["--enfriado", modelo], {}, false);
      return r.codigo === 0 ? recortar(r.salida) : null;
    },
    async elegir(tipo, o = {}) {
      const extra: Env = {};
      if (o.reservar) extra.REPARTO_RESERVAR = "1";
      if (o.reservar) extra.REPARTO_SIN_DSH = o.sinDsh ? "1" : "";
      const r = await llamar(["--tipo", tipo, ...(o.cuenta ? ["--cuenta", o.cuenta] : []), "--json"], extra);
      return { rc: r.codigo, salida: recortar(r.salida) };
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
      const r = spawnSync(ruta, ["--plan", sub, ...args], { env: entorno() as NodeJS.ProcessEnv, stdio: "inherit" });
      return r.status ?? (r.error ? 127 : 1);
    },
  };
}

/** cuentas como proceso. */
export function cuentasProceso(pa: Pa): Cuentas {
  const ruta = pa.env.PA_CUENTAS_BIN || path.join(pa.bin, "cuentas");
  return {
    async env(id) {
      const r = await correr(ruta, ["env", id, "--json"], { env: pa.env, input: "" });
      return { rc: r.codigo, salida: recortar(r.salida + r.errores) };
    },
  };
}
