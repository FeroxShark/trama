// `pa <proyecto> --seguir-con <modelo> --id <id> ["<pedido extra>"]`: sigue la MISMA conversación de la corrida <id> con otro modelo (o
// motor). Como no se puede retomar la sesión de un modelo en otro, arma un resumen de traspaso del transcript de esa corrida
// (electron/resumen-traspaso.ts) y lo lanza como tarea de una corrida limpia en el mismo puesto y la misma rama (lo hace `retomaDe` en
// orquesta.ts, igual que --actualizar). Acá está sólo el armado de la tarea y sus validaciones (los `exit 2`); el resto es lanzar.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resumenDeTranscript, resumenTraspaso } from "../../resumen-traspaso.ts";
import { esArchivo, kill0, leerCampo, leerTexto, listar } from "./corridas.ts";
import type { Pa } from "./entorno.ts";
import { carpetaProyectos, escapar } from "./lanzar.ts";

export type ResultadoSeguirCon = { ok: true; tarea: string } | { ok: false; mensaje: string; codigo: number };

/** El transcript de la sesión de la corrida: bajo el cwd de la corrida, o en cualquier carpeta de proyectos de claude. */
function transcriptDe(pa: Pa, sid: string, rutaTrabajo: string): string | null {
  const proj = carpetaProyectos(pa);
  const directo = rutaTrabajo ? path.join(proj, escapar(rutaTrabajo), `${sid}.jsonl`) : "";
  if (directo && esArchivo(directo)) return directo;
  for (const d of listar(proj)) {
    const f = path.join(proj, d, `${sid}.jsonl`);
    if (esArchivo(f)) return f;
  }
  return null;
}

const jsonLinea = (type: string, content: unknown) => JSON.stringify({ type, message: { role: type, content } });

/** Sin transcript (un motor que no guarda sesión de claude): el pedido de la `.hilo` y el RESULTADO de la `.json` hacen de conversación. */
function lineasDeRespaldo(dir: string, id: string): string[] {
  const out: string[] = [];
  const tarea = leerCampo(path.join(dir, `${id}.hilo`), "tarea");
  if (tarea) out.push(jsonLinea("user", tarea));
  try {
    const j = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8")) as { result?: unknown };
    if (typeof j.result === "string" && j.result.trim()) out.push(jsonLinea("assistant", [{ type: "text", text: j.result }]));
  } catch {
    /* sin resultado */
  }
  return out;
}

export async function armarSeguirCon(pa: Pa, x: { slug: string; dir: string }, id: string, modelo: string, extra: string): Promise<ResultadoSeguirCon> {
  const error = (mensaje: string, codigo = 2): ResultadoSeguirCon => ({ ok: false, mensaje, codigo });
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return error(`pa: el id '${id}' no es un id de corrida.\n`);
  const corrida = path.join(x.dir, `${id}.corrida`);
  if (!existsSync(corrida)) return error(`pa: no hay una corrida '${id}' de '${x.slug}' (falta ${corrida}). El id lo imprime pa --async; ver también: pa --estado.\n`);
  const pid = path.join(x.dir, `${id}.pid`);
  if (esArchivo(pid) && kill0(leerTexto(pid))) return error(`pa: la corrida '${id}' sigue viva: esperala (pa --esperar) o bajala (pa '${x.slug}' --matar --id ${id}) antes de seguir con otro modelo.\n`, 75);
  const hilo = path.join(x.dir, `${id}.hilo`);
  const o = { modeloAnterior: leerCampo(hilo, "modelo") || undefined, motivo: `seguís con ${modelo}`, pedido: extra };
  const sidF = path.join(x.dir, `${id}.sid`);
  const sid = esArchivo(sidF) ? leerTexto(sidF) : "";
  const transcript = sid ? transcriptDe(pa, sid, leerCampo(corrida, "ruta_trabajo")) : null;
  const resumen = (transcript ? await resumenDeTranscript(transcript, o) : null) ?? (() => {
    const l = lineasDeRespaldo(x.dir, id);
    return l.length ? resumenTraspaso(l, o) : null;
  })();
  if (!resumen) return error(`pa: no tengo de dónde armar el resumen de la corrida '${id}' de '${x.slug}' (sin transcript, sin pedido ni resultado guardados).\n`, 1);
  return { ok: true, tarea: resumen };
}
