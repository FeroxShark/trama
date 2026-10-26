// "Aplicar los veredictos solo después de analizar" (Ramas): una preferencia de esta pantalla, apagada de fábrica. Vive en el
// navegador de quien mira (no la comparten el celular y la PC): es una comodidad, no un dato. Si el almacenamiento no anda, queda en memoria.
const CLAVE = "trama.ramas.aplicarAuto";
let valor: boolean | null = null;
const oyentes = new Set<() => void>();

function leer(): boolean {
  if (valor !== null) return valor;
  try {
    valor = localStorage.getItem(CLAVE) === "1";
  } catch {
    valor = false;
  }
  return valor;
}

export const aplicarAuto = (): boolean => leer();

export function cambiarAplicarAuto(si: boolean) {
  valor = si;
  try {
    localStorage.setItem(CLAVE, si ? "1" : "0");
  } catch {
    /* sin almacenamiento: vale en esta sesión */
  }
  oyentes.forEach((o) => o());
}

export const alCambiarAplicarAuto = (f: () => void): (() => void) => (oyentes.add(f), () => void oyentes.delete(f));
