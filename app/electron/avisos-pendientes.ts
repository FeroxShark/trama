// La cola persistente de los avisos de workers para el líder que los lanzó (por `jefe_id`). Antes el aviso iba directo a la cola de
// mensajes (cola.ts) sólo si el líder tenía proceso en ese instante y, si no, se perdía en silencio (sin proceso tras reiniciar el líder
// o Trama; un líder ocioso con un simple "terminó"); y lo que esperaba el cierre de una tanda vivía sólo en memoria. Ahora:
//  - cada aviso de un worker se anota en disco al detectarlo (`registrar`) y queda `retenido` hasta que su tanda se cierra o, si
//    Trama se reinició en el medio, hasta que el líder no tenga más workers vivos (`soltarHuerfanos`);
//  - el que ya se le puede decir (`liberar`) queda `pendiente`; `entregar` lo encola SÓLO si el líder tiene proceso. Sin proceso espera
//    (y se anota que estuvo ausente): cuando el líder vuelve, un único aviso de resumen con todo lo que terminó mientras no estaba;
//  - un `fin` (o una decisión) para un líder ocioso con proceso espera `GRUPO_MS` (los que terminen en ese rato salen juntos) y
//    entonces lo despierta con un turno nuevo, sin esperar a que el usuario escriba; una falla, un corte por cupo o un colgado
//    salen ya, aunque esté ocioso (nadie más se entera). Si el líder empieza un turno antes, sale a mitad de ese turno;
//  - es `entregado` sólo cuando la cola confirma que se mandó (`salida`); si no salió vuelve a pendiente, y al arrancar lo `encolado`
//    que no está en la cola vuelve a pendiente (`reconciliar`);
//  - `descubrir` rescata a los workers de un líder que terminaron mientras Trama estaba apagada (nadie los vio terminar).
// Sin Electron, sin disco propio ni reloj: lo de afuera se inyecta. Lo prueba tests/avisos-pendientes.test.ts.

import { motivoDe, tareaCorta, textoParaLider, vivo, type AvisoWorker, type FilaWorker } from "./avisos-worker.ts";

/** Una fila de `pa --hilos` con lo que hace falta para saber cuándo terminó. */
export type FilaHilo = FilaWorker & { inicio?: number | null; duracion_s?: number | null; archivado?: boolean | null };

export type EstadoEntrada = "retenido" | "pendiente" | "encolado" | "entregado" | "descartado";

export type Entrada = {
  /** `<worker>:<tipo>`. */
  clave: string;
  jefe_id: string;
  worker: string;
  aviso: AvisoWorker;
  estado: EstadoEntrada;
  /** epoch ms de cuando se anotó. */
  ts: number;
  /** Se quiso entregar y el líder no tenía proceso (o la entrega se perdió): sale como resumen, aunque esté ocioso. */
  ausente?: true;
};

/** Lo que se le encola al líder (la forma de `Encolado` de cola.ts, sin id). */
export type ParaCola = { texto: string; modelo: string; effort: string; aviso: true; avisos: string[] };

export type Deps = {
  /** Lo que se guarda en disco; falla en silencio (se reintenta en el próximo cambio). */
  guardar: (json: string) => Promise<void> | void;
  /** El modelo y el esfuerzo del líder de la app con proceso, o `null` si no tiene (no se lo despierta por un aviso). */
  proceso: (sid: string) => { modelo: string; effort: string } | null;
  /** ¿Está a mitad de un turno, y acepta mensajes ahí? */
  puedeEnTurno: (sid: string) => boolean;
  encolar: (sid: string, x: ParaCola) => void;
  /** La última lista buena de `pa --hilos`. */
  filas: () => readonly FilaHilo[];
  /** `descubrir`: ¿un worker listado `murio` sigue corriendo? Sin esto, no. */
  procesoVivo?: (h: FilaWorker) => Promise<boolean>;
  ahora?: () => number;
  /** Pone `f` a correr dentro de `ms`; devuelve cómo cancelarlo. Por defecto `setTimeout` (sin atar el proceso). */
  temporizar?: (f: () => void, ms: number) => () => void;
};

/** Cuánto se espera, con el líder ocioso, antes de despertarlo por workers que terminaron (los que terminen en ese rato salen juntos). */
export const GRUPO_MS = 20_000;

/** Lo ya entregado se guarda este tiempo (evita repetir y deja descubrir lo nuevo). */
const GUARDAR_ENTREGADOS_MS = 3 * 24 * 3600_000;
/** Un pendiente que nadie recogió en tanto tiempo ya no importa (el worker ya se limpió hace mucho). */
const VENCE_PENDIENTE_MS = 14 * 24 * 3600_000;
const MAX_ENTRADAS = 1000;

const TERMINADOS = new Set(["listo", "decision", "entregado"]);
/** Estados que dicen que alguien ya se ocupó del worker (integrarlo, archivarlo, descartarlo): su aviso no tiene sentido. */
const CERRADOS = new Set(["archivado", "integrado", "descartado", "revertido"]);

const esEntrada = (x: unknown): x is Entrada => {
  const e = x as Entrada;
  return !!e && typeof e.clave === "string" && typeof e.jefe_id === "string" && typeof e.worker === "string" && typeof e.ts === "number" && !!e.aviso && typeof e.estado === "string";
};

export function crearAvisosPendientes(d: Deps) {
  const ahora = d.ahora ?? Date.now;
  let entradas: Entrada[] = [];
  /** epoch s de la última lista que se miró: los workers que terminaron después y nadie anotó se descubren. `null`: primera vez. */
  let ultimaVez: number | null = null;
  const temporizar =
    d.temporizar ??
    ((f: () => void, ms: number) => {
      const r = setTimeout(f, ms);
      r.unref?.();
      return () => clearTimeout(r);
    });
  /** El rato de agrupación de cada líder ocioso con avisos esperando. */
  const relojes = new Map<string, () => void>();
  const soltarReloj = (jefe: string) => {
    relojes.get(jefe)?.();
    relojes.delete(jefe);
  };

  const guardar = () => {
    const t = ahora();
    entradas = entradas.filter((e) => (e.estado === "entregado" || e.estado === "descartado" ? t - e.ts < GUARDAR_ENTREGADOS_MS : t - e.ts < VENCE_PENDIENTE_MS));
    if (entradas.length > MAX_ENTRADAS) entradas = entradas.slice(-MAX_ENTRADAS);
    try {
      void Promise.resolve(d.guardar(JSON.stringify({ version: 1, ultimaVez, entradas }))).catch(() => {});
    } catch {
      // Se reintenta con el próximo cambio.
    }
  };

  const de = (clave: string, ...estados: EstadoEntrada[]) => entradas.find((e) => e.clave === clave && (!estados.length || estados.includes(e.estado)));
  const cambiar = (claves: readonly string[], desde: EstadoEntrada, hasta: EstadoEntrada, marca?: { ausente: true }) => {
    let cambio = false;
    for (const e of entradas)
      if (claves.includes(e.clave) && e.estado === desde) {
        e.estado = hasta;
        if (marca) e.ausente = true;
        cambio = true;
      }
    return cambio;
  };

  /** ¿Ya no tiene sentido decírselo? El worker lo cerró alguien, o volvió a andar, o el colgado ya se movió. */
  function revisado(e: Entrada): boolean {
    const lista = d.filas();
    if (!lista.length) return false;
    const f = lista.find((h) => h.id === e.worker);
    // Si no está en la lista no se sabe (puede ser una lectura parcial): se queda hasta que venza.
    if (!f) return false;
    if (f.archivado || CERRADOS.has(f.estado)) return true;
    if (e.aviso.tipo === "colgado") return f.estado !== "colgado";
    return vivo(f);
  }

  /** Un aviso de un worker recién detectado: se anota (retenido hasta que se le pueda decir al líder). */
  function registrar(a: AvisoWorker) {
    const jefe = a.jefe_id ?? "";
    if (!jefe || a.tipo === "tanda") return;
    const previa = de(a.clave);
    if (previa && previa.ts >= a.ts) return;
    // El mismo worker y tipo otra vez (se relanzó con `--seguir` y volvió a terminar): reemplaza al viejo.
    entradas = entradas.filter((e) => e.clave !== a.clave);
    entradas.push({ clave: a.clave, jefe_id: jefe, worker: a.id, aviso: a, estado: "retenido", ts: a.ts });
    guardar();
  }

  /** Ya se le puede decir al líder: el aviso suelto o las líneas de su tanda. */
  function liberar(a: AvisoWorker) {
    const claves = a.tipo === "tanda" ? (a.lineas ?? []).map((l) => l.clave) : [a.clave];
    if (cambiar(claves, "retenido", "pendiente")) guardar();
  }

  const api = {
    registrar,
    liberar,
    /** Lo que quedó guardado de la vez anterior. Lo que no se entiende se ignora. */
    cargar(json: string | null) {
      try {
        const j = JSON.parse(json ?? "");
        if (j?.version !== 1) return;
        if (typeof j.ultimaVez === "number") ultimaVez = j.ultimaVez;
        if (Array.isArray(j.entradas)) entradas = j.entradas.filter(esEntrada);
      } catch {
        // Sin archivo, o roto: nada pendiente.
      }
    },

    /**
     * Lo retenido de un líder que ya no tiene workers vivos y cuya tanda no se cerró (Trama se reinició en el medio): se libera.
     * En la marcha normal la tanda se cierra sola y esto no encuentra nada.
     */
    soltarHuerfanos() {
      const conVivos = new Set(d.filas().filter(vivo).map((h) => h.jefe_id ?? ""));
      let cambio = false;
      for (const e of entradas)
        if (e.estado === "retenido" && !conVivos.has(e.jefe_id)) {
          e.estado = "pendiente";
          cambio = true;
        }
      if (cambio) guardar();
    },

    /** Al arrancar, con la cola de mensajes ya leída: lo `encolado` que no está en ella se perdió a mitad de camino y se vuelve a decir. */
    reconciliar(clavesEnCola: ReadonlySet<string>) {
      let cambio = false;
      for (const e of entradas)
        if (e.estado === "encolado" && !clavesEnCola.has(e.clave)) {
          e.estado = "pendiente";
          e.ausente = true;
          cambio = true;
        }
      if (cambio) guardar();
    },

    /** La cola de mensajes dice qué pasó con lo que llevaba (`Deps.salida` de cola.ts). */
    salida(_sid: string, claves: readonly string[], que: "entregado" | "quitado" | "vaciado") {
      const cambio =
        que === "entregado" ? cambiar(claves, "encolado", "entregado") : que === "quitado" ? cambiar(claves, "encolado", "descartado") : cambiar(claves, "encolado", "pendiente", { ausente: true });
      if (cambio) guardar();
    },

    /**
     * Mira (sin esperar) a qué líderes se les puede decir algo: uno, o todos los que tienen pendientes. Sin proceso del líder se
     * espera (y se anota la ausencia); con proceso a mitad de un turno sale todo junto; ocioso, sólo si hay una falla (o si estuvo
     * ausente: es el resumen al retomarlo), y un simple "terminó" espera `GRUPO_MS` y lo despierta (`ya`: ese rato se cumplió).
     */
    entregar(sid?: string, ya = false) {
      const jefes = sid !== undefined ? [sid] : [...new Set(entradas.filter((e) => e.estado === "pendiente").map((e) => e.jefe_id))];
      let cambio = false;
      for (const jefe of jefes) {
        const todos = entradas.filter((e) => e.jefe_id === jefe && e.estado === "pendiente");
        if (!todos.length) {
          soltarReloj(jefe);
          continue;
        }
        for (const e of todos)
          if (revisado(e)) {
            e.estado = "descartado";
            cambio = true;
          }
        const pend = todos.filter((e) => e.estado === "pendiente");
        if (!pend.length) {
          soltarReloj(jefe);
          continue;
        }
        const proc = d.proceso(jefe);
        if (!proc) {
          soltarReloj(jefe);
          for (const e of pend) if (!e.ausente) ((e.ausente = true), (cambio = true));
          continue;
        }
        const retomado = pend.some((e) => e.ausente);
        const urgente = pend.some((e) => e.aviso.tipo !== "fin");
        if (!retomado && !urgente && !ya && !d.puedeEnTurno(jefe)) {
          // Ocioso: se junta lo que termine en este rato y después se lo despierta con todo.
          if (!relojes.has(jefe)) relojes.set(jefe, temporizar(() => (relojes.delete(jefe), api.entregar(jefe, true)), GRUPO_MS));
          continue;
        }
        soltarReloj(jefe);
        // El último aviso de cada worker: un cupo y después su fin dicen lo mismo con lo último.
        const ultimos = new Map<string, Entrada>();
        for (const e of [...pend].sort((a, b) => a.ts - b.ts)) ultimos.set(e.worker, e);
        const lineas = [...ultimos.values()].map((e) => e.aviso);
        const base = lineas[0];
        const aviso: AvisoWorker = {
          tipo: "tanda",
          clave: `${jefe}:tanda`,
          id: base.id,
          proyecto: base.proyecto,
          tarea: "",
          modelo: "",
          jefe_id: jefe,
          jefe: base.jefe,
          motivo: "",
          n: lineas.length,
          fallas: lineas.filter((l) => l.tipo !== "fin").length,
          lineas,
          ...(retomado ? { retomado: true } : {}),
          ts: ahora(),
        };
        const claves = pend.map((e) => e.clave);
        d.encolar(jefe, { texto: textoParaLider(aviso), modelo: proc.modelo, effort: proc.effort, aviso: true, avisos: claves });
        for (const e of pend) e.estado = "encolado";
        cambio = true;
      }
      if (cambio) guardar();
    },

    /**
     * Los workers de un líder que terminaron sin que nadie lo anotara (Trama apagada, o murieron entre dos lecturas sin evento): se
     * registran y se liberan. Compara cuándo terminaron contra la última lista que se miró. Va después de `avisosWorker.hilos`.
     */
    async descubrir(lista: readonly FilaHilo[]): Promise<void> {
      const t = Math.floor(ahora() / 1000);
      const desde = ultimaVez;
      ultimaVez = t;
      if (desde === null) return void guardar();
      for (const h of lista) {
        const jefe = h.jefe_id ?? "";
        const terminado = TERMINADOS.has(h.estado) || (h.estado === "murio" && !h.frenado_en);
        if (!jefe || !terminado || h.archivado || h.inicio == null || h.duracion_s == null) continue;
        const fin = h.inicio + h.duracion_s;
        if (fin <= desde - 5) continue;
        if (entradas.some((e) => e.worker === h.id && e.ts >= fin * 1000)) continue;
        if (h.estado === "murio" && (await d.procesoVivo?.(h).catch(() => false))) continue;
        const detalle = motivoDe(h.resultado ?? "");
        const a: AvisoWorker = {
          tipo: h.estado === "murio" ? "falla" : "fin",
          clave: `${h.id}:${h.estado === "murio" ? "falla" : "fin"}`,
          id: h.id,
          proyecto: h.proyecto,
          tarea: tareaCorta(h.tarea),
          modelo: h.modelo ?? "",
          jefe_id: jefe,
          jefe: h.jefe ?? null,
          motivo: h.estado === "murio" ? detalle : "",
          ...(h.estado === "decision" ? { decision: true } : {}),
          ...(h.sin_arrancar ? { sinArrancar: true } : {}),
          ts: ahora(),
        };
        registrar(a);
        liberar(a);
      }
      guardar();
    },

    /** Lo que hay anotado de un líder (para probar y para ver). */
    entradas: (sid?: string): readonly Entrada[] => entradas.filter((e) => sid === undefined || e.jefe_id === sid),
    /** Las claves de los avisos que lleva lo encolado en la cola de mensajes (para `reconciliar`). */
    clavesDe: (colas: readonly { lista: readonly { avisos?: readonly string[] }[] }[]): Set<string> => new Set(colas.flatMap((c) => c.lista.flatMap((x) => x.avisos ?? []))),
  };
  return api;
}

export type AvisosPendientes = ReturnType<typeof crearAvisosPendientes>;
