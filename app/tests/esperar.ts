// Helper para esperar que se cumpla una condición en tests (#1793).

export async function esperarHasta(
  cond: () => boolean | Promise<boolean>,
  opc: { tope?: number; cada?: number } = {}
): Promise<void> {
  const tope = opc.tope ?? 2000;
  const cada = opc.cada ?? 10;
  const inicio = Date.now();
  while (true) {
    if (await cond()) {
      return;
    }
    if (Date.now() - inicio >= tope) {
      throw new Error(`esperarHasta: se superó el tope de ${tope} ms`);
    }
    await new Promise((resolver) => setTimeout(resolver, cada));
  }
}
