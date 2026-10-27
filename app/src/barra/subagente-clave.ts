// La clave con que se abre un subagente a la derecha (`sub:<sesión>:<agentId>`): la misma que entiende
// electron/pasos-worker.ts para armar sus pasos. Sin imports: lo prueba `tests/pasos-subagente.test.ts`.

/** Lo que se abre a la derecha para ver los pasos de un subagente (lo entiende electron/pasos-worker.ts). */
export const claveSub = (sid: string, id: string) => `sub:${sid}:${id}`;

/** La sesión y el subagente de una clave de `claveSub`; `null` si no es una. */
export function deClaveSub(clave: string | null): { sid: string; id: string } | null {
  const m = clave?.match(/^sub:([^:]+):([^:]+)$/);
  return m ? { sid: m[1], id: m[2] } : null;
}
