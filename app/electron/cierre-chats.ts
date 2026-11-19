// Cierre ordenado por cupo, del lado de cada chat (líder): qué chats cerraron por la señal de electron/cierre-cupo.ts, la tarjeta que se ve en el chat
// («Cupo bajo: cerré en este punto») y «Retomar solo cuando vuelva el cupo». Sin imports de Node ni de Electron: lo de afuera (disco, reloj, la cola, el
// aviso al chat) se inyecta. Lo prueba tests/cierre-chats.test.ts.
//
// - Un chat entra cuando se dispara una entrada de su suscripción (`alCierreCupo`) y estaba trabajando (turno en curso): queda `cerrando`; al terminar
//   el turno pasa a `cerrado`. Un chat ocioso no entra: no hay nada que cerrar.
// - `retomar` arranca con `cierre.retomar_solo` de Ajustes y se cambia por chat.
// - Al pasar `vuelve` + `MARGEN_RETOMAR_S`, cada chat con `retomar` encendido recibe en su cola el mensaje de retomar (`textoRetomar`), salvo que la persona
//   haya escrito en ese chat después del cierre. Todo vive en disco: reabrir Trama (o prender la PC después de la hora) retoma igual.
import type { EntradaCierre, Suscripcion } from "./cierre-cupo.ts";
import { suscripcionDeModelo } from "./cierre-cupo.ts";

/** Se espera un poco más que la hora de reinicio de la ventana: la lectura del uso puede redondear. */
export const MARGEN_RETOMAR_S = 60;
/** Un registro retomado (o con el cupo ya vuelto y sin retomar solo) se limpia pasado este tiempo desde `vuelve`. */
export const LIMPIAR_DESPUES_S = 3 * 86_400;
export const VERSION_CIERRE_CHATS = 1;
/** Lo más que dura un `setTimeout` (2^31 - 1 ms). */
const MAX_ESPERA_MS = 2_147_000_000;

export type CierreChat = {
  sid: string;
  proveedor: Suscripcion;
  cuenta: string;
  ventana: string;
  /** % que quedaba cuando cerró. */
  restante: number;
  /** Epoch s en que vuelve el cupo; `null`: no se sabe (no se retoma solo). */
  vuelve: number | null;
  desde: number;
  estado: "cerrando" | "cerrado";
  retomar: boolean;
  /** El archivo de relevo del chat: el resumen para retomar. */
  relevo: string;
  /** La persona escribió en el chat después del cierre: no se retoma solo. */
  duenoEscribio: boolean;
  /** Ya se encoló el mensaje de retomar. */
  retomado: boolean;
};

/** Lo que ve la tarjeta: el registro y en qué punto está respecto de la hora de vuelta. */
export type CierreVisto = CierreChat & { fase: "cerrando" | "cerrado" | "volvio" | "retomado" };

export type Deps = {
  leer: () => string | null;
  guardar: (json: string) => void;
  /** Epoch s. */
  ahora: () => number;
  /** Los chats con un turno en curso. */
  trabajando: () => string[];
  /** El modelo con el que corre el chat (sin proceso: `null`). */
  modeloDe: (sid: string) => string | null;
  /** La cuenta agregada de Claude con que corre; `undefined`: la de siempre. */
  cuentaDe?: (sid: string) => string | undefined;
  relevo: (sid: string) => string;
  /** `cierre.retomar_solo` de Ajustes (con lo que valga hoy). */
  retomarSolo: () => boolean;
  /** Pone el mensaje en la cola del chat (sale cuando el chat pueda recibirlo, o lo retoma si no tiene proceso). */
  encolar: (sid: string, texto: string) => void;
  /** Cambió algo que ve la tarjeta. */
  avisar: (lista: CierreVisto[]) => void;
  /** Una línea de sistema en el chat: «Cupo bajo en …; cerré los trabajos con resumen; vuelve a las HH:MM». */
  avisoChat: (sid: string, e: EntradaCierre) => void;
  poner: (ms: number, fn: () => void) => unknown;
  cancelar: (h: unknown) => void;
};

/** El mensaje que recibe el chat cuando vuelve el cupo (el que lee el modelo). */
export const textoRetomar = (relevo: string): string =>
  `Volvió el cupo: retomá desde tu resumen ${relevo} y seguí con los workers que quedaron cortados (pa --seguir --id <id de cada uno>).`;

export const fase = (r: CierreChat, ahora: number): CierreVisto["fase"] => {
  if (r.retomado) return "retomado";
  if (r.vuelve !== null && r.vuelve <= ahora) return "volvio";
  return r.estado;
};

const esRegistro = (x: unknown): x is CierreChat => {
  const o = x as Partial<CierreChat> | null;
  return (
    !!o &&
    typeof o.sid === "string" &&
    (o.proveedor === "claude" || o.proveedor === "google" || o.proveedor === "chatgpt") &&
    typeof o.cuenta === "string" &&
    typeof o.ventana === "string" &&
    typeof o.restante === "number" &&
    (o.vuelve === null || typeof o.vuelve === "number") &&
    typeof o.desde === "number" &&
    (o.estado === "cerrando" || o.estado === "cerrado") &&
    typeof o.retomar === "boolean" &&
    typeof o.relevo === "string" &&
    typeof o.duenoEscribio === "boolean" &&
    typeof o.retomado === "boolean"
  );
};

export function leerRegistros(json: string | null): CierreChat[] {
  if (!json) return [];
  try {
    const j = JSON.parse(json) as { version?: number; chats?: unknown };
    return j.version === VERSION_CIERRE_CHATS && Array.isArray(j.chats) ? j.chats.filter(esRegistro) : [];
  } catch {
    return [];
  }
}

export function crearCierreChats(d: Deps) {
  let registros = new Map<string, CierreChat>(leerRegistros(d.leer()).map((r) => [r.sid, r]));
  const relojes = new Map<string, unknown>();

  const lista = (): CierreVisto[] => {
    const ahora = d.ahora();
    return [...registros.values()].map((r) => ({ ...r, fase: fase(r, ahora) }));
  };
  function guardar() {
    d.guardar(JSON.stringify({ version: VERSION_CIERRE_CHATS, chats: [...registros.values()] }, null, 2) + "\n");
    d.avisar(lista());
  }

  function soltarReloj(sid: string) {
    const h = relojes.get(sid);
    if (h !== undefined) d.cancelar(h);
    relojes.delete(sid);
  }

  /** ¿Toca retomar a este chat ahora? */
  const debeRetomar = (r: CierreChat, ahora: number): boolean => r.retomar && !r.retomado && !r.duenoEscribio && r.vuelve !== null && ahora >= r.vuelve + MARGEN_RETOMAR_S;

  function retomar(sid: string) {
    const r = registros.get(sid);
    if (!r || !debeRetomar(r, d.ahora())) return;
    registros.set(sid, { ...r, estado: "cerrado", retomado: true });
    guardar();
    d.encolar(sid, textoRetomar(r.relevo));
  }

  /** Deja puesto el reloj que retoma a este chat (uno por chat); si la hora ya pasó, retoma en el acto. */
  function armar(sid: string) {
    soltarReloj(sid);
    const r = registros.get(sid);
    if (!r || r.retomado || !r.retomar || r.duenoEscribio || r.vuelve === null) return;
    const falta = (r.vuelve + MARGEN_RETOMAR_S - d.ahora()) * 1000;
    if (falta <= 0) return retomar(sid);
    relojes.set(
      sid,
      d.poner(Math.min(falta, MAX_ESPERA_MS), () => {
        relojes.delete(sid);
        // Un tope cortó la espera larga: se vuelve a armar con lo que falte.
        if (debeRetomar(registros.get(sid) ?? r, d.ahora())) retomar(sid);
        else armar(sid);
      }),
    );
  }

  /** Se disparó una entrada: los chats de esa suscripción que están trabajando cierran. Devuelve cuáles. */
  function alCierre(e: EntradaCierre): string[] {
    const tocados: string[] = [];
    for (const sid of d.trabajando()) {
      if (suscripcionDeModelo(d.modeloDe(sid)) !== e.proveedor) continue;
      if (e.proveedor === "claude" && (d.cuentaDe?.(sid) ?? "claude") !== e.cuenta) continue;
      const previo = registros.get(sid);
      // Un registro que ya se retomó, o cuyo cupo ya volvió, es de otro cierre: éste empieza de cero.
      const antes = previo && !previo.retomado && !(previo.vuelve !== null && previo.vuelve <= d.ahora()) ? previo : undefined;
      // Otra ventana de la misma suscripción: se retoma cuando vuelva la última.
      const vuelve = antes ? (antes.vuelve === null || e.vuelve === null ? (antes.vuelve ?? e.vuelve) : Math.max(antes.vuelve, e.vuelve)) : e.vuelve;
      registros.set(sid, {
        sid,
        proveedor: e.proveedor,
        cuenta: e.cuenta,
        ventana: e.ventana,
        restante: Math.min(e.restante, antes?.restante ?? e.restante),
        vuelve,
        desde: antes ? antes.desde : e.desde,
        estado: antes ? antes.estado : "cerrando",
        retomar: antes ? antes.retomar : d.retomarSolo(),
        relevo: d.relevo(sid),
        duenoEscribio: antes ? antes.duenoEscribio : false,
        retomado: false,
      });
      tocados.push(sid);
      d.avisoChat(sid, e);
    }
    if (tocados.length) {
      guardar();
      for (const sid of tocados) armar(sid);
    }
    return tocados;
  }

  /**
   * Volvió el cupo de una ventana (a su hora o con un reinicio antes de tiempo). Si otra ventana de esa cuenta sigue baja, el chat sigue cerrado hasta
   * esa. Si no, la tarjeta pasa a «Volvió el cupo»; y si la persona ya siguió escribiendo en ese chat, no queda nada que avisar y se va.
   */
  function alVolvio(e: EntradaCierre, vigentes: readonly EntradaCierre[]): void {
    const ahora = d.ahora();
    const siguen = vigentes.filter((v) => v.proveedor === e.proveedor && v.cuenta === e.cuenta);
    const tocados: string[] = [];
    for (const [sid, r] of registros) {
      if (r.proveedor !== e.proveedor || r.cuenta !== e.cuenta || r.retomado) continue;
      tocados.push(sid);
      if (siguen.length) {
        const vuelve = siguen.some((v) => v.vuelve === null) ? null : Math.max(...siguen.map((v) => v.vuelve as number));
        registros.set(sid, { ...r, vuelve, restante: Math.min(...siguen.map((v) => v.restante)) });
      } else if (r.duenoEscribio) {
        soltarReloj(sid);
        registros.delete(sid);
      } else if (r.vuelve === null || r.vuelve > ahora) {
        registros.set(sid, { ...r, vuelve: ahora });
      }
    }
    if (!tocados.length) return;
    guardar();
    for (const sid of tocados) armar(sid);
  }

  /** Cambió el estado de los chats: los que cerraban y ya no trabajan terminaron su turno. */
  function revisar(): void {
    const activos = new Set(d.trabajando());
    let cambio = false;
    for (const [sid, r] of registros) {
      if (r.estado === "cerrando" && !activos.has(sid)) {
        registros.set(sid, { ...r, estado: "cerrado" });
        cambio = true;
      }
    }
    if (cambio) guardar();
  }

  /** La persona escribió en este chat: si cerró por cupo, ya no se retoma solo; si el cupo ya volvió, la tarjeta no tiene más nada que decir y se va. */
  function duenoEscribio(sid: string): void {
    const r = registros.get(sid);
    if (!r) return;
    if (r.retomado || (r.vuelve !== null && r.vuelve <= d.ahora())) {
      soltarReloj(sid);
      registros.delete(sid);
      guardar();
      return;
    }
    if (r.duenoEscribio) return;
    registros.set(sid, { ...r, duenoEscribio: true });
    soltarReloj(sid);
    guardar();
  }

  /** El interruptor de la tarjeta. */
  function ponerRetomar(sid: string, on: boolean): void {
    const r = registros.get(sid);
    if (!r || r.retomar === on) return;
    registros.set(sid, { ...r, retomar: on });
    guardar();
    armar(sid);
  }

  /** Al abrir Trama: limpia lo viejo, arma un reloj por chat y retoma lo que ya pasó de hora (la PC estaba apagada). */
  function arrancar(): void {
    const ahora = d.ahora();
    let cambio = false;
    for (const [sid, r] of registros) {
      // Lo que quedó «cerrando» de la vez anterior no tiene turno: terminó con la app.
      if (r.estado === "cerrando") {
        registros.set(sid, { ...r, estado: "cerrado" });
        cambio = true;
      }
      const ref = registros.get(sid)!;
      // El cupo volvió y la persona ya había seguido en ese chat: no queda nada que avisar.
      const yaSiguio = ref.duenoEscribio && ref.vuelve !== null && ref.vuelve <= ahora;
      if (yaSiguio || (ref.vuelve !== null && ahora > ref.vuelve + LIMPIAR_DESPUES_S && (ref.retomado || !ref.retomar || ref.duenoEscribio))) {
        registros.delete(sid);
        cambio = true;
      }
    }
    if (cambio) guardar();
    for (const sid of [...registros.keys()]) armar(sid);
  }

  function parar(): void {
    for (const sid of [...relojes.keys()]) soltarReloj(sid);
  }

  return { lista, alCierre, alVolvio, revisar, duenoEscribio, ponerRetomar, arrancar, parar, de: (sid: string) => lista().find((r) => r.sid === sid) ?? null };
}

export type CierreChats = ReturnType<typeof crearCierreChats>;
