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
      // la carpeta con sello de hora de los backups de --unificar-md (la hora de cada corrida es otra)
      .replace(/\bmd-backup\/\d{8}-\d{6}\b/g, "md-backup/<TS>")
      // sha de git (el commit inicial lleva la hora)
      .replace(/\b[0-9a-f]{40}\b/g, "<SHA>")
      // sha corto de «N commit(s) sobre <sha>» (--ramas y el resultado de una corrida con worktree)
      .replace(/\bsobre [0-9a-f]{7,12}\b/g, "sobre <SHA>")
      // uuid
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
      // id de corrida: AAAAMMDD-HHMMSS-pid
      .replace(/\b\d{8}-\d{6}-\d+\b/g, "<ID>")
      // fecha-hora ISO (con o sin milisegundos, Z u offset)
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<FECHA>")
      // epoch en segundos o ms (10 o 13 dígitos sueltos)
      .replace(/\b1[5-9]\d{8}(\d{3})?\b/g, "<EPOCH>")
      // «2026-10-28 12:31» (las notas del jefe y el encabezado del traspaso, al minuto)
      .replace(/\b20\d{2}-\d{2}-\d{2} \d{2}:\d{2}\b/g, "<FECHA>")
      // fecha suelta de hoy (el 'Hoy:' del plan, nombres de carpetas con fecha)
      .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "<DIA>")
      .replace(/\b20\d{6}\b/g, "<DIA>")
      // duraciones: «0s», «12s», «1m03s»
      .replace(/\b\d+m\d{2}s\b/g, "<DUR>")
      .replace(/\b\d+h\d{2}m\b/g, "<DUR>")
      .replace(/\bhace \d+s\b/g, "hace <DUR>")
      .replace(/("(?:arranco_hace_s|herramienta_hace_s)": )\d+/g, "$1<N>")
      .replace(/ · \d+s ·/g, " · <DUR> ·")
      // La ayuda: la entrada del tope de turnos ahora dice que sale del tipo y el bash está congelado: se borra de los dos.
      .replace(/^ *pa <proyecto> --max-turns N[^\n]*\n(?:[^\n]*\n){0,3}? *Al llegar:[^\n]*\n/gm, "")
      // El contrato: la frase de «si tu contexto se compacta» existe sólo en el pa de TypeScript (el bash está congelado): se borra de los dos.
      .replace(/\nSi tu contexto se compacta, cerrá el pedazo[^\n]*/g, "")
      // El contrato: HALLAZGO y FALTA (opcionales) existen sólo en el pa de TypeScript: se borran de los dos.
      .replace(/\n(?:HALLAZGO|FALTA): \(opcional\)[^\n]*/g, "")
      // La ayuda: --indivisible existe sólo en el pa de TypeScript (el bash está congelado): se borra de los dos.
      .replace(/^ *pa <proyecto> --indivisible[^\n]*\n/gm, "")
      // La ayuda: --integrar-si-pasa (en --objetivo) existe sólo en el pa de TypeScript (el bash está congelado): se borra de los dos.
      .replace(/ \[--integrar-si-pasa\]/g, "")
      .replace(/ Con --integrar-si-pasa, [\s\S]*?Sin el flag no integra\. /g, " ")
      // La ayuda: --mcp ahora vale para todos los workers (por defecto van sin MCP) y el bash está congelado: se unifica la línea.
      .replace(/^( *pa <proyecto> --mcp "<tarea>" +)[^\n]*$/gm, "$1<MCP>")
      // Gemini 3.8 Flash fue sacado del TS (python y bash congelados todavía lo nombran en --explicar, --ayuda y el error de -m).
      .replace(/(Uso por modelo:[^\n]*)gemini-3\.8-flash → poco importante; /g, "$1")
      .replace(/gemini-\{4-argon,3\.8-flash\}-\{low,medium,high\}/g, "gemini-4-argon-{low,medium,high}, gemini-4-hydrogen-{low,medium,high,xhigh}")
      // El aviso del plan: el texto del tope de turnos cambió (ahora sale del tipo).
      .replace(/tope 100 turnos/g, "tope de turnos hasta 100")
      .replace(/tope 150\)/g, "tope de turnos por tipo: 30 a 120)")
      // pids
      .replace(/\b(pid[= :]+)\d+/gi, "$1<PID>")
      // el pid del claude que baja --matar/--parar («matado (claude 1234 y su árbol)»)
      .replace(/\b(claude )\d+\b/g, "$1<PID>")
      // RAM libre / reservada (varía con la máquina)
      .replace(/(disponible |reservada )\d+ MB/g, "$1<N> MB")
  );
}

/** argv de claude: igual, pero un argumento por línea para que el diff sea legible. */
export function normalizarArgv(args: string[], raices: Raices): string {
  return args.map((a) => normalizar(a, raices)).join("\n");
}
