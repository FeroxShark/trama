// La cola de mensajes de un líder: lo que el usuario manda mientras el líder está a mitad de un
// turno no se rechaza ni lo corta: espera acá (se ve debajo de la conversación y se puede
// sacar) y sale solo cuando el líder puede recibirlo. Todo lo que hay en la cola sale JUNTO, en un solo
// mensaje (`juntar`): nunca uno por turno. Con un `claude` de la app a mitad de un turno sale en la primera
// pausa: se manda al stdin sin interrumpir (`enTurno`) y el CLI lo entrega en el próximo límite de herramienta
// (`tool_result`); los motores sin ese canal (modelos locales) esperan al final del turno. Vale para los dos:
//  - el de la app: al terminar el turno (o Parar, o el proceso que salió: `mandar` lo relanza);
//  - el abierto en una terminal: cuando su turno termina (`status: idle`) se lo trae (se cierra
//    ese `claude`, por su pid) y el mensaje sale con el `--resume` de siempre. Sin proceso en
//    ningún lado (cerraron la terminal, o trama volvió después de un reinicio), igual.
// Vive en el main y se guarda en disco (`cola.json`): la ven la ventana y el celular, y un
// reinicio de trama no la pierde. Lo que no pudo salir no se reintenta solo (un `claude` que
// no arranca sería un bucle): queda en la cola con su error, hasta que el usuario reintente o lo saque.
// Nunca se pierde un mensaje: en disco está TODO lo que todavía no entró, con su error y con sus imágenes:
//  - cada imagen va en su archivo (`Deps.adjuntos`): `cola.json` queda chico y no hay tope que las descarte;
//  - lo que ya se le pasó al motor pero no entró (`camino`: un `mandar` a medias, o el stdin a mitad de un turno, que espera el
//    próximo límite de herramienta) sigue en disco hasta que entra (el eco del CLI, el fin del turno o el transcript). Si la app se
//    cae, o el motor se cierra sin tomarlo, vuelve al principio de la cola; si el transcript ya lo tiene, no se manda dos veces.
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
  /** Un aviso automático de Trama (electron/avisos-worker.ts), no algo que escribió el usuario: va a la conversación como fila de sistema. */
  aviso?: true;
  /** Las claves (`<id>:<tipo>`) de los avisos de workers que lleva (electron/avisos-pendientes.ts): se marcan entregados sólo cuando de verdad salió. */
  avisos?: string[];
};

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
  /** De cuál de la lista es el error (el primero de lo que no pudo salir). */
  errorId?: number | null;
  /** Lo que ya se le pasó al motor a mitad del turno y todavía no entró: sigue en la bandeja, sin Editar ni Borrar (ya no se puede retirar). */
  camino?: readonly Encolado[];
  /**
   * Salió este (todo el lote junto) como un turno propio: va a la conversación. `total`: mensajes del transcript en ese momento; `traido`:
   * venía de una terminal.
   */
  salio?: { item: Encolado; total: number | null; traido: boolean };
  /** Entró a mitad del turno en curso (no empieza uno nuevo): recién ahora pasa de la bandeja a la conversación. */
  entro?: { item: Encolado; total: number | null };
  /** El que había salido no llegó: volvió a la cola (se saca de la conversación). */
  volvio?: boolean;
};

/** Lo que se le pasó al motor y todavía no entró. `lote`: los mensajes tal como estaban en la cola; `item`: el mensaje junto que salió. */
type Camino = { lote: readonly Encolado[]; item: Encolado; enTurno: boolean; total: number | null };

/** Una imagen en disco: los datos, si no se pudo escribir su archivo (o de una versión anterior), o el nombre de su archivo. */
type ImagenDisco = { tipo: string; datos?: string; archivo?: string };

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
  /** Las imágenes, cada una en su archivo. Sin esto (fixtures, pruebas chicas) van adentro del JSON. */
  adjuntos?: {
    guardar: (archivo: string, datos: string) => Promise<void>;
    leer: (archivo: string) => Promise<string | null>;
    borrar: (archivo: string) => Promise<void>;
    listar: () => Promise<string[]>;
  };
  /**
   * ¿El transcript ya tiene este mensaje, de `desde` en adelante? `null`: no se puede saber. Sin esto, lo que el motor tomó se da por entrado apenas queda libre
   * (fixtures, pruebas chicas).
   */
  verificar?: (sid: string, texto: string, desde: number | null) => Promise<boolean | null>;
  /** Corta el turno de un líder de la app («Cortar y enviar ahora»): al terminar, la cola sigue sola. */
  cortar?: (sid: string) => void | Promise<void>;
  avisar: (a: AvisoCola) => void;
  /** ¿Se le puede mandar algo a mitad de su turno (un `claude` de la app ocupado que acepta mensajes)? Sin esto, todo espera al fin del turno. */
  puedeEnTurno?: (sid: string) => boolean | Promise<boolean>;
  /** Lo manda a mitad del turno, sin interrumpir: el CLI lo entrega en el próximo `tool_result`. `"normal"`: el turno ya había terminado y salió como uno propio. */
  enTurno?: (sid: string, x: Encolado) => Promise<void | "normal">;
  /** Cuánto se espera (ms) antes de mandar a mitad de un turno, para que varios mensajes seguidos salgan juntos (y dé tiempo a editarlos). */
  agrupar?: number;
  /** Cuánto se espera (ms) al eco de lo que estaba en camino, ya con el líder libre, antes de mirar el transcript. */
  gracia?: number;
  /**
   * Qué fue de los avisos de workers (`Encolado.avisos`) que llevaba lo encolado: `entregado` cuando `mandar` / `enTurno` contestó bien (nunca
   * antes: si falla vuelven a la cola); `quitado` si el usuario lo sacó; `vaciado` si el líder se cerró adrede (lo suyo se retoma después).
   */
  salida?: (sid: string, claves: string[], que: "entregado" | "quitado" | "vaciado") => void;
};

/**
 * Lo que tarda en salir lo encolado a mitad de un turno: lo que se escriba en este rato sale en el mismo mensaje, y hasta ahí se puede editar o borrar
 * (una vez en el stdin del motor ya no se retira). Cada mensaje nuevo, edición o cambio de orden lo vuelve a empezar.
 */
export const AGRUPAR_MS = 8000;
/** Lo que se le da al CLI, con el turno terminado, para tomar lo que recibió a mitad (corre como turno propio): su eco llega enseguida. */
export const GRACIA_MS = 4000;
/** Editar, arrastrar o confirmar frena la salida; si la vista desaparece sin soltarla, se suelta sola. La vista la renueva mientras tanto. */
export const RETENER_MS = 120_000;
/** Imágenes por mensaje (el tope de `imagenesDe`): un lote que pasara de acá se parte en dos. */
export const LOTE_IMAGENES_MAX = 20;

/** Los que salen juntos: desde el primero de la cola, mientras sus imágenes entren en un mensaje (siempre sale al menos uno). */
export function loteDe(lista: readonly Encolado[]): Encolado[] {
  const r: Encolado[] = [];
  let imgs = 0;
  for (const e of lista) {
    imgs += e.imagenes?.length ?? 0;
    if (r.length && imgs > LOTE_IMAGENES_MAX) break;
    r.push(e);
  }
  return r;
}

/**
 * Un mensaje con todo el lote, en orden y con cada uno bien separado ("Mensaje 2 de 3" y una raya); las imágenes van juntas y el
 * encabezado dice cuáles son de quién. Uno solo sale tal cual. Modelo y esfuerzo: los del último; modo y nombre: los del primero que los tenga.
 * Es un aviso sólo si todo el lote lo es: un mensaje del usuario metido en el mismo lote sigue siendo suyo.
 */
export function juntar(lote: readonly Encolado[]): Encolado {
  if (lote.length === 1) return lote[0];
  const imagenes: { tipo: string; datos: string }[] = [];
  const partes = lote.map((e, k) => {
    const n = e.imagenes?.length ?? 0;
    const nota = n ? ` (${n === 1 ? `imagen ${imagenes.length + 1}` : `imágenes ${imagenes.length + 1} a ${imagenes.length + n}`} de las adjuntas)` : "";
    if (e.imagenes) imagenes.push(...e.imagenes);
    return `Mensaje ${k + 1} de ${lote.length}${nota}:\n${e.texto}`;
  });
  const ultimo = lote[lote.length - 1];
  const modo = lote.find((e) => e.modo !== undefined)?.modo;
  const nombre = lote.find((e) => e.nombre !== undefined)?.nombre;
  return {
    id: ultimo.id,
    texto: partes.join("\n\n---\n\n"),
    modelo: ultimo.modelo,
    effort: ultimo.effort,
    ...(imagenes.length ? { imagenes } : {}),
    ...(modo !== undefined ? { modo } : {}),
    ...(nombre !== undefined ? { nombre } : {}),
    ...(lote.every((e) => e.aviso) ? { aviso: true as const } : {}),
    ...(lote.some((e) => e.avisos?.length) ? { avisos: lote.flatMap((e) => e.avisos ?? []) } : {}),
  };
}

const VACIA: readonly Encolado[] = [];
const SIN_CAMINO: readonly Camino[] = [];

/** Lo que el usuario tiene elegido en la caja del líder (modelo y esfuerzo). */
export type Seleccion = { modelo: string; effort: string };

/**
 * Un mensaje de la cola sale con lo elegido en la caja en el momento en que de verdad se entrega al modelo, no con lo que había al
 * encolarlo: si el usuario cambió el modelo o el esfuerzo mientras esperaba, manda lo nuevo. Sin selección vigente, la del mensaje.
 */
export const conSeleccion = (x: Encolado, s: Seleccion | undefined): Encolado => (s ? { ...x, modelo: s.modelo, effort: s.effort } : x);

/**
 * ¿Entró `texto` de `desde` en adelante? `mensajes`: los últimos del transcript, `total`: cuántos tiene en total. Lo de antes de `desde` no cuenta: el mismo texto mandado
 * antes no es este mensaje. Sin `desde`, o sin texto (sólo imágenes), no se puede saber.
 */
export function entroEn(mensajes: readonly { rol?: string; texto?: string }[], total: number, texto: string, desde: number | null): boolean | null {
  const t = texto.trim();
  if (desde === null || !t) return null;
  const primero = total - mensajes.length;
  return mensajes.some((m, k) => primero + k >= desde && m.rol === "user" && String(m.texto ?? "").trim().endsWith(t));
}

const esEncolado = (x: unknown): x is Encolado => {
  const e = x as Encolado;
  return !!e && Number.isInteger(e.id) && typeof e.texto === "string" && typeof e.modelo === "string" && typeof e.effort === "string";
};

export function crearCola(d: Deps) {
  const colas = new Map<string, readonly Encolado[]>();
  const errores = new Map<string, { texto: string; id: number | null }>();
  // Lo que se le pasó al motor y todavía no entró (va a disco). De a un lote por envío, el más viejo primero.
  const caminos = new Map<string, readonly Camino[]>();
  // Uno en camino por líder: un fin de turno y un aviso de las sesiones seguidos no mandan dos.
  const enCamino = new Set<string>();
  // Avisaron que quedó libre mientras se miraba (un intento que lo vio ocupado justo antes del fin
  // del turno): se vuelve a mirar al terminar, en vez de perder el aviso. El valor: si era con `cortar`.
  const otraVez = new Map<string, boolean>();
  // Lo elegido en la caja de cada líder con cola (la vista lo avisa en cada cambio): se aplica al salir cada mensaje y se olvida al vaciarse la cola.
  const selecciones = new Map<string, Seleccion>();
  // Alguien está editando, arrastrando o confirmando: no sale nada hasta que suelte (o venza).
  const retenidas = new Map<string, ReturnType<typeof setTimeout>>();
  // Se pidió cortar el turno: lo que espera sale al terminar, no a mitad.
  const cortando = new Set<string>();
  // Lo que estaba en camino al cerrarse la app y vuelve a la cola al cargar.
  const caminoVuelto = new Map<string, Encolado[]>();
  let n = 0;

  const lista = (sid: string) => colas.get(sid) ?? VACIA;
  const error = (sid: string) => errores.get(sid)?.texto ?? null;
  const caminoDe = (sid: string): readonly Camino[] => caminos.get(sid) ?? SIN_CAMINO;
  const clavesDe = (c: readonly Encolado[]) => c.flatMap((e) => e.avisos ?? []);
  const salida = (sid: string, c: readonly Encolado[], que: "entregado" | "quitado" | "vaciado") => {
    const claves = clavesDe(c);
    if (claves.length) d.salida?.(sid, claves, que);
  };
  const entregado = (sid: string, lote: readonly Encolado[]) => salida(sid, lote, "entregado");
  const ponerCamino = (sid: string, c: readonly Camino[]) => void (c.length ? caminos.set(sid, c) : caminos.delete(sid));

  // --- A disco ---------------------------------------------------------------------------------------------------
  // El archivo de cada imagen, por objeto (las imágenes no se tocan: cambiar de modelo o de lote las conserva).
  const archivos = new WeakMap<object, string>();
  let enDisco = new Set<string>();
  let nArchivo = 0;

  /** Las imágenes de un mensaje como van al JSON. El archivo se escribe antes que el JSON; si no se puede, van adentro: mejor pesado que perdido. */
  async function aDisco(e: Encolado, vivos: Set<string>): Promise<Encolado> {
    const adj = d.adjuntos;
    if (!adj || !e.imagenes?.length) return e;
    const imagenes = await Promise.all(
      e.imagenes.map(async (img): Promise<ImagenDisco> => {
        let archivo = archivos.get(img);
        if (!archivo) {
          archivo = `${e.id}-${++nArchivo}`;
          try {
            await adj.guardar(archivo, img.datos);
            archivos.set(img, archivo);
          } catch {
            return img;
          }
        }
        vivos.add(archivo);
        return { tipo: img.tipo, archivo };
      }),
    );
    return { ...e, imagenes: imagenes as Encolado["imagenes"] };
  }

  async function escribir() {
    const vivos = new Set<string>();
    const r: Record<string, Encolado[]> = {};
    for (const [sid, c] of colas) r[sid] = await Promise.all(c.map((e) => aDisco(e, vivos)));
    const cs: Record<string, unknown[]> = {};
    for (const [sid, c] of caminos)
      cs[sid] = await Promise.all(c.map(async (x) => ({ lote: await Promise.all(x.lote.map((e) => aDisco(e, vivos))), texto: x.item.texto, modelo: x.item.modelo, effort: x.item.effort, enTurno: x.enTurno, total: x.total })));
    await d.guardar(JSON.stringify({ version: 1, colas: r, ...(errores.size ? { errores: Object.fromEntries(errores) } : {}), ...(caminos.size ? { camino: cs } : {}) }));
    // Recién con el JSON escrito (ya no los nombra) se borran los que sobran.
    const adj = d.adjuntos;
    if (adj) for (const a of enDisco) if (!vivos.has(a)) void adj.borrar(a).catch(() => {});
    enDisco = vivos;
  }

  // Una escritura por vez, en orden; las que se piden mientras tanto salen juntas en la próxima (lee el estado al empezar).
  let cadena: Promise<void> = Promise.resolve();
  let proxima: Promise<void> | null = null;
  const guardar = (): Promise<void> => {
    if (proxima) return proxima;
    const p = cadena.then(() => {
      proxima = null;
      return escribir();
    }).catch(() => {});
    proxima = cadena = p;
    return p;
  };

  // --- Avisar a las vistas -----------------------------------------------------------------------------------------
  const enBandeja = (sid: string) => caminoDe(sid).filter((c) => c.enTurno).flatMap((c) => c.lote);
  const foto = (sid: string): AvisoCola => {
    const camino = enBandeja(sid);
    return { sid, lista: lista(sid), error: error(sid), ...(errores.has(sid) ? { errorId: errores.get(sid)!.id } : {}), ...(camino.length ? { camino } : {}) };
  };

  function poner(sid: string, c: readonly Encolado[], extra: Pick<AvisoCola, "salio" | "volvio" | "entro"> = {}) {
    if (c.length) colas.set(sid, c);
    else {
      colas.delete(sid);
      errores.delete(sid);
      selecciones.delete(sid);
      soltarReloj(sid);
    }
    const g = guardar();
    d.avisar({ ...foto(sid), ...extra });
    return g;
  }

  function fallar(sid: string, texto: string, id: number | null, volvio = false) {
    errores.set(sid, { texto, id });
    void guardar();
    d.avisar({ ...foto(sid), ...(volvio ? { volvio } : {}) });
  }

  // --- Lo que está en camino ---------------------------------------------------------------------------------------
  const sacarCamino = (sid: string, c: Camino) => ponerCamino(sid, caminoDe(sid).filter((x) => x !== c));
  /** Vuelve al principio de la cola, con lo elegido cuando salió. */
  const alFrente = (sid: string, c: Camino) => colas.set(sid, [...c.lote.map((y) => conSeleccion(y, { modelo: c.item.modelo, effort: c.item.effort })), ...lista(sid)]);

  /** Entró de verdad: deja la bandeja y el disco. A mitad de un turno, recién ahora va a la conversación. */
  function adentro(sid: string, c: Camino) {
    sacarCamino(sid, c);
    entregado(sid, c.lote);
    void guardar();
    if (c.enTurno) d.avisar({ ...foto(sid), entro: { item: c.item, total: c.total } });
  }

  const gracias = new Map<string, ReturnType<typeof setTimeout>>();
  function soltarGracia(sid: string) {
    const r = gracias.get(sid);
    if (r) clearTimeout(r);
    gracias.delete(sid);
  }
  function esperarGracia(sid: string) {
    if (gracias.has(sid)) return;
    const r = setTimeout(() => {
      gracias.delete(sid);
      void resolver(sid);
    }, d.gracia ?? GRACIA_MS);
    (r as { unref?: () => void }).unref?.();
    gracias.set(sid, r);
  }

  /** El líder quedó libre y lo que estaba en camino no dio señales: el transcript dice si entró. Lo que no entró vuelve a la cola, sin perderse. */
  async function resolver(sid: string) {
    if ((await d.disponible(sid)) === "ocupado") return;
    for (const c of caminoDe(sid)) {
      const hay = d.verificar ? await d.verificar(sid, c.item.texto, c.total).catch(() => null) : true;
      if (!caminoDe(sid).includes(c)) continue; // llegó el eco mientras se miraba
      if (hay) {
        adentro(sid, c);
        continue;
      }
      sacarCamino(sid, c);
      alFrente(sid, c);
      // A mitad de un turno es lo que se soltó al cortar: sale como uno propio. Uno que iba solo y se cayó no se reintenta por su cuenta (sería un bucle).
      if (c.enTurno && hay === false) d.avisar(foto(sid));
      else fallar(sid, d.textoError({ motivo: "noEntro" }), c.lote[0]?.id ?? null, !c.enTurno);
      void guardar();
    }
    await libre(sid);
  }

  // Los que ya esperaron su rato para salir a mitad de un turno (y el reloj de cada uno).
  const listos = new Set<string>();
  const relojes = new Map<string, ReturnType<typeof setTimeout>>();
  function esperarPausa(sid: string) {
    if (relojes.has(sid)) return;
    const r = setTimeout(() => {
      relojes.delete(sid);
      listos.add(sid);
      void libre(sid);
    }, d.agrupar ?? AGRUPAR_MS);
    (r as { unref?: () => void }).unref?.();
    relojes.set(sid, r);
  }
  function soltarReloj(sid: string) {
    const r = relojes.get(sid);
    if (r) clearTimeout(r);
    relojes.delete(sid);
    listos.delete(sid);
  }

  /** A mitad de un turno: todo lo que hay sale junto, sin interrumpir. `true`: salió. */
  async function aMitadDeTurno(sid: string): Promise<boolean> {
    if (cortando.has(sid) || !d.enTurno || !(await d.puedeEnTurno?.(sid))) return false;
    // Un ratito para que lo que se escribe enseguida salga en el mismo mensaje.
    if (!listos.has(sid)) {
      esperarPausa(sid);
      return false;
    }
    const lote = loteDe(lista(sid));
    if (!lote.length) return false;
    const total = await d.total(sid).catch(() => null);
    const item = conSeleccion(juntar(lote), selecciones.get(sid));
    if (retenidas.has(sid) || !lote.every((y, i) => lista(sid)[i]?.id === y.id)) return false;
    listos.delete(sid);
    const c: Camino = { lote, item, enTurno: true, total };
    ponerCamino(sid, [...caminoDe(sid), c]);
    // Antes de tocar el stdin ya está en disco como "en camino": si la app se cae acá, no se pierde.
    await poner(sid, lista(sid).slice(lote.length));
    try {
      const como = await d.enTurno(sid, item);
      if (como === "normal") {
        // El turno ya había terminado: es un turno propio, y va a la conversación ya.
        ponerCamino(sid, caminoDe(sid).map((x) => (x === c ? { ...c, enTurno: false } : x)));
        d.avisar({ ...foto(sid), salio: { item, total, traido: false } });
      }
    } catch (err) {
      sacarCamino(sid, c);
      alFrente(sid, c);
      fallar(sid, d.textoError({ error: err }), lote[0].id);
      return false;
    }
    entregado(sid, lote);
    return true;
  }

  /** Un intento de sacar todo lo que espera, junto. `true`: salió (puede seguir lo que quedó). */
  async function intento(sid: string, cortar: boolean): Promise<boolean> {
    const disp = await d.disponible(sid);
    if (disp === "ocupado") soltarGracia(sid);
    else if (caminoDe(sid).length) {
      // Primero lo que ya se le pasó al motor: si no entró, va adelante de lo que sigue esperando.
      if (d.verificar) {
        esperarGracia(sid);
        return false;
      }
      for (const c of caminoDe(sid)) adentro(sid, c);
    }
    if (!lista(sid).length || errores.has(sid) || retenidas.has(sid) || (disp === "terminalOcupada" && !cortar)) return false;
    if (disp === "ocupado") return aMitadDeTurno(sid);
    soltarReloj(sid);
    cortando.delete(sid);
    const traido = disp !== "app";
    if (traido) {
      const r = await d.traer(sid, conSeleccion(juntar(loteDe(lista(sid))), selecciones.get(sid)), cortar);
      if (!r.ok) {
        // Volvió a ponerse a trabajar justo ahora: se sigue esperando.
        if (r.motivo !== "trabajando") fallar(sid, d.textoError({ motivo: r.motivo }), lista(sid)[0]?.id ?? null);
        return false;
      }
    }
    const total = await d.total(sid).catch(() => null);
    // Lo que se sacó de la cola (o se sumó) mientras tanto ya cuenta: el lote es el de recién.
    const lote = loteDe(lista(sid));
    if (!lote.length) return false;
    // Recién ahora (al desencolarse) se toma la selección vigente.
    const item = conSeleccion(juntar(lote), selecciones.get(sid));
    const c: Camino = { lote, item, enTurno: false, total };
    ponerCamino(sid, [...caminoDe(sid), c]);
    // En disco antes de mandar: un `mandar` a medias (relanzar el proceso tarda) no se pierde si la app se cae.
    await poner(sid, lista(sid).slice(lote.length), { salio: { item, total, traido } });
    try {
      await d.mandar(sid, item);
    } catch (err) {
      sacarCamino(sid, c);
      alFrente(sid, c);
      fallar(sid, d.textoError({ error: err }), lote[0].id, true);
      return false;
    }
    entregado(sid, lote);
    return true;
  }

  /**
   * El líder pudo haber quedado libre (o estar en una pausa de su turno): sale todo lo que hay, junto (si no hay otro en camino y si
   * lo anterior no había fallado). `cortar`: El usuario dijo que sí a cortar al de la terminal.
   */
  async function libre(sid: string, cortar = false): Promise<void> {
    const hay = caminoDe(sid).length > 0;
    if (!hay && (!lista(sid).length || errores.has(sid) || retenidas.has(sid))) return;
    if (enCamino.has(sid)) return void otraVez.set(sid, cortar || otraVez.get(sid) === true);
    enCamino.add(sid);
    let salio = false;
    try {
      salio = await intento(sid, cortar);
    } catch (err) {
      fallar(sid, d.textoError({ error: err }), lista(sid)[0]?.id ?? null);
    } finally {
      enCamino.delete(sid);
    }
    const otra = otraVez.get(sid);
    otraVez.delete(sid);
    // Si el turno ya terminó antes de que `mandar` contestara, sigue el próximo.
    if (salio || otra !== undefined) await libre(sid, otra === true);
  }

  /** Vuelve a empezar el rato de agrupar: lo que se acaba de tocar tiene su tiempo entero antes de salir. */
  function tocar(sid: string) {
    soltarReloj(sid);
    void libre(sid);
  }

  function soltarRetencion(sid: string) {
    const r = retenidas.get(sid);
    if (r) clearTimeout(r);
    return retenidas.delete(sid);
  }

  /** Las imágenes guardadas aparte vuelven a ser datos; la que no está se deja afuera y se avisa con `falto` (el texto sigue). */
  async function hidratar(e: Encolado, falto: () => void): Promise<Encolado> {
    const imgs = e.imagenes as ImagenDisco[] | undefined;
    if (!imgs?.length) return e;
    const r: { tipo: string; datos: string }[] = [];
    for (const img of imgs) {
      if (typeof img?.datos === "string" && typeof img.tipo === "string") {
        r.push({ tipo: img.tipo, datos: img.datos });
        continue;
      }
      const datos = typeof img?.archivo === "string" ? await d.adjuntos?.leer(img.archivo).catch(() => null) : null;
      if (typeof datos !== "string") {
        falto();
        continue;
      }
      const lista = { tipo: String(img.tipo), datos };
      archivos.set(lista, img.archivo!);
      enDisco.add(img.archivo!);
      nArchivo = Math.max(nArchivo, Number(img.archivo!.split("-")[1]) || 0);
      r.push(lista);
    }
    const { imagenes: _, ...sin } = e;
    return r.length ? { ...sin, imagenes: r } : sin;
  }

  return {
    lista,
    error,
    /** Lo que ya se le pasó al motor a mitad del turno y todavía no entró. */
    camino: enBandeja,
    /** Todas las colas con algo (una vista que recién abre). */
    todas: (): AvisoCola[] => [...new Set([...colas.keys(), ...caminos.keys()])].filter((sid) => lista(sid).length || enBandeja(sid).length).map(foto),
    /**
     * Lo que quedó guardado de la vez anterior. Lo que no se entiende se ignora. Lo que estaba en camino cuando la app se cerró: si el transcript lo tiene ya entró;
     * si no, vuelve al principio de la cola (y sale solo); si no se puede saber, vuelve con su error y Reintentar: mejor preguntar que mandarlo dos veces.
     * Sin imágenes aparte ni camino que mirar, carga en el acto; si no, hay que esperar la promesa antes de usar la cola.
     */
    cargar(json: string | null): void | Promise<void> {
      type Disco = { colas?: Record<string, unknown>; errores?: Record<string, unknown>; camino?: Record<string, unknown> };
      let j: Disco;
      try {
        j = JSON.parse(json ?? "");
        if ((j as { version?: number })?.version !== 1 || typeof j.colas !== "object" || !j.colas) return;
      } catch {
        // Sin archivo, o roto: cola vacía.
        return;
      }
      const leidas = Object.entries(j.colas).map(([sid, c]) => [sid, Array.isArray(c) ? c.filter(esEncolado) : []] as const).filter(([, c]) => c.length);
      const sueltos = Object.entries(j.camino ?? {}).flatMap(([sid, c]) => (Array.isArray(c) ? c : []).map((x) => ({ sid, x: x as { lote?: unknown; texto?: unknown; modelo?: unknown; effort?: unknown; total?: unknown; enTurno?: unknown } })));
      const contar = (c: readonly Encolado[]) => c.forEach((e) => (n = Math.max(n, e.id)));
      leidas.forEach(([, c]) => contar(c));
      const conErrores = () => {
        for (const [sid, v] of Object.entries(j.errores ?? {})) {
          const e = v as { texto?: unknown; id?: unknown };
          if (lista(sid).length && typeof e?.texto === "string") errores.set(sid, { texto: e.texto, id: typeof e.id === "number" ? e.id : (lista(sid)[0]?.id ?? null) });
        }
      };
      const aparte = (e: Encolado) => (e.imagenes as ImagenDisco[] | undefined)?.some((i) => typeof i?.datos !== "string");
      if (!sueltos.length && !leidas.some(([, c]) => c.some(aparte)) && !d.adjuntos) {
        for (const [sid, c] of leidas) colas.set(sid, c);
        conErrores();
        return;
      }
      return (async () => {
        const faltan = new Map<string, number>();
        const conImagenes = (sid: string, e: Encolado) =>
          hidratar(e, () => {
            if (!faltan.has(sid)) faltan.set(sid, e.id);
          });
        for (const [sid, c] of leidas) {
          const r: Encolado[] = [];
          for (const e of c) r.push(await conImagenes(sid, e));
          colas.set(sid, r);
        }
        conErrores();
        for (const { sid, x } of sueltos) {
          const lote: Encolado[] = [];
          for (const e of Array.isArray(x?.lote) ? x.lote.filter(esEncolado) : []) lote.push(await conImagenes(sid, e));
          if (!lote.length) continue;
          contar(lote);
          const texto = typeof x.texto === "string" ? x.texto : juntar(lote).texto;
          const total = typeof x.total === "number" ? x.total : null;
          const hay = d.verificar ? await d.verificar(sid, texto, total).catch(() => null) : false;
          if (hay) {
            entregado(sid, lote);
            continue;
          }
          const antes = caminoVuelto.get(sid) ?? [];
          caminoVuelto.set(sid, [...antes, ...lote]);
          if (hay === null && !errores.has(sid)) errores.set(sid, { texto: d.textoError({ motivo: "cortado" }), id: lote[0].id });
        }
        for (const [sid, c] of caminoVuelto) colas.set(sid, [...c, ...lista(sid)]);
        caminoVuelto.clear();
        for (const [sid, id] of faltan) if (!errores.has(sid) && lista(sid).some((e) => e.id === id)) errores.set(sid, { texto: d.textoError({ motivo: "sinImagen" }), id });
        // Lo que quedó de otra vez (se cayó antes de borrarlo) y ya nadie nombra.
        const adj = d.adjuntos;
        if (adj) for (const a of await adj.listar().catch(() => [])) if (!enDisco.has(a)) void adj.borrar(a).catch(() => {});
        if (sueltos.length) await guardar();
      })();
    },
    /** A la cola; si ya está libre (la vista lo vio ocupado un instante tarde), sale ya. */
    encolar(sid: string, x: Omit<Encolado, "id">): Encolado {
      const e = { ...x, id: ++n };
      poner(sid, [...lista(sid), e]);
      tocar(sid);
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
      if (!c.some((x) => x.id === id)) return;
      salida(sid, c.filter((x) => x.id === id), "quitado");
      // Se fue el que no pudo salir: su error se va con él y lo demás sigue.
      const eraSuyo = errores.get(sid)?.id === id;
      if (eraSuyo) errores.delete(sid);
      poner(sid, c.filter((x) => x.id !== id));
      if (eraSuyo) void libre(sid);
    },
    /** Cambia el texto (y saca imágenes, por posición) de uno que todavía espera. `false`: ya salió, es un aviso de Trama, o quedaría vacío. */
    editar(sid: string, id: number, texto: string, sinImagenes: readonly number[] = []): boolean {
      const c = lista(sid);
      const e = c.find((x) => x.id === id);
      if (!e || e.aviso) return false;
      const imagenes = (e.imagenes ?? []).filter((_, k) => !sinImagenes.includes(k));
      if (!texto.trim() && !imagenes.length) return false;
      const { imagenes: _, ...sin } = e;
      poner(sid, c.map((x) => (x === e ? { ...sin, texto, ...(imagenes.length ? { imagenes } : {}) } : x)));
      if (relojes.has(sid)) tocar(sid);
      return true;
    },
    /** El orden nuevo, por ids. Lo que ya salió se ignora y lo que no nombra (llegó mientras se arrastraba) queda al final. */
    ordenar(sid: string, ids: readonly number[]) {
      const c = lista(sid);
      const r = [...ids.flatMap((id) => c.find((x) => x.id === id) ?? []), ...c.filter((x) => !ids.includes(x.id))];
      if (r.every((x, k) => x === c[k])) return;
      poner(sid, r);
      if (relojes.has(sid)) tocar(sid);
    },
    /** Alguien edita, arrastra o confirma: no sale nada (`true`, y se renueva repitiéndolo) hasta que suelte (`false`) o venza. */
    retener(sid: string, si: boolean) {
      const habia = soltarRetencion(sid);
      if (si) {
        const r = setTimeout(() => {
          retenidas.delete(sid);
          void libre(sid);
        }, RETENER_MS);
        (r as { unref?: () => void }).unref?.();
        retenidas.set(sid, r);
      } else if (habia) void libre(sid);
    },
    /** Con el eco del CLI: entró lo que estaba en camino a mitad del turno. Lo que estaba libre detrás ya puede seguir. */
    entro(sid: string, texto: string) {
      const c = caminoDe(sid).find((x) => x.enTurno && x.item.texto.trim() === texto.trim());
      if (!c) return;
      adentro(sid, c);
      if (!caminoDe(sid).length) soltarGracia(sid);
    },
    /** Terminó un turno con el proceso vivo: lo que salió como turno propio ya entró. */
    finTurno(sid: string) {
      for (const c of caminoDe(sid)) if (!c.enTurno) adentro(sid, c);
    },
    /** El líder se cerró adrede: lo suyo no sale más. */
    vaciar(sid: string) {
      soltarReloj(sid);
      soltarGracia(sid);
      soltarRetencion(sid);
      cortando.delete(sid);
      salida(sid, lista(sid), "vaciado");
      const habia = caminoDe(sid).length > 0;
      ponerCamino(sid, SIN_CAMINO);
      if (lista(sid).length || habia) poner(sid, VACIA);
    },
    libre: (sid: string) => libre(sid),
    /**
     * El usuario lo pide ahora: reintenta lo que había fallado y, con `cortar`, corta lo que está haciendo: el de la terminal se cierra (`traer`) y el de la app para su turno
     * (`Deps.cortar`): al terminar, la cola sigue sola con todo, en orden.
     */
    async ya(sid: string, cortar: boolean) {
      if (errores.delete(sid)) {
        void guardar();
        d.avisar(foto(sid));
      }
      soltarRetencion(sid);
      if (cortar && d.cortar && (await d.disponible(sid)) === "ocupado") {
        soltarReloj(sid);
        cortando.add(sid);
        await d.cortar(sid);
        return;
      }
      return libre(sid, cortar);
    },
    /** Cuántos líderes tienen uno saliendo ahora (se mira si se puede, se lo trae o se manda): un relanzo de trama lo cortaría. */
    enCamino: () => enCamino.size,
    /** Y cuáles. */
    enCaminoSids: () => [...enCamino],
    /** Algo cambió afuera (las sesiones de Claude Code, la lista de líderes, trama que arranca): se miran todas. */
    revisar: () => Promise.all([...new Set([...colas.keys(), ...caminos.keys()])].map((sid) => libre(sid))).then(() => {}),
  };
}

export type Cola = ReturnType<typeof crearCola>;
