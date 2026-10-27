// La cola de mensajes de un líder: lo que el usuario manda mientras el líder está a mitad de un
// turno no se rechaza ni lo corta: espera acá (se ve debajo de la conversación y se puede
// sacar) y sale solo, uno por turno, cuando el líder queda libre. Vale para los dos:
//  - el de la app: al terminar el turno (o Parar, o el proceso que salió: `mandar` lo relanza);
//  - el abierto en una terminal: cuando su turno termina (`status: idle`) se lo trae (se cierra
//    ese `claude`, por su pid) y el mensaje sale con el `--resume` de siempre. Sin proceso en
//    ningún lado (cerraron la terminal, o trama volvió después de un reinicio), igual.
// Vive en el main y se guarda en disco (`cola.json`): la ven la ventana y el celular, y un
// reinicio de trama no la pierde. Lo que no pudo salir no se reintenta solo (un `claude` que
// no arranca sería un bucle): queda en la cola con su error, hasta que el usuario reintente o lo saque.
// Sin imports: lo de afuera (estado del líder, traer, mandar, disco, avisar) se inyecta. La usa
// el main (electron/nucleo.ts) y, con fixtures, el renderer; la prueba tests/cola.test.ts.

export type Encolado = {
  id: number;
  texto: string;
  modelo: string;
  effort: string;
  imagenes?: { tipo: string; datos: string }[];
  /** Para traer a uno de la terminal: el modo de permisos de la caja y su nombre. */
  modo?: string;
  nombre?: string;
};

/**
 * Lo más que `cola.json` guarda de imágenes en total (caracteres de base64: ~15 MB de imagen). Un mensaje puede traer
 * 20 de hasta 5 MB y la cola se reescribe entera con cada cambio: sin tope, una captura pegada de más hace lento cada guardado.
 * Pasado el tope, los mensajes siguientes se guardan sin sus imágenes (el texto sí); en memoria siguen completos hasta que sale el mensaje.
 */
export const COLA_IMAGENES_MAX = 20 * 1024 * 1024;

/** Las colas como van a disco: las imágenes de un mensaje entran enteras o no entran, de la cola más vieja y el mensaje más viejo en adelante. */
export function paraDisco(colas: ReadonlyMap<string, readonly Encolado[]>, tope = COLA_IMAGENES_MAX): Record<string, Encolado[]> {
  let usado = 0;
  const r: Record<string, Encolado[]> = {};
  for (const [sid, c] of colas)
    r[sid] = c.map((e) => {
      if (!e.imagenes?.length) return e;
      const peso = e.imagenes.reduce((n, i) => n + i.datos.length, 0);
      if (usado + peso > tope) {
        const { imagenes: _, ...sin } = e;
        return sin;
      }
      usado += peso;
      return e;
    });
  return r;
}

/**
 * Qué se puede hacer con el líder ahora: escribirle (`app`), esperar (`ocupado`: responde o hay
 * un envío a medias), traerlo de la terminal (`terminal`, en reposo), esperar a que la terminal
 * termine el turno (`terminalOcupada`), o retomarlo (`nadie`: ningún proceso y no es de la app).
 */
export type Disponible = "app" | "ocupado" | "terminal" | "terminalOcupada" | "nadie";

/** Lo que se le avisa a las vistas: cómo quedó la cola y, si corresponde, qué salió o qué volvió. */
export type AvisoCola = {
  sid: string;
  lista: readonly Encolado[];
  error: string | null;
  /** Salió este: va a la conversación. `total`: mensajes del transcript en ese momento; `traido`: venía de una terminal. */
  salio?: { item: Encolado; total: number | null; traido: boolean };
  /** El que había salido no llegó: volvió a la cola (se saca de la conversación). */
  volvio?: boolean;
};

export type Deps = {
  disponible: (sid: string) => Promise<Disponible>;
  /** Trae al de la terminal (o anota al que no tiene proceso). `motivo: "trabajando"` = sigue a mitad de algo. */
  traer: (sid: string, x: Encolado, cortar: boolean) => Promise<{ ok: true } | { ok: false; motivo: string }>;
  mandar: (sid: string, x: Encolado) => Promise<void>;
  /** Cuántos mensajes tiene su transcript (la base de la tanda en la vista). */
  total: (sid: string) => Promise<number | null>;
  /** El texto (ya como lo entiende la vista) de por qué no se pudo: un motivo de `traer` o un error de `mandar`. */
  textoError: (x: { motivo: string } | { error: unknown }) => string;
  guardar: (json: string) => Promise<void>;
  avisar: (a: AvisoCola) => void;
};

const VACIA: readonly Encolado[] = [];

/** Lo que el usuario tiene elegido en la caja del líder (modelo y esfuerzo). */
export type Seleccion = { modelo: string; effort: string };

/**
 * Un mensaje de la cola sale con lo elegido en la caja en el momento en que de verdad se entrega al modelo, no con lo que había al
 * encolarlo: si el usuario cambió el modelo o el esfuerzo mientras esperaba, manda lo nuevo. Sin selección vigente, la del mensaje.
 */
export const conSeleccion = (x: Encolado, s: Seleccion | undefined): Encolado => (s ? { ...x, modelo: s.modelo, effort: s.effort } : x);

const esEncolado = (x: unknown): x is Encolado => {
  const e = x as Encolado;
  return !!e && Number.isInteger(e.id) && typeof e.texto === "string" && typeof e.modelo === "string" && typeof e.effort === "string";
};

export function crearCola(d: Deps) {
  const colas = new Map<string, readonly Encolado[]>();
  const errores = new Map<string, string>();
  // Uno en camino por líder: un fin de turno y un aviso de las sesiones seguidos no mandan dos.
  const enCamino = new Set<string>();
  // Avisaron que quedó libre mientras se miraba (un intento que lo vio ocupado justo antes del fin
  // del turno): se vuelve a mirar al terminar, en vez de perder el aviso. El valor: si era con `cortar`.
  const otraVez = new Map<string, boolean>();
  // Lo elegido en la caja de cada líder con cola (la vista lo avisa en cada cambio): se aplica al salir cada mensaje y se olvida al vaciarse la cola.
  const selecciones = new Map<string, Seleccion>();
  let n = 0;

  const lista = (sid: string) => colas.get(sid) ?? VACIA;
  const error = (sid: string) => errores.get(sid) ?? null;
  const guardar = () => d.guardar(JSON.stringify({ version: 1, colas: paraDisco(colas) })).catch(() => {});

  function poner(sid: string, c: readonly Encolado[], extra: Pick<AvisoCola, "salio" | "volvio"> = {}) {
    if (c.length) colas.set(sid, c);
    else {
      colas.delete(sid);
      errores.delete(sid);
      selecciones.delete(sid);
    }
    void guardar();
    d.avisar({ sid, lista: lista(sid), error: error(sid), ...extra });
  }

  function fallar(sid: string, texto: string, volvio = false) {
    errores.set(sid, texto);
    d.avisar({ sid, lista: lista(sid), error: texto, ...(volvio ? { volvio } : {}) });
  }

  /** Un intento de sacar el primero. `true`: salió (puede seguir el próximo). */
  async function intento(sid: string, cortar: boolean): Promise<boolean> {
    const disp = await d.disponible(sid);
    let x = lista(sid)[0];
    if (!x || disp === "ocupado" || (disp === "terminalOcupada" && !cortar)) return false;
    const traido = disp !== "app";
    if (traido) {
      const r = await d.traer(sid, conSeleccion(x, selecciones.get(sid)), cortar);
      if (!r.ok) {
        // Volvió a ponerse a trabajar justo ahora: se sigue esperando.
        if (r.motivo !== "trabajando") fallar(sid, d.textoError({ motivo: r.motivo }));
        return false;
      }
      // Lo sacaron de la cola mientras se lo traía: ya es de la app, y no hay nada que mandar.
      x = lista(sid)[0];
      if (!x) return false;
    }
    const total = await d.total(sid).catch(() => null);
    const original = x;
    if (lista(sid)[0] !== original) return false;
    // Recién ahora (al desencolarse) se toma la selección vigente.
    const item = conSeleccion(original, selecciones.get(sid));
    poner(sid, lista(sid).slice(1), { salio: { item, total, traido } });
    try {
      await d.mandar(sid, item);
    } catch (err) {
      colas.set(sid, [item, ...lista(sid)]);
      void guardar();
      fallar(sid, d.textoError({ error: err }), true);
      return false;
    }
    return true;
  }

  /**
   * El líder pudo haber quedado libre: sale el primero (si hay, si no hay otro en camino y si
   * lo anterior no había fallado). `cortar`: El usuario dijo que sí a cortar al de la terminal.
   */
  async function libre(sid: string, cortar = false): Promise<void> {
    if (!lista(sid).length || errores.has(sid)) return;
    if (enCamino.has(sid)) return void otraVez.set(sid, cortar || otraVez.get(sid) === true);
    enCamino.add(sid);
    let salio = false;
    try {
      salio = await intento(sid, cortar);
    } catch (err) {
      fallar(sid, d.textoError({ error: err }));
    } finally {
      enCamino.delete(sid);
    }
    const otra = otraVez.get(sid);
    otraVez.delete(sid);
    // Si el turno ya terminó antes de que `mandar` contestara, sigue el próximo.
    if (salio || otra !== undefined) await libre(sid, otra === true);
  }

  return {
    lista,
    error,
    /** Todas las colas con algo (una vista que recién abre). */
    todas: (): AvisoCola[] => [...colas.keys()].map((sid) => ({ sid, lista: lista(sid), error: error(sid) })),
    /** Lo que quedó guardado de la vez anterior. Lo que no se entiende se ignora. */
    cargar(json: string | null) {
      try {
        const j = JSON.parse(json ?? "");
        if (j?.version !== 1 || typeof j.colas !== "object" || !j.colas) return;
        for (const [sid, c] of Object.entries(j.colas)) {
          const ok = Array.isArray(c) ? c.filter(esEncolado) : [];
          if (!ok.length) continue;
          colas.set(sid, ok);
          for (const e of ok) n = Math.max(n, e.id);
        }
      } catch {
        // Sin archivo, o roto: cola vacía.
      }
    },
    /** A la cola; si ya está libre (la vista lo vio ocupado un instante tarde), sale ya. */
    encolar(sid: string, x: Omit<Encolado, "id">): Encolado {
      const e = { ...x, id: ++n };
      poner(sid, [...lista(sid), e]);
      void libre(sid);
      return e;
    },
    /** Lo elegido ahora en la caja del líder: lo que lleva el próximo mensaje de la cola al salir. Sin cola, no se guarda nada. */
    elegir(sid: string, s: Seleccion) {
      if (lista(sid).length) selecciones.set(sid, s);
    },
    /** La selección vigente de un líder con cola (para probar y para la vista). */
    seleccion: (sid: string): Seleccion | null => selecciones.get(sid) ?? null,
    quitar(sid: string, id: number) {
      const c = lista(sid);
      if (c.some((x) => x.id === id)) poner(sid, c.filter((x) => x.id !== id));
    },
    /** El líder se cerró adrede: lo suyo no sale más. */
    vaciar(sid: string) {
      if (lista(sid).length) poner(sid, VACIA);
    },
    libre: (sid: string) => libre(sid),
    /** El usuario lo pide ahora: reintenta lo que había fallado y, con `cortar`, corta al de la terminal. */
    ya(sid: string, cortar: boolean) {
      if (errores.delete(sid)) d.avisar({ sid, lista: lista(sid), error: null });
      return libre(sid, cortar);
    },
    /** Cuántos líderes tienen uno saliendo ahora (se mira si se puede, se lo trae o se manda): un relanzo de trama lo cortaría. */
    enCamino: () => enCamino.size,
    /** Y cuáles. */
    enCaminoSids: () => [...enCamino],
    /** Algo cambió afuera (las sesiones de Claude Code, la lista de líderes, trama que arranca): se miran todas. */
    revisar: () => Promise.all([...colas.keys()].map((sid) => libre(sid))).then(() => {}),
  };
}

export type Cola = ReturnType<typeof crearCola>;
