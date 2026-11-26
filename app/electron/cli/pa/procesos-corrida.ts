// Los procesos que una corrida dejó vivos después de terminar (Linux). Un worker que lanza algo en segundo plano (un servidor de
// prueba, un `vigilar.py`, un `sleep` de espera) y cierra su respuesta lo deja corriendo: el Bash de Claude corre cada comando en su
// propia sesión (setsid), así que no cuelga del árbol del claude y nadie lo ve. Medido el 2026-11-25: dos `vigilar.py` de un worker de
// `shell` seguían vivos dos días después, adentro del servicio del motor.
// Cada worker sale con `PA_CORRIDA=<id>` en el entorno, que se hereda aunque el hijo haga setsid (la misma idea que
// `TRAMA_LIDER_ETIQUETA` en electron/huerfanos.ts). Con eso `pa` AVISA al terminar la corrida y en `pa --estado`; no baja nada: lo que
// quedó puede ser a propósito (el worker que reinicia el shell o un servicio del dueño) y eso lo decide quien lee el aviso.
// Sólo Linux (lee /proc): en Windows no hay cómo leer el entorno de otro proceso y todo devuelve vacío.
import { readFileSync } from "node:fs";
import path from "node:path";
import { entornos } from "../../huerfanos.ts";
import { plataformaActual, type Plataforma } from "../../rutas.ts";

/** La variable con el id de la corrida que lleva todo worker (claude, agy, codex, opencode, local). */
export const VAR_CORRIDA = "PA_CORRIDA";

/** Un proceso que sigue vivo con la etiqueta de una corrida. */
export interface Quedo {
  pid: number;
  /** Su línea de comando, en una línea y recortada. */
  cmd: string;
}

export type OpcionesProc = { procDir?: string; plat?: Plataforma };

const ID = /^[A-Za-z0-9._-]+$/;
const LARGO_CMD = 70;

function cmdDe(pid: number, procDir: string): string {
  try {
    const t = readFileSync(path.join(procDir, String(pid), "cmdline"), "latin1").replace(/\0+$/, "").replace(/\0/g, " ").replace(/\s+/g, " ").trim();
    return t.length > LARGO_CMD ? `${t.slice(0, LARGO_CMD - 1)}…` : t;
  } catch {
    return "";
  }
}

/** Los procesos vivos de cada corrida, por id (todas las etiquetas que hay en el sistema). Vacío fuera de Linux. */
export function procesosPorCorrida(o: OpcionesProc = {}): Map<string, Quedo[]> {
  const r = new Map<string, Quedo[]>();
  if ((o.plat ?? plataformaActual()) !== "linux") return r;
  const procDir = o.procDir ?? "/proc";
  const prefijo = `${VAR_CORRIDA}=`;
  for (const e of entornos(procDir)) {
    const v = e.vars.find((x) => x.startsWith(prefijo));
    const id = v ? v.slice(prefijo.length) : "";
    if (!ID.test(id)) continue;
    const lista = r.get(id) ?? [];
    lista.push({ pid: e.pid, cmd: cmdDe(e.pid, procDir) });
    r.set(id, lista);
  }
  return r;
}

/** Los procesos vivos con la etiqueta de esa corrida. */
export function procesosDeCorrida(id: string, o: OpcionesProc = {}): Quedo[] {
  return ID.test(id) ? (procesosPorCorrida(o).get(id) ?? []) : [];
}

/**
 * Al terminar la corrida: lo que sigue vivo con su etiqueta. Lo que está saliendo (los servidores MCP del claude, un hijo que recibe
 * la señal) tiene hasta `graciaMs` para irse: sólo se informa lo que queda después. Sin nada vivo no espera.
 */
export async function quedaronAlTerminar(id: string, o: OpcionesProc & { graciaMs?: number; pasoMs?: number; dormir?: (ms: number) => Promise<void> } = {}): Promise<Quedo[]> {
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const paso = o.pasoMs ?? 250;
  let q = procesosDeCorrida(id, o);
  for (let t = 0; q.length && t < (o.graciaMs ?? 2000); t += paso) {
    await dormir(paso);
    q = procesosDeCorrida(id, o);
  }
  return q;
}

/** «1234 python3 vigilar.py; 1240 sleep 600» (hasta 5; el resto se cuenta). */
export function listaDe(q: Quedo[]): string {
  const ver = q.slice(0, 5).map((p) => (p.cmd ? `${p.pid} ${p.cmd}` : String(p.pid)));
  return ver.join("; ") + (q.length > 5 ? `; y ${q.length - 5} más` : "");
}

/** El aviso de una línea para stderr al terminar la corrida, o "" si no quedó nada. */
export function avisoQuedaron(id: string, q: Quedo[]): string {
  if (!q.length) return "";
  const n = q.length === 1 ? "1 proceso" : `${q.length} procesos`;
  return `pa: aviso: la corrida ${id} terminó y dejó ${n} corriendo: ${listaDe(q)}. No los bajo (pueden ser a propósito); si sobran: kill ${q.map((p) => p.pid).join(" ")}\n`;
}
