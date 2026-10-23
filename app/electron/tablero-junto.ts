// El tablero junto de las dos máquinas (etapa 7, M5; contrato: docs/estado/maquinas.md): el de acá más el de cada otra
// máquina, que se lee de su motor (`tablero:leer`). Cada item de allá lleva `maquina` y `maquinaNombre` y su id con
// prefijo (`dell:12`), como las filas de la barra: los números de dos tableros chocan. Las acciones sobre un item de
// allá van al tablero de su máquina (maquinas.ts, `enrutar`). Puro y sin Electron: lo prueba tests/tablero-junto.test.ts.
import { esperanEnVista, type TableroCrudo } from "./tablero.ts";

/** Lo que se tiene del tablero de otra máquina: `tb` es null si no se pudo leer (caída, o sin tablero). */
export type TableroOtra = { id: string; nombre: string; tb: TableroCrudo | null };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** El item de allá con su máquina y su id con prefijo; lo que no es un item se deja como vino (lo descarta quien lo valida). */
function estampar(m: TableroOtra, x: unknown): unknown {
  if (!esObjeto(x) || !Number.isInteger(x.id)) return x;
  return { ...x, id: `${m.id}:${x.id}`, maquina: m.id, maquinaNombre: m.nombre };
}
const estamparTodos = (m: TableroOtra, lista: unknown): unknown[] => (Array.isArray(lista) ? lista.map((x) => estampar(m, x)) : []);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Las columnas de la vista de acá con los items de allá al final de cada una; los contadores numéricos se suman. */
function juntarVista(local: unknown, otras: TableroOtra[]): unknown {
  if (!esObjeto(local)) return local;
  const columnas: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(esObjeto(local.columnas) ? local.columnas : {})) columnas[k] = lista(v);
  const contadores: Record<string, unknown> = esObjeto(local.contadores) ? { ...local.contadores } : {};
  for (const m of otras) {
    const v = m.tb?.vista;
    if (!esObjeto(v)) continue;
    for (const [k, c] of Object.entries(esObjeto(v.columnas) ? v.columnas : {})) columnas[k] = [...(columnas[k] ?? []), ...estamparTodos(m, c)];
    for (const [k, n] of Object.entries(esObjeto(v.contadores) ? v.contadores : {})) {
      if (typeof n === "number" && Number.isFinite(n)) contadores[k] = (typeof contadores[k] === "number" ? (contadores[k] as number) : 0) + n;
    }
  }
  return { ...local, columnas, contadores };
}

/** Los proyectos de las dos: el mismo nombre es una fila (suma lo abierto, los días del más reciente); `etapa` y `sigue` mandan los de acá. */
function juntarProyectos(local: unknown, otras: TableroOtra[]): unknown {
  const sale: unknown[] = [...lista(local)];
  const porNombre = new Map<string, number>();
  sale.forEach((p, i) => esObjeto(p) && typeof p.proyecto === "string" && porNombre.set(p.proyecto, i));
  for (const m of otras)
    for (const p of lista(m.tb?.proyectos)) {
      if (!esObjeto(p) || typeof p.proyecto !== "string") continue;
      const i = porNombre.get(p.proyecto);
      const de = i === undefined ? null : sale[i];
      if (!esObjeto(de)) {
        porNombre.set(p.proyecto, sale.push(p) - 1);
        continue;
      }
      const dias = [de.dias, p.dias].filter((d): d is number => typeof d === "number");
      sale[i!] = {
        ...de,
        abiertos: (typeof de.abiertos === "number" ? de.abiertos : 0) + (typeof p.abiertos === "number" ? p.abiertos : 0),
        dias: dias.length ? Math.min(...dias) : null,
        sigue: de.sigue ?? p.sigue ?? null,
      };
    }
  return sale;
}

const cuando = (x: unknown) => Date.parse(String((x as { cerrado?: unknown })?.cerrado ?? "")) || 0;

/**
 * El tablero de acá con el de cada otra máquina. `caidas`: los nombres de las que no están (sus items no aparecen y la
 * ventana lo dice en una línea). Sin otras máquinas con tablero ni caídas, el mismo objeto de acá.
 */
export function juntarTableros(local: TableroCrudo, otras: TableroOtra[], caidas: string[]): TableroCrudo & { caidas: string[] } {
  const con = otras.filter((m) => m.tb);
  if (!con.length) return { ...local, caidas };
  const hecho = [...lista(local.hecho), ...con.flatMap((m) => estamparTodos(m, m.tb!.hecho))].sort((a, b) => cuando(b) - cuando(a));
  // Un aviso de acá manda; si no, el primero de allá, con el nombre de su máquina.
  const aviso = local.aviso ?? con.flatMap((m) => (m.tb!.aviso ? [`${m.nombre}: ${m.tb!.aviso}`] : []))[0] ?? null;
  return {
    ...local,
    vista: juntarVista(local.vista, con),
    hecho,
    proyectos: juntarProyectos(local.proyectos, con),
    pospuestosLista: [...local.pospuestosLista, ...con.flatMap((m) => estamparTodos(m, m.tb!.pospuestosLista))],
    aviso,
    caidas,
  };
}

/** El número del botón del pie: lo que espera al usuario acá más lo de allá. Sin vista acá y sin nada de allá sigue siendo null. */
export function esperanJuntas(local: number | null, otras: TableroOtra[]): number | null {
  const con = otras.filter((m) => m.tb);
  if (!con.length) return local;
  return (local ?? 0) + con.reduce((a, m) => a + esperanEnVista(m.tb!.vista), 0);
}
