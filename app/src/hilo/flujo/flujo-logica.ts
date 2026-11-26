// Lógica pura del mapa de flujo B3 (Líder → Subagentes/Orquestadores → Workers):
// arma nodos, estados semánticos, posiciones, curvas Bézier ancladas a puertos, cadena relacionada y encuadre.
// Sin React ni DOM: lo prueba `tests/flujo-logica.test.ts`.
import type { Estado, Hilo, Lider } from "../../datos/contrato";
import type { Subagente } from "../../../electron/subagentes";

export type EstadoNodo = "lider" | "orq" | "run" | "decision" | "error" | "verify" | "ok" | "queue" | "pausa";
export type TipoNodo = "lider" | "subagente" | "worker";

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
  x: number;
  y: number;
  w: number;
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
};

export type ParamsGrafo = {
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

/** Estado visual del nodo líder. */
export function estadoDeLider(l: Lider | null): EstadoNodo {
  if (!l) return "lider";
  if (l.caido === "murio") return "error";
  if (l.pide || l.espera?.motivo === "pide") return "decision";
  if (l.ocupado) return "run";
  return "lider";
}

const ANCHO_LIDER = 248;
const ANCHO_SUB = 256;
const ANCHO_WORKER = 272;
const PASO_Y = 132;
const MARGEN_X = 44;
const MARGEN_Y = 44;

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

  // Ordenar workers: primero los que piden atención o corren, después en cola, luego listos (máximo 12 para no saturar el lienzo).
  const workersOrdenados = [...p.workers]
    .map((h) => {
      const estHilo = p.estadoWorker(h);
      const est = estadoDeWorker(h, estHilo);
      return { h, estHilo, est };
    })
    .sort((a, b) => prioridadWorker(a.est) - prioridadWorker(b.est) || b.h.inicio - a.h.inicio)
    .slice(0, 12);

  const idsWorkers = new Set(workersOrdenados.map((x) => x.h.id));
  const subsOrdenados = [...p.subagentes].slice(0, 8);

  // Separar workers raíz (colgados del líder) y workers encadenados (`sigue_de` apuntando a otro worker visible).
  const wRaiz = workersOrdenados.filter((x) => !x.h.sigue_de || !idsWorkers.has(x.h.sigue_de));
  const wCadena = workersOrdenados.filter((x) => x.h.sigue_de && idsWorkers.has(x.h.sigue_de));

  const col1X = MARGEN_X + ANCHO_LIDER + 92;
  const col2X = col1X + (subsOrdenados.length ? ANCHO_SUB : ANCHO_WORKER) + 96;
  const col3X = col2X + ANCHO_WORKER + 96;

  // Subagentes (si hay) van en columna 1 arriba; si también hay workers raíz, van a la derecha o debajo según cantidad.
  const haySubs = subsOrdenados.length > 0;
  const hayWorkers = wRaiz.length > 0;

  let ySub = MARGEN_Y;
  for (const u of subsOrdenados) {
    const est = estadoDeSubagente(u);
    if (est === "orq") resumen.corriendo++;
    else if (est === "error") resumen.error++;
    else resumen.listo++;

    const nid = `sub:${u.id}`;
    const subTxt =
      u.ultimo?.trim() ||
      u.resultado?.trim() ||
      (u.estado === "corriendo" ? p.textos.subCorriendo : u.estado === "error" ? p.textos.subFallo : p.textos.subListo);
    nodos.push({
      id: nid,
      tipo: "subagente",
      estado: est,
      titulo: u.descripcion || p.textos.subMarca,
      subtitulo: subTxt.length > 120 ? `${subTxt.slice(0, 119)}…` : subTxt,
      modelo: p.modeloCorto(u.modelo) || u.tipo || p.textos.subMarca,
      contexto: u.tipo || "",
      tiempo: u.estado === "corriendo" ? p.textos.subCorriendo : u.estado === "error" ? p.textos.subFallo : p.textos.subListo,
      subagente: u,
      claveSub: p.lider ? `${p.lider.id}:${u.id}` : undefined,
      x: col1X,
      y: ySub,
      w: ANCHO_SUB,
    });
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

  // Workers raíz: si hay subagentes, los ponemos en columna 1 debajo de subagentes si son pocos, o en columna 2 para mantener aire.
  const xWorkersRaiz = haySubs && subsOrdenados.length <= 2 && wRaiz.length >= 2 ? col1X : col1X;
  let yWorker = haySubs ? ySub + (hayWorkers ? 16 : 0) : MARGEN_Y;
  const mapaPos = new Map<string, { x: number; y: number }>();

  for (const { h, estHilo, est } of wRaiz) {
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
  for (const { h, estHilo, est } of wCadena) {
    contarEstado(resumen, est);
    const padrePos = h.sigue_de ? mapaPos.get(h.sigue_de) : undefined;
    const y = Math.max(yCadena, padrePos ? padrePos.y : yCadena);
    const nid = `w:${h.id}`;
    nodos.push(construirNodoWorker(h, estHilo, est, xCadena, y, p));
    mapaPos.set(h.id, { x: xCadena, y });
    const deId = h.sigue_de ? `w:${h.sigue_de}` : idLider;
    aristas.push(construirArista(deId, nid, est, true));
    yCadena = y + PASO_Y;
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

  void col3X;
  return { nodos, aristas, resumen };
}

function contarEstado(r: ResumenFlujo, est: EstadoNodo) {
  if (est === "run" || est === "orq" || est === "verify") r.corriendo++;
  else if (est === "decision") r.decision++;
  else if (est === "error") r.error++;
  else if (est === "ok") r.listo++;
  else if (est === "queue") r.cola++;
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
