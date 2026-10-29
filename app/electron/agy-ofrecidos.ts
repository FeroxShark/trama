// Los modelos que ofrece el `agy` de ESTA cuenta (`reparto --agy-modelos --json`): el catálogo depende de la cuenta, la región y la
// versión de agy, así que el selector de modelos y Ajustes muestran sólo éstos. `reparto` guarda la lista (6 h) y la refresca si agy
// falla; acá se recuerda unos minutos en memoria para no lanzar un proceso por cada pedido. Sin `reparto` o sin lista: `null`
// y la interfaz muestra los de siempre.
import { homedir } from "node:os";
import { comandoPropio, entornoPa, lanzarCmd } from "./binario.ts";
import { recordarAgySinNivel } from "./modelos-config.ts";

export type AgyOfrecido = { id: string; nombre: string };

const VIDA_MS = 10 * 60_000;

/** La salida de `reparto --agy-modelos --json` → los modelos con el id de pa (`gemini-3.8-flash-high`, `agy:claude-opus-4-6-thinking`); `null` si no se entiende o viene vacía. */
export function parsearAgyOfrecidos(salida: string): AgyOfrecido[] | null {
  let j: unknown;
  try {
    j = JSON.parse(salida);
  } catch {
    return null;
  }
  const lista = (j as { modelos?: unknown } | null)?.modelos;
  if (!Array.isArray(lista)) return null;
  const vistos = new Set<string>();
  const r: AgyOfrecido[] = [];
  for (const m of lista as { reparto?: unknown; nombre?: unknown }[]) {
    const id = typeof m?.reparto === "string" ? m.reparto : "";
    if (!/^(?:agy:)?[a-z0-9][\w.-]{0,80}$/i.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    r.push({ id, nombre: typeof m.nombre === "string" && m.nombre ? m.nombre.slice(0, 80) : id });
  }
  return r.length ? r : null;
}

let guardada: { cuando: number; lista: AgyOfrecido[] } | null = null;
let enCurso: Promise<AgyOfrecido[] | null> | null = null;

/** Para los tests. */
export const olvidarAgyOfrecidos = () => {
  guardada = null;
  enCurso = null;
};

/** Corre `reparto --agy-modelos --json`; en pruebas, capturas y bench no se mira el `reparto` de la máquina (salvo que el test ponga uno falso). */
async function leer(): Promise<AgyOfrecido[] | null> {
  const aislado = process.env.HILOS_PRUEBA === "1" || process.env.HILOS_CAPTURA === "1" || process.env.HILOS_BENCH === "1";
  if (aislado && !process.env.HILOS_REPARTO) return null;
  try {
    const env = entornoPa(process.env, homedir()) as NodeJS.ProcessEnv;
    const cmd = comandoPropio("reparto", process.env, homedir());
    const stdout = await new Promise<string>((ok, mal) =>
      lanzarCmd(cmd, ["--agy-modelos", "--json"], { env, timeout: 25_000, maxBuffer: 1 << 20 }, (e, o) => (e ? mal(e) : ok(o))),
    );
    return parsearAgyOfrecidos(stdout);
  } catch {
    return null;
  }
}

/** Los modelos de agy de esta cuenta, o `null` si no se pudo saber (la última lista buena se sigue usando si la nueva falla). */
export function agyOfrecidos(ahora = Date.now()): Promise<AgyOfrecido[] | null> {
  if (guardada && ahora - guardada.cuando < VIDA_MS) return Promise.resolve(guardada.lista);
  enCurso ??= leer()
    .then((lista) => {
      if (lista) {
        guardada = { cuando: Date.now(), lista };
        recordarAgySinNivel(lista.map((m) => m.id));
      }
      return lista ?? guardada?.lista ?? null;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}
