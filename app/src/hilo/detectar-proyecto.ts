// Qué proyecto nombra el pedido de un líder nuevo (#1877): si el texto dice el nombre de un proyecto conocido, la carpeta de ese proyecto
// arranca sola (el chip del selector lo marca "automático"). Puro: lo prueba tests/detectar-proyecto.test.ts.

/** Lo mínimo que hace falta de un proyecto: el `nombre` del registry y el `titulo` que muestra el selector (si lo tiene). */
export type ProyectoDetectable = { nombre: string; titulo: string | null };

/** Sin acentos, sin mayúsculas y con los espacios juntos: "Diseño  Web" → "diseno web". */
const llano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const letraONumero = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Dónde aparece `nombre` en `texto` como palabra (o frase) entera, no metido dentro de otra palabra; `-1` si no aparece así. */
function posicionDe(texto: string, nombre: string): number {
  if (!nombre) return -1;
  for (let i = texto.indexOf(nombre); i !== -1; i = texto.indexOf(nombre, i + 1)) {
    if (!letraONumero(texto[i - 1]) && !letraONumero(texto[i + nombre.length])) return i;
  }
  return -1;
}

/**
 * El proyecto que nombra `texto` (el pedido), por su `nombre` o su `titulo`, sin distinguir mayúsculas ni tildes. Si nombra más de
 * uno, el que aparece primero en el texto. `null` si no nombra ninguno.
 */
export function detectarProyecto<P extends ProyectoDetectable>(texto: string, proyectos: readonly P[]): P | null {
  const t = llano(texto);
  let elegido: P | null = null;
  let elegidoEn = Infinity;
  for (const p of proyectos) {
    for (const nombre of [p.nombre, p.titulo]) {
      const en = posicionDe(t, llano(nombre ?? ""));
      if (en !== -1 && en < elegidoEn) {
        elegido = p;
        elegidoEn = en;
      }
    }
  }
  return elegido;
}
