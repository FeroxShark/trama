// `pa --archivar <id>` (cmd_archivar de motor/bin/pa): saca la corrida de la vista de la app con `archivado=<fecha>` en su `.hilo`.
// No toca `.listo` ni `.entregado`: el `--esperar-todos` del jefe la cobra igual. Se niega (92) con el worker vivo.
import { evento, hiloPoner } from "./corridas.ts";
import type { Pa } from "./entorno.ts";
import { corridaIdViva, isoSegundos, usarId } from "./ramas.ts";

export async function cmdArchivar(pa: Pa, t = ""): Promise<number> {
  if (!t) {
    pa.io.err("uso: pa --archivar <id-de-corrida>\n");
    return 2;
  }
  const x = usarId(pa, t);
  if (corridaIdViva(x, t)) {
    pa.io.err(`pa: la corrida ${t} de '${x.slug}' sigue viva (corriendo o en cola); no la archivo debajo de un worker. Paralo primero: pa --parar ${t}\n`);
    return 92;
  }
  await hiloPoner(x.dir, t, "archivado", isoSegundos());
  await evento(pa, "archivar", t, x.slug);
  pa.io.out(`pa: corrida ${t} de '${x.slug}' archivada.\n`);
  return 0;
}
