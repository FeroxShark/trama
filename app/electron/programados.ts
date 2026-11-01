// Mensajes programados y conversaciones pospuestas. Un mensaje programado es un texto para un líder que sale solo a una hora
// ("en 30 min", "mañana 9:00"); posponer una conversación la saca de la barra hasta una hora y ahí reaparece con un aviso.
// Todo vive en el proceso principal y se guarda en disco (`programados.json`): un reinicio de Trama no pierde nada y, al arrancar,
// lo vencido sale enseguida y lo que falta se vuelve a programar. Sin servicios del sistema (nada de cron ni de Task Scheduler):
// un solo timer dentro del proceso, igual en Linux y en Windows. El timer nunca espera más de `REVISAR_MS` seguidos: si la máquina
// durmió o el reloj se movió, a lo sumo en ese rato se nota. Al salir, el mensaje entra por la cola del líder (electron/cola.ts):
// si el líder está a mitad de un turno espera su turno, y si no tiene proceso se lo retoma, igual que cualquier mensaje encolado.
// Un mensaje que no pudo salir NO se reintenta solo (un `claude` que no arranca sería un bucle): queda con su error hasta que se saque.
// Sin imports de Electron: el reloj, el timer, el disco y la cola se inyectan; lo prueba tests/programados.test.ts.
import { LEJOS_MS } from "./programados-hora.ts";

export type Programado = {
  id: number;
  sid: string;
  texto: string;
  modelo: string;
  effort: string;
  /** Para retomar un líder sin proceso (el modo de permisos de la caja) y su nombre. */
  modo?: string;
  nombre?: string;
  /** Cuándo sale (ms desde epoch) y cuándo se programó. */
  cuando: number;
  creado: number;
  /** Salió la hora y no pudo salir: por qué. No se reintenta solo. */
  error?: string;
};

export type Pospuesto = { sid: string; hasta: number; desde: number; nombre?: string };

export type Estado = { mensajes: Programado[]; pospuestos: Pospuesto[] };

/** Lo que se avisa a las vistas: cómo quedó todo y, si corresponde, qué acaba de pasar. */
export type Aviso = Estado & { salio?: { id: number; sid: string }; desperto?: Pospuesto };

type Foto = Estado & { version: 1; siguiente: number };

/** Lo más que se guarda: sin tope, un bucle en la ventana llenaría el disco. */
export const MENSAJES_MAX = 200;
export const POSPUESTOS_MAX = 200;
/** Lo más largo de un texto programado, en caracteres. */
export const TEXTO_MAX = 100_000;
/** El timer no espera más que esto de una vez: cubre la suspensión de la máquina y un cambio de hora. */
export const REVISAR_MS = 30_000;
/** Un `setTimeout` no pasa de 2^31-1 ms; por debajo de eso, además, `REVISAR_MS` manda. */
const POR_DEBAJO_DE = 2 ** 31 - 1;

const cadena = (x: unknown, max = 500): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const numero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function mensajeLimpio(x: unknown): Programado | null {
  const m = x as Partial<Programado> | null;
  if (!m || typeof m !== "object") return null;
  if (!numero(m.id) || !cadena(m.sid, 200) || !cadena(m.texto, TEXTO_MAX) || !cadena(m.modelo, 200) || !cadena(m.effort, 100) || !numero(m.cuando) || !numero(m.creado)) return null;
  return {
    id: m.id,
    sid: m.sid,
    texto: m.texto,
    modelo: m.modelo,
    effort: m.effort,
    ...(cadena(m.modo, 100) ? { modo: m.modo } : {}),
    ...(cadena(m.nombre, 300) ? { nombre: m.nombre } : {}),
    cuando: m.cuando,
    creado: m.creado,
    ...(cadena(m.error, 1000) ? { error: m.error } : {}),
  };
}

function pospuestoLimpio(x: unknown): Pospuesto | null {
  const p = x as Partial<Pospuesto> | null;
  if (!p || typeof p !== "object" || !cadena(p.sid, 200) || !numero(p.hasta)) return null;
  return { sid: p.sid, hasta: p.hasta, desde: numero(p.desde) ? p.desde : p.hasta, ...(cadena(p.nombre, 300) ? { nombre: p.nombre } : {}) };
}

/** Lo que dice el archivo guardado; roto, de otra versión o ausente: nada. */
export function leerFoto(json: string | null): Foto {
  const vacia: Foto = { version: 1, siguiente: 1, mensajes: [], pospuestos: [] };
  try {
    const j = JSON.parse(json ?? "") as Partial<Foto> | null;
    if (j?.version !== 1) return vacia;
    const mensajes = (Array.isArray(j.mensajes) ? j.mensajes : []).flatMap((x) => mensajeLimpio(x) ?? []).slice(0, MENSAJES_MAX);
    const pospuestos = new Map<string, Pospuesto>();
    for (const x of Array.isArray(j.pospuestos) ? j.pospuestos : []) {
      const p = pospuestoLimpio(x);
      if (p) pospuestos.set(p.sid, p);
    }
    const mayor = mensajes.reduce((n, m) => Math.max(n, m.id), 0);
    return { version: 1, siguiente: Math.max(mayor + 1, numero(j.siguiente) ? j.siguiente : 1), mensajes, pospuestos: [...pospuestos.values()].slice(0, POSPUESTOS_MAX) };
  } catch {
    return vacia;
  }
}

export type Deps = {
  leer: () => Promise<string | null>;
  escribir: (json: string) => Promise<void>;
  ahora: () => number;
  /** Un timer de una sola vez; devuelve lo que `cancelar` necesita. */
  poner: (ms: number, fn: () => void) => unknown;
  cancelar: (t: unknown) => void;
  /** Mandarle el mensaje al líder por su cola. Rechaza si no sirve. */
  encolar: (m: Programado) => Promise<void>;
  avisar: (a: Aviso) => void;
};

export type Pedido = { sid: unknown; texto: unknown; cuando: unknown; modelo: unknown; effort: unknown; modo?: unknown; nombre?: unknown };

export function crearProgramados(deps: Deps) {
  let foto: Foto = { version: 1, siguiente: 1, mensajes: [], pospuestos: [] };
  let cargado: Promise<void> | null = null;
  let timer: unknown = null;
  /** Guardados en orden: dos escrituras no se pisan. */
  let escritura: Promise<void> = Promise.resolve();

  const estado = (): Estado => ({ mensajes: foto.mensajes.map((m) => ({ ...m })), pospuestos: foto.pospuestos.map((p) => ({ ...p })) });
  const guardar = () => {
    const json = JSON.stringify(foto);
    escritura = escritura.then(() => deps.escribir(json)).catch(() => undefined);
    return escritura;
  };
  const cargar = () => (cargado ??= deps.leer().then(
    (j) => void (foto = leerFoto(j)),
    () => undefined,
  ));

  /** Lo que falta para el próximo vencimiento (un mensaje sin error o un pospuesto), o `null` si no hay nada. */
  const proximo = (): number | null => {
    let m: number | null = null;
    for (const x of foto.mensajes) if (!x.error && (m === null || x.cuando < m)) m = x.cuando;
    for (const p of foto.pospuestos) if (m === null || p.hasta < m) m = p.hasta;
    return m;
  };

  const armar = () => {
    if (timer !== null) deps.cancelar(timer);
    timer = null;
    const p = proximo();
    if (p === null) return;
    const ms = Math.max(0, Math.min(p - deps.ahora(), REVISAR_MS, POR_DEBAJO_DE));
    timer = deps.poner(ms, () => {
      timer = null;
      void vencer();
    });
  };

  let venciendo: Promise<void> | null = null;
  /** Saca lo que ya es hora (lo vencido al arrancar también) y vuelve a armar el timer. */
  const vencer = (): Promise<void> => {
    // Una pasada a la vez; si algo vence mientras tanto, la pasada siguiente (la del timer que se arma al terminar) lo toma.
    if (venciendo) return venciendo;
    const pasada = (async () => {
      {
        const ahora = deps.ahora();
        const salen = foto.mensajes.filter((m) => !m.error && m.cuando <= ahora);
        const despiertan = foto.pospuestos.filter((p) => p.hasta <= ahora);
        if (despiertan.length) {
          foto = { ...foto, pospuestos: foto.pospuestos.filter((p) => p.hasta > ahora) };
          await guardar();
          for (const p of despiertan) deps.avisar({ ...estado(), desperto: p });
        }
        for (const m of salen) {
          // Primero se saca de la lista (y se guarda): si Trama se cierra a mitad de la entrega no sale dos veces.
          foto = { ...foto, mensajes: foto.mensajes.filter((x) => x.id !== m.id) };
          await guardar();
          try {
            await deps.encolar(m);
            deps.avisar({ ...estado(), salio: { id: m.id, sid: m.sid } });
          } catch (e) {
            const error = String((e as Error)?.message ?? e).slice(0, 500) || "error";
            foto = { ...foto, mensajes: [...foto.mensajes, { ...m, error }].sort((a, b) => a.cuando - b.cuando) };
            await guardar();
            deps.avisar(estado());
          }
        }
      }
    })();
    // `finally` corre en otro tick: `venciendo` ya está asignado aunque la pasada no haya esperado nada.
    venciendo = pasada.finally(() => {
      venciendo = null;
      armar();
    });
    return venciendo;
  };

  const cambio = async () => {
    await guardar();
    armar();
    deps.avisar(estado());
  };

  return {
    /** Al arrancar la app: lee el disco, manda lo que venció mientras estaba cerrada y arma el timer. */
    async arrancar(): Promise<void> {
      await cargar();
      await vencer();
    },
    async estado(): Promise<Estado> {
      await cargar();
      return estado();
    },
    /** Programa un mensaje; rechaza si el pedido no sirve (sin texto, hora pasada o a más de un año, demasiados). */
    async programar(x: Pedido): Promise<Programado> {
      await cargar();
      const ahora = deps.ahora();
      const m = mensajeLimpio({ id: foto.siguiente, sid: x?.sid, texto: typeof x?.texto === "string" ? x.texto.trim() : "", cuando: x?.cuando, modelo: x?.modelo, effort: x?.effort, modo: x?.modo, nombre: x?.nombre, creado: ahora });
      if (!m) throw new Error("programado: pedido inválido");
      if (m.cuando <= ahora) throw new Error("programado: la hora ya pasó");
      if (m.cuando - ahora > LEJOS_MS) throw new Error("programado: demasiado lejos");
      if (foto.mensajes.length >= MENSAJES_MAX) throw new Error("programado: demasiados mensajes");
      foto = { ...foto, siguiente: foto.siguiente + 1, mensajes: [...foto.mensajes, m].sort((a, b) => a.cuando - b.cuando || a.id - b.id) };
      await cambio();
      return { ...m };
    },
    /** Saca uno (también el que falló). */
    async quitar(id: unknown): Promise<void> {
      await cargar();
      const antes = foto.mensajes.length;
      foto = { ...foto, mensajes: foto.mensajes.filter((m) => m.id !== Number(id)) };
      if (foto.mensajes.length !== antes) await cambio();
    },
    /** Cambia la hora de uno que todavía no salió (y lo deja en pie si había fallado). */
    async reprogramar(id: unknown, cuando: unknown): Promise<void> {
      await cargar();
      const ahora = deps.ahora();
      if (!numero(cuando) || cuando <= ahora || cuando - ahora > LEJOS_MS) throw new Error("programado: hora inválida");
      const m = foto.mensajes.find((x) => x.id === Number(id));
      if (!m) return;
      const { error: _, ...sin } = m;
      foto = { ...foto, mensajes: foto.mensajes.map((x) => (x.id === m.id ? { ...sin, cuando } : x)).sort((a, b) => a.cuando - b.cuando || a.id - b.id) };
      await cambio();
    },
    /** Saca la conversación de la barra hasta `hasta`. Posponerla otra vez cambia la hora. */
    async posponer(sid: unknown, hasta: unknown, nombre?: unknown): Promise<void> {
      await cargar();
      const ahora = deps.ahora();
      if (!cadena(sid, 200) || !numero(hasta) || hasta <= ahora || hasta - ahora > LEJOS_MS) throw new Error("pospuesto: pedido inválido");
      const resto = foto.pospuestos.filter((p) => p.sid !== sid);
      if (resto.length >= POSPUESTOS_MAX) throw new Error("pospuesto: demasiados");
      const previo = foto.pospuestos.find((p) => p.sid === sid);
      foto = { ...foto, pospuestos: [...resto, { sid, hasta, desde: previo?.desde ?? ahora, ...(cadena(nombre, 300) ? { nombre } : {}) }] };
      await cambio();
    },
    /** Vuelve ya (sin aviso de "reapareció": la persona lo pidió). */
    async despertar(sid: unknown): Promise<void> {
      await cargar();
      const antes = foto.pospuestos.length;
      foto = { ...foto, pospuestos: foto.pospuestos.filter((p) => p.sid !== sid) };
      if (foto.pospuestos.length !== antes) await cambio();
    },
    /** Para los tests y el cierre: apaga el timer. */
    parar(): void {
      if (timer !== null) deps.cancelar(timer);
      timer = null;
    },
    /** Una pasada ya (el timer la llama; los tests también). */
    vencer,
    /** Lo que espera el timer, o `null`. */
    proximo,
  };
}
