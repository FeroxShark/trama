// Cómo se muestra la vista previa de "Unificar instrucciones": qué líneas salen y entran de un archivo. Puro (sin React): lo prueba
// tests/unificar-md.test.ts. Cada línea lleva su signo (+ / −) en el texto: el color ayuda, pero no es lo único que lo dice.

export type LineaVista = { signo: "+" | "−" | " "; texto: string } | { signo: "…"; n: number };

const partir = (t: string): string[] => {
  const l = t.replace(/\r/g, "").split("\n");
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
};

/**
 * Lo que cambia de `antes` a `despues`: se descarta lo que tienen igual al principio y al final (queda una línea de contexto de cada lado)
 * y el resto va como − (lo que sale) y + (lo que entra). `antes === null` es un archivo nuevo: todo +. `max` acota las líneas que se
 * muestran por lado; lo demás se resume en una fila "… N líneas más".
 */
export function lineasDeCambio(antes: string | null, despues: string, max = 14): { lineas: LineaVista[]; quita: number; pone: number } {
  const a = antes === null ? [] : partir(antes);
  const d = partir(despues);
  let ini = 0;
  while (ini < a.length && ini < d.length && a[ini] === d[ini]) ini++;
  let fin = 0;
  while (fin < a.length - ini && fin < d.length - ini && a[a.length - 1 - fin] === d[d.length - 1 - fin]) fin++;
  const sale = a.slice(ini, a.length - fin);
  const entra = d.slice(ini, d.length - fin);
  const lineas: LineaVista[] = [];
  if (!sale.length && !entra.length) return { lineas, quita: 0, pone: 0 };
  if (ini > 0) lineas.push({ signo: " ", texto: a[ini - 1] });
  const tope = (xs: string[], signo: "+" | "−") => {
    for (const x of xs.slice(0, max)) lineas.push({ signo, texto: x });
    if (xs.length > max) lineas.push({ signo: "…", n: xs.length - max });
  };
  tope(sale, "−");
  tope(entra, "+");
  if (fin > 0) lineas.push({ signo: " ", texto: a[a.length - fin] });
  return { lineas, quita: sale.length, pone: entra.length };
}
