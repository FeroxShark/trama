// La barra de Guardar de Ajustes, una sola y siempre a la vista. Cada bloque editable (plan y compactación, modelos,
// celular) conserva su borrador y publica acá cómo está; la barra suma los bloques y guarda o cancela todos a la vez.
// Puro (sin React): lo prueba tests/ajustes-barra.test.ts.

export type Bloque = {
  /** Hay algo distinto de lo guardado. */
  sucio: boolean;
  /** Lo escrito vale; sin eso el bloque sucio no se guarda. */
  valido: boolean;
  guardando: boolean;
  /** Se guardó hace un momento (hasta el próximo cambio). */
  ok: boolean;
  error: string | null;
  guardar: () => Promise<void> | void;
  cancelar: () => void;
};

export type Resumen = {
  sucio: boolean;
  /** Se puede guardar: hay cambios y todos los bloques con cambios valen. */
  puedeGuardar: boolean;
  guardando: boolean;
  /** Guardado, y sin nada nuevo desde entonces. */
  ok: boolean;
  error: string | null;
};

const SIN: Resumen = { sucio: false, puedeGuardar: false, guardando: false, ok: false, error: null };

const bloques = new Map<string, Bloque>();
const oyentes = new Set<() => void>();
let vista: Resumen = SIN;

function sumar(): Resumen {
  let sucio = false;
  let invalido = false;
  let guardando = false;
  let ok = false;
  let error: string | null = null;
  for (const b of bloques.values()) {
    if (b.sucio) {
      sucio = true;
      if (!b.valido) invalido = true;
    }
    if (b.guardando) guardando = true;
    if (b.ok && !b.sucio) ok = true;
    if (b.error && error === null) error = b.error;
  }
  return { sucio, puedeGuardar: sucio && !invalido && !guardando, guardando, ok: ok && !sucio, error };
}

function avisar() {
  const nueva = sumar();
  const igual = nueva.sucio === vista.sucio && nueva.puedeGuardar === vista.puedeGuardar && nueva.guardando === vista.guardando && nueva.ok === vista.ok && nueva.error === vista.error;
  if (igual) return;
  vista = nueva;
  for (const f of [...oyentes]) f();
}

/** Un bloque dice cómo está (o `null` al desmontarse). Las funciones se guardan siempre las últimas; sólo un cambio de estado avisa. */
export function publicar(id: string, b: Bloque | null) {
  if (b) bloques.set(id, b);
  else bloques.delete(id);
  avisar();
}

export const resumen = (): Resumen => vista;

export function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}

/** Guarda, de a uno, cada bloque con cambios que vale. Uno que falla no frena a los demás: su error queda en la barra. */
export async function guardarTodo() {
  for (const b of [...bloques.values()]) {
    if (b.sucio && b.valido && !b.guardando) await b.guardar();
  }
}

export function cancelarTodo() {
  for (const b of [...bloques.values()]) if (b.sucio && !b.guardando) b.cancelar();
}

/** Para los tests: sin bloques ni oyentes. */
export function vaciar() {
  bloques.clear();
  oyentes.clear();
  vista = SIN;
}
