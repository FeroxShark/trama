// Presets de skills por tipo de worker (Fase 1 de docs/plan-orquestador-presets.md). Un preset dice qué skills cargan los
// workers de un tipo: `todo` (sólo el apagado global), `apagar` (apaga las que lista) o `solo` (carga sólo las que lista).
// Lo guarda `presets.ts` en `<config de trama>/presets.json`. Este archivo es PURO (sin Node ni Electron): lo importan
// el main, `pa` y la interfaz React.

export type ModoPreset = "todo" | "apagar" | "solo";
export const MODOS_PRESET: readonly ModoPreset[] = ["todo", "apagar", "solo"];

export type PresetSkills = { modo: ModoPreset; skills: string[] };

export type ConfigPresets = {
  version: 1;
  presets: Record<string, PresetSkills>;
  /** Tipo de worker (o `lectura` / `default`) → nombre de preset. */
  por_tipo: Record<string, string>;
};

/** Cuántos presets como mucho (uno que crece sin fin es un error, no un uso). */
const MAX_PRESETS = 50;
/** Cuántas skills por preset como mucho. */
const MAX_SKILLS = 200;

export const PRESETS_NOMBRES_FABRICA = ["minimo", "codigo", "diseno", "orquestador", "todo"] as const;

const SKILLS_CODIGO = ["ui-ux-pro-max", "taste-skill", "design-taste-frontend", "frontend-design", "frontend-design:frontend-design", "stageshow", "diseno", "trama-orquestar"];
const SKILLS_DISENO = ["ui-ux-pro-max", "taste-skill", "design-taste-frontend", "frontend-design", "frontend-design:frontend-design", "stageshow", "diseno"];

/** Los defaults de fábrica (copia nueva cada vez: nadie puede mutar el objeto compartido). */
export function presetsFabrica(): ConfigPresets {
  return {
    version: 1,
    presets: {
      minimo: { modo: "solo", skills: [] },
      codigo: { modo: "apagar", skills: [...SKILLS_CODIGO] },
      diseno: { modo: "solo", skills: [...SKILLS_DISENO] },
      orquestador: { modo: "solo", skills: ["trama-orquestar"] },
      todo: { modo: "todo", skills: [] },
    },
    por_tipo: {
      mecanico: "minimo",
      lectura: "minimo",
      "codigo-acotado": "codigo",
      "codigo-multi": "codigo",
      debug: "codigo",
      final: "codigo",
      default: "codigo",
      frontend: "diseno",
      diseno: "diseno",
    },
  };
}

/** Un nombre de preset o de tipo: letras, números, `_` o `-`, hasta 40. */
export function nombrePresetValido(x: unknown): x is string {
  return typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x);
}

export function modoPresetValido(x: unknown): x is ModoPreset {
  return typeof x === "string" && (MODOS_PRESET as readonly string[]).includes(x);
}

/** Una skill como la lista Claude Code (`nombre` o `plugin:nombre`): sin espacios ni caracteres de control, hasta 300. */
export function skillPresetValida(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 300 && !/[\s\u0000-\u001f\u007f]/.test(x);
}

const esObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/**
 * Un `presets.json` leído (o recibido) limpio. Siempre parte de los defaults de fábrica: un preset de fábrica que
 * falte o venga roto vuelve a su valor de fábrica; lo inválido se descarta sin romper nada.
 */
export function normalizarPresets(x: unknown): ConfigPresets {
  const base = presetsFabrica();
  if (!esObjeto(x)) return base;

  if (esObjeto(x.presets)) {
    for (const [nombre, p] of Object.entries(x.presets)) {
      if (!nombrePresetValido(nombre) || !esObjeto(p) || !modoPresetValido(p.modo)) continue;
      if (!(nombre in base.presets) && Object.keys(base.presets).length >= MAX_PRESETS) continue;
      const skills = Array.isArray(p.skills) ? [...new Set(p.skills.filter(skillPresetValida))].slice(0, MAX_SKILLS) : [];
      base.presets[nombre] = { modo: p.modo, skills };
    }
  }

  if (esObjeto(x.por_tipo)) {
    for (const [tipo, preset] of Object.entries(x.por_tipo)) {
      if (!nombrePresetValido(tipo) || typeof preset !== "string") continue;
      if (!(preset in base.presets)) continue;
      base.por_tipo[tipo] = preset;
    }
  }

  return base;
}

/**
 * El preset que le toca a un worker. Con `preset` explícito lo busca por nombre (`null` si no existe). Si no, lo infiere:
 * `tipo` → su entrada en `por_tipo`; sin tipo pero con `leer` → `lectura`; y si nada calza, `default`.
 */
export function resolverPreset(
  cfg: ConfigPresets,
  opts: { preset?: string | null; tipo?: string | null; leer?: boolean },
): { nombre: string; preset: PresetSkills } | null {
  if (opts.preset) {
    const p = cfg.presets[opts.preset];
    return p ? { nombre: opts.preset, preset: p } : null;
  }
  const candidatos = [opts.tipo, opts.leer && !opts.tipo ? "lectura" : null, "default"];
  for (const c of candidatos) {
    if (!c) continue;
    const nombre = cfg.por_tipo[c];
    if (nombre && cfg.presets[nombre]) return { nombre, preset: cfg.presets[nombre] };
  }
  return null;
}

/** ¿La skill instalada está apagada por el global o por el nombre de ella (clave o nombre corto)? */
const calza = (s: { clave: string; nombre: string }, lista: ReadonlySet<string> | readonly string[]) => {
  const has = (v: string) => (lista instanceof Set ? lista.has(v) : (lista as readonly string[]).includes(v));
  return has(s.clave) || has(s.nombre);
};

/**
 * Las claves de skill a apagar para este worker. Las globales (`apagados.json`) quedan SIEMPRE, con preset o sin él.
 * - `todo` (o sin preset): sólo las globales.
 * - `apagar`: además, las instaladas que calzan con `preset.skills` (por clave o por nombre).
 * - `solo`: además, toda instalada que NO calce con `preset.skills`.
 */
export function apagadasPorPreset(
  todas: readonly { clave: string; nombre: string }[],
  preset: PresetSkills | null | undefined,
  apagadasGlobales: readonly string[],
): string[] {
  const salida = new Set<string>(apagadasGlobales);
  if (!preset || preset.modo === "todo") return [...salida];
  for (const s of todas) {
    const en = calza(s, preset.skills);
    const apagar = preset.modo === "apagar" ? en : !en;
    if (apagar) salida.add(s.clave);
  }
  return [...salida];
}

/**
 * ¿Queda alguna skill cargada con este preset? `false` si es `solo` sin skills (no carga ninguna), o si todas las
 * instaladas quedan apagadas (globales incluidas).
 */
export function presetHabilitaSkills(
  todas: readonly { clave: string; nombre: string }[],
  preset: PresetSkills,
  apagadasGlobales: readonly string[],
): boolean {
  if (preset.modo === "solo" && preset.skills.length === 0) return false;
  const apagadas = new Set(apagadasPorPreset(todas, preset, apagadasGlobales));
  return todas.some((s) => !calza(s, apagadas));
}
