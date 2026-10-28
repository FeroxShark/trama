// Los avisos de los workers de `pa`: cuando uno termina, falla o se cuelga se entera solo el líder que lo lanzó (un mensaje
// corto por la cola de electron/cola.ts) y, si corresponde, el dueño (notificación y barra). Se deriva de lo que ya llega:
// cada lista de `pa --hilos` (los cambios de estado de un worker vivo) y cada línea de `eventos.jsonl` (`inicio`, `fin` con su
// `rc`). Sin Electron, sin disco ni reloj propio: lo de afuera (leer el `.err`, los cupos, entregar) se inyecta, y lo prueba
// tests/avisos-worker.test.ts con workers falsos.

/** Lo que se usa de una fila de `pa --hilos`. */
export type FilaWorker = {
  id: string;
  proyecto: string;
  estado: string;
  en_cola?: boolean;
  tarea?: string | null;
  modelo?: string | null;
  jefe_id?: string | null;
  jefe?: string | null;
  resultado?: string | null;
  /** Lo frenó a propósito `pa --parar` (lo pone el main): no es un fallo. */
  frenado_en?: number | null;
  sin_arrancar?: boolean;
};

/** Una línea de `eventos.jsonl` (lo que importa acá). */
export type EventoWorker = { tipo: string; id: string; rc?: number };

export type TipoAviso = "fin" | "falla" | "cupo" | "colgado" | "tanda";

/** Lo que se avisa: va al renderer (que lo escribe en el idioma de la app) y, para el líder, a `textoParaLider`. */
export type AvisoWorker = {
  tipo: TipoAviso;
  /** `<id>:<tipo>`: una sola vez por worker y tipo. */
  clave: string;
  id: string;
  proyecto: string;
  /** La tarea en pocas palabras. */
  tarea: string;
  modelo: string;
  jefe_id: string | null;
  jefe: string | null;
  /** En una línea; vacío cuando terminó bien. */
  motivo: string;
  /** `fin`: terminó pidiendo una decisión. */
  decision?: boolean;
  /** `cupo`: el proveedor y cuándo vuelve (epoch s; `null`: no se sabe). */
  proveedor?: string;
  vuelve?: number | null;
  /** `falla`: murió en la cola sin arrancar; `rc`: con qué código salió `pa`, si lo dijo. */
  sinArrancar?: boolean;
  rc?: number;
  /** `colgado`: minutos sin actividad. */
  minutos?: number;
  /** `tanda`: cuántos eran y cuántos fallaron. */
  n?: number;
  fallas?: number;
  /** epoch ms */
  ts: number;
};

/** Pa da por colgado a un worker sin latido hace esto (motor/bin/pa, `hechos_de`). */
export const COLGADO_PA_MS = 10 * 60_000;
/** Sin eventos y sin nada en vuelo durante esto cuenta como falla. */
export const COLGADO_MS = 15 * 60_000;
/** Cada cuánto se mira si alguno cruzó el umbral. */
export const REVISAR_MS = 60_000;
const MAX_AVISADOS = 2000;

const VIVOS = new Set(["trabajando", "colgado"]);
export const vivo = (h: Pick<FilaWorker, "estado" | "en_cola">) => VIVOS.has(h.estado) || h.en_cola === true;
/** Terminó él solo (con resultado): lo demás que no es vivo ya lo movió una persona (integrar, archivar…) o murió. */
const TERMINADOS = new Set(["listo", "decision", "entregado"]);

const ERROR_CUPO = /RESOURCE_EXHAUSTED|Individual quota reached|quota|rate.?limit|usage limit|hit your limit|session limit|weekly limit|Too Many Requests|FreeUsageLimit|límite de uso|(^|[^0-9])429([^0-9]|$)/i;

/** ¿El texto es de un corte por cupo (429, quota, límite de uso)? */
export const esDeCupo = (texto: string) => ERROR_CUPO.test(texto);

export type Proveedor = { id: "claude" | "google" | "chatgpt" | "opencode" | "otro"; nombre: string };

/** De quién es el modelo con el que corría el worker. */
export function proveedorDe(modelo: string | null | undefined): Proveedor {
  const m = (modelo ?? "").toLowerCase();
  if (m.startsWith("claude")) return { id: "claude", nombre: "Claude" };
  if (m.startsWith("gemini") || m.startsWith("agy:")) return { id: "google", nombre: "Google" };
  if (m.startsWith("codex:") || m.startsWith("gpt")) return { id: "chatgpt", nombre: "ChatGPT" };
  if (m.startsWith("opencode:") || m.startsWith("dsh:")) return { id: "opencode", nombre: "OpenCode" };
  return { id: "otro", nombre: modelo?.trim() || "?" };
}

/** Lo que se sabe de los cupos (la forma de `CuposLeidos`, electron/cupos.ts, sin importarlo). */
export type CuposMin = {
  claude?: { cincoH: number; sieteD: number; reseteaCincoH?: number; reseteaSieteD?: number };
  suscripciones: {
    proveedor?: string;
    agotado?: number;
    ventanas?: { pct: number | null; vuelve: number | null; deshabilitada?: boolean }[];
    grupos?: { agotado?: number; ventanas: { pct: number | null; vuelve: number | null; deshabilitada?: boolean }[] }[];
  }[];
};

/** Cuándo vuelve el cupo de un proveedor (epoch s), o `null` si no se sabe. Lo primero que vuelve entre lo agotado. */
export function vuelveDe(cupos: CuposMin | null | undefined, proveedor: Proveedor["id"], ahoraS: number): number | null {
  if (!cupos) return null;
  const hs: number[] = [];
  if (proveedor === "claude" && cupos.claude) {
    const c = cupos.claude;
    if (c.cincoH >= 100 && c.reseteaCincoH) hs.push(Math.round(c.reseteaCincoH / 1000));
    if (c.sieteD >= 100 && c.reseteaSieteD) hs.push(Math.round(c.reseteaSieteD / 1000));
  }
  const llenas = (vs: { pct: number | null; vuelve: number | null; deshabilitada?: boolean }[] = []) =>
    vs.filter((v) => !v.deshabilitada && v.pct !== null && v.pct >= 100 && v.vuelve !== null).map((v) => v.vuelve as number);
  for (const s of cupos.suscripciones) {
    if (s.proveedor !== proveedor) continue;
    if (s.agotado) hs.push(s.agotado);
    hs.push(...llenas(s.ventanas));
    for (const g of s.grupos ?? []) {
      if (g.agotado) hs.push(g.agotado);
      hs.push(...llenas(g.ventanas));
    }
  }
  const futuras = hs.filter((h) => h > ahoraS);
  return futuras.length ? Math.min(...futuras) : null;
}

const una = (s: string, tope: number) => {
  const l = s.replace(/\s+/g, " ").trim();
  return l.length > tope ? `${l.slice(0, tope - 1)}…` : l;
};

/** La tarea en pocas palabras: su primera línea con contenido, sin el "Objetivo:" de los briefs. */
export function tareaCorta(tarea: string | null | undefined, tope = 60): string {
  for (const linea of (tarea ?? "").split("\n")) {
    const l = linea.replace(/^\s*(\[[^\]]*\]\s*)?(objetivo|goal)\s*:\s*/i, "").trim();
    if (l) return una(l, tope);
  }
  return "";
}

/**
 * Por qué falló, en una línea, de lo que dejó (`texto`: el final de su `.err` y el resultado). Con un corte por cupo, el
 * renglón que lo dice; si no, el último renglón con algo. Sin nada: el proceso se cortó sin decir por qué.
 */
export function motivoDe(texto: string, tope = 140): string {
  const lineas = texto.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean);
  const cupo = lineas.find((l) => esDeCupo(l));
  const l = cupo ?? lineas[lineas.length - 1];
  return l ? una(l, tope) : "";
}

export type Deps = {
  /** El texto crudo para entender por qué murió (el final de su `.err` y su resultado); sin acceso, `""`. */
  leerRastro: (h: FilaWorker) => Promise<string>;
  /** ¿Sigue corriendo (su `.running` con el pid vivo, o su `.json` vacío recién creado)? Sin dato: no. */
  procesoVivo?: (h: FilaWorker) => Promise<boolean>;
  cupos?: () => CuposMin | null;
  emitir: (a: AvisoWorker) => void;
  ahora?: () => number;
};

type Tanda = { ids: Set<string>; fallas: number };

export function crearAvisosWorker(d: Deps) {
  const ahora = d.ahora ?? Date.now;
  /** Estado de cada worker en la lectura anterior. */
  const antes = new Map<string, FilaWorker>();
  let base = false;
  /** Los que arrancaron o terminaron desde que corre esto (rápido: pueden no haberse visto vivos en la lista). */
  const iniciados = new Set<string>();
  const rcs = new Map<string, number>();
  /** id → desde cuándo (ms) se lo ve colgado, y los que ya se avisaron. */
  const colgadoDesde = new Map<string, number>();
  const avisados = new Set<string>();
  const tandas = new Map<string, Tanda>();
  /** Las últimas filas vistas de lo colgado (el aviso las necesita al cruzar el umbral). */
  const filas = new Map<string, FilaWorker>();
  let pendiente: Promise<unknown> = Promise.resolve();

  function emitir(a: Omit<AvisoWorker, "clave" | "ts">) {
    const clave = `${a.id}:${a.tipo}`;
    if (avisados.has(clave)) return;
    avisados.add(clave);
    if (avisados.size > MAX_AVISADOS) for (const k of [...avisados].slice(0, MAX_AVISADOS / 2)) avisados.delete(k);
    d.emitir({ ...a, clave, ts: ahora() });
  }

  const base_ = (h: FilaWorker) => ({
    id: h.id,
    proyecto: h.proyecto,
    tarea: tareaCorta(h.tarea),
    modelo: h.modelo ?? "",
    jefe_id: h.jefe_id || null,
    jefe: h.jefe ?? null,
  });

  async function falla(h: FilaWorker, rc: number | undefined) {
    const rastro = await d.leerRastro(h).catch(() => "");
    const texto = `${rastro}\n${h.resultado ?? ""}`;
    const detalle = motivoDe(texto);
    if (esDeCupo(texto)) {
      const p = proveedorDe(h.modelo);
      emitir({ ...base_(h), tipo: "cupo", motivo: detalle, proveedor: p.nombre, vuelve: vuelveDe(d.cupos?.(), p.id, Math.floor(ahora() / 1000)) });
    } else {
      emitir({ ...base_(h), tipo: "falla", motivo: detalle, ...(h.sin_arrancar ? { sinArrancar: true } : {}), ...(rc !== undefined && rc !== 0 ? { rc } : {}) });
    }
  }

  async function terminoVivo(h: FilaWorker): Promise<boolean> {
    const rc = rcs.get(h.id);
    if (h.estado === "murio") {
      if (h.frenado_en) return false;
      await falla(h, rc);
      return true;
    }
    if (TERMINADOS.has(h.estado)) {
      if (rc !== undefined && rc !== 0) {
        await falla(h, rc);
        return true;
      }
      emitir({ ...base_(h), tipo: "fin", motivo: "", ...(h.estado === "decision" ? { decision: true } : {}) });
    }
    return false;
  }

  function cerrarTanda(clave: string) {
    const t = tandas.get(clave);
    if (!t) return;
    tandas.delete(clave);
    if (t.ids.size < 2) return;
    const primero = [...t.ids][0];
    const h = filas.get(primero);
    emitir({
      tipo: "tanda",
      id: [...t.ids].sort()[0],
      proyecto: h?.proyecto ?? "",
      tarea: "",
      modelo: "",
      jefe_id: clave === "" ? null : clave,
      jefe: h?.jefe ?? null,
      motivo: "",
      n: t.ids.size,
      fallas: t.fallas,
    });
  }

  async function procesar(lista: readonly FilaWorker[]) {
    const vistos = new Set<string>();
    const vivosPor = new Map<string, number>();
    for (const h of lista) {
      vistos.add(h.id);
      const prev = antes.get(h.id);
      const clave = h.jefe_id ?? "";
      if (vivo(h)) {
        // Volvió a andar (un `--seguir`, un relanzo): lo que le pase de nuevo se avisa.
        avisados.delete(`${h.id}:terminado`);
        if (h.estado !== "colgado") avisados.delete(`${h.id}:colgado`);
        filas.set(h.id, h);
        const t = tandas.get(clave) ?? { ids: new Set(), fallas: 0 };
        t.ids.add(h.id);
        tandas.set(clave, t);
        vivosPor.set(clave, (vivosPor.get(clave) ?? 0) + 1);
        if (h.estado === "colgado") {
          if (!colgadoDesde.has(h.id)) colgadoDesde.set(h.id, ahora());
        } else colgadoDesde.delete(h.id);
      } else {
        colgadoDesde.delete(h.id);
        // Terminó desde la lectura anterior, o nació y terminó entre dos (un fallo al arrancar tarda segundos; la lista, ~11 s).
        const visto = prev ? vivo(prev) : base && iniciados.has(h.id);
        if (visto && !avisados.has(`${h.id}:terminado`)) {
          // Lo lista muerto pero sigue corriendo (su `.running` o su pid viven): no es un fin ni una falla. No se toca `antes`,
          // así la próxima lectura lo mira otra vez desde lo último que se vio vivo.
          if (await d.procesoVivo?.(h)) {
            vivosPor.set(clave, (vivosPor.get(clave) ?? 0) + 1);
            continue;
          }
          avisados.add(`${h.id}:terminado`);
          const huboFalla = await terminoVivo(h);
          rcs.delete(h.id);
          const t = tandas.get(clave) ?? { ids: new Set<string>(), fallas: 0 };
          t.ids.add(h.id);
          if (huboFalla) t.fallas++;
          tandas.set(clave, t);
        }
      }
      antes.set(h.id, h);
    }
    for (const id of [...antes.keys()]) if (!vistos.has(id)) (antes.delete(id), colgadoDesde.delete(id), filas.delete(id));
    // Una tanda termina cuando ya no le queda ningún worker vivo (y vio terminar alguno).
    if (base) for (const clave of [...tandas.keys()]) if (!vivosPor.get(clave)) cerrarTanda(clave);
    base = true;
  }

  return {
    /** Una lectura nueva de `pa --hilos`. Devuelve cuando terminó de avisar (los tests la esperan). */
    hilos(lista: readonly FilaWorker[]): Promise<void> {
      // De a una: el motivo se lee del disco y dos lecturas seguidas no tienen que cruzarse.
      pendiente = pendiente.then(() => procesar(lista)).catch(() => {});
      return pendiente as Promise<void>;
    },
    /** Líneas nuevas de `eventos.jsonl`. */
    eventos(es: readonly EventoWorker[]) {
      for (const e of es) {
        if (e.tipo === "inicio") iniciados.add(e.id);
        else if (e.tipo === "fin") {
          iniciados.add(e.id);
          if (typeof e.rc === "number") rcs.set(e.id, e.rc);
        }
        colgadoDesde.delete(e.id);
      }
    },
    /** Mira si algún colgado ya cruzó el umbral. Lo llama un reloj (`REVISAR_MS`) mientras haya workers vivos. */
    revisar(): void {
      const t = ahora();
      for (const [id, desde] of colgadoDesde) {
        // `pa` lo da por colgado tras 10 min sin latido: sin eventos desde entonces suma lo que lleva así.
        const sin = COLGADO_PA_MS + (t - desde);
        if (sin < COLGADO_MS) continue;
        const h = filas.get(id);
        if (!h) continue;
        emitir({ ...base_(h), tipo: "colgado", motivo: "", minutos: Math.floor(sin / 60_000) });
      }
    },
    /** ¿Hay algo que vigilar? (el reloj corre sólo entonces). */
    vigilando: () => colgadoDesde.size > 0,
  };
}

export type AvisosWorker = ReturnType<typeof crearAvisosWorker>;

const hora = (epochS: number, ahoraMs: number) => {
  const d = new Date(epochS * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return epochS * 1000 - ahoraMs > 12 * 3600_000 ? `${["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][d.getDay()]} ${hm}` : hm;
};

/**
 * El mensaje corto para el líder que lanzó al worker. Va en español y en un solo lugar (es una instrucción para un modelo, no
 * texto de la interfaz). Vacío para lo que al líder no le toca (la tanda es del dueño).
 */
export function textoParaLider(a: AvisoWorker): string {
  if (a.tipo === "tanda") return "";
  const w = `Worker «${a.tarea || a.id}»`;
  let r: string;
  if (a.tipo === "fin") r = `${w} terminó${a.decision ? " pidiendo una decisión" : ""}.`;
  else if (a.tipo === "colgado") r = `${w} falló: parece colgado, sin actividad hace ${a.minutos ?? 15} min.`;
  else if (a.tipo === "cupo") {
    const vuelve = a.vuelve ? `vuelve a las ${hora(a.vuelve, a.ts)}` : "no sé cuándo vuelve";
    r = `${w} falló: ${a.proveedor ?? "el proveedor"} sin cupo (${vuelve}).${a.motivo ? ` ${a.motivo}` : ""}`;
  } else {
    const por = a.motivo || (a.sinArrancar ? "murió en la cola sin arrancar" : a.rc ? `salió con código ${a.rc}` : "el proceso se cortó sin dejar mensaje");
    r = `${w} falló: ${por}.`;
  }
  return `[Aviso automático de Trama] ${r} Id: ${a.id}. Revisalo con \`pa --hilo ${a.id}\`.`;
}
