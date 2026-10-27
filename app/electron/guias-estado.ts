// El estado de las guías de pantalla (src/guia): qué versión de cada guía ya se vio y si las guías están apagadas del todo. Vive en
// preferencias.json (`guias`), así lo comparten las ventanas y los celulares de la misma instalación. Puro (sin fs): lo usan
// electron/preferencias.ts (validar lo que llega y lo que está guardado) y src/guia/registro.ts (lo mismo en el renderer).

export type EstadoGuias = { off: boolean; vistas: Record<string, number> };

/** Un cambio: marcar una guía como vista en su versión, apagar/prender todas, o volver a mostrar todas. */
export type OpGuias = { vista: { id: string; version: number } } | { off: boolean } | { reiniciar: true };

export const GUIAS_VACIO: EstadoGuias = { off: false, vistas: {} };

const MAX_GUIAS = 64;
export const esIdGuia = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x);
const esVersion = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 9999;

/** Lo que venga (el archivo, el IPC) llevado a algo válido: lo que no se entiende se descarta. */
export function normalizarGuias(x: unknown): EstadoGuias {
  const j = x && typeof x === "object" ? (x as { off?: unknown; vistas?: unknown }) : {};
  const vistas: Record<string, number> = {};
  if (j.vistas && typeof j.vistas === "object") {
    for (const [id, v] of Object.entries(j.vistas as Record<string, unknown>)) {
      if (Object.keys(vistas).length >= MAX_GUIAS) break;
      if (esIdGuia(id) && esVersion(v)) vistas[id] = v;
    }
  }
  return { off: j.off === true, vistas };
}

/** Aplica un cambio sin tocar el estado de entrada. Una op inválida lo deja igual. Una guía vista en una versión nunca "retrocede". */
export function aplicarOpGuias(e: EstadoGuias, op: unknown): EstadoGuias {
  const o = op && typeof op === "object" ? (op as Record<string, unknown>) : {};
  if (o.reiniciar === true) return { off: e.off, vistas: {} };
  if (typeof o.off === "boolean") return { off: o.off, vistas: e.vistas };
  const v = o.vista as { id?: unknown; version?: unknown } | undefined;
  if (v && esIdGuia(v.id) && esVersion(v.version)) {
    if ((e.vistas[v.id] ?? 0) >= v.version) return e;
    if (!(v.id in e.vistas) && Object.keys(e.vistas).length >= MAX_GUIAS) return e;
    return { off: e.off, vistas: { ...e.vistas, [v.id]: v.version } };
  }
  return e;
}
