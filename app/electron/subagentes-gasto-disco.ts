// Leer de a poco los transcripts de los subagentes de una sesión (`<sesión>/subagents/agent-<id>.jsonl`) y juntarlos con su estado y su
// meta: lo que gastó cada uno (la cuenta pura está en subagentes-gasto.ts). Lo prueba `tests/subagentes-gasto.test.ts`.
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { Acumulado, juntar, ventanaSub, type GastoSubagentes, type SubagenteGasto } from "./subagentes-gasto.ts";
import { leerCarpeta, modeloCorto, type Subagente } from "./subagentes.ts";

/** Une lo que se sabe de un subagente (su estado, su meta) con lo que gastó. */
export function gastoDe(u: Subagente, a: Acumulado): SubagenteGasto {
  const modeloId = a.modeloId;
  return {
    id: u.id,
    sid: u.sid,
    llamada: u.tool_use_id ?? null,
    descripcion: u.descripcion,
    tipo: u.tipo,
    modelo: modeloId ? modeloCorto(modeloId) : u.modelo,
    modeloId,
    estado: u.estado,
    inicio: u.inicio,
    ultimo_en: u.ultimo_en,
    tokens: a.tokens,
    pedidos: a.pedidos,
    herramientas: a.herramientas,
    contexto: a.contexto,
    ventana: ventanaSub(modeloId ?? u.modelo),
  };
}

/** La carpeta de los subagentes de una sesión a partir del transcript de la sesión. */
export const carpetaDeSubagentes = (transcript: string): string => path.join(transcript.replace(/\.jsonl$/, ""), "subagents");

type Leido = { leido: number; resto: string; acum: Acumulado };

/**
 * Lee de a poco: guarda lo sumado de cada archivo y, cuando crece, sólo lee lo que se agregó. Un archivo que se achicó (se rehízo) se
 * empieza de nuevo. Los archivos de subagentes pueden pesar muchos MB: releerlos enteros en cada refresco no va.
 */
export function crearGastos() {
  const leidos = new Map<string, Leido>();

  async function acumulado(archivo: string): Promise<Acumulado | null> {
    const s = await stat(archivo).catch(() => null);
    if (!s?.isFile()) return null;
    let x = leidos.get(archivo);
    if (!x || s.size < x.leido) leidos.set(archivo, (x = { leido: 0, resto: "", acum: new Acumulado() }));
    if (s.size > x.leido) {
      const fh = await open(archivo, "r");
      try {
        const buf = Buffer.alloc(s.size - x.leido);
        const { bytesRead } = await fh.read(buf, 0, buf.length, x.leido);
        x.leido += bytesRead;
        const trozos = (x.resto + buf.toString("utf8", 0, bytesRead)).split("\n");
        // La última puede estar a medio escribir: queda para la próxima.
        x.resto = trozos.pop() ?? "";
        for (const l of trozos) x.acum.linea(l);
      } finally {
        await fh.close();
      }
    }
    // Un tope: no se guardan archivos de sesiones que ya no se miran.
    if (leidos.size > 400) leidos.delete(leidos.keys().next().value as string);
    return x.acum;
  }

  return {
    /**
     * El gasto de cada subagente de `dir` (la carpeta `subagents/` de la sesión `sid`). `base`: la lista de subagentes que ya tiene el
     * main (con su estado al día); si falta, se lee de la carpeta.
     */
    async listar(dir: string, sid: string, base?: readonly Subagente[]): Promise<GastoSubagentes> {
      const lista = base?.length ? base : await leerCarpeta(dir, sid);
      const filas: SubagenteGasto[] = [];
      for (const u of lista) {
        const a = await acumulado(path.join(dir, `agent-${u.id}.jsonl`));
        if (a) filas.push(gastoDe(u, a));
      }
      return juntar(sid, filas);
    },
  };
}
