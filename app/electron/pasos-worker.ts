// Los pasos de un worker a la vista (la vista de worker, ventana y celular): quién mira qué worker, un
// armador (electron/pasos.ts) por worker mirado y los cambios empujados de a lotes. La sesión del worker se
// encuentra por `$PA_STATE/<proyecto>/<id>.sid` y su transcript en `projects/` (helpers de consumo.ts).
//
// Sólo trabaja mientras alguien mira (`mirar` … `soltar`): sin nadie, ni un watch ni un reloj ni el armador
// en memoria. Un worker sin transcript todavía (recién lanzado) se reintenta cuando se mueve algo (`faltantes`,
// lo llama el núcleo con cada statusline), nunca con un reloj. Sin Electron: lo prueba `tests/pasos-worker.test.ts`.
//
// El protocolo: `mirar` contesta la vista entera (`gen`, `v`); después llegan `CambioPasos` ("pasos:cambio")
// con los pasos nuevos o tocados desde la revisión `desde`. Quien tenga `gen` distinto o `v < desde` (se perdió
// uno) vuelve a pedir `mirar`. Un solo aviso por lote aunque lleguen muchas líneas (DEBOUNCE_MS).
//
// Los workers que no son de Claude (agy, codex, opencode, dsh) no tienen transcript: su hilo sale del `<id>.stream.jsonl`
// (`pa --hilo`, que la vista de siempre pide). Para que se actualice en vivo, `mirar` vigila ese archivo igual que el
// transcript (un watch de su carpeta, sin reloj) y, cuando le llega una línea ENTERA, avisa por `alStream` que el hilo
// de ese id cambió; el núcleo lo manda como "eventos:ids" y la vista relee. Una línea a medio escribir no avisa: se
// avisa cuando se completa (`ColaDeLineas`, la misma lectura incremental que el armador). Mirar no cambia lo que contesta.
//
// Un subagente de un líder (herramienta Agent de Claude Code) se mira igual, con el id `sub:<sid>:<agentId>`: su
// transcript está en `projects/<cwd>/<sid>/subagents/agent-<agentId>.jsonl` y se arma como subagente (sin nietos).
import { stat, readdir } from "node:fs/promises";
import path from "node:path";
import { ArmadorPasos, ColaDeLineas, encabezadoVacio, type CambioPasos, type VistaPasos } from "./pasos.ts";
import { sidDeWorker, transcriptDe } from "./consumo.ts";
import { mirarCarpeta, type Mirada } from "./mirar.ts";
import { silencio } from "./log.ts";

const ID = /^\d{8}-\d{6}-\d+$/;
/** `sub:<sid de la sesión>:<agentId>`: un subagente (los ids, como los valida electron/subagentes.ts). */
const SUB = /^sub:([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
/** Lo que se espera a que el transcript termine de escribirse; varias líneas seguidas, un solo aviso. */
export const DEBOUNCE_MS = 150;
/** Lo que se junta de un stream que crece antes de avisar (un solo aviso aunque lleguen muchas líneas: cada aviso es una relectura del hilo). */
export const STREAM_MS = 400;

type Mirado = {
  id: string;
  vistas: Set<string>;
  armador: ArmadorPasos | null;
  /** Hasta qué revisión se empujó. */
  empujado: number;
  watches: Map<string, Mirada>;
  reloj: NodeJS.Timeout | null;
  /** El stream de un worker que no es de Claude: lo que se leyó ya y su watch. */
  stream: { ruta: string; cola: ColaDeLineas; mirada: Mirada | null; reloj: NodeJS.Timeout | null } | null;
};

/** Lo que contesta `mirar` cuando no hay nada que ver (id inválido, o el worker todavía no tiene transcript). */
export const sinPasos = (id: string): VistaPasos => ({ id, hay: false, gen: 0, v: 0, omitidos: 0, encabezado: encabezadoVacio(), pasos: [] });

export function crearPasos(o: { proyectos: string; paState: string; alCambiar: (c: CambioPasos) => void; alStream?: (id: string) => void; espera?: number; esperaStream?: number }) {
  const espera = o.espera ?? DEBOUNCE_MS;
  const esperaStream = o.esperaStream ?? STREAM_MS;
  const mirados = new Map<string, Mirado>();
  /** Qué worker mira cada vista (la ventana, cada cliente por red): uno solo. */
  const dondeMira = new Map<string, string>();
  let cola: Promise<unknown> = Promise.resolve();

  const enFila = <T>(f: () => Promise<T>): Promise<T> => {
    const r = cola.then(f, f);
    cola = r.catch(silencio("pasos"));
    return r;
  };

  function cerrarStream(m: Mirado): void {
    const st = m.stream;
    if (!st) return;
    st.mirada?.cerrar();
    if (st.reloj) clearTimeout(st.reloj);
    m.stream = null;
  }

  function cerrar(m: Mirado): void {
    cerrarStream(m);
    for (const w of m.watches.values()) w.cerrar();
    m.watches.clear();
    if (m.reloj) clearTimeout(m.reloj);
    m.reloj = null;
    mirados.delete(m.id);
  }

  function sucio(m: Mirado): void {
    m.reloj ??= setTimeout(() => {
      m.reloj = null;
      void enFila(() => actualizar(m));
    }, espera);
  }

  /** `<paState>/<proyecto>/<id>.stream.jsonl`, o `null` si el worker no tiene stream. */
  async function rutaStream(id: string): Promise<string | null> {
    for (const c of await readdir(o.paState).catch(() => [] as string[])) {
      const f = path.join(o.paState, c, `${id}.stream.jsonl`);
      if (await stat(f).then((x) => x.isFile(), () => false)) return f;
    }
    return null;
  }

  /** Lo nuevo del stream: `true` si llegó alguna línea entera (o el archivo se rehízo). */
  async function leerStream(m: Mirado): Promise<boolean> {
    const st = m.stream;
    if (!st) return false;
    let reinicio = false;
    const leyo = await st.cola.avanzar(st.ruta, () => {}, () => (reinicio = true));
    return leyo || reinicio;
  }

  /** Vigila el stream del worker (si lo hay y todavía no se lo vigila). Lo que ya tiene el archivo lo lee la vista al abrir: sólo se avisa lo que llegue después. */
  async function vigilarStream(m: Mirado): Promise<void> {
    if (m.stream || m.armador || SUB.test(m.id)) return;
    const ruta = await rutaStream(m.id);
    if (!ruta || mirados.get(m.id) !== m || m.stream) return;
    const st = { ruta, cola: new ColaDeLineas(), mirada: null as Mirada | null, reloj: null as NodeJS.Timeout | null };
    m.stream = st;
    await leerStream(m);
    const sucioStream = () => {
      st.reloj ??= setTimeout(() => {
        st.reloj = null;
        void enFila(async () => {
          if (mirados.get(m.id) !== m || m.stream !== st) return;
          if (await leerStream(m)) o.alStream?.(m.id);
        });
      }, esperaStream);
    };
    st.mirada = mirarCarpeta(
      path.dirname(ruta),
      (_ev, nombre) => {
        // En la carpeta del proyecto se mueven otros archivos del worker (statusline, .hilo…): sólo importa el stream.
        const n = nombre ? String(nombre) : "";
        if (n && n !== path.basename(ruta)) return;
        sucioStream();
      },
      { donde: "pasos-stream", alRearmar: sucioStream },
    );
  }

  /** Un watch por carpeta del transcript y de sus subagentes; la de subagentes puede no existir todavía: se reintenta en cada lectura. */
  function mirarCarpetas(m: Mirado): void {
    const a = m.armador;
    if (!a) return;
    // Un subagente no lanza otros: sólo su carpeta.
    const dirs = SUB.test(m.id) ? [path.dirname(a.ruta)] : [path.dirname(a.ruta), path.join(path.dirname(a.ruta), path.basename(a.ruta, ".jsonl"), "subagents")];
    for (const dir of dirs) {
      if (m.watches.has(dir)) continue;
      const principal = dir === dirs[0];
      const w = mirarCarpeta(
        dir,
        (_ev, nombre) => {
          // En la carpeta del proyecto hay otras sesiones: sólo importa la de este worker (y la aparición de su carpeta de subagentes).
          const n = nombre ? String(nombre) : "";
          if (principal && n && n !== path.basename(a.ruta) && n !== path.basename(a.ruta, ".jsonl")) return;
          sucio(m);
        },
        { donde: "pasos", alRearmar: () => sucio(m) },
      );
      if (w) m.watches.set(dir, w);
    }
  }

  async function actualizar(m: Mirado): Promise<void> {
    if (mirados.get(m.id) !== m || !m.armador) return;
    const cambio = await m.armador.leer();
    if (mirados.get(m.id) !== m) return;
    mirarCarpetas(m);
    if (!cambio) return;
    const c = m.armador.cambio(m.id, m.empujado);
    m.empujado = m.armador.v;
    o.alCambiar(c);
  }

  /** Busca el transcript del worker; `true` si lo encontró. */
  async function ubicar(m: Mirado): Promise<boolean> {
    if (m.armador) return true;
    const sub = SUB.exec(m.id);
    if (sub) {
      const sesion = await transcriptDe(o.proyectos, sub[1]);
      const ruta = sesion ? path.join(sesion.replace(/\.jsonl$/, ""), "subagents", `agent-${sub[2]}.jsonl`) : null;
      if (!ruta || !(await stat(ruta).then((x) => x.isFile(), () => false))) return false;
      m.armador = new ArmadorPasos(ruta, { subagente: true });
      return true;
    }
    const sid = await sidDeWorker(o.paState, m.id);
    const ruta = sid ? await transcriptDe(o.proyectos, sid) : null;
    if (!ruta) return false;
    m.armador = new ArmadorPasos(ruta, { carpetaSub: path.join(path.dirname(ruta), path.basename(ruta, ".jsonl"), "subagents") });
    return true;
  }

  /** La vista dejó de mirar (cerró la vista, o se fue el cliente). `salvo`: el worker que va a mirar ahora (no se cierra lo compartido). */
  function soltar(vista: string, salvo: string | null = null): void {
    const id = dondeMira.get(vista);
    if (!id || id === salvo) return;
    dondeMira.delete(vista);
    const m = mirados.get(id);
    if (!m) return;
    m.vistas.delete(vista);
    if (!m.vistas.size) cerrar(m);
  }

  return {
    /** Esta vista pasa a mirar este worker o subagente (suelta el que miraba) y contesta cómo está todo. */
    mirar(vista: string, idPedido: unknown): Promise<VistaPasos> {
      const id = typeof idPedido === "string" && (ID.test(idPedido) || SUB.test(idPedido)) ? idPedido : null;
      soltar(vista, id);
      if (!id) return Promise.resolve(sinPasos(String(idPedido ?? "").slice(0, 64)));
      dondeMira.set(vista, id);
      let m = mirados.get(id);
      if (!m) mirados.set(id, (m = { id, vistas: new Set(), armador: null, empujado: 0, watches: new Map(), reloj: null, stream: null }));
      m.vistas.add(vista);
      const mirado = m;
      return enFila(async () => {
        if (mirados.get(id) !== mirado) return sinPasos(id);
        if (!(await ubicar(mirado)) || !mirado.armador) {
          await vigilarStream(mirado);
          return sinPasos(id);
        }
        await mirado.armador.leer();
        mirarCarpetas(mirado);
        mirado.empujado = mirado.armador.v;
        return mirado.armador.vista(id);
      });
    },
    soltar: (vista: string) => soltar(vista),
    /** Algo se movió (un statusline): a los workers que esperan su transcript se los busca de nuevo. */
    faltantes(): void {
      const falta = [...mirados.values()].filter((m) => !m.armador);
      if (!falta.length) return;
      void enFila(async () => {
        for (const m of falta) {
          if (mirados.get(m.id) !== m) continue;
          if (!(await ubicar(m))) {
            // Todavía sin transcript: puede ser un worker de otro motor cuyo stream apareció después de abrirlo.
            await vigilarStream(m);
            continue;
          }
          cerrarStream(m);
          await m.armador!.leer();
          mirarCarpetas(m);
          // Quien miraba tenía la vista vacía (`gen` 0): lo que llega ahora trae otro `gen`, y vuelve a pedirla.
          o.alCambiar(m.armador!.cambio(m.id, 0));
          m.empujado = m.armador!.v;
        }
      });
    },
    /** A quién se mira ahora (para los tests y el log). */
    mirando: (): string[] => [...mirados.keys()],
  };
}
