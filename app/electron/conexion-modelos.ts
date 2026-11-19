// Qué proveedores del selector de modelo tienen su motor listo en esta máquina (sesión iniciada o programa instalado). Con esto el
// selector muestra SIEMPRE a todos y marca «Sin conectar» a los que no. Sin `electron`: lo prueba tests/conexion-modelos.test.ts.
// Las sesiones se preguntan a cada CLI (`electron/cuentas.ts`: 3 procesos chicos), así que se guardan unos segundos y las pedidas a
// la vez comparten una sola consulta: abrir el menú varias veces seguidas no relanza `claude`, `agy` y `codex` cada vez.
import type { EstadoCuentas } from "./cuentas.ts";

/** Qué proveedores están listos. `local` cubre llama-server y Ollama. */
export type Conexion = { anthropic: boolean; google: boolean; openai: boolean; opencode: boolean; dsh: boolean; local: boolean };

/** Lo que el main ya sabe sin preguntarle a nadie. */
export type Instalado = { agy: boolean; dsh: boolean; opencode: boolean; local: boolean };

/** Pura: junta la sesión de cada CLI con lo instalado. agy o codex que no contestaron cuentan como sin conectar (el menú sólo ofrece «Conectar»); claude no (ver abajo). */
export const conexionDe = (cuentas: EstadoCuentas | null, i: Instalado): Conexion => ({
  // Claude es el motor de siempre: sólo se marca «Sin conectar» si no está instalado o dijo claro que no hay sesión. Si no contestó a
  // tiempo o dijo otra cosa (error), no se le bloquea el modelo a nadie.
  anthropic: cuentas === null || cuentas.claude.logueado === true || (cuentas.claude.instalado && cuentas.claude.error !== null),
  google: i.agy && cuentas?.agy.logueado === true,
  openai: cuentas?.codex?.logueado === true,
  opencode: i.opencode,
  dsh: i.dsh,
  local: i.local,
});

const TTL_MS = 30_000;
let guardado: { hasta: number; valor: Promise<EstadoCuentas | null> } | null = null;

/** Las sesiones de los CLI, con caché corto. `preguntar` y `ahora` se inyectan en las pruebas. */
export function cuentasConCache(preguntar: () => Promise<EstadoCuentas>, ahora = Date.now()): Promise<EstadoCuentas | null> {
  if (guardado && guardado.hasta > ahora) return guardado.valor;
  const valor = preguntar().catch(() => null);
  guardado = { hasta: ahora + TTL_MS, valor };
  return valor;
}

/** Lo olvida (Ajustes acaba de iniciar o cerrar una sesión: la próxima consulta es de verdad). */
export const olvidarConexion = (): void => {
  guardado = null;
};
