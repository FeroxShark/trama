// Normalización de salidas de `pa` para compararlas entre implementaciones: lo que cambia entre corridas (rutas
// temporales, fechas, uuids, pids, duraciones) se reemplaza por marcas fijas. Lo demás se compara tal cual.

export interface Raices {
  /** Carpetas temporales de ESTA corrida, de la más larga a la más corta; se reemplazan por `<TMP>`. */
  tmp: string[];
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reemplazos en orden: de lo más específico a lo más general. */
export function normalizar(texto: string, raices: Raices): string {
  let t = texto.replace(/\r\n/g, "\n");
  for (const r of [...raices.tmp].sort((a, b) => b.length - a.length)) {
    if (r) {
      t = t.replace(new RegExp(escapar(r.replace(/\\/g, "/")), "g"), "<TMP>").replace(new RegExp(escapar(r), "g"), "<TMP>");
      // la carpeta de transcripts de Claude: la ruta con todo lo que no es alfanumérico pasado a «-»
      t = t.replace(new RegExp(escapar(r.replace(/[^A-Za-z0-9]/g, "-")), "g"), "<TMP-CLAUDE>");
    }
  }
  return (
    t
      // sha de git (el commit inicial lleva la hora)
      .replace(/\b[0-9a-f]{40}\b/g, "<SHA>")
      // uuid
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
      // id de corrida: AAAAMMDD-HHMMSS-pid
      .replace(/\b\d{8}-\d{6}-\d+\b/g, "<ID>")
      // fecha-hora ISO (con o sin milisegundos, Z u offset)
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<FECHA>")
      // epoch en segundos o ms (10 o 13 dígitos sueltos)
      .replace(/\b1[5-9]\d{8}(\d{3})?\b/g, "<EPOCH>")
      // fecha suelta de hoy (el 'Hoy:' del plan, nombres de carpetas con fecha)
      .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "<DIA>")
      .replace(/\b20\d{6}\b/g, "<DIA>")
      // duraciones: «0s», «12s», «1m03s»
      .replace(/\b\d+m\d{2}s\b/g, "<DUR>")
      .replace(/\b\d+h\d{2}m\b/g, "<DUR>")
      .replace(/\bhace \d+s\b/g, "hace <DUR>")
      .replace(/("(?:arranco_hace_s|herramienta_hace_s)": )\d+/g, "$1<N>")
      .replace(/ · \d+s ·/g, " · <DUR> ·")
      // pids
      .replace(/\b(pid[= :]+)\d+/gi, "$1<PID>")
      // RAM libre / reservada (varía con la máquina)
      .replace(/(disponible |reservada )\d+ MB/g, "$1<N> MB")
  );
}

/** argv de claude: igual, pero un argumento por línea para que el diff sea legible. */
export function normalizarArgv(args: string[], raices: Raices): string {
  return args.map((a) => normalizar(a, raices)).join("\n");
}
