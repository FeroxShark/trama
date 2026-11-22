// La lógica del panel de contexto (src/paneles/PanelContexto.tsx), sin React: las categorías en orden y con su porcentaje, los ítems de
// cada una (con tokens, usos y a qué apagado corresponden), el mapa de bloques (treemap) y el filtro del catálogo de skills.
// Los datos son los de `contexto:desglose` y `skills:catalogo` (electron/contexto-desglose.ts, electron/contexto-panel.ts).
import type { Categoria, Desglose, TipoSistema } from "../../electron/contexto-desglose";
import type { SkillCatalogo, UsosCatalogo } from "../../electron/skills-catalogo";
import { lectura, type Nivel } from "../hilo/contexto-logica.ts";

export type TipoApagado = "skills" | "mcp" | "herramientas" | "memoria";
export type Apagados = Record<TipoApagado, string[]>;

/** Las categorías que ocupan la ventana, en el orden en que se pintan (mensajes primero: es lo que más crece). */
export const ORDEN: Categoria[] = ["mensajes", "herramientas", "mcp", "skills", "memoria", "prefacio", "agentes", "sistema", "otro", "reserva"];

/** Qué categorías tienen ítems que se pueden mirar uno por uno. */
export const CON_ITEMS: ReadonlySet<Categoria> = new Set(["sistema", "herramientas", "mcp", "skills", "memoria", "prefacio"]);

export type FilaCat = { id: Categoria; tokens: number; estimado: boolean; pct: number };

/** Lo que queda de lo usado al sacar lo apagado (que se libera desde el próximo mensaje); sin apagados, lo medido. `null`: no se sabe. */
export function usadoNeto(d: Desglose, apagados?: Apagados | null): number | null {
  if (d.usado === null) return null;
  const libre = Object.values(ahorro(d, apagados)).reduce((n, v) => n + v, 0);
  return Math.max(0, d.usado - libre);
}

/**
 * La lectura de lo usado contra el tope efectivo (la misma cuenta del anillo: `lectura` de src/hilo/contexto-logica.ts, CTX-43): el tope de la
 * corrida o de «Contexto antes de compactar» (`d.tope`) y, sin él, `autoCompact` (el del settings), nunca más que la ventana física.
 * `null`: no se sabe lo usado o la ventana.
 */
export function lecturaUsada(d: Desglose, apagados?: Apagados | null, autoCompact?: number | null): { pct: number; nivel: Nivel; umbral: number } | null {
  const u = usadoNeto(d, apagados);
  if (u === null || !d.ventana) return null;
  return lectura(u, d.ventana, d.tope ?? autoCompact);
}

/** Cuánto ocupa lo usado respecto del tope efectivo (0 a 1); `null` si no se sabe. */
export function fraccionUsada(d: Desglose, apagados?: Apagados | null, autoCompact?: number | null): number | null {
  const l = lecturaUsada(d, apagados, autoCompact);
  const u = usadoNeto(d, apagados);
  return l === null || u === null ? null : Math.min(1, u / l.umbral);
}

/** Lo que pesa lo apagado en cada categoría: ya no entra en la cuenta ni en el mapa (los ítems se siguen viendo, grises y tachados). */
export function ahorro(d: Desglose, apagados?: Apagados | null): Partial<Record<Categoria, number>> {
  const r: Partial<Record<Categoria, number>> = {};
  if (!apagados) return r;
  for (const cat of ["herramientas", "mcp", "skills", "memoria"] as const) {
    let n = 0;
    for (const it of itemsDe(d, cat)) {
      if (it.diferida) continue;
      if (it.apaga && estaApagado(apagados, it.apaga)) n += it.tokens ?? 0;
      else for (const h of it.hijos) if (!h.diferida && h.apaga && estaApagado(apagados, h.apaga)) n += h.tokens ?? 0;
    }
    if (n > 0) r[cat] = n;
  }
  return r;
}

/**
 * Las categorías con tokens, en `ORDEN`, con su parte de la ventana (o de lo usado, si no se sabe la ventana). Las diferidas no suman
 * (no están en la ventana), `libre` es el hueco que queda: no es una categoría, y lo apagado no cuenta.
 */
export function categorias(d: Desglose, apagados?: Apagados | null): FilaCat[] {
  const suma = new Map<Categoria, FilaCat>();
  for (const c of d.categorias) {
    // En la vista previa los MCP prendidos figuran aunque su peso no se sepa hasta conectar.
    if (c.diferido || c.id === "libre" || (c.tokens <= 0 && !(d.fuente === "previa" && c.id === "mcp"))) continue;
    const ya = suma.get(c.id);
    if (ya) ya.tokens += c.tokens;
    else suma.set(c.id, { id: c.id, tokens: c.tokens, estimado: c.estimado, pct: 0 });
  }
  const menos = ahorro(d, apagados);
  for (const f of suma.values()) f.tokens = Math.max(0, f.tokens - (menos[f.id] ?? 0));
  const total = d.ventana ?? [...suma.values()].reduce((n, c) => n + c.tokens, 0);
  const filas = [...suma.values()].filter((f) => f.tokens > 0 || (d.fuente === "previa" && f.id === "mcp")).sort((a, b) => ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id));
  for (const f of filas) f.pct = total > 0 ? f.tokens / total : 0;
  return filas;
}

/** Un ítem de una categoría: lo que se lista y lo que se puede apagar. */
export type Item = {
  /** Único dentro de la categoría. */
  clave: string;
  nombre: string;
  /** Para la memoria, la ruta entera (el nombre es sólo el final). */
  detalle: string | null;
  tokens: number | null;
  /** Cuántas veces se usó en la sesión; `null`: no se mide (memoria) o no se sabe. */
  usos: number | null;
  /** Pesa y no se usó nunca en esta sesión. */
  nunca: boolean;
  /** Lo que se le manda a `apagados:fijar`; `null`: no se puede apagar. */
  apaga: { tipo: TipoApagado; nombre: string } | null;
  /** Una herramienta que Trama no deja apagar. */
  protegida: boolean;
  /** Herramientas de un servidor MCP. */
  hijos: Item[];
  /** Su esquema todavía no está en la ventana (se carga al buscarla): sus tokens no suman. */
  diferida: boolean;
  /** Una skill que un hook mete al contexto solo (no hace falta usarla): no es "nunca usada". */
  porHook: boolean;
  /** Veces que se usó en las sesiones recientes de la persona (todas, no sólo esta); `null`: no se sabe. */
  recientes: number | null;
  /** MCP: definiciones que existen pero no están cargadas (no suman) y lo que pesan sus resultados en los mensajes (estimado). */
  diferidos: number | null;
  resultados: number | null;
  /** Una pieza del sistema: de qué es (la vista pone el nombre) y su texto, si se guardó. */
  sis: TipoSistema | "resto" | null;
  /** Del prompt: la clave de la sección conocida (`arnes`, `memoria`…), `suelta` o `null` si el título no se conoce. */
  seccion: string | null;
  texto: string | null;
  truncado: boolean;
  /** Una parte del prefacio de un líder que no es Claude: los tokens que se cortaron (`0`: entró entera); `null`: no es una parte del prefacio. */
  cortados: number | null;
  /** Está apagada y la medición ya no la trae (el líder la dejó afuera): se muestra para poder prenderla. */
  fantasma: boolean;
  /** Skills: la clave de otra skill con el mismo nombre que se usa más (la que se queda); `null`: no está duplicada. */
  duplicadaCon: string | null;
};

const ultimo = (ruta: string) => ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta;

/** El servidor como aparece en `mcp__<servidor>__…`: lo que no es letra, número, `_` o `-` pasa a `_`. */
export const servidorNormalizado = (n: string) => n.replace(/[^A-Za-z0-9_-]/g, "_");

/** La clave con que se apaga una skill: `plugin:skill` si es de un plugin y su nombre no lo trae ya. */
export const claveSkill = (s: { nombre: string; plugin: string | null }) => (s.plugin && !s.nombre.includes(":") ? `${s.plugin.split("@")[0]}:${s.nombre}` : s.nombre);

/** ¿Se sabe lo que se usó? Sin desglose, o con el transcript todavía vacío, "nunca usada" sería inventar. */
export const sabeUsos = (d: Desglose) => d.fuente !== "sin-desglose" && d.fuente !== "previa" && d.motivo === null;

/** Lo que se necesita de afuera para armar los ítems: qué está apagado, qué se usó en las sesiones recientes y cuánto dice la categoría. */
export type ContextoItems = {
  apagados?: Apagados | null;
  /** `undefined`: sin dato de otras sesiones (sólo cuenta la abierta). `null`: se pidió y no hay dato: no se afirma "nunca usada" de una skill. */
  recientes?: UsosCatalogo | null;
  /** Lo que suma la categoría (para decir cuánto del sistema no se pudo separar). */
  tokensCat?: number;
};

const ITEM_BASE: Item = {
  clave: "",
  nombre: "",
  detalle: null,
  tokens: null,
  usos: null,
  nunca: false,
  apaga: null,
  protegida: false,
  hijos: [],
  diferida: false,
  porHook: false,
  recientes: null,
  diferidos: null,
  resultados: null,
  sis: null,
  seccion: null,
  texto: null,
  truncado: false,
  cortados: null,
  fantasma: false,
  duplicadaCon: null,
};

/**
 * Skills con el mismo nombre (la misma skill instalada por dos plugins o a mano y por un plugin): se queda la que más se usó (si empatan, la
 * la que no es de un plugin) y las otras quedan `duplicadaCon` ella, que es lo que sobra. Las fantasmas no entran.
 */
function marcarDuplicadas(items: Item[]): Item[] {
  const grupos = new Map<string, Item[]>();
  for (const it of items) {
    if (it.fantasma) continue;
    grupos.set(it.nombre, [...(grupos.get(it.nombre) ?? []), it]);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const usoDe = (i: Item) => Math.max(i.usos ?? 0, i.recientes ?? 0);
    // El historial de 30 días cuenta por nombre (lo comparten las dos): a igual uso, la de esta sesión más usada y después la que no es de un plugin.
    const propia = (i: Item) => Number(i.clave === i.nombre);
    const [quedan, ...otras] = [...g].sort((a, b) => usoDe(b) - usoDe(a) || (b.usos ?? 0) - (a.usos ?? 0) || propia(b) - propia(a) || a.clave.localeCompare(b.clave));
    for (const o of otras) o.duplicadaCon = quedan.clave;
  }
  return items;
}

export function itemsDe(d: Desglose, cat: Categoria, protegidas: readonly string[] = [], ctx: ContextoItems = {}): Item[] {
  const usos = sabeUsos(d);
  const nunca = (u: number, tokens: number | null) => usos && u === 0 && (tokens ?? 0) > 0;
  const orden = (a: Item, b: Item) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.nombre.localeCompare(b.nombre);
  const ap = ctx.apagados ?? null;
  /** Lo apagado que la medición ya no trae, para poder prenderlo. */
  const fantasmas = (tipo: TipoApagado, hay: (n: string) => boolean, nombreDe: (n: string) => string = (n) => n): Item[] =>
    (ap?.[tipo] ?? [])
      .filter((n) => !hay(n))
      .map((n): Item => ({ ...ITEM_BASE, clave: `fantasma:${n}`, nombre: nombreDe(n), detalle: tipo === "memoria" ? n : null, apaga: { tipo, nombre: n }, fantasma: true }));
  if (cat === "sistema") {
    const piezas = d.sistema.map((p): Item => ({ ...ITEM_BASE, clave: p.clave, nombre: p.nombre, detalle: p.detalle, tokens: p.tokens, sis: p.tipo, seccion: p.seccion, texto: p.texto, truncado: p.truncado }));
    const resto = (ctx.tokensCat ?? 0) - piezas.reduce((n, p) => n + (p.tokens ?? 0), 0);
    // Lo que sobra de la categoría y no se pudo separar (por ejemplo, el primer mensaje).
    if (ctx.tokensCat !== undefined && resto > Math.max(1, ctx.tokensCat * 0.03)) piezas.push({ ...ITEM_BASE, clave: "sin-separar", nombre: "", tokens: resto, sis: "resto" });
    return piezas.sort(orden);
  }
  if (cat === "herramientas")
    return d.herramientas
      .map((h): Item => {
        const protegida = protegidas.includes(h.nombre);
        return {
          ...ITEM_BASE,
          clave: h.nombre,
          nombre: h.nombre,
          tokens: h.tokens,
          usos: usos ? h.usos : null,
          nunca: !h.diferida && nunca(h.usos, h.tokens),
          apaga: protegida ? null : { tipo: "herramientas", nombre: h.nombre },
          protegida,
          diferida: h.diferida,
        };
      })
      .concat(fantasmas("herramientas", (n) => n.startsWith("mcp__") || d.herramientas.some((h) => h.nombre === n)))
      .sort(orden);
  if (cat === "mcp")
    return d.mcp
      .map((m): Item => {
        const srv = servidorNormalizado(m.servidor);
        return {
          ...ITEM_BASE,
          clave: m.servidor,
          nombre: m.servidor,
          tokens: m.tokens,
          usos: usos ? m.usos : null,
          nunca: nunca(m.usos, m.tokens),
          apaga: { tipo: "mcp", nombre: m.servidor },
          diferidos: m.diferidos ?? null,
          resultados: m.resultados ?? null,
          hijos: m.herramientas
            .map(
              (h): Item => ({
                ...ITEM_BASE,
                clave: `${m.servidor}/${h.nombre}`,
                nombre: h.nombre,
                tokens: h.tokens,
                usos: usos ? h.usos : null,
                nunca: h.cargada !== false && nunca(h.usos, h.tokens),
                apaga: { tipo: "herramientas", nombre: `mcp__${srv}__${h.nombre}` },
                diferida: h.cargada === false,
              }),
            )
            .sort(orden),
        };
      })
      .concat(fantasmas("mcp", (n) => d.mcp.some((m) => servidorNormalizado(m.servidor) === servidorNormalizado(n))))
      .sort(orden);
  if (cat === "skills") {
    const rec = ctx.recientes;
    return marcarDuplicadas(d.skills
      .map((s): Item => {
        const clave = claveSkill(s);
        const vecesRec = rec ? (rec.skills[clave] ?? 0) + (clave === s.nombre ? 0 : (rec.skills[s.nombre] ?? 0)) : null;
        const porHook = s.hook > 0 || !!rec?.porHook.includes(clave);
        // Con el dato de las sesiones recientes ("nunca" es de todas, no de esta sola); sin él (se pidió y no llegó), no se afirma.
        const sinUso = rec === null ? false : nunca(s.usos, s.tokens) && !porHook && (vecesRec ?? 0) === 0;
        return {
          ...ITEM_BASE,
          clave,
          nombre: s.nombre,
          detalle: s.plugin ? s.plugin.split("@")[0] : s.origen,
          tokens: s.tokens,
          usos: usos ? s.usos : null,
          nunca: sinUso,
          apaga: { tipo: "skills", nombre: clave },
          porHook,
          recientes: vecesRec,
        };
      })
      .concat(fantasmas("skills", (n) => d.skills.some((s) => claveSkill(s) === n || s.nombre === n))))
      .sort(orden);
  }
  // El prefacio de un líder que no es Claude: una fila por parte, con lo que se recortó (no se apaga: Trama lo arma al lanzar).
  if (cat === "prefacio")
    return (d.prefacio ?? [])
      .map((p): Item => {
        const corto = p.titulo.split(" (")[0];
        return { ...ITEM_BASE, clave: p.titulo, nombre: corto, detalle: corto === p.titulo ? null : p.titulo, tokens: p.tokens, cortados: p.recortado ? Math.max(0, p.cortados) : 0 };
      })
      .sort(orden);
  if (cat === "memoria")
    return d.memoria
      .map((m): Item => ({
        ...ITEM_BASE,
        clave: m.ruta,
        nombre: ultimo(m.ruta),
        detalle: m.ruta,
        tokens: m.tokens,
        // La memoria se apaga con una ruta absoluta o un glob (`claudeMdExcludes`).
        apaga: m.ruta.startsWith("/") || /^[A-Za-z]:[\\/]/.test(m.ruta) ? { tipo: "memoria", nombre: m.ruta } : null,
      }))
      .concat(fantasmas("memoria", (n) => d.memoria.some((m) => m.ruta === n), ultimo))
      .sort(orden);
  return [];
}

/** ¿Está apagado ese ítem para todo Trama? (el MCP se compara normalizado: el registro guarda el nombre de `/mcp`). */
export function estaApagado(a: Apagados, x: { tipo: TipoApagado; nombre: string }): boolean {
  const l = a[x.tipo] ?? [];
  if (l.includes(x.nombre)) return true;
  return x.tipo === "mcp" ? l.some((n) => servidorNormalizado(n) === servidorNormalizado(x.nombre)) : false;
}

// --- Mapa de bloques (treemap) ----------------------------------------------------------------------------------------------------------

export type Bloque = {
  id: string;
  cat: Categoria;
  nombre: string;
  tokens: number;
  /** El ítem que abre (`null`: la categoría entera). */
  clave: string | null;
  /** Lo que sobró de varias cosas chicas: no se toca. */
  resto?: true;
  /** Una pieza del sistema (la vista le pone el nombre en su idioma). */
  sis?: TipoSistema | "resto";
  seccion?: string | null;
};
export type Colocado = Bloque & { x: number; y: number; w: number; h: number };

/** Los bloques del mapa: los ítems más pesados de cada categoría con ítems (o la categoría entera), con tope; lo chico se junta en uno. Lo apagado y lo que no está en la ventana (diferido) no tiene bloque. */
export function bloques(d: Desglose, tope = 14, apagados?: Apagados | null): Bloque[] {
  const todos: Bloque[] = [];
  const fuera = (i: Item) => i.diferida || i.fantasma || (!!apagados && !!i.apaga && estaApagado(apagados, i.apaga));
  for (const c of categorias(d, apagados)) {
    if (c.id === "reserva") continue;
    const items = CON_ITEMS.has(c.id) ? itemsDe(d, c.id).filter((i) => (i.tokens ?? 0) > 0 && !fuera(i)) : [];
    let cubierto = 0;
    for (const i of items) {
      todos.push({ id: `${c.id}:${i.clave}`, cat: c.id, nombre: i.nombre, tokens: i.tokens ?? 0, clave: i.clave, ...(i.sis ? { sis: i.sis, seccion: i.seccion } : {}) });
      cubierto += i.tokens ?? 0;
    }
    // Lo de la categoría que los ítems no explican (o toda ella, si no tiene ítems).
    const falta = c.tokens - cubierto;
    if (falta > Math.max(1, c.tokens * 0.03)) todos.push({ id: `${c.id}:*`, cat: c.id, nombre: items.length ? "…" : "", tokens: falta, clave: null });
  }
  todos.sort((a, b) => b.tokens - a.tokens);
  if (todos.length <= tope) return todos;
  const resto = todos.slice(tope - 1);
  return [...todos.slice(0, tope - 1), { id: "resto", cat: "otro", nombre: "", tokens: resto.reduce((n, b) => n + b.tokens, 0), clave: null, resto: true }];
}

/** Squarified treemap (Bruls, Huizing y van Wijk) en un rectángulo de `ancho`×`alto`; los valores no positivos se descartan. */
export function treemap(items: Bloque[], ancho: number, alto: number): Colocado[] {
  const lista = items.filter((b) => b.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const total = lista.reduce((n, b) => n + b.tokens, 0);
  const salida: Colocado[] = [];
  if (!lista.length || total <= 0 || ancho <= 0 || alto <= 0) return salida;
  const area = (ancho * alto) / total;
  let x = 0;
  let y = 0;
  let w = ancho;
  let h = alto;
  let i = 0;
  // El peor cociente de aspecto de una fila de áreas `a` apoyada sobre un lado de largo `lado`.
  const peor = (a: number[], lado: number) => {
    const s = a.reduce((n, v) => n + v, 0);
    const [mx, mn] = [Math.max(...a), Math.min(...a)];
    return Math.max((lado * lado * mx) / (s * s), (s * s) / (lado * lado * mn));
  };
  while (i < lista.length) {
    const lado = Math.min(w, h);
    const fila: Bloque[] = [lista[i]];
    let areas = [lista[i].tokens * area];
    let j = i + 1;
    while (j < lista.length) {
      const prueba = [...areas, lista[j].tokens * area];
      if (peor(prueba, lado) > peor(areas, lado)) break;
      areas = prueba;
      fila.push(lista[j]);
      j++;
    }
    const s = areas.reduce((n, v) => n + v, 0);
    const grosor = s / lado;
    let pos = 0;
    fila.forEach((b, k) => {
      const largo = areas[k] / grosor;
      if (w >= h) salida.push({ ...b, x: x, y: y + pos, w: grosor, h: largo });
      else salida.push({ ...b, x: x + pos, y: y, w: largo, h: grosor });
      pos += largo;
    });
    if (w >= h) {
      x += grosor;
      w -= grosor;
    } else {
      y += grosor;
      h -= grosor;
    }
    i = j;
  }
  return salida;
}

// --- Catálogo de skills -----------------------------------------------------------------------------------------------------------------

export type FiltroSkills = { q: string; solo: "todas" | "apagadas" | "nunca"; plugin: string };

/** Sin tildes ni mayúsculas, para buscar. */
export const plano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** El plugin (o la cuenta de claude.ai) de una skill; `""` si es del usuario o de un proyecto. */
export const pluginDeSkill = (s: SkillCatalogo): string => (s.origen === "plugin" ? s.de.split("@")[0] : s.origen === "claudeai" ? s.de : "");

/** Los plugins que aparecen en el catálogo, ordenados. */
export const pluginsDe = (lista: SkillCatalogo[]): string[] => [...new Set(lista.map(pluginDeSkill).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** Cuáles de las skills no se usaron en ninguna de las sesiones miradas: por su clave o por su nombre. */
export function usadas(desgloses: Desglose[], recientes?: UsosCatalogo | null): Set<string> {
  const r = new Set<string>();
  for (const d of desgloses) for (const k of [...Object.keys(d.usos?.skills ?? {}), ...Object.keys(d.usos?.hook ?? {})]) r.add(k);
  if (recientes) for (const k of [...Object.keys(recientes.skills), ...recientes.porHook]) r.add(k);
  return r;
}

/**
 * Filtra el catálogo: por texto (todas las palabras, sin tildes, en nombre, descripción, origen y plugin), por estado y por plugin.
 * `nunca` sólo sirve si `sabeUsos` (alguna sesión mirada informó usos): si no, no hay nada que decir y se devuelve vacío.
 */
export function filtrarSkills(lista: SkillCatalogo[], f: FiltroSkills, usos: { sabe: boolean; usadas: Set<string> }): SkillCatalogo[] {
  const palabras = plano(f.q).split(/\s+/).filter(Boolean);
  return lista.filter((s) => {
    if (f.plugin && pluginDeSkill(s) !== f.plugin) return false;
    if (f.solo === "apagadas" && s.estado === "activa") return false;
    if (f.solo === "nunca" && (!usos.sabe || s.estado !== "activa" || usos.usadas.has(s.clave) || usos.usadas.has(s.nombre))) return false;
    if (!palabras.length) return true;
    const pajar = plano(`${s.clave} ${s.descripcion} ${s.origen} ${s.de}`);
    return palabras.every((p) => pajar.includes(p));
  });
}

/** La parte de `n` sobre `total` en porcentaje entero (mínimo 1 si hay algo). */
export const porcentaje = (n: number, total: number) => (total > 0 && n > 0 ? Math.max(1, Math.round((n / total) * 100)) : 0);

// --- Veredicto de cada pieza fija -------------------------------------------------------------------------------------------------------
// Lo que se carga siempre (CLAUDE.md, memoria, skills, MCP, herramientas…) pesa en cada mensaje, se use o no. El veredicto dice si vale lo que
// pesa: «vale», «dudoso» o «sobra», con una razón corta. La regla es pura: entra lo que ya tiene cada fila y sale `{ veredicto, razon }`.

export type Veredicto = "vale" | "dudoso" | "sobra";

/** Una pieza que pesa menos que esto (tokens) no vale la pena sacarla aunque nunca se use: el ahorro no se nota. */
export const UMBRAL_LIVIANA = 150;
/** Desde acá una pieza es «pesada»: cerca del 1 % de una ventana de 200 k, lo que cuesta un mensaje largo cada vez. */
export const UMBRAL_PESADA = 2_000;
/** Hasta esta cantidad de usos en los 30 días (o en la sesión, sin historial) una pieza se considera «poco usada»: menos que uno cada semana. */
export const USOS_POCO = 4;
/** Del peso de lo «dudoso» se cuenta como recuperable la mitad: puede ser que se use cuando hace falta, pero el costo es seguro. */
export const FRACCION_DUDOSO = 0.5;

/** Lo que mira la regla de una fila: todo ya está en el `Item` (más la categoría). */
export type Pieza = Pick<Item, "tokens" | "usos" | "recientes" | "nunca" | "porHook" | "diferida" | "fantasma" | "protegida" | "sis" | "duplicadaCon"> & { cat: Categoria };

export type Juicio = { veredicto: Veredicto; razon: { clave: string; vars: Record<string, string | number> } };

const juicio = (veredicto: Veredicto, clave: string, vars: Record<string, string | number> = {}): Juicio => ({ veredicto, razon: { clave, vars } });

/**
 * El veredicto de una pieza fija; `null` si no cuenta (no está en la ventana: diferida o fantasma, o no pesa nada).
 * El orden de las reglas es el de lo más seguro a lo más dudoso:
 *  1. Lo que Trama o un hook necesitan (sistema, herramienta protegida, skill por hook) siempre vale.
 *  2. Duplicada con otra (la que se queda es la más usada): sobra, se use o no, porque el uso del historial cuenta por nombre y lo comparten las dos.
 *  3. Nunca usada: sobra, salvo que pese poco (dudoso: no cuesta casi nada, pero tampoco aporta).
 *  4. Pesada y poco usada: dudoso. Sin datos de uso (memoria, o sesión sin medir) no se afirma nada de «uso»: sólo lo pesado queda dudoso.
 *  5. El resto vale.
 */
export function veredictoDe(p: Pieza): Juicio | null {
  if (p.diferida || p.fantasma || !p.tokens || p.tokens <= 0) return null;
  // El prefacio de un motor que no es Claude lo arma Trama al lanzar: no se apaga ni hay datos de uso, así que no se juzga (sí suma a «Fijo»).
  if (p.cat === "prefacio") return null;
  if (p.sis !== null || p.protegida) return juicio("vale", "ctxp.vd.fija");
  if (p.porHook) return juicio("vale", "ctxp.vd.hook");
  const hayUso = p.usos !== null || p.recientes !== null;
  const usos = Math.max(p.usos ?? 0, p.recientes ?? 0);
  // `recientes` es el historial de 30 días de la persona: con él, el dato es de 30 días; sin él, sólo de esta sesión.
  const ventana = p.recientes !== null ? "30" : "sesion";
  if (p.duplicadaCon) return juicio("sobra", "ctxp.vd.duplicada", { con: p.duplicadaCon });
  if (p.nunca) return p.tokens < UMBRAL_LIVIANA ? juicio("dudoso", "ctxp.vd.nuncaLiviana") : juicio("sobra", ventana === "30" ? "ctxp.vd.nunca30" : "ctxp.vd.nuncaSesion");
  if (!hayUso) return p.tokens >= UMBRAL_PESADA ? juicio("dudoso", "ctxp.vd.pesadaSinDato") : juicio("vale", "ctxp.vd.sinDato");
  if (p.tokens >= UMBRAL_PESADA && usos <= USOS_POCO) return juicio("dudoso", "ctxp.vd.pesadaPoco", { n: usos });
  return juicio("vale", ventana === "30" ? "ctxp.vd.usada30" : "ctxp.vd.usadaSesion", { n: usos });
}

/** Cuánto pesa de más (tokens por mensaje) lo que sobra: todo lo «sobra» y la mitad de lo «dudoso». */
export function recuperable(piezas: { tokens: number | null; veredicto: Veredicto | null }[]): number {
  let n = 0;
  for (const p of piezas) {
    if (p.veredicto === "sobra") n += p.tokens ?? 0;
    else if (p.veredicto === "dudoso") n += (p.tokens ?? 0) * FRACCION_DUDOSO;
  }
  return Math.round(n);
}

/** Las categorías que se cargan en cada mensaje y tienen piezas que se juzgan (los mensajes y la reserva no). */
export const FIJAS: readonly Categoria[] = ["sistema", "herramientas", "mcp", "skills", "memoria", "prefacio"];

/**
 * `Fijo: N por mensaje · recuperable: M`: lo que ocupa lo que se carga siempre (ya sin lo apagado) y lo que se podría sacar según los
 * veredictos. Los MCP cuentan por servidor (sus herramientas no se suman otra vez); lo apagado, lo diferido y lo fantasma no cuentan.
 */
export function resumenFijo(d: Desglose, ctx: ContextoItems = {}, protegidas: readonly string[] = []): { fijo: number; recuperable: number } {
  const ap = ctx.apagados ?? null;
  const cats = categorias(d, ap);
  let fijo = 0;
  const piezas: { tokens: number | null; veredicto: Veredicto | null }[] = [];
  for (const c of cats) {
    if (!FIJAS.includes(c.id)) continue;
    fijo += c.tokens;
    const crudo = d.categorias.filter((x) => x.id === c.id && !x.diferido).reduce((n, x) => n + x.tokens, 0);
    for (const it of itemsDe(d, c.id, protegidas, { ...ctx, tokensCat: crudo })) {
      if (ap && it.apaga && estaApagado(ap, it.apaga)) continue;
      piezas.push({ tokens: it.tokens, veredicto: veredictoDe({ ...it, cat: c.id })?.veredicto ?? null });
    }
  }
  return { fijo, recuperable: Math.min(fijo, recuperable(piezas)) };
}

/** Primero lo más caro que menos se usa: lo que sobra pesa entero, lo dudoso a medias y lo que vale nada; a igual peso, el más pesado primero. Lo que no está en la ventana, al final. */
export function ordenarPorVeredicto(items: Item[], cat: Categoria): Item[] {
  const peso = (i: Item) => {
    const v = veredictoDe({ ...i, cat })?.veredicto;
    return (i.tokens ?? 0) * (v === "sobra" ? 1 : v === "dudoso" ? FRACCION_DUDOSO : 0);
  };
  return [...items].sort((a, b) => Number(a.diferida || a.fantasma) - Number(b.diferida || b.fantasma) || peso(b) - peso(a) || (b.tokens ?? -1) - (a.tokens ?? -1) || a.nombre.localeCompare(b.nombre));
}
