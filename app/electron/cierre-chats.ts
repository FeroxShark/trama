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
import { entradaRigeAModelo, suscripcionDeModelo } from "./cierre-cupo.ts";

/** Se espera un poco más que la hora de reinicio de la ventana: la lectura del uso puede redondear. */
export const MARGEN_RETOMAR_S = 60;
/** Un registro retomado (o con el cupo ya vuelto y sin retomar solo) se limpia pasado este tiempo desde `vuelve`. */
export const LIMPIAR_DESPUES_S = 3 * 86_400;
export const VERSION_CIERRE_CHATS = 1;
/** Lo más que dura un `setTimeout` (2^31 - 1 ms). */
const MAX_ESPERA_MS = 2_147_000_000;

type VentanaCerrada = Pick<EntradaCierre, "ventana" | "grupo" | "restante" | "vuelve" | "desde">;
type IdentidadChat = { modelo: string | null; cuenta?: string };

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
  /** Ventanas que explican el cierre. Los registros viejos sólo tienen el total de la tarjeta. */
  ventanas?: VentanaCerrada[];
};

/** Lo que ve la tarjeta: el registro y en qué punto está respecto de la hora de vuelta. */
export type CierreVisto = Omit<CierreChat, "ventanas"> & { fase: "cerrando" | "cerrado" | "volvio" | "retomado" };

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
  /** Identidad al retomar, también para los chats sin proceso. */
  identidadAlRetomar?: (sid: string) => Promise<IdentidadChat>;
  relevo: (sid: string) => string;
  /** `cierre.retomar_solo` de Ajustes (con lo que valga hoy). */
  retomarSolo: () => boolean;
  /** Pone el mensaje en la cola del chat (sale cuando el chat pueda recibirlo, o lo retoma si no tiene proceso). */
  encolar: (sid: string, texto: string, sigueVigente: (identidad: IdentidadChat) => boolean) => void;
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

const esVentana = (x: unknown): x is VentanaCerrada => {
  const o = x as Partial<VentanaCerrada> | null;
  return (
    !!o &&
    typeof o.ventana === "string" &&
    (o.grupo === undefined || typeof o.grupo === "string") &&
    typeof o.restante === "number" &&
    (o.vuelve === null || typeof o.vuelve === "number") &&
    typeof o.desde === "number"
  );
};

const esRegistro = (x: unknown): x is CierreChat => {
  const o = x as CierreChat | null;
  return (
    esVentana(o) &&
    typeof o.sid === "string" &&
    (o.proveedor === "claude" || o.proveedor === "google" || o.proveedor === "chatgpt") &&
    typeof o.cuenta === "string" &&
    (o.estado === "cerrando" || o.estado === "cerrado") &&
    typeof o.retomar === "boolean" &&
    typeof o.relevo === "string" &&
    typeof o.duenoEscribio === "boolean" &&
    typeof o.retomado === "boolean" &&
    (o.ventanas === undefined || (Array.isArray(o.ventanas) && o.ventanas.length > 0 && o.ventanas.every(esVentana)))
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
  const registros = new Map<string, CierreChat>(leerRegistros(d.leer()).map((r) => [r.sid, r]));
  const relojes = new Map<string, unknown>();
  const retomadasPendientes = new Set<CierreChat>();

  const lista = (): CierreVisto[] => {
    const ahora = d.ahora();
    return [...registros.values()].map(({ ventanas, ...r }) => ({ ...r, fase: fase(r, ahora) }));
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

  const identidadActual = (sid: string): IdentidadChat => ({ modelo: d.modeloDe(sid), cuenta: d.cuentaDe?.(sid) ?? "claude" });
  const rigeAlChat = (r: Pick<CierreChat, "proveedor" | "cuenta">, { modelo, cuenta }: IdentidadChat): boolean =>
    suscripcionDeModelo(modelo) === r.proveedor && (r.proveedor !== "claude" || cuenta === undefined || cuenta === r.cuenta);

  const ventanaDe = ({ ventana, grupo, restante, vuelve, desde }: VentanaCerrada): VentanaCerrada => ({ ventana, grupo, restante, vuelve, desde });
  const ventanasDe = (r: CierreChat): VentanaCerrada[] => r.ventanas ?? [ventanaDe(r)];

  function conVentanas(r: CierreChat, ventanas: VentanaCerrada[], esperaTodas = false): CierreChat {
    const horas = ventanas.flatMap((v) => v.vuelve === null ? [] : [v.vuelve]);
    const vuelve = horas.length === 0 || (esperaTodas && horas.length !== ventanas.length) ? null : Math.max(...horas);
    return {
      ...r,
      ventanas,
      ventana: ventanas[ventanas.length - 1].ventana,
      restante: Math.min(...ventanas.map((v) => v.restante)),
      desde: Math.min(...ventanas.map((v) => v.desde)),
      vuelve,
    };
  }

  /** Sin modelo, todavía no se sabe si el cierre sigue rigiendo. */
  function vigente(r: CierreChat, identidad: IdentidadChat): CierreChat | null {
    const { modelo } = identidad;
    if (!modelo) return r;
    if (!rigeAlChat(r, identidad)) return null;
    const ventanas = ventanasDe(r);
    const aplican = ventanas.filter((v) => entradaRigeAModelo({ proveedor: r.proveedor, grupo: v.grupo }, modelo));
    if (aplican.length === ventanas.length) return r;
    return aplican.length ? conVentanas(r, aplican, r.vuelve === null) : null;
  }

  function actualizar(r: CierreChat, nuevo: CierreChat | null): boolean {
    if (r === nuevo) return false;
    if (nuevo) registros.set(r.sid, nuevo);
    else {
      soltarReloj(r.sid);
      registros.delete(r.sid);
    }
    return true;
  }

  /** ¿Toca retomar a este chat ahora? */
  const debeRetomar = (r: CierreChat, ahora: number): boolean => r.retomar && !r.retomado && !r.duenoEscribio && r.vuelve !== null && ahora >= r.vuelve + MARGEN_RETOMAR_S;

  function retomar(r: CierreChat) {
    const { sid } = r;
    const comprobar = (identidad: IdentidadChat) => {
      if (registros.get(sid) !== r || !identidad.modelo) return;
      const ref = vigente(r, identidad);
      if (ref && debeRetomar(ref, d.ahora())) {
        const retomado = { ...ref, estado: "cerrado" as const, retomado: true };
        actualizar(r, retomado);
        guardar();
        d.encolar(sid, textoRetomar(ref.relevo), (actual) => registros.get(sid) === retomado && vigente(retomado, actual) === retomado);
      } else if (actualizar(r, ref)) {
        guardar();
        armar(sid);
      }
    };
    if (!d.identidadAlRetomar) return comprobar(identidadActual(sid));
    if (retomadasPendientes.has(r)) return;
    retomadasPendientes.add(r);
    void d.identidadAlRetomar(sid).then((identidad) => {
      if (retomadasPendientes.delete(r)) comprobar(identidad);
    }, () => retomadasPendientes.delete(r));
  }

  /** Deja puesto el reloj que retoma a este chat (uno por chat); si la hora ya pasó, retoma en el acto. */
  function armar(sid: string) {
    soltarReloj(sid);
    const r = registros.get(sid);
    if (!r || r.retomado || !r.retomar || r.duenoEscribio || r.vuelve === null) return;
    const falta = (r.vuelve + MARGEN_RETOMAR_S - d.ahora()) * 1000;
    if (falta <= 0) return retomar(r);
    const reloj = d.poner(Math.min(falta, MAX_ESPERA_MS), () => {
      if (relojes.get(sid) !== reloj) return;
      relojes.delete(sid);
      // Si el tope cortó una espera larga, se vuelve a armar con lo que falte.
      armar(sid);
    });
    relojes.set(sid, reloj);
  }

  /** Se disparó una entrada: los chats de esa suscripción que están trabajando cierran. Devuelve cuáles. */
  function alCierre(e: EntradaCierre): string[] {
    const tocados: string[] = [];
    for (const sid of d.trabajando()) {
      const identidad = identidadActual(sid);
      if (!rigeAlChat(e, identidad)) continue;
      // El límite propio de un modelo (Fable) sólo cierra a los chats de ese modelo.
      if (!entradaRigeAModelo(e, identidad.modelo)) continue;
      const previo = registros.get(sid);
      const mismoCierre = previo?.proveedor === e.proveedor && previo.cuenta === e.cuenta ? vigente(previo, identidad) : null;
      const antes = mismoCierre && !mismoCierre.retomado && (mismoCierre.vuelve === null || mismoCierre.vuelve > d.ahora()) ? mismoCierre : null;
      const otras = antes ? ventanasDe(antes) : [];
      registros.set(sid, conVentanas({
        sid,
        proveedor: e.proveedor,
        cuenta: e.cuenta,
        ventana: e.ventana,
        restante: e.restante,
        vuelve: e.vuelve,
        desde: e.desde,
        estado: antes?.estado ?? "cerrando",
        retomar: antes?.retomar ?? d.retomarSolo(),
        relevo: d.relevo(sid),
        duenoEscribio: antes?.duenoEscribio ?? false,
        retomado: false,
      }, [...otras, ventanaDe(e)]));
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
    const mismaCuenta = vigentes.filter((v) => v.proveedor === e.proveedor && v.cuenta === e.cuenta);
    const tocados = new Set<string>();
    for (const [sid, previo] of registros) {
      if (previo.proveedor !== e.proveedor || previo.cuenta !== e.cuenta) continue;
      const identidad = identidadActual(sid);
      const r = vigente(previo, identidad);
      if (actualizar(previo, r)) tocados.add(sid);
      if (!r || r.retomado) continue;
      // Un chat de otro modelo no estaba cerrado por el límite propio de éste, ni lo retiene el de otro.
      const aplica = (v: EntradaCierre): boolean => identidad.modelo
        ? entradaRigeAModelo(v, identidad.modelo)
        : v.proveedor !== "claude" || !v.grupo || ventanasDe(r).some((anterior) => anterior.grupo === v.grupo);
      if (!aplica(e)) continue;
      const siguen = mismaCuenta.filter(aplica);
      tocados.add(sid);
      if (siguen.length) {
        registros.set(sid, conVentanas(r, siguen.map(ventanaDe), true));
      } else if (r.duenoEscribio) {
        actualizar(r, null);
      } else {
        const vuelve = Math.min(r.vuelve ?? ahora, ahora);
        const ventanas = r.ventanas?.map((v) => ({ ...v, vuelve: Math.min(v.vuelve ?? ahora, ahora) }));
        registros.set(sid, { ...r, vuelve, ventanas });
      }
    }
    if (!tocados.size) return;
    guardar();
    for (const sid of tocados) armar(sid);
  }

  /** Cambió el estado de los chats: se comprueba el cupo y si terminó el turno. */
  function revisar(): void {
    const activos = new Set(d.trabajando());
    const armarDeNuevo: string[] = [];
    let cambio = false;
    for (const [sid, previo] of registros) {
      const identidad = identidadActual(sid);
      const r = vigente(previo, identidad);
      const ref = r?.estado === "cerrando" && !activos.has(sid) ? { ...r, estado: "cerrado" as const } : r;
      if (actualizar(previo, ref)) cambio = true;
      if (ref && (r !== previo || (!relojes.has(sid) && identidad.modelo && debeRetomar(ref, d.ahora())))) armarDeNuevo.push(sid);
    }
    if (cambio) guardar();
    for (const sid of armarDeNuevo) armar(sid);
  }

  /** La selección de la caja puede cambiar antes de que el proceso viejo se relance. */
  function revisarIdentidad(sid: string, identidad: IdentidadChat): void {
    const r = registros.get(sid);
    if (r && actualizar(r, vigente(r, identidad))) {
      guardar();
      armar(sid);
    }
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
  function arrancar(identidadDe = identidadActual): void {
    const ahora = d.ahora();
    let cambio = false;
    for (const [sid, previo] of registros) {
      const r = vigente(previo, identidadDe(sid));
      if (actualizar(previo, r)) cambio = true;
      if (!r) continue;
      // Lo que quedó «cerrando» de la vez anterior no tiene turno: terminó con la app.
      if (r.estado === "cerrando") {
        registros.set(sid, { ...r, estado: "cerrado" });
        cambio = true;
      }
      // El cupo volvió y la persona ya había seguido en ese chat: no queda nada que avisar.
      const yaSiguio = r.duenoEscribio && r.vuelve !== null && r.vuelve <= ahora;
      if (yaSiguio || (r.vuelve !== null && ahora > r.vuelve + LIMPIAR_DESPUES_S && (r.retomado || !r.retomar || r.duenoEscribio))) {
        actualizar(r, null);
        cambio = true;
      }
    }
    if (cambio) guardar();
    for (const sid of [...registros.keys()]) armar(sid);
  }

  function parar(): void {
    for (const sid of [...relojes.keys()]) soltarReloj(sid);
    retomadasPendientes.clear();
  }

  return { lista, alCierre, alVolvio, revisar, revisarIdentidad, duenoEscribio, ponerRetomar, arrancar, parar, de: (sid: string) => lista().find((r) => r.sid === sid) ?? null };
}

export type CierreChats = ReturnType<typeof crearCierreChats>;
