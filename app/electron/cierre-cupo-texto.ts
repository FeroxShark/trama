// El aviso de cierre por cupo del lado de la app. Los textos (es/en) viven en UN solo lugar, `motor/hooks/cierre-cupo-textos.mjs`
// (lo usa también el hook `cierre-cupo.mjs`, que corre fuera de la app): acá se cargan de ahí. Además, el `--settings` que registra
// el hook en cada líder de Claude de la app y qué líderes (de otro motor, que no corren hooks) reciben el aviso por la cola.
// Lo de afuera (la cola, la lista de líderes vivos) se inyecta: sin Electron, lo prueba tests/cierre-cupo-hook.test.ts.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { comandoCierreCupo, EVENTOS_CIERRE_CUPO } from "./cli/hooks.ts";
import { resolverMotor } from "./cli/pa/entorno.ts";
import { suscripcionDeModelo, type EntradaCierre } from "./cierre-cupo.ts";

export type Idioma = "es" | "en";
export type RolCierre = "worker" | "lider";

type Textos = { textoCierre: (o: { rol: RolCierre; idioma: Idioma; entrada: Pick<EntradaCierre, "proveedor" | "ventana" | "restante" | "vuelve">; archivo?: string; ahora?: number }) => string };

/** La carpeta de los hooks del motor si tiene el de cierre por cupo; `null` si no (una instalación vieja o rota). */
export function carpetaHooksCierre(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const dir = resolverMotor(env).hooks;
    return existsSync(path.join(dir, "cierre-cupo.mjs")) && existsSync(path.join(dir, "cierre-cupo-textos.mjs")) ? dir : null;
  } catch {
    return null;
  }
}

/** Los textos, cargados del motor (una vez por carpeta). */
const cargados = new Map<string, Promise<Textos>>();
export function cargarTextos(hooks: string): Promise<Textos> {
  let p = cargados.get(hooks);
  if (!p) {
    p = import(pathToFileURL(path.join(hooks, "cierre-cupo-textos.mjs")).href) as Promise<Textos>;
    p.catch(() => cargados.delete(hooks));
    cargados.set(hooks, p);
  }
  return p;
}

/** El pedazo de settings (`--settings`) que registra el hook en un líder de Claude de la app: sin esto dependería del settings del usuario. */
export function settingsCierreCupo(hooks: string, o: { node?: string; plataforma?: NodeJS.Platform } = {}): string {
  const cmd = comandoCierreCupo(hooks, o);
  return JSON.stringify({ hooks: Object.fromEntries(EVENTOS_CIERRE_CUPO.map((e) => [e, [{ hooks: [{ type: "command", command: cmd, timeout: 10 }] }]])) });
}

/** Un líder con proceso de la app, como lo ve el aviso. */
export type LiderVivo = { sid: string; modelo: string; effort: string; clase: string; ocupado: boolean };

/**
 * A quiénes de los líderes vivos hay que mandarles el aviso por la cola: los que NO corren hooks (todo menos el `claude` oficial),
 * cuya suscripción es la de la entrada y que están respondiendo (uno ocioso no se despierta). La entrada con `grupo` (Google) vale para
 * toda la suscripción, como dice el protocolo.
 */
export function lideresParaAvisar(vivos: readonly LiderVivo[], entrada: Pick<EntradaCierre, "proveedor">): LiderVivo[] {
  return vivos.filter((l) => l.clase !== "claude" && l.clase !== "ollama" && l.ocupado && suscripcionDeModelo(l.modelo) === entrada.proveedor);
}

/** Manda el texto de líder a cada uno que corresponde. `encolar` es la cola del main (`cola.encolar` con un item de `paraCola`). */
export async function avisarLideres(o: {
  entrada: EntradaCierre;
  vivos: readonly LiderVivo[];
  idioma: Idioma;
  hooks: string;
  archivoRelevo: (sid: string) => string;
  encolar: (sid: string, texto: string, modelo: string, effort: string) => void | Promise<void>;
  ahora?: number;
}): Promise<string[]> {
  const { textoCierre } = await cargarTextos(o.hooks);
  const sids: string[] = [];
  for (const l of lideresParaAvisar(o.vivos, o.entrada)) {
    await o.encolar(l.sid, textoCierre({ rol: "lider", idioma: o.idioma, entrada: o.entrada, archivo: o.archivoRelevo(l.sid), ahora: o.ahora }), l.modelo, l.effort);
    sids.push(l.sid);
  }
  return sids;
}
