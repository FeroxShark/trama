// Lo que se está escribiendo en Ajustes antes de Guardar: el plan y la red de seguridad, y el acceso desde el celular.
// Puro (sin React ni puente): cada borrador nace de lo guardado, se valida con las reglas del main (valida-ajustes.ts) y
// Cancelar es volver a nacer de lo guardado. Lo prueba tests/ajustes-borrador.test.ts.
import type { CambioAjustes } from "../../electron/ajustes-editar";
import { esPlan, validarDispositivo, validarPuerto, validarRed, type ConfigEditable, type Plan } from "../../electron/valida-ajustes";

export type Guardado = { plan: string | null; red_seguridad: number | null };
export type BorradorNum = { plan: Plan | null; red: string };

export const numDesde = (g: Guardado): BorradorNum => ({ plan: esPlan(g.plan) ? g.plan : null, red: g.red_seguridad === null ? "" : String(g.red_seguridad) });

/** Qué mandar, el motivo si algo no vale (clave de i18n) y si hay algo distinto de lo guardado. */
export function numPara(g: Guardado, b: BorradorNum): { cambio: CambioAjustes; error: string | null; sucio: boolean } {
  const cambio: CambioAjustes = {};
  if (b.plan !== null && b.plan !== g.plan) cambio.plan = b.plan;
  const red = validarRed(b.red);
  if (!red.error && red.valor !== g.red_seguridad) cambio.red_seguridad = red.valor;
  const sucio = Object.keys(cambio).length > 0 || !!red.error || b.red.trim() !== (g.red_seguridad === null ? "" : String(g.red_seguridad));
  return { cambio, error: red.error, sucio };
}

export type BorradorRemoto = { activo: boolean; puerto: string; dispositivos: string[]; nuevo: string };

export const remotoDesde = (c: ConfigEditable): BorradorRemoto => ({ activo: c.activo, puerto: String(c.puerto), dispositivos: [...c.dispositivos], nuevo: "" });

/** Suma el nombre escrito a la lista (en el borrador, no en el archivo); si no vale, dice por qué. */
export function agregarDispositivo(b: BorradorRemoto): { borrador: BorradorRemoto; error: string | null } {
  const error = validarDispositivo(b.nuevo, b.dispositivos);
  if (error) return { borrador: b, error };
  return { borrador: { ...b, dispositivos: [...b.dispositivos, b.nuevo.trim().toLowerCase()], nuevo: "" }, error: null };
}

export const quitarDispositivo = (b: BorradorRemoto, nombre: string): BorradorRemoto => ({ ...b, dispositivos: b.dispositivos.filter((d) => d !== nombre) });

/** Lo que se manda a guardar (`null` si algo no vale) con los motivos por campo, y si hay algo distinto de lo guardado. */
export function remotoPara(g: ConfigEditable, b: BorradorRemoto): { config: ConfigEditable | null; errores: { puerto?: string; nuevo?: string; general?: string }; sucio: boolean } {
  const errores: { puerto?: string; nuevo?: string; general?: string } = {};
  const malPuerto = validarPuerto(b.puerto);
  if (malPuerto) errores.puerto = malPuerto;
  if (b.nuevo.trim()) errores.nuevo = validarDispositivo(b.nuevo, b.dispositivos) ?? "ajustes.errDispPendiente";
  if (b.activo && !b.dispositivos.length) errores.general = "ajustes.errSinDispositivos";
  const config = malPuerto ? null : { activo: b.activo, puerto: Number(b.puerto), dispositivos: b.dispositivos };
  const sucio =
    b.activo !== g.activo || b.puerto.trim() !== String(g.puerto) || b.nuevo.trim() !== "" || b.dispositivos.length !== g.dispositivos.length || b.dispositivos.some((d, i) => d !== g.dispositivos[i]);
  return { config: Object.keys(errores).length ? null : config, errores, sucio };
}
