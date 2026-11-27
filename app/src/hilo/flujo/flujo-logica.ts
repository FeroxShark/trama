// Lógica pura del mapa de flujo B3 (Líder → Subagentes/Orquestadores → Workers):
// arma nodos, estados semánticos, posiciones, curvas Bézier ancladas a puertos, cadena relacionada y encuadre.
// Sin React ni DOM: lo prueba `tests/flujo-logica.test.ts`.
import type { Estado, Hilo, Lider } from "../../datos/contrato";
import type { Subagente } from "../../../electron/subagentes";
import type { EncargoOrquestador } from "../../../electron/orquestador-texto";

export type EstadoNodo = "lider" | "orq" | "run" | "decision" | "error" | "verify" | "ok" | "queue" | "pausa";
export type TipoNodo = "lider" | "orquestador" | "subagente" | "worker";

export type NodoFlujo = {
  id: string;
  tipo: TipoNodo;
  estado: EstadoNodo;
  titulo: string;
  subtitulo: string;
  modelo: string;
  contexto: string;
  tiempo: string;
  /** Porcentaje orientativo sólo cuando el nodo está activo con avance conocido (0..100). */
  progreso?: number;
  /** Datos de origen para acciones directas en el inspector. */
  hilo?: Hilo;
  estadoHilo?: Estado;
  subagente?: Subagente;
  claveSub?: string;
  encargo?: EncargoOrquestador;
  /** Segundos que faltan para que el nodo pase al historial (sólo dentro de la ventana de desvanecimiento). */
  expiraEnS?: number;
  /** Lo mismo en porcentaje del plazo total (100 = recién terminado, 0 = por irse). */
  expiraPct?: number;
  x: number;
  y: number;
  w: number;
};

/** Segundos que un nodo terminado (o frenado) sigue en el mapa antes de pasar al historial. */
export const EXPIRA_LISTO_S = 60;
/** Segundos que un nodo fallido sigue en el mapa antes de pasar al historial. */
export const EXPIRA_ERROR_S = 300;

/** Nodo ya expirado: sale del mapa y queda sólo en el historial de «ocultos». */
export type NodoHistorial = {
  id: string;
  tipo: "worker" | "subagente" | "orquestador";
  estado: EstadoNodo;
  titulo: string;
  subtitulo: string;
  modelo: string;
  tiempo: string;
  finEn: number;
  hilo?: Hilo;
  subagente?: Subagente;
  claveSub?: string;
  encargo?: EncargoOrquestador;
};

export type AristaFlujo = {
  id: string;
  de: string;
  a: string;
  tipo: EstadoNodo;
  /** Clave de etiqueta corta sobre el cable (`encargo`, `consulta`, `fallo`, `listo`, `cola`, `sigue`, `enCurso`). */
  etiquetaClave: "encargo" | "enCurso" | "consulta" | "fallo" | "listo" | "cola" | "sigue" | "pausa";
  particula: boolean;
  /** Flujo de vuelta (consulta / decisión / entrega hacia el nodo padre). */
  inversa: boolean;
};

export type ResumenFlujo = {
  corriendo: number;
  decision: number;
  error: number;
  listo: number;
  cola: number;
};

export type GrafoFlujo = {
  nodos: NodoFlujo[];
  aristas: AristaFlujo[];
  resumen: ResumenFlujo;
  /** Nodos terminados o fallidos que ya expiraron, del más reciente al más viejo. */
  ocultos: NodoHistorial[];
};

export type ParamsGrafo = {
  /** Epoch en segundos. Sin él no expira ningún nodo y `ocultos` queda vacío. */
  ahora?: number;
  /** Plazos de expiración en segundos (por defecto `EXPIRA_LISTO_S` y `EXPIRA_ERROR_S`). */
  expiracion?: { listoS?: number; errorS?: number };
  lider: Lider | null;
  liderNuevo?: boolean;
  /** Descripción breve de lo que está haciendo el líder ahora (si está activo). */
  actividadLider?: string | null;
  /** Texto corto del contexto del líder (ej. "19k · 18%"). */
  contextoLider?: string;
  /** Texto corto del caché del líder (ej. "4m" o "?"). */
  cacheLider?: string;
  /** Workers de la rama del líder (activos y recientes). */
  workers: readonly Hilo[];
  /** Estado efectivo (con optimista) de cada worker por id. */
  estadoWorker: (h: Hilo) => Estado;
  /** Subagentes visibles del líder. */
  subagentes: readonly Subagente[];
  /** Encargos del Orquestador de fondo del líder (sin ellos el mapa queda igual que antes). */
  orquestadores?: readonly EncargoOrquestador[];
  /** Títulos legibles ya resueltos para los workers (p. ej. `tareaDe(h)`). */
  tituloWorker: (h: Hilo) => string;
  /** Formateador de tiempo relativo/transcurrido. */
  tiempoWorker: (h: Hilo, est: Estado) => string;
  /** Formateador de nombre de modelo. */
  modeloCorto: (m: string | null | undefined) => string;
  /** Textos por defecto (inyectables para mantener el módulo puro y traducible). */
  textos: {
    liderNuevo: string;
    liderSub: string;
    liderEscucha: string;
    liderPensando: string;
    liderPide: string;
    liderDormido: string;
    liderCaido: string;
    subMarca: string;
    subCorriendo: string;
    subListo: string;
    subFallo: string;
    workerCola: string;
    workerDecision: string;
    workerFalta: string;
    workerFallo: string;
    workerFrenado: string;
    workerTrabaja: string;
    workerListo: string;
    commits: (n: number) => string;
    orqMarca?: string;
    orqRevisando?: string;
    orqConsulta?: string;
    orqEjecutando?: string;
    orqListo?: string;
    orqFallo?: string;
  };
};

/** Estado visual y semántico de un worker: nunca depende sólo del color (la vista suma ícono y palabra). */
export function estadoDeWorker(h: Hilo, estado: Estado): EstadoNodo {
  if (h.frenado_en != null) return "pausa";
  if (h.en_cola && (estado === "trabajando" || h.arrancando)) return "queue";
  if (estado === "decision" || estado === "falta-info") return "decision";
  if (estado === "murio" || estado === "colgado" || (estado === "entregado" && h.fallo)) return "error";
  if (estado === "trabajando" || h.arrancando) return "run";
  if (estado === "listo" || estado === "entregado" || estado === "integrado") return "ok";
  return "pausa";
}

/** Estado visual de un subagente del líder. */
export function estadoDeSubagente(u: Subagente): EstadoNodo {
  if (u.estado === "corriendo") return "orq";
  if (u.estado === "error") return "error";
  if (u.estado === "parado") return "pausa";
  return "ok";
}

/** Estado visual de un encargo del Orquestador de fondo. */
export function estadoDeOrquestador(o: EncargoOrquestador): EstadoNodo {
  if (o.estado === "consulta") return "decision";
  if (o.estado === "error") return "error";
  if (o.estado === "listo") return "ok";
  return "orq";
}

/** Estado visual del nodo líder. */
export function estadoDeLider(l: Lider | null): EstadoNodo {
  if (!l) return "lider";
  if (l.caido === "murio") return "error";
  if (l.pide || l.espera?.motivo === "pide") return "decision";
  if (l.ocupado) return "run";
  return "lider";
}

const ANCHO_LIDER = 224;
const ANCHO_SUB = 232;
const ANCHO_WORKER = 244;
const PASO_Y = 120;
const MARGEN_X = 32;
const MARGEN_Y = 32;
const SEP_COL = 76;

const finDeWorker = (h: Hilo): number =>
  h.frenado_en ?? h.murio_en ?? (h.duracion_s != null && h.duracion_s > 0 ? h.inicio + h.duracion_s : h.inicio);
const finDeSub = (u: Subagente): number => u.ultimo_en || u.inicio;
const finDeOrq = (o: EncargoOrquestador): number => o.actualizado || o.creado;

/**
 * Expiración de un nodo: `null` si no expira (sin `ahora` o estado activo); si no, los segundos que
 * faltan (`rem <= 0` ya expiró) y el plazo total usado.
 */
function expiracionDe(est: EstadoNodo, fin: number, p: ParamsGrafo): { rem: number; limite: number } | null {
  if (p.ahora == null) return null;
  let limite: number;
  if (est === "ok" || est === "pausa") limite = p.expiracion?.listoS ?? EXPIRA_LISTO_S;
  else if (est === "error") limite = p.expiracion?.errorS ?? EXPIRA_ERROR_S;
  else return null;
  return { rem: Math.ceil(fin + limite - p.ahora), limite };
}

const pctExpira = (rem: number, limite: number): number => Math.max(0, Math.min(100, Math.round((rem / limite) * 100)));

const aHistorial = (n: NodoFlujo, tipo: NodoHistorial["tipo"], finEn: number): NodoHistorial => ({
  id: n.id,
  tipo,
  estado: n.estado,
  titulo: n.titulo,
  subtitulo: n.subtitulo,
  modelo: n.modelo,
  tiempo: n.tiempo,
  finEn,
  hilo: n.hilo,
  subagente: n.subagente,
  claveSub: n.claveSub,
  encargo: n.encargo,
});

const prioridadWorker = (e: EstadoNodo): number => {
  switch (e) {
    case "decision":
      return 0;
    case "error":
      return 1;
    case "run":
      return 2;
    case "queue":
      return 3;
    case "ok":
      return 4;
    default:
      return 5;
  }
};

const prioridadOrq = (e: EncargoOrquestador["estado"]): number =>
  e === "consulta" ? 0 : e === "error" ? 2 : e === "listo" ? 3 : 1;

/** Arma el grafo completo con posiciones deterministas y cables semánticos. */
export function armarGrafo(p: ParamsGrafo): GrafoFlujo {
  const nodos: NodoFlujo[] = [];
  const aristas: AristaFlujo[] = [];
  const resumen: ResumenFlujo = { corriendo: 0, decision: 0, error: 0, listo: 0, cola: 0 };

  const estLider = estadoDeLider(p.lider);
  const subLider = p.actividadLider
    ? p.actividadLider
    : p.lider?.caido === "murio"
      ? (p.lider.motivo || p.textos.liderCaido)
      : p.lider?.pide || p.lider?.espera?.motivo === "pide"
        ? p.textos.liderPide
        : p.lider?.ocupado
          ? p.textos.liderPensando
          : p.lider && p.lider.origen === "app" && !p.lider.vivo && !p.lider.caido
            ? p.textos.liderDormido
            : p.textos.liderSub;

  const ctxPartes = [p.contextoLider, p.cacheLider].filter(Boolean).join(" · ");
  const idLider = p.lider ? `lider:${p.lider.id}` : "lider:nuevo";
  const nodoLider: NodoFlujo = {
    id: idLider,
    tipo: "lider",
    estado: estLider,
    titulo: p.lider ? p.lider.nombre || p.textos.liderNuevo : p.textos.liderNuevo,
    subtitulo: subLider,
    modelo: p.lider ? [p.modeloCorto(p.lider.modelo) || p.lider.titulo, p.lider.effort].filter(Boolean).join(" · ") : "",
    contexto: ctxPartes,
    tiempo: p.lider?.ocupado ? p.textos.liderPensando : p.textos.liderEscucha,
    x: MARGEN_X,
    y: MARGEN_Y,
    w: ANCHO_LIDER,
  };
  nodos.push(nodoLider);

  // Expiración: los terminados/fallidos viejos salen del mapa y van a `ocultos`; los recientes llevan cuenta regresiva.
  const ocultos: NodoHistorial[] = [];
  const expirando = new Map<string, { rem: number; limite: number }>();

  // Ordenar workers: primero los que piden atención o corren, después en cola, luego listos (máximo 12 para no saturar el lienzo).
  const workersOrdenados = p.workers
    .flatMap((h) => {
      const estHilo = p.estadoWorker(h);
      const est = estadoDeWorker(h, estHilo);
      const fin = finDeWorker(h);
      const ex = expiracionDe(est, fin, p);
      if (ex && ex.rem <= 0) {
        ocultos.push(aHistorial(construirNodoWorker(h, estHilo, est, 0, 0, p), "worker", fin));
        return [];
      }
      if (ex) expirando.set(`w:${h.id}`, ex);
      return [{ h, estHilo, est }];
    })
    .sort((a, b) => prioridadWorker(a.est) - prioridadWorker(b.est) || b.h.inicio - a.h.inicio)
    .slice(0, 12);

  const idsWorkers = new Set(workersOrdenados.map((x) => x.h.id));
  const subsOrdenados = p.subagentes
    .filter((u) => {
      const est = estadoDeSubagente(u);
      const fin = finDeSub(u);
      const ex = expiracionDe(est, fin, p);
      if (ex && ex.rem <= 0) {
        ocultos.push(aHistorial(construirNodoSub(u, est, 0, 0, p), "subagente", fin));
        return false;
      }
      if (ex) expirando.set(`sub:${u.id}`, ex);
      return true;
    })
    .slice(0, 8);
  const orqsOrdenados = p.orquestadores
    ?.filter((o) => {
      const est = estadoDeOrquestador(o);
      const fin = finDeOrq(o);
      const ex = expiracionDe(est, fin, p);
      if (ex && ex.rem <= 0) {
        ocultos.push(aHistorial(construirNodoOrquestador(o, est, 0, 0, p), "orquestador", fin));
        return false;
      }
      if (ex) expirando.set(`orq:${o.id}`, ex);
      return true;
    })
    .sort((a, b) => prioridadOrq(a.estado) - prioridadOrq(b.estado) || b.actualizado - a.actualizado)
    .slice(0, 6) ?? [];

  // Cada worker cuelga de un solo orquestador visible (el primero que lo reclama).
  // Sólo cuentan los visibles: si el orquestador expiró, sus workers activos cuelgan del líder.
  const padreOrqDeWorker = new Map<string, string>();
  for (const o of orqsOrdenados) {
    for (const w of o.workers) if (!padreOrqDeWorker.has(w)) padreOrqDeWorker.set(w, `orq:${o.id}`);
  }

  // Separar workers raíz (colgados del líder) y workers encadenados (`sigue_de` apuntando a otro worker visible).
  const wRaiz = workersOrdenados.filter((x) => !x.h.sigue_de || !idsWorkers.has(x.h.sigue_de));
  const wCadena = workersOrdenados.filter((x) => x.h.sigue_de && idsWorkers.has(x.h.sigue_de));

  const col1X = MARGEN_X + ANCHO_LIDER + SEP_COL;
  const col2X = col1X + (subsOrdenados.length ? ANCHO_SUB : ANCHO_WORKER) + SEP_COL;
  const col3X = col2X + ANCHO_WORKER + SEP_COL;

  // Cadenas cuya raíz cuelga de un orquestador: su raíz ocupa la columna 2, así que siguen en la 3.
  const porId = new Map(workersOrdenados.map((x) => [x.h.id, x.h]));
  const linaje = (h: Hilo): { raiz: string; nivel: number } => {
    const vistos = new Set([h.id]);
    let cur = h;
    while (cur.sigue_de && !vistos.has(cur.sigue_de) && porId.has(cur.sigue_de)) {
      vistos.add(cur.sigue_de);
      cur = porId.get(cur.sigue_de)!;
    }
    return { raiz: cur.id, nivel: vistos.size };
  };
  const bajoOrq = (h: Hilo) => padreOrqDeWorker.has(linaje(h).raiz);
  const wDirectos = wRaiz.filter((x) => !padreOrqDeWorker.has(x.h.id));

  // Subagentes (si hay) van en columna 1 arriba; si también hay workers raíz, van a la derecha o debajo según cantidad.
  const haySubs = subsOrdenados.length > 0;
  const hayOrqs = orqsOrdenados.length > 0;
  const hayWorkers = wDirectos.length > 0;

  let ySub = MARGEN_Y;
  for (const u of subsOrdenados) {
    const est = estadoDeSubagente(u);
    if (est === "orq") resumen.corriendo++;
    else if (est === "error") resumen.error++;
    else resumen.listo++;

    const nid = `sub:${u.id}`;
    nodos.push(construirNodoSub(u, est, col1X, ySub, p, p.lider ? `${p.lider.id}:${u.id}` : undefined));
    aristas.push({
      id: `e:${idLider}->${nid}`,
      de: idLider,
      a: nid,
      tipo: est,
      etiquetaClave: est === "orq" ? "encargo" : est === "error" ? "fallo" : "listo",
      particula: est === "orq",
      inversa: false,
    });
    ySub += PASO_Y;
  }

  // Orquestadores: columna 1, debajo de los subagentes.
  const yOrqs = new Map<string, number>();
  for (const o of orqsOrdenados) {
    const est = estadoDeOrquestador(o);
    contarEstado(resumen, est);
    const nid = `orq:${o.id}`;
    nodos.push(construirNodoOrquestador(o, est, col1X, ySub, p));
    yOrqs.set(nid, ySub);
    aristas.push({
      id: `e:${idLider}->${nid}`,
      de: idLider,
      a: nid,
      tipo: est,
      etiquetaClave: est === "decision" ? "consulta" : est === "orq" ? "encargo" : est === "error" ? "fallo" : "listo",
      particula: est === "decision" || est === "orq",
      inversa: est === "decision",
    });
    ySub += PASO_Y;
  }

  // Workers raíz: si hay subagentes, los ponemos en columna 1 debajo de subagentes si son pocos, o en columna 2 para mantener aire.
  const xWorkersRaiz = haySubs && subsOrdenados.length <= 2 && wDirectos.length >= 2 ? col1X : col1X;
  let yWorker = haySubs || hayOrqs ? ySub + (hayWorkers ? 16 : 0) : MARGEN_Y;
  const mapaPos = new Map<string, { x: number; y: number }>();

  for (const { h, estHilo, est } of wDirectos) {
    contarEstado(resumen, est);
    const nid = `w:${h.id}`;
    const nodo = construirNodoWorker(h, estHilo, est, xWorkersRaiz, yWorker, p);
    nodos.push(nodo);
    mapaPos.set(h.id, { x: xWorkersRaiz, y: yWorker });
    aristas.push(construirArista(idLider, nid, est, false));
    yWorker += PASO_Y;
  }

  // Workers encadenados (`sigue_de`) en la columna siguiente, alineados con su padre cuando se puede.
  const xCadena = haySubs && xWorkersRaiz === col1X ? col2X : col2X;
  let yCadena = MARGEN_Y;

  // Hijos de cada orquestador en la columna 2, a la altura del padre cuando hay lugar.
  for (const [orqId, yOrq] of yOrqs) {
    for (const { h, estHilo, est } of wRaiz) {
      if (padreOrqDeWorker.get(h.id) !== orqId) continue;
      contarEstado(resumen, est);
      const y = Math.max(yCadena, yOrq);
      const nid = `w:${h.id}`;
      nodos.push(construirNodoWorker(h, estHilo, est, col2X, y, p));
      mapaPos.set(h.id, { x: col2X, y });
      aristas.push(construirArista(orqId, nid, est, false));
      yCadena = y + PASO_Y;
    }
  }

  const ponerEnCadena = ({ h, estHilo, est }: (typeof wCadena)[number], x: number, yMin: number): number => {
    contarEstado(resumen, est);
    const padrePos = h.sigue_de ? mapaPos.get(h.sigue_de) : undefined;
    const y = Math.max(yMin, padrePos ? padrePos.y : yMin);
    const nid = `w:${h.id}`;
    nodos.push(construirNodoWorker(h, estHilo, est, x, y, p));
    mapaPos.set(h.id, { x, y });
    const deId = h.sigue_de ? `w:${h.sigue_de}` : idLider;
    aristas.push(construirArista(deId, nid, est, true));
    return y + PASO_Y;
  };

  for (const w of wCadena) {
    if (!bajoOrq(w.h)) yCadena = ponerEnCadena(w, xCadena, yCadena);
  }

  // Columna 3: primero los padres, para que cada hijo pueda alinearse.
  let yTercera = MARGEN_Y;
  for (const w of wCadena.filter((x) => bajoOrq(x.h)).sort((a, b) => linaje(a.h).nivel - linaje(b.h).nivel)) {
    yTercera = ponerEnCadena(w, col3X, yTercera);
  }

  // Centrar verticalmente el nodo Líder respecto a sus ramas hijas.
  const hijos = nodos.slice(1);
  if (hijos.length > 0) {
    const minY = Math.min(...hijos.map((n) => n.y));
    const maxY = Math.max(...hijos.map((n) => n.y));
    nodoLider.y = Math.round((minY + maxY) / 2);
  } else {
    nodoLider.y = 140;
  }

  // Cuenta regresiva de los nodos que todavía se ven pero ya están desvaneciéndose.
  for (const n of nodos) {
    const ex = expirando.get(n.id);
    if (!ex) continue;
    n.expiraEnS = ex.rem;
    n.expiraPct = pctExpira(ex.rem, ex.limite);
  }

  ocultos.sort((a, b) => b.finEn - a.finEn);
  return { nodos, aristas, resumen, ocultos };
}

function construirNodoSub(u: Subagente, est: EstadoNodo, x: number, y: number, p: ParamsGrafo, claveSub?: string): NodoFlujo {
  const subTxt =
    u.ultimo?.trim() ||
    u.resultado?.trim() ||
    (u.estado === "corriendo" ? p.textos.subCorriendo : u.estado === "error" ? p.textos.subFallo : p.textos.subListo);
  return {
    id: `sub:${u.id}`,
    tipo: "subagente",
    estado: est,
    titulo: u.descripcion || p.textos.subMarca,
    subtitulo: subTxt.length > 120 ? `${subTxt.slice(0, 119)}…` : subTxt,
    modelo: p.modeloCorto(u.modelo) || u.tipo || p.textos.subMarca,
    contexto: u.tipo || "",
    tiempo: u.estado === "corriendo" ? p.textos.subCorriendo : u.estado === "error" ? p.textos.subFallo : p.textos.subListo,
    subagente: u,
    claveSub,
    x,
    y,
    w: ANCHO_SUB,
  };
}

function contarEstado(r: ResumenFlujo, est: EstadoNodo) {
  if (est === "run" || est === "orq" || est === "verify") r.corriendo++;
  else if (est === "decision") r.decision++;
  else if (est === "error") r.error++;
  else if (est === "ok") r.listo++;
  else if (est === "queue") r.cola++;
}

const recortarTexto = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function construirNodoOrquestador(o: EncargoOrquestador, est: EstadoNodo, x: number, y: number, p: ParamsGrafo): NodoFlujo {
  const t = p.textos;
  const [etiqueta, detalle] = {
    revisando: [t.orqRevisando ?? "Revisando", o.resumen],
    consulta: [t.orqConsulta ?? "Consulta", o.propuesta?.resumen?.trim() || o.resumen],
    ejecutando: [t.orqEjecutando ?? "Ejecutando", o.resumen],
    listo: [t.orqListo ?? "Listo", o.resumen],
    error: [t.orqFallo ?? "Falló", o.error],
  }[o.estado] as [string, string | undefined];

  return {
    id: `orq:${o.id}`,
    tipo: "orquestador",
    estado: est,
    titulo: recortarTexto(o.objetivo.trim(), 64) || (t.orqMarca ?? "Orquestador"),
    subtitulo: recortarTexto(detalle?.trim() || etiqueta, 120),
    modelo: [p.modeloCorto(o.modelo), o.effort].filter(Boolean).join(" · "),
    contexto: o.preset_contexto,
    tiempo: etiqueta,
    progreso: o.estado === "revisando" ? 38 : o.estado === "ejecutando" ? 68 : undefined,
    encargo: o,
    x,
    y,
    w: ANCHO_SUB,
  };
}

function construirNodoWorker(h: Hilo, estHilo: Estado, est: EstadoNodo, x: number, y: number, p: ParamsGrafo): NodoFlujo {
  let subtitulo = "";
  if (est === "decision") {
    subtitulo = h.decision?.trim() || (estHilo === "falta-info" ? p.textos.workerFalta : p.textos.workerDecision);
  } else if (est === "error") {
    subtitulo = h.resultado?.trim() || p.textos.workerFallo;
  } else if (est === "queue") {
    subtitulo = h.cola_motivo?.trim() || p.textos.workerCola;
  } else if (est === "pausa") {
    subtitulo = p.textos.workerFrenado;
  } else if (est === "run") {
    subtitulo = h.rama ? `${p.textos.workerTrabaja} · ${h.rama}` : p.textos.workerTrabaja;
  } else {
    const partes = [h.commits > 0 ? p.textos.commits(h.commits) : null, h.resultado?.trim() || p.textos.workerListo].filter(Boolean);
    subtitulo = partes.join(" · ");
  }

  if (subtitulo.length > 120) subtitulo = `${subtitulo.slice(0, 119)}…`;

  const modelo = [p.modeloCorto(h.modelo), h.effort].filter(Boolean).join(" · ");
  const contexto = h.rama ? h.rama : h.leer ? "solo lectura" : "";

  return {
    id: `w:${h.id}`,
    tipo: "worker",
    estado: est,
    titulo: p.tituloWorker(h),
    subtitulo,
    modelo,
    contexto,
    tiempo: p.tiempoWorker(h, estHilo),
    progreso: est === "run" ? 62 : undefined,
    hilo: h,
    estadoHilo: estHilo,
    x,
    y,
    w: ANCHO_WORKER,
  };
}

function construirArista(de: string, a: string, est: EstadoNodo, esCadena: boolean): AristaFlujo {
  const inversa = est === "decision";
  const particula = est === "run" || est === "orq" || est === "decision" || est === "verify";
  const etiquetaClave: AristaFlujo["etiquetaClave"] =
    est === "decision"
      ? "consulta"
      : est === "error"
        ? "fallo"
        : est === "queue"
          ? "cola"
          : est === "pausa"
            ? "pausa"
            : est === "ok"
              ? "listo"
              : esCadena
                ? "sigue"
                : "enCurso";

  return {
    id: `e:${de}->${a}`,
    de,
    a,
    tipo: est,
    etiquetaClave,
    particula,
    inversa,
  };
}

export type GeometriaCurva = {
  d: string;
  dRev: string;
  mx: number;
  my: number;
};

/** Curva Bézier cúbica anclada exactamente al puerto de salida (derecha de `n1`) y entrada (izquierda de `n2`). */
export function curvaPuertos(
  n1: { x: number; y: number; w: number },
  n2: { x: number; y: number; w: number },
  h1 = 104,
  h2 = 104,
): GeometriaCurva {
  const x1 = n1.x + n1.w + 5;
  const y1 = n1.y + h1 / 2;
  const x2 = n2.x - 5;
  const y2 = n2.y + h2 / 2;
  const dx = Math.max(46, Math.abs(x2 - x1) * 0.48);
  const c1x = x1 + dx;
  const c2x = x2 - dx;
  const d = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
  const dRev = `M ${x2} ${y2} C ${c2x} ${y2}, ${c1x} ${y1}, ${x1} ${y1}`;
  const mx = 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2;
  const my = 0.5 * (y1 + y2);
  return { d, dRev, mx, my };
}

/** Todos los nodos aguas arriba y aguas abajo de `id`, para resaltar una ruta al apoyar el puntero. */
export function cadenaRelacionada(aristas: readonly AristaFlujo[], id: string | null): ReadonlySet<string> | null {
  if (!id) return null;
  const set = new Set<string>([id]);
  const subir = (cur: string) => {
    for (const a of aristas) {
      if (a.a === cur && !set.has(a.de)) {
        set.add(a.de);
        subir(a.de);
      }
    }
  };
  const bajar = (cur: string) => {
    for (const a of aristas) {
      if (a.de === cur && !set.has(a.a)) {
        set.add(a.a);
        bajar(a.a);
      }
    }
  };
  subir(id);
  bajar(id);
  return set;
}

export type Camara = { x: number; y: number; z: number };

/** Encuadra todos los nodos visibles dentro del lienzo `(ancho × alto)` con margen parejo. */
export function calcularEncuadre(
  nodos: readonly { id: string; x: number; y: number; w: number }[],
  alturas: ReadonlyMap<string, number>,
  ancho: number,
  alto: number,
): Camara {
  if (!nodos.length || ancho <= 0 || alto <= 0) return { x: 24, y: 24, z: 0.9 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodos) {
    const h = alturas.get(n.id) ?? 108;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + h);
  }
  const padX = 36;
  const padY = 56;
  const bw = Math.max(120, maxX - minX);
  const bh = Math.max(100, maxY - minY);
  const z = Math.max(0.35, Math.min(1.04, Math.min((ancho - padX * 2) / bw, (alto - padY * 2) / bh)));
  const zr = Math.round(z * 100) / 100;
  return {
    x: Math.round((ancho - bw * zr) / 2 - minX * zr),
    y: Math.round((alto - bh * zr) / 2 - minY * zr + 6),
    z: zr,
  };
}
