// Lógica pura del acomodo de paneles acoplables (Chats, Contexto y Cupo en las zonas izquierda, derecha y abajo).
// Sin React, DOM ni localStorage: lo prueba `tests/acople-logica.test.ts`.

/** Clave de almacenamiento del acomodo en localStorage. */
export const CLAVE_ACOPLE = "hilos:acople";

export type Zona = "izq" | "der" | "abajo";
export type PanelId = "chats" | "contexto" | "cupo";

export type Acople = {
  zonas: Record<Zona, PanelId[]>;
  /** Ancho (`izq`, `der`) o alto (`abajo`) en px de letra 13. */
  tam: Record<Zona, number>;
  /** Peso relativo de cada panel dentro de su zona. */
  partes: Partial<Record<PanelId, number>>;
  plegados: PanelId[];
  /** Recuerda de qué zona salió cada panel cerrado para devolverlo ahí al abrir. */
  cerrados: Partial<Record<PanelId, Zona>>;
};

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type GeoDestino = {
  ventana: Rect;
  zonas: Record<Zona, Rect | null>;
  paneles: Record<Zona, readonly Rect[]>;
};

export type Destino = {
  zona: Zona;
  indice: number;
};

export const ZONAS: readonly Zona[] = ["izq", "der", "abajo"];
export const PANELES: readonly PanelId[] = ["chats", "contexto", "cupo"];

const ZONA_FABRICA: Record<PanelId, Zona> = {
  chats: "izq",
  contexto: "der",
  cupo: "der",
};

const TAM_DEFECTO: Record<Zona, number> = {
  izq: 320,
  der: 400,
  abajo: 340,
};

const ANCHO_MIN = 240;
const ANCHO_MAX = 520;
const ALTO_MIN = 160;
const ALTO_MAX = 2000;
const PANEL_MIN = 120;
const FRANJA_VACIA = 96;

const acotar = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

const esZona = (x: unknown): x is Zona => x === "izq" || x === "der" || x === "abajo";

const esPanelId = (x: unknown): x is PanelId => x === "chats" || x === "contexto" || x === "cupo";

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const clonar = (a: Acople): Acople => ({
  zonas: {
    izq: [...a.zonas.izq],
    der: [...a.zonas.der],
    abajo: [...a.zonas.abajo],
  },
  tam: { ...a.tam },
  partes: { ...a.partes },
  plegados: [...a.plegados],
  cerrados: { ...a.cerrados },
});

/** Zona donde está un panel abierto, o `null` si está cerrado. */
export function zonaDe(a: Acople, panel: PanelId): Zona | null {
  for (const z of ZONAS) {
    if (a.zonas[z].includes(panel)) return z;
  }
  return null;
}

/** Acomodo inicial de fábrica. */
export function acopleDeFabrica(): Acople {
  return {
    zonas: { izq: ["chats"], der: ["contexto", "cupo"], abajo: [] },
    tam: { ...TAM_DEFECTO },
    partes: {},
    plegados: ["cupo"],
    cerrados: {},
  };
}

/** Mueve un panel a `zona` en la posición `indice` (al final si se omite); si estaba cerrado, lo abre. */
export function mover(a: Acople, panel: PanelId, zona: Zona, indice?: number): Acople {
  const res = clonar(a);
  const origen = zonaDe(res, panel);
  if (origen) {
    res.zonas[origen] = res.zonas[origen].filter((p) => p !== panel);
    for (const p of res.zonas[origen]) delete res.partes[p];
  }
  for (const p of res.zonas[zona]) delete res.partes[p];
  delete res.partes[panel];
  delete res.cerrados[panel];

  const destinoLista = res.zonas[zona];
  const pos =
    indice === undefined || !Number.isFinite(indice)
      ? destinoLista.length
      : acotar(Math.trunc(indice), 0, destinoLista.length);
  destinoLista.splice(pos, 0, panel);
  return res;
}

/** Cierra un panel recordando de qué zona salió. */
export function cerrar(a: Acople, panel: PanelId): Acople {
  const res = clonar(a);
  const z = zonaDe(res, panel);
  if (!z) {
    if (!(panel in res.cerrados)) res.cerrados[panel] = ZONA_FABRICA[panel];
    return res;
  }
  res.zonas[z] = res.zonas[z].filter((p) => p !== panel);
  res.cerrados[panel] = z;
  delete res.partes[panel];
  for (const p of res.zonas[z]) delete res.partes[p];
  return res;
}

/** Reabre un panel cerrado al final de la zona de la que salió. */
export function abrir(a: Acople, panel: PanelId): Acople {
  const res = clonar(a);
  const actual = zonaDe(res, panel);
  if (!actual) {
    const z = res.cerrados[panel] ?? ZONA_FABRICA[panel];
    delete res.cerrados[panel];
    res.zonas[z].push(panel);
    delete res.partes[panel];
    for (const p of res.zonas[z]) delete res.partes[p];
  } else {
    delete res.cerrados[panel];
  }
  return res;
}

/** Alterna el estado plegado de un panel. */
export function alternarPlegado(a: Acople, panel: PanelId): Acople {
  const res = clonar(a);
  if (res.plegados.includes(panel)) {
    res.plegados = res.plegados.filter((p) => p !== panel);
  } else {
    res.plegados.push(panel);
  }
  return res;
}

/** Cambia el tamaño de una zona acotando `izq`/`der` a 240..520 y `abajo` a 160..`limite`. */
export function redimensionar(a: Acople, zona: Zona, px: number, limite?: number): Acople {
  const res = clonar(a);
  if (!Number.isFinite(px)) return res;
  if (zona === "izq" || zona === "der") {
    res.tam[zona] = acotar(px, ANCHO_MIN, ANCHO_MAX);
  } else {
    const max = limite !== undefined && Number.isFinite(limite) ? Math.max(ALTO_MIN, limite) : ALTO_MAX;
    res.tam.abajo = acotar(px, ALTO_MIN, max);
  }
  return res;
}

/** Mueve el divisor entre `panelDeArriba` y el panel siguiente en `zona` sin dejar ninguno bajo 120 px. */
export function repartir(a: Acople, zona: Zona, panelDeArriba: PanelId, deltaPx: number, largoZona: number): Acople {
  const res = clonar(a);
  if (!Number.isFinite(deltaPx) || !Number.isFinite(largoZona) || largoZona <= 0) return res;

  const lista = res.zonas[zona];
  const idx = lista.indexOf(panelDeArriba);
  if (idx < 0 || idx + 1 >= lista.length) return res;

  const panelDeAbajo = lista[idx + 1];
  if (res.plegados.includes(panelDeArriba) || res.plegados.includes(panelDeAbajo)) return res;

  const desplegados = lista.filter((p) => !res.plegados.includes(p));
  const pesoDe = (p: PanelId): number => {
    const v = res.partes[p];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
  };
  const sumaPesos = desplegados.reduce((acc, p) => acc + pesoDe(p), 0);
  if (sumaPesos <= 0) return res;

  const pxActual = (p: PanelId): number => (largoZona * pesoDe(p)) / sumaPesos;
  const ha = pxActual(panelDeArriba);
  const hb = pxActual(panelDeAbajo);
  const totalPar = ha + hb;
  if (totalPar < 2 * PANEL_MIN) return res;

  const nuevoA = acotar(ha + deltaPx, PANEL_MIN, totalPar - PANEL_MIN);
  const nuevoB = totalPar - nuevoA;

  for (const p of desplegados) {
    if (p === panelDeArriba) res.partes[p] = nuevoA;
    else if (p === panelDeAbajo) res.partes[p] = nuevoB;
    else res.partes[p] = pxActual(p);
  }
  return res;
}

/** Normaliza cualquier entrada arbitraria devolviendo siempre un `Acople` válido. */
export function normalizar(x: unknown): Acople {
  if (!esObjeto(x)) return acopleDeFabrica();

  const base = acopleDeFabrica();
  const zonas: Record<Zona, PanelId[]> = { izq: [], der: [], abajo: [] };
  const vistos = new Set<PanelId>();

  if (esObjeto(x.zonas)) {
    for (const z of ZONAS) {
      const lista = x.zonas[z];
      if (!Array.isArray(lista)) continue;
      for (const item of lista) {
        if (esPanelId(item) && !vistos.has(item)) {
          zonas[z].push(item);
          vistos.add(item);
        }
      }
    }
  }

  const cerrados: Partial<Record<PanelId, Zona>> = {};
  if (esObjeto(x.cerrados)) {
    for (const p of PANELES) {
      if (vistos.has(p) || !Object.prototype.hasOwnProperty.call(x.cerrados, p)) continue;
      const val = x.cerrados[p];
      if (val !== undefined && val !== null && val !== false) {
        cerrados[p] = esZona(val) ? val : ZONA_FABRICA[p];
        vistos.add(p);
      }
    }
  }

  for (const p of PANELES) {
    if (!vistos.has(p)) {
      zonas[ZONA_FABRICA[p]].push(p);
      vistos.add(p);
    }
  }

  const rawTam = esObjeto(x.tam) ? x.tam : null;
  const tamNum = (z: Zona, min: number, max: number): number => {
    const v = rawTam?.[z];
    return typeof v === "number" && Number.isFinite(v) ? acotar(v, min, max) : TAM_DEFECTO[z];
  };
  const tam: Record<Zona, number> = {
    izq: tamNum("izq", ANCHO_MIN, ANCHO_MAX),
    der: tamNum("der", ANCHO_MIN, ANCHO_MAX),
    abajo: tamNum("abajo", ALTO_MIN, ALTO_MAX),
  };

  const partes: Partial<Record<PanelId, number>> = {};
  if (esObjeto(x.partes)) {
    for (const p of PANELES) {
      if (p in cerrados) continue;
      const v = x.partes[p];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        partes[p] = v;
      }
    }
  }

  let plegados: PanelId[];
  if (Array.isArray(x.plegados)) {
    const vistosPleg = new Set<PanelId>();
    plegados = [];
    for (const item of x.plegados) {
      if (esPanelId(item) && !vistosPleg.has(item)) {
        plegados.push(item);
        vistosPleg.add(item);
      }
    }
  } else {
    plegados = [...base.plegados];
  }

  return { zonas, tam, partes, plegados, cerrados };
}

const enRect = (r: Rect, x: number, y: number): boolean => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

const indiceEnZona = (zona: Zona, paneles: readonly Rect[], x: number, y: number): number => {
  const horizontal = zona === "abajo";
  const pos = horizontal ? x : y;
  for (let i = 0; i < paneles.length; i++) {
    const r = paneles[i];
    const mid = horizontal ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2;
    if (pos < mid) return i;
  }
  return paneles.length;
};

/** Calcula en qué zona e índice cae el puntero `(x, y)`, o `null` sobre el centro o fuera de la ventana. */
export function destino(geo: GeoDestino, x: number, y: number): Destino | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const v = geo.ventana;
  if (!enRect(v, x, y)) return null;

  for (const z of ZONAS) {
    const r = geo.zonas[z];
    if (r && enRect(r, x, y)) {
      return { zona: z, indice: indiceEnZona(z, geo.paneles[z] ?? [], x, y) };
    }
  }

  const franjas: Record<Zona, Rect> = {
    izq: { left: v.left, top: v.top, right: Math.min(v.right, v.left + FRANJA_VACIA), bottom: v.bottom },
    der: { left: Math.max(v.left, v.right - FRANJA_VACIA), top: v.top, right: v.right, bottom: v.bottom },
    abajo: { left: v.left, top: Math.max(v.top, v.bottom - FRANJA_VACIA), right: v.right, bottom: v.bottom },
  };

  for (const z of ZONAS) {
    if (geo.zonas[z] === null && enRect(franjas[z], x, y)) {
      return { zona: z, indice: 0 };
    }
  }

  return null;
}

/** Construye el acomodo inicial a partir de los valores viejos de la barra lateral. */
export function desdeViejo(viejo: { ancho?: number | null; abierta?: boolean | null }): Acople {
  let res = acopleDeFabrica();
  if (typeof viejo.ancho === "number" && Number.isFinite(viejo.ancho)) {
    res = redimensionar(res, "izq", viejo.ancho);
  }
  if (viejo.abierta === false) {
    res = cerrar(res, "chats");
  }
  return res;
}
