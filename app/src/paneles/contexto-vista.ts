// La lógica del panel de contexto (src/paneles/PanelContexto.tsx), sin React: las categorías en orden y con su porcentaje, los ítems de
// cada una (con tokens, usos y a qué apagado corresponden), el mapa de bloques (treemap) y el filtro del catálogo de skills.
// Los datos son los de `contexto:desglose` y `skills:catalogo` (electron/contexto-desglose.ts, electron/contexto-panel.ts).
import type { Categoria, Desglose, TipoSistema } from "../../electron/contexto-desglose";
import type { SkillCatalogo, UsosCatalogo } from "../../electron/skills-catalogo";

export type TipoApagado = "skills" | "mcp" | "herramientas" | "memoria";
export type Apagados = Record<TipoApagado, string[]>;

/** Las categorías que ocupan la ventana, en el orden en que se pintan (mensajes primero: es lo que más crece). */
export const ORDEN: Categoria[] = ["mensajes", "herramientas", "mcp", "skills", "memoria", "agentes", "sistema", "otro", "reserva"];

/** Qué categorías tienen ítems que se pueden mirar uno por uno. */
export const CON_ITEMS: ReadonlySet<Categoria> = new Set(["sistema", "herramientas", "mcp", "skills", "memoria"]);

export type FilaCat = { id: Categoria; tokens: number; estimado: boolean; pct: number };

/** Lo que queda de lo usado al sacar lo apagado (que se libera desde el próximo mensaje); sin apagados, lo medido. `null`: no se sabe. */
export function usadoNeto(d: Desglose, apagados?: Apagados | null): number | null {
  if (d.usado === null) return null;
  const libre = Object.values(ahorro(d, apagados)).reduce((n, v) => n + v, 0);
  return Math.max(0, d.usado - libre);
}

/** Cuánto ocupa lo usado respecto de la ventana (0 a 1); `null` si no se sabe. */
export function fraccionUsada(d: Desglose, apagados?: Apagados | null): number | null {
  const u = usadoNeto(d, apagados);
  if (u === null || !d.ventana) return null;
  return Math.min(1, u / d.ventana);
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
    if (c.diferido || c.id === "libre" || c.tokens <= 0) continue;
    const ya = suma.get(c.id);
    if (ya) ya.tokens += c.tokens;
    else suma.set(c.id, { id: c.id, tokens: c.tokens, estimado: c.estimado, pct: 0 });
  }
  const menos = ahorro(d, apagados);
  for (const f of suma.values()) f.tokens = Math.max(0, f.tokens - (menos[f.id] ?? 0));
  const total = d.ventana ?? [...suma.values()].reduce((n, c) => n + c.tokens, 0);
  const filas = [...suma.values()].filter((f) => f.tokens > 0).sort((a, b) => ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id));
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
  texto: string | null;
  truncado: boolean;
  /** Está apagada y la medición ya no la trae (el líder la dejó afuera): se muestra para poder prenderla. */
  fantasma: boolean;
};

const ultimo = (ruta: string) => ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta;

/** El servidor como aparece en `mcp__<servidor>__…`: lo que no es letra, número, `_` o `-` pasa a `_`. */
export const servidorNormalizado = (n: string) => n.replace(/[^A-Za-z0-9_-]/g, "_");

/** La clave con que se apaga una skill: `plugin:skill` si es de un plugin y su nombre no lo trae ya. */
export const claveSkill = (s: { nombre: string; plugin: string | null }) => (s.plugin && !s.nombre.includes(":") ? `${s.plugin.split("@")[0]}:${s.nombre}` : s.nombre);

/** ¿Se sabe lo que se usó? Sin desglose, o con el transcript todavía vacío, "nunca usada" sería inventar. */
export const sabeUsos = (d: Desglose) => d.fuente !== "sin-desglose" && d.motivo === null;

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
  texto: null,
  truncado: false,
  fantasma: false,
};

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
    const piezas = d.sistema.map((p): Item => ({ ...ITEM_BASE, clave: p.clave, nombre: p.nombre, detalle: p.detalle, tokens: p.tokens, sis: p.tipo, texto: p.texto, truncado: p.truncado }));
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
    return d.skills
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
      .concat(fantasmas("skills", (n) => d.skills.some((s) => claveSkill(s) === n || s.nombre === n)))
      .sort(orden);
  }
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
      todos.push({ id: `${c.id}:${i.clave}`, cat: c.id, nombre: i.nombre, tokens: i.tokens ?? 0, clave: i.clave, ...(i.sis ? { sis: i.sis } : {}) });
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
