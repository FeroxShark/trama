// Trama en dos máquinas, la unión en sólo lectura (etapa 7, M2; contrato: docs/estado/maquinas.md): la trama
// de la PC junta a lo suyo las filas del motor de cada otra máquina (`maquinas.json`). Cada fila de allá lleva
// su `maquina` y el id con prefijo (`dell:…`, también el `jefe_id`), así nunca choca con uno de acá. Lo que
// difunde el motor de allá y es `reenviar` en `EVENTOS` sale de acá con los ids ya con prefijo; lo que es de
// una fila de allá y sólo se lee (su conversación) va a su motor. **Nada más se le manda**, salvo lo que se le hace
// a un item de su tablero (M5): una acción sobre una fila de allá falla con un texto claro (las acciones son M4).
// M4: con el mismo build (`acceso: si`) las acciones (lanzar, escribir, parar, integrar, archivar, retomar, la cola)
// también van al motor de la fila, con el id de allá; con otro build o caído se rechazan con aviso, nunca se hacen acá.
// Con la otra máquina caída, o sin saludo que se entienda, sus filas no están y todo queda como hoy.
// Sin otra máquina configurada no se arma (`crearMaquinas` da null): ni sockets ni relojes ni nada que recorrer.
// Sin `electron`: lo prueba tests/maquinas.test.ts con un segundo motor de verdad en 127.0.0.2.
import { armarClienteMaquina, type ClienteMaquina, type EstadoMaquina, type OpcionesMaquina } from "./maquina-cliente.ts";
import type { ConfigMaquinas, Maquina } from "./maquinas-config.ts";
import { EVENTOS } from "./maquinas-contrato.ts";
import { aplicarDif, type Dif, type Hilo } from "./hilos-dif.ts";
import type { TableroCrudo } from "./tablero.ts";
import { esperanJuntas, juntarTableros } from "./tablero-junto.ts";
import { errorT } from "./errores.ts";
import { log, silencio } from "./log.ts";

type Lectura = { n: number; datos: unknown } | { n: number; error: string };
type Fila = { id: string } & Record<string, unknown>;
type Sl = { uso: unknown; lideres: { version: number; lideres: Fila[]; analista?: unknown; caidos?: Fila[] } };
type Cola = { sid: string } & Record<string, unknown>;

/** Lo que se le pide a la otra máquina aunque tenga otro build: sólo lecturas. Lo demás (M4) pide el mismo build. */
const LECTURAS: ReadonlySet<string> = new Set(["lider:conversacion", "lider:mirar", "lider:pendientes", "lider:visto", "pa:hilo"]);

/** Los canales cuya máquina no la dice un id sino el selector (`maquina` en lo que se manda; en `tablero:agregar`, el 3.º argumento). */
const POR_SELECTOR: ReadonlySet<string> = new Set(["lider:nuevo", "lider:archivo", "tablero:agregar"]);

/** Qué cambió de lo juntado: quien junta (nucleo.ts) lo vuelve a difundir con lo suyo. */
export type Cambio = "hilos" | "statusline" | "compactando" | "colas" | "tablero";
const TODOS: readonly Cambio[] = ["hilos", "statusline", "compactando", "colas", "tablero"];

export type OpcionesMaquinas = {
  config: ConfigMaquinas;
  /** Un evento de allá, ya con los ids con prefijo, que no se junta con nada de acá (sale tal cual). */
  alEvento(canal: string, dato: unknown): void;
  /** Cambió lo que se junta de allá (llegó, cambió, o la máquina se cayó): hay que difundir lo junto. */
  alCambio(que: Cambio): void;
  /** Cambió cómo está una máquina (conectó, se cayó, otra versión): la barra lo dice (`estados`). */
  alEstado?(): void;
  /** Para probar: cómo se arma el cliente de cada máquina. */
  cliente?: (o: OpcionesMaquina) => ClienteMaquina;
};

/** Lo de una otra máquina que se tiene. `hilos.n`: la lectura de su motor (sus diferencias parten de ahí). */
type Otra = {
  m: Maquina;
  c: ClienteMaquina;
  e: EstadoMaquina;
  hilos: { n: number; lista: Hilo[] } | null;
  sl: Sl | null;
  comp: Record<string, number> | null;
  colas: Cola[] | null;
  /** Su tablero (`tablero:leer` de su motor); null si no se pudo leer. */
  tb: TableroCrudo | null;
  /** Una lectura de su tablero en curso: si cambia otra vez mientras tanto, se vuelve a leer al terminar. */
  leyendoTb: Promise<void> | null;
  otraTb: boolean;
  /** Una carga completa en curso: lo que llegue mientras tanto la vuelve a pedir al terminar. */
  cargando: Promise<void> | null;
  otraVez: boolean;
  /** Cuántas lecturas de su lista pidió esta trama y cuántos empujes (`hilos:cambio`) llegaron de su motor: ver `pedirHilos`. */
  pedido: number;
  empuje: number;
};

export type EstadoOtra = { id: string; nombre: string; fase: EstadoMaquina["fase"]; acceso: EstadoMaquina["acceso"] };

export function crearMaquinas(o: OpcionesMaquinas) {
  if (!o.config.maquinas.length) return null;
  const armar = o.cliente ?? armarClienteMaquina;
  const otras = new Map<string, Otra>();
  const pre = (m: string, id: unknown) => (typeof id === "string" && id ? `${m}:${id}` : id);
  const sinPre = (m: string, id: string) => (id.startsWith(`${m}:`) ? id.slice(m.length + 1) : id);
  /** La fila de allá con su máquina y los ids con prefijo. */
  const fila = (m: string, f: Fila): Fila => ({ ...f, id: pre(m, f.id) as string, ...("jefe_id" in f ? { jefe_id: pre(m, f.jefe_id) } : {}), maquina: m });
  /** Se ven sus filas: conectada (o reconectando en silencio tras un corte) y con un saludo que se entiende. */
  const visible = (x: Otra) => x.e.fase !== "caida" && x.e.acceso !== "no";
  const visibles = () => [...otras.values()].filter(visible);
  const tablerosVisibles = () => visibles().map((x) => ({ id: x.m.id, nombre: x.m.nombre, tb: x.tb }));

  // La última de acá que pasó por la unión: con un cambio de allá se vuelve a juntar con esto.
  let local: { hilos: Lectura | null; sl: Sl | null; comp: Record<string, number> | null; colas: Cola[] | null } = { hilos: null, sl: null, comp: null, colas: null };
  // Lo junto de los hilos, memorizado: la misma lectura de acá con lo mismo de allá es el mismo objeto y el mismo `n`.
  let vuelta = 0;
  let junto: { de: Lectura; vuelta: number; l: Lectura } | null = null;
  let n = 0;
  const cambio = (que: Cambio) => {
    if (que === "hilos") vuelta++;
    o.alCambio(que);
  };

  async function cargar(x: Otra) {
    if (x.cargando) return void (x.otraVez = true);
    x.cargando = (async () => {
      // `hilos:leer` también hace que su motor mire `eventos.jsonl` y difunda sus cambios.
      const [h, s, c, k] = await Promise.allSettled([
        pedirHilos(x, "hilos:leer"),
        x.c.pedir("statusline:leer"),
        x.c.pedir("compactando:leer"),
        x.c.pedir("lider:colas"),
        leerTablero(x),
      ]);
      if (s.status === "fulfilled") x.sl = esSl(s.value) ? s.value : null;
      if (c.status === "fulfilled") x.comp = esObjeto(c.value) ? (c.value as Record<string, number>) : null;
      if (k.status === "fulfilled") x.colas = Array.isArray(k.value) ? (k.value as Cola[]) : null;
      for (const r of [h, s, c, k]) if (r.status === "rejected") silencio("maquinas")(r.reason);
      // Su motor se reinició (o es la primera vez): lo que se miraba allá se vuelve a pedir.
      const sid = mirandoEn(x.m.id);
      if (sid) await x.c.pedir("lider:mirar", [sid]).catch(silencio("maquinas"));
    })().finally(() => {
      x.cargando = null;
      if (x.otraVez) {
        x.otraVez = false;
        void cargar(x);
      }
    });
    await x.cargando;
    for (const q of TODOS) cambio(q);
  }

  /** Su tablero, que su motor lee del CLI de allá. Sin vista (no hay tablero allá) queda en null. */
  function leerTablero(x: Otra): Promise<void> {
    if (x.leyendoTb) {
      x.otraTb = true;
      return x.leyendoTb;
    }
    x.leyendoTb = x.c
      .pedir("tablero:leer")
      .then((d) => void (x.tb = esObjeto(d) && d.version === 1 ? (d as TableroCrudo) : null))
      .catch((e) => void ((x.tb = null), silencio("maquinas")(e)))
      .finally(() => {
        x.leyendoTb = null;
        if (x.otraTb) {
          x.otraTb = false;
          void leerTablero(x).then(() => cambio("tablero"));
        }
      });
    return x.leyendoTb;
  }

  /**
   * Pide la lista de allá y la pone al llegar. Su respuesta puede llegar después de un empuje más nuevo (su motor la
   * difunde en cuanto la lee, y la respuesta viaja por otra conexión): pisarlo la dejaba vieja hasta el próximo cambio.
   * Vale sólo si es la última pedida y no llegó ningún empuje mientras volvía (el empuje ya traía esa lista, o una más
   * nueva); por eso se pone acá, en el momento, y no cuando terminan las demás lecturas de `cargar`.
   */
  async function pedirHilos(x: Otra, canal: "hilos:leer" | "hilos:completa"): Promise<void> {
    const mio = ++x.pedido;
    const empuje = x.empuje;
    const r = await x.c.pedir(canal);
    if (mio === x.pedido && empuje === x.empuje) ponerHilos(x, r);
  }

  /** Una lectura (entera o diferencia) de la lista de allá. Si no cierra, la entera. */
  function ponerHilos(x: Otra, l: unknown) {
    const v = l as { n?: unknown; datos?: { version?: unknown; hilos?: unknown }; dif?: Dif };
    if (typeof v?.n !== "number") return;
    if (v.dif) {
      const lista = x.hilos && x.hilos.n === v.dif.base ? aplicarDif(x.hilos.lista, v.dif) : null;
      if (!lista) {
        void pedirHilos(x, "hilos:completa").then(() => cambio("hilos"), silencio("maquinas"));
        return false;
      }
      x.hilos = { n: v.n, lista };
      return true;
    }
    // Un error de su `pa`: queda lo que había (como acá, la vista no pierde la lista por una corrida mala).
    if (v.datos?.version !== 1 || !Array.isArray(v.datos.hilos)) return false;
    x.hilos = { n: v.n, lista: (v.datos.hilos as unknown[]).filter((h): h is Hilo => typeof (h as Hilo)?.id === "string") };
    return true;
  }

  function alEvento(x: Otra, canal: string, d: unknown) {
    if (EVENTOS[canal] !== "reenviar" || !visible(x)) return;
    const m = x.m.id;
    switch (canal) {
      case "hilos:cambio":
        x.empuje++;
        if (ponerHilos(x, d)) cambio("hilos");
        return;
      case "statusline:cambio":
        if (esSl(d)) (x.sl = d), cambio("statusline");
        return;
      case "compactando:cambio":
        if (esObjeto(d)) (x.comp = d as Record<string, number>), cambio("compactando");
        return;
      case "lider:cola": {
        const a = d as Cola;
        if (typeof a?.sid !== "string") return;
        x.colas = [...(x.colas ?? []).filter((c) => c.sid !== a.sid), ...(a.lista && (a.lista as unknown[]).length ? [{ sid: a.sid, lista: a.lista, error: a.error ?? null }] : [])];
        return o.alEvento(canal, { ...a, sid: pre(m, a.sid) });
      }
      case "eventos:ids":
        if (Array.isArray(d)) o.alEvento(canal, d.map((id) => pre(m, id)));
        return;
      case "eventos:pa":
        if (Array.isArray(d)) o.alEvento(canal, d.map((e) => (esObjeto(e) ? { ...(e as object), id: pre(m, (e as { id?: unknown }).id) } : e)));
        return;
      case "lider:evento": {
        const v = d as { sid?: unknown; e?: unknown };
        if (typeof v?.sid === "string") o.alEvento(canal, { ...v, sid: pre(m, v.sid) });
        return;
      }
      case "lider:transcript":
        if (typeof d === "string") o.alEvento(canal, pre(m, d));
        return;
      case "tablero:cambio":
        void leerTablero(x).then(() => cambio("tablero"));
        return;
    }
  }

  for (const m of o.config.maquinas) {
    let u: URL;
    try {
      u = new URL(m.url);
    } catch {
      continue;
    }
    // El transporte es http pelado por la tailnet (Tailscale ya cifra); https (un `tailscale serve` del Dell) todavía no.
    if (u.protocol !== "http:") {
      log.escribir("error", "maquinas", `${m.id}: sólo http (${u.protocol})`);
      continue;
    }
    const x: Otra = {
      m,
      c: null as unknown as ClienteMaquina,
      e: { fase: "conectando", saludo: null, acceso: "no" },
      hilos: null,
      sl: null,
      comp: null,
      colas: null,
      tb: null,
      leyendoTb: null,
      otraTb: false,
      cargando: null,
      otraVez: false,
      pedido: 0,
      empuje: 0,
    };
    x.c = armar({
      ip: u.hostname.replace(/^\[|\]$/g, ""),
      puerto: Number(u.port) || 80,
      host: u.hostname,
      alEvento: (canal, d) => alEvento(x, canal, d),
      alCambiar(e) {
        const antes = visible(x);
        x.e = e;
        o.alEstado?.();
        const ahora = visible(x);
        if (ahora && (!antes || !x.hilos)) void cargar(x);
        if (antes && !ahora) {
          // Se cayó (o dejó de entenderse): sus filas se van y la barra queda como hoy.
          x.hilos = x.sl = x.comp = x.colas = x.tb = null;
          log.escribir("aviso", "maquinas", `${m.id}: sin conexión (o no se entiende): sus filas y su tablero no aparecen`);
          for (const q of TODOS) cambio(q);
        }
      },
      alResincronizar: () => void (visible(x) && cargar(x)),
    });
    otras.set(m.id, x);
  }
  if (!otras.size) return null;

  // Qué líder de allá mira cada vista (`quien`). El motor de allá ve un solo cliente (esta trama): mira el último pedido.
  const mirando = new Map<string, { m: string; sid: string }>();
  const mirandoEn = (m: string) => [...mirando.values()].reverse().find((v) => v.m === m)?.sid ?? null;
  async function mirar(vista: string, m: string | null, sid: string | null) {
    const antes = mirando.get(vista);
    if (m && sid) {
      mirando.delete(vista);
      mirando.set(vista, { m, sid });
    } else mirando.delete(vista);
    const tocadas = new Set([antes?.m, m].filter((v): v is string => !!v));
    for (const t of tocadas) {
      const x = otras.get(t);
      if (x && visible(x)) await x.c.pedir("lider:mirar", [mirandoEn(t)]).catch(silencio("maquinas"));
    }
  }

  /** De qué otra máquina es lo que nombran los argumentos de un pedido (`sid`, `id`, o el id suelto), y el id de allá. */
  function deQuien(args: unknown[]): { x: Otra; id: string } | null {
    const a = args[0];
    const id = typeof a === "string" ? a : esObjeto(a) ? ((a as { sid?: unknown }).sid ?? (a as { id?: unknown }).id) : null;
    if (typeof id !== "string") return null;
    const i = id.indexOf(":");
    const x = i > 0 ? otras.get(id.slice(0, i)) : undefined;
    return x ? { x, id: id.slice(i + 1) } : null;
  }

  /** La otra máquina de un id de máquina (el del selector); `""`/undefined/la de acá: null. Una que no existe: falla, no se hace acá. */
  function dePor(id: unknown): Otra | null {
    if (id === undefined || id === null || id === "" || id === o.config.esta) return null;
    const x = typeof id === "string" ? otras.get(id) : undefined;
    if (!x) throw errorT("main.maquinaDesconocida", { maquina: String(id) });
    return x;
  }
  /** Lo que se le pide a una máquina por su selector: el campo `maquina` del pedido (o el 3.º argumento de `tablero:agregar`). */
  function porSelector(canal: string, args: unknown[]): { x: Otra; args: unknown[] } | null {
    if (canal === "tablero:agregar") {
      const x = dePor(args[2]);
      return x ? { x, args: [args[0], args[1]] } : null;
    }
    const a = args[0];
    const x = dePor(esObjeto(a) ? a.maquina : undefined);
    if (!x) return null;
    const { maquina: _, ...resto } = a as Record<string, unknown>;
    return { x, args: [resto, ...args.slice(1)] };
  }
  /** Lo que se le hace a una fila: el id (de `deQuien`, o el 2.º argumento de `pa:rama`) dice la máquina; allá va el de allá. */
  function porId(canal: string, args: unknown[]): { x: Otra; args: unknown[] } | null {
    const i = canal === "pa:rama" ? 1 : 0;
    const q = deQuien(args.slice(i));
    if (!q) return null;
    const a = args[i];
    const propio = typeof a === "string" ? q.id : { ...(a as object), ...("sid" in (a as object) ? { sid: q.id } : { id: q.id }) };
    return { x: q.x, args: [...args.slice(0, i), propio, ...args.slice(i + 1)] };
  }
  /** El pedido a su motor, si se puede: caída → sin conexión; otro build → sólo lo que se lee. */
  function pasar(x: Otra, canal: string, args: unknown[]): Promise<unknown> {
    if (!visible(x)) return Promise.reject(errorT("main.maquinaSinConexion", { maquina: x.m.nombre }));
    if (!LECTURAS.has(canal) && x.e.acceso !== "si") return Promise.reject(errorT("main.maquinaSoloLectura", { maquina: x.m.nombre }));
    return x.c.pedir(canal, args);
  }
  /** `ramas:brief`: las filas de cada máquina a la suya (las de allá con su id de allá y de vuelta con el prefijo), y se juntan. */
  function briefs(args: unknown[], hacerLocal?: (args: unknown[]) => Promise<unknown>): Promise<unknown> | null {
    const lista = args[0];
    if (!Array.isArray(lista)) return null;
    const grupos = new Map<Otra, Fila[]>();
    const locales: unknown[] = [];
    for (const h of lista) {
      const q = deQuien([h]);
      if (!q) locales.push(h);
      else grupos.set(q.x, [...(grupos.get(q.x) ?? []), { ...(h as Fila), id: q.id, ...(typeof (h as Fila).jefe_id === "string" ? { jefe_id: sinPre(q.x.m.id, (h as Fila).jefe_id as string) } : {}) }]);
    }
    if (!grupos.size) return null;
    if (!hacerLocal && locales.length) return null;
    return Promise.all([
      locales.length && hacerLocal ? hacerLocal([locales, ...args.slice(1)]) : [],
      ...[...grupos].map(async ([x, hs]) => {
        const r = await pasar(x, "ramas:brief", [hs, ...args.slice(1)]);
        return Array.isArray(r) ? r.map((b) => (esObjeto(b) ? { ...b, id: pre(x.m.id, b.id) } : b)) : r;
      }),
    ]).then((rs) => rs.flat());
  }

  return {
    /** Las otras máquinas y cómo están (para la UI de M3). */
    estados: (): EstadoOtra[] => [...otras.values()].map((x) => ({ id: x.m.id, nombre: x.m.nombre, fase: x.e.fase, acceso: x.e.acceso })),

    /** La lista de `pa --hilos` de acá con las filas de allá al final. Mismo `n` mientras no cambie nada. */
    hilos(l: Lectura): Lectura {
      local.hilos = l;
      if (junto && junto.de === l && junto.vuelta === vuelta) return junto.l;
      let sale: Lectura;
      if (!("datos" in l)) sale = { n: ++n, error: l.error };
      else {
        const d = l.datos as { hilos?: unknown } | null;
        const otrasFilas = visibles().flatMap((x) => (x.hilos?.lista ?? []).map((h) => fila(x.m.id, h)));
        sale = { n: ++n, datos: d && Array.isArray(d.hilos) ? { ...d, hilos: [...d.hilos, ...otrasFilas] } : d };
      }
      junto = { de: l, vuelta, l: sale };
      return sale;
    },
    /** La última lectura de acá (con lo de allá), o null si todavía no hubo. */
    ultimaHilos: () => local.hilos,
    /** La lista guardada de acá (para pintar al abrir) con lo que se tenga de allá. */
    guardados(d: unknown): unknown {
      const otrasFilas = visibles().flatMap((x) => (x.hilos?.lista ?? []).map((h) => fila(x.m.id, h)));
      if (!otrasFilas.length) return d;
      const g = (esObjeto(d) ? d : { version: 1, hilos: [] }) as { hilos?: unknown };
      return { ...g, hilos: [...(Array.isArray(g.hilos) ? g.hilos : []), ...otrasFilas] };
    },
    /** El statusline de acá con los líderes de allá. El uso es de la misma cuenta: el de acá. */
    statusline(s: unknown): unknown {
      if (!esSl(s)) return s;
      local.sl = s;
      let lideres = s.lideres.lideres;
      let caidos = s.lideres.caidos;
      for (const x of visibles()) {
        if (!x.sl) continue;
        // Su pid es de allá: acá no sirve para nada (ni Ir a la ventana).
        lideres = [...lideres, ...x.sl.lideres.lideres.map((l) => ({ ...fila(x.m.id, l), pid: null }))];
        if (x.sl.lideres.caidos?.length) caidos = [...(caidos ?? []), ...x.sl.lideres.caidos.map((c) => fila(x.m.id, c))];
      }
      return { ...s, lideres: { ...s.lideres, lideres, ...(caidos ? { caidos } : {}) } };
    },
    /** Lo de acá que está compactando con lo de allá (ids con prefijo). */
    compactando(c: unknown): unknown {
      if (!esObjeto(c)) return c;
      local.comp = c as Record<string, number>;
      const sale: Record<string, unknown> = { ...(c as object) };
      for (const x of visibles()) for (const [id, v] of Object.entries(x.comp ?? {})) sale[`${x.m.id}:${id}`] = v;
      return sale;
    },
    /** Las colas de los líderes de acá y de allá. */
    colas(c: unknown): unknown {
      if (!Array.isArray(c)) return c;
      local.colas = c as Cola[];
      return [...c, ...visibles().flatMap((x) => (x.colas ?? []).map((k) => ({ ...k, sid: `${x.m.id}:${k.sid}` })))];
    },
    /** El tablero de acá con el de cada otra máquina; con una caída, sus items no aparecen y `caidas` trae su nombre. */
    tablero(local: unknown): unknown {
      if (!esObjeto(local) || local.version !== 1) return local;
      const caidas = [...otras.values()].filter((x) => !visible(x)).map((x) => x.m.nombre);
      return juntarTableros(local as TableroCrudo, tablerosVisibles(), caidas);
    },
    /** El número del botón del pie con lo que espera de allá. */
    esperan: (local: number | null): number | null => esperanJuntas(local, tablerosVisibles()),
    /** Lo último de acá, para volver a juntar cuando cambia algo de allá (null: nadie lo pidió todavía). */
    ultimo: <K extends "sl" | "comp" | "colas">(k: K) => local[k],

    /**
     * Un pedido de un canal que va a la máquina de la fila. Si es de acá, null (lo contesta acá).
     * Si es de allá: con el mismo build va a su motor con los ids de allá (y lo que devuelve, con el prefijo); con otro
     * build sólo pasan las lecturas; caída, falla. Nunca se hace acá lo que se pidió para allá.
     * `hacerLocal` es para lo que mezcla filas de las dos (`ramas:brief`): lo de acá, con los argumentos que se le den.
     */
    enrutar(canal: string, args: unknown[], vista: string, hacerLocal?: (args: unknown[]) => Promise<unknown>): Promise<unknown> | null {
      if (canal === "lider:mirar") {
        // Mirar uno de acá (o ninguno) suelta el de allá de esta vista.
        const q = deQuien(args);
        if (!q) return mirando.has(vista) ? (void mirar(vista, null, null), null) : null;
        return mirar(vista, q.x.m.id, q.id);
      }
      if (canal === "ramas:brief") return briefs(args, hacerLocal);
      const d = POR_SELECTOR.has(canal) ? porSelector(canal, args) : porId(canal, args);
      if (!d) return null;
      return pasar(d.x, canal, d.args).then((r) => (canal === "lider:nuevo" && typeof r === "string" ? pre(d.x.m.id, r) : r));
    },
    /** Una vista que se fue: deja de mirar lo de allá. */
    soltar: (vista: string) => void (mirando.has(vista) && mirar(vista, null, null)),
    cerrar() {
      for (const x of otras.values()) x.c.cerrar();
    },
  };
}

export type Maquinas = NonNullable<ReturnType<typeof crearMaquinas>>;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function esSl(v: unknown): v is Sl {
  const l = (v as Sl | null)?.lideres;
  return esObjeto(v) && esObjeto(l) && Array.isArray(l.lideres);
}
