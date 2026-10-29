// Los canales `cuentas:lista|agregar|renombrar|quitar|login|plan|preferir` (varias cuentas por proveedor) sobre electron/cuentas-varias.ts.
// Aparte de nucleo.ts para probarlos sin Electron: `manejar` y las dependencias entran por argumento. Un fallo vuelve como
// `{ ok: false, error }` (texto ya codificado, lo traduce el renderer con `textoMain`), nunca como excepción del IPC.
import { agregarCuenta, listarCuentas, loginCuenta, planCuenta, preferirCuenta, quitarCuenta, renombrarCuenta, type DepsVarias, type ListaCuentas } from "./cuentas-varias.ts";

export type ResultadoCuenta = { ok: true; id?: string } | { ok: false; error: string };

type Registrar = (canal: string, fn: (e: unknown, ...args: unknown[]) => unknown) => void;

const mensaje = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function cuentasVarias(manejar: Registrar, deps: DepsVarias, alCambiar: () => void): void {
  const hacer = async (fn: () => Promise<string | void>): Promise<ResultadoCuenta> => {
    try {
      const id = await fn();
      return typeof id === "string" ? { ok: true, id } : { ok: true };
    } catch (e) {
      return { ok: false, error: mensaje(e) };
    } finally {
      alCambiar();
    }
  };
  manejar("cuentas:lista", (_e, verificar): Promise<ListaCuentas | null> => listarCuentas(deps, verificar === true));
  manejar("cuentas:agregar", (_e, proveedor, nombre) => hacer(() => agregarCuenta(deps, proveedor, nombre)));
  manejar("cuentas:renombrar", (_e, id, nombre) => hacer(() => renombrarCuenta(deps, id, nombre)));
  manejar("cuentas:quitar", (_e, id, borrar) => hacer(() => quitarCuenta(deps, id, borrar)));
  manejar("cuentas:login", (_e, id) => hacer(() => loginCuenta(deps, id)));
  manejar("cuentas:plan", (_e, id, plan) => hacer(() => planCuenta(deps, id, plan)));
  manejar("cuentas:preferir", (_e, id) => hacer(() => preferirCuenta(deps, id)));
}
