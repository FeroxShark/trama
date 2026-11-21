// Modelos de Codex (ChatGPT) leídos del caché local que deja el CLI `codex` (`$CODEX_HOME/models_cache.json` o
// `~/.codex/models_cache.json`; `%USERPROFILE%\.codex\models_cache.json` en Windows). Puro y tolerante: ante un
// archivo ausente, vacío o roto devuelve el catálogo de respaldo sin tirar ni asumir que `codex` esté instalado.
import { readFileSync } from "node:fs";
import { caminoDe, homeDe, plataformaActual, type Plataforma } from "../rutas.ts";

/** Ventana de contexto por defecto cuando el caché no la informa. */
export const VENTANA_CODEX_DEFECTO = 400_000;

/** Niveles de razonamiento que `pa` y los puentes saben pasar a `codex exec`. */
export const EFFORTS_CODEX_PA = ["low", "medium", "high"] as const;

export type CodexModelo = {
  /** Slug crudo de Codex (ej. `"gpt-6.2-sol"`). */
  slug: string;
  /** Identificador de Trama / `pa` (`"codex:gpt-6.2-sol"`). */
  id: string;
  /** Nombre legible (ej. `"GPT-6.2 Sol (Codex)"`). */
  nombre: string;
  /** Familia / última palabra del slug (`"sol"`, `"astra"`, `"terra"`, `"luna"`). */
  familia: string;
  /** Alias corto de la familia (igual a `familia`). */
  alias: string;
  /** Versión numérica extraída del slug (`"6.2"`, `"6.1"`, `"6"`, `"5.6"`). */
  version: string;
  /** Partes numéricas de `version` para comparar (`[6, 2]`). */
  versionPartes: number[];
  /** Esfuerzos listados en `supported_reasoning_levels` del caché (sin recortar). */
  efforts: string[];
  /** `default_reasoning_level` si viene informado. */
  defaultEffort: string | null;
  /** Prioridad en el caché (`Infinity` si falta). */
  priority: number;
  /** Ventana de contexto (`context_window`). */
  ventana: number;
};

export type OpcionesCodexCache = {
  ruta?: string;
  env?: Record<string, string | undefined>;
  home?: string;
  plat?: Plataforma;
  leer?: (ruta: string) => string;
};

const FORMA_SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const FORMA_EFFORT = /^[a-z]{2,20}$/;

/** Partes numéricas de la versión de un slug (`gpt-6.2-sol` → `[6, 2]`). */
export function versionPartesCodex(slugOrVer: string): number[] {
  const m = /(?:^|-)(\d+(?:\.\d+)*)(?:-|$)/.exec(slugOrVer.trim());
  if (!m) return [];
  return m[1]!.split(".").map((n) => Number.parseInt(n, 10)).filter((n) => Number.isFinite(n));
}

/** Versión en texto extraída de un slug (`gpt-6.2-sol` → `"6.2"`). */
export function versionDeSlug(slug: string): string {
  const ps = versionPartesCodex(slug);
  return ps.length ? ps.join(".") : "";
}

/** Compara dos versiones (`6.2 > 6.1 > 6 > 5.6`). Positivo si `a > b`. */
export function compararVersionCodex(a: string | readonly number[], b: string | readonly number[]): number {
  const pa = typeof a === "string" ? versionPartesCodex(a) : a;
  const pb = typeof b === "string" ? versionPartesCodex(b) : b;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Última palabra alfabética del slug (`gpt-6.2-sol` → `"sol"`). */
export function familiaCodexDeSlug(slug: string): string {
  const partes = slug.toLowerCase().split("-").filter(Boolean);
  for (let i = partes.length - 1; i >= 0; i--) {
    if (/^[a-z]+$/.test(partes[i]!)) return partes[i]!;
  }
  return slug.toLowerCase();
}

function capitalizarPalabra(p: string): string {
  if (!p) return p;
  if (p.toLowerCase() === "gpt") return "GPT";
  if (/^\d/.test(p)) return p;
  return p[0]!.toUpperCase() + p.slice(1);
}

/** `"GPT-6.2-Sol"` o `"gpt-6.2-sol"` → `"GPT-6.2 Sol (Codex)"`. */
export function nombreCodexLegible(slug: string, displayName?: unknown): string {
  let base = typeof displayName === "string" && displayName.trim() ? displayName.trim() : "";
  if (!base || base === slug.toLowerCase()) {
    const segs = slug.split("-").filter(Boolean).map(capitalizarPalabra);
    if (segs.length >= 2 && segs[0] === "GPT" && /^\d/.test(segs[1]!)) {
      base = `GPT-${segs[1]}${segs.length > 2 ? " " + segs.slice(2).join(" ") : ""}`;
    } else {
      base = segs.join(" ");
    }
  } else {
    base = base.replace(/^gpt-/i, "GPT-").replace(/(\d)-([A-Za-z])/g, "$1 $2");
  }
  return /\(codex\)\s*$/i.test(base) ? base : `${base} (Codex)`;
}

function crearRespaldo(slug: string, nombre: string, priority: number): CodexModelo {
  const familia = familiaCodexDeSlug(slug);
  const version = versionDeSlug(slug);
  return {
    slug,
    id: `codex:${slug}`,
    nombre,
    familia,
    alias: familia,
    version,
    versionPartes: versionPartesCodex(version),
    efforts: [...EFFORTS_CODEX_PA],
    defaultEffort: "medium",
    priority,
    ventana: VENTANA_CODEX_DEFECTO,
  };
}

/** Catálogo fijo de respaldo cuando `models_cache.json` falta, está vacío o no se puede leer. */
export const CODEX_RESPALDO: readonly CodexModelo[] = [
  crearRespaldo("gpt-6.1-sol", "GPT-6.1 Sol (Codex)", 1),
  crearRespaldo("gpt-6-astra", "GPT-6 Astra (Codex)", 2),
  crearRespaldo("gpt-6-luna", "GPT-6 Luna (Codex)", 3),
];

/** Alias históricos aceptados por `pa` en respaldo cuando no hay `models_cache.json`. */
export const CODEX_SLUGS_EXTRA_RESPALDO = ["gpt-6-sol"] as const;

const clonar = (m: CodexModelo): CodexModelo => ({ ...m, versionPartes: [...m.versionPartes], efforts: [...m.efforts] });

/** Ruta de `models_cache.json` de Codex (`$CODEX_HOME` o `<home>/.codex`). */
export function rutaCodexCache(
  env: Record<string, string | undefined> = process.env,
  home?: string,
  plat: Plataforma = plataformaActual(),
): string {
  const c = caminoDe(plat);
  const h = home ?? homeDe(env, plat);
  const dir = env.CODEX_HOME ? env.CODEX_HOME : c.join(h, ".codex");
  return c.join(dir, "models_cache.json");
}

/** Parsea el texto de `models_cache.json` y devuelve los modelos con `visibility === "list"`; `null` si está roto o vacío. */
export function parsearCodexCache(texto: string): CodexModelo[] | null {
  if (!texto.trim()) return null;
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const lista = (j as { models?: unknown }).models;
  if (!Array.isArray(lista)) return null;
  const vistos = new Set<string>();
  const salida: CodexModelo[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (o.visibility !== "list") continue;
    const slugCrudo = typeof o.slug === "string" ? o.slug.trim() : "";
    if (!slugCrudo || !FORMA_SLUG.test(slugCrudo)) continue;
    const slug = slugCrudo.toLowerCase();
    if (vistos.has(slug)) continue;
    vistos.add(slug);

    const efforts: string[] = [];
    if (Array.isArray(o.supported_reasoning_levels)) {
      for (const lvl of o.supported_reasoning_levels) {
        const raw = typeof lvl === "string" ? lvl : lvl && typeof lvl === "object" && !Array.isArray(lvl) ? (lvl as { effort?: unknown }).effort : undefined;
        const ef = typeof raw === "string" ? raw.trim().toLowerCase() : "";
        if (ef && FORMA_EFFORT.test(ef) && !efforts.includes(ef)) efforts.push(ef);
      }
    }
    const defRaw = typeof o.default_reasoning_level === "string" ? o.default_reasoning_level.trim().toLowerCase() : "";
    const defaultEffort = defRaw && FORMA_EFFORT.test(defRaw) ? defRaw : null;
    const priority = typeof o.priority === "number" && Number.isFinite(o.priority) ? o.priority : Number.MAX_SAFE_INTEGER;
    const ventana =
      typeof o.context_window === "number" && Number.isFinite(o.context_window) && o.context_window > 0
        ? Math.trunc(o.context_window)
        : VENTANA_CODEX_DEFECTO;
    const familia = familiaCodexDeSlug(slug);
    const version = versionDeSlug(slug);
    salida.push({
      slug,
      id: `codex:${slug}`,
      nombre: nombreCodexLegible(slug, o.display_name),
      familia,
      alias: familia,
      version,
      versionPartes: versionPartesCodex(version),
      efforts,
      defaultEffort,
      priority,
      ventana,
    });
  }
  return salida.length ? salida : null;
}

/** Lee `models_cache.json` (tolerante: nunca tira) y dice si usó el caché o el respaldo de siempre. */
export function leerCatalogoCodex(opc?: string | OpcionesCodexCache): { modelos: CodexModelo[]; fallback: boolean; ruta: string } {
  const o: OpcionesCodexCache = typeof opc === "string" ? { ruta: opc } : (opc ?? {});
  const plat = o.plat ?? plataformaActual();
  const env = o.env ?? process.env;
  const ruta = o.ruta ?? rutaCodexCache(env, o.home, plat);
  const leer = o.leer ?? ((r: string) => readFileSync(r, "utf8"));
  try {
    const ms = parsearCodexCache(leer(ruta));
    if (ms && ms.length) return { modelos: ms, fallback: false, ruta };
  } catch {
    /* archivo ausente o ilegible: va el respaldo */
  }
  return { modelos: CODEX_RESPALDO.map(clonar), fallback: true, ruta };
}

/** Lee los modelos visibles de Codex; sin caché válido devuelve el respaldo fijo de siempre. */
export function leerCodexModelos(opc?: string | OpcionesCodexCache): CodexModelo[] {
  return leerCatalogoCodex(opc).modelos;
}

/** Recorta los efforts de un modelo a lo que `pa` sabe pasar a `codex exec` (`low`, `medium`, `high`). */
export function effortsCodexSoportados(m: Pick<CodexModelo, "efforts">): string[] {
  if (!m.efforts.length) return [...EFFORTS_CODEX_PA];
  return m.efforts.filter((e) => (EFFORTS_CODEX_PA as readonly string[]).includes(e));
}

/** Por cada familia presente (`sol`, `astra`, `luna`, `terra`…), el modelo de versión más nueva (desempata `priority` menor). */
export function aliasMasNuevosCodex(modelos: readonly CodexModelo[]): Record<string, CodexModelo> {
  const porFam: Record<string, CodexModelo> = {};
  for (const m of modelos) {
    if (!effortsCodexSoportados(m).length) continue;
    const prev = porFam[m.familia];
    if (!prev) {
      porFam[m.familia] = m;
      continue;
    }
    const d = compararVersionCodex(m.versionPartes, prev.versionPartes);
    if (d > 0 || (d === 0 && m.priority < prev.priority)) porFam[m.familia] = m;
  }
  return porFam;
}

/** Slugs de respaldo + catálogo vigente (para validar `codex:<slug>-<effort>` en `pa`). */
export function esfuerzosDeSlugCodex(slug: string, opc?: OpcionesCodexCache): string[] | null {
  const { modelos, fallback } = leerCatalogoCodex(opc);
  const s = slug.toLowerCase();
  const hallado = modelos.find((m) => m.slug === s);
  if (hallado) {
    const efs = effortsCodexSoportados(hallado);
    return efs.length ? efs : null;
  }
  if (fallback && (CODEX_SLUGS_EXTRA_RESPALDO as readonly string[]).includes(s)) return [...EFFORTS_CODEX_PA];
  return null;
}

/** Valida `<codex:slug-effort>` contra el catálogo (o respaldo sin caché). Acepta alias `codex:sol-high`. */
export function resolverCodexPedido(modeloConPrefijo: string, opc?: OpcionesCodexCache): { id: string; slug: string; effort: string } | null {
  const raw = modeloConPrefijo.trim().toLowerCase();
  if (!raw.startsWith("codex:")) return null;
  const resto = raw.slice("codex:".length);
  const i = resto.lastIndexOf("-");
  if (i <= 0) return null;
  const slugOAlias = resto.slice(0, i);
  const ef = resto.slice(i + 1);
  if (!(EFFORTS_CODEX_PA as readonly string[]).includes(ef)) return null;
  const efs = esfuerzosDeSlugCodex(slugOAlias, opc);
  if (efs && efs.includes(ef)) return { id: `codex:${slugOAlias}-${ef}`, slug: slugOAlias, effort: ef };
  const alias = aliasMasNuevosCodex(leerCodexModelos(opc))[slugOAlias];
  if (alias && effortsCodexSoportados(alias).includes(ef)) return { id: `${alias.id}-${ef}`, slug: alias.slug, effort: ef };
  return null;
}

/** Ventana de contexto de un modelo `codex:…` (sin caché o desconocido: `VENTANA_CODEX_DEFECTO`). */
export function ventanaCodex(modelo: string, opc?: OpcionesCodexCache): number {
  const slug = modelo.trim().toLowerCase().replace(/^codex:/, "").replace(/-(low|medium|high|xhigh|max|ultra)$/, "");
  const m = leerCodexModelos(opc).find((x) => x.slug === slug);
  return m?.ventana ?? VENTANA_CODEX_DEFECTO;
}

/** Familia de Codex a partir de un id o slug (`"codex:gpt-6.2-astra-high"` → `"astra"`), o `""`. */
export function familiaCodexDeId(modelo: string): string {
  const raw = modelo.trim().toLowerCase();
  if (!raw.startsWith("codex:")) return "";
  const sin = raw.slice("codex:".length).replace(/-(low|medium|high|xhigh|max|ultra)$/, "");
  return familiaCodexDeSlug(sin);
}

/** Lista formateada para mensajes de error de `pa`: `codex:{slug1,slug2,...}-{low,medium,high}`. */
export function resumenCodexAceptados(opc?: OpcionesCodexCache): string {
  const { modelos, fallback } = leerCatalogoCodex(opc);
  const slugs = modelos.filter((m) => effortsCodexSoportados(m).length > 0).map((m) => m.slug);
  if (fallback) for (const s of CODEX_SLUGS_EXTRA_RESPALDO) if (!slugs.includes(s)) slugs.splice(1, 0, s);
  const todosEfs = new Set(modelos.flatMap((m) => effortsCodexSoportados(m)));
  const efs = EFFORTS_CODEX_PA.filter((e) => todosEfs.has(e));
  return `codex:{${slugs.join(",")}}-{${(efs.length ? efs : EFFORTS_CODEX_PA).join(",")}}`;
}
