// La tabla de modelos que ofrecen los selectores: UN lugar. Un modelo nuevo se agrega con una entrada acá
// (y su texto en i18n); los niveles de esfuerzo que muestra, cuál es el de arranque y si corre en la GPU
// local salen de su fila. Sin JSX ni imports locales de verdad: lo prueban los tests.
import type { ClaveSola } from "../i18n";

/** Los niveles de esfuerzo de Claude Code: `pa` y `claude --effort` los conocen. */
export const EFFORTS_CLAUDE = ["low", "medium", "high", "xhigh", "max"] as const;
/**
 * Los de un modelo local (llama-server con plantilla Qwen3.x): `off` apaga el razonamiento y `high` no existe
 * (la plantilla lo rechaza: el máximo es `xhigh`). Igual que `reasoningEfforts` de `~/.dsh/settings.yaml`.
 */
export const EFFORTS_LOCAL = ["off", "low", "medium", "xhigh"] as const;

/** Quién hace el modelo: el menú los agrupa por empresa, con su nombre como divisor y su logo (`src/hilo/Logos.tsx`) junto a cada uno. */
export type Empresa = "anthropic" | "google" | "local" | "ollama" | "dsh" | "opencode";
/** El nombre de cada empresa, tal cual se escribe (un nombre propio: no se traduce). `local`: lo pone cada modelo (`empresaNombre`). */
export const EMPRESAS: Record<Empresa, string> = { anthropic: "Anthropic", google: "Google", local: "Local", ollama: "Ollama", dsh: "DeepSeek Harness", opencode: "OpenCode" };

/** Los de Gemini (`agy`): tres niveles de razonamiento, el máximo por defecto. */
export const EFFORTS_GEMINI = ["low", "medium", "high"] as const;

export type ModeloDef = {
  /** Lo que viaja a `claude --model` / `pa -m` (el de Claude es el de la API; el local, el de nuestra tabla). */
  id: string;
  /** Lo que se busca en el id de modelo de un hilo ("claude-sonnet-5-5[1m]" → "sonnet"). */
  clave: string;
  nombre: string;
  empresa: Empresa;
  /** El divisor del menú si no es el de `EMPRESAS` (un local de llama-server dice quién lo hace en `locales.json`). */
  empresaNombre?: string;
  /** Para qué sirve, en una línea (clave de i18n). */
  desc: ClaveSola;
  /** El default de la tabla de routing. */
  rec?: boolean;
  /** Gratis (los `*-free` y `big-pickle` de OpenCode): el menú lo marca. */
  gratis?: boolean;
  /** De OpenCode Go (plan pago de OpenCode, con el plan prendido en Ajustes > OpenCode): el menú lo marca con el texto «Plan Go». */
  go?: boolean;
  /** Corre en la GPU de esta máquina (llama-server): sin límites de Claude, con contexto a elegir. */
  local?: boolean;
  /** Sólo se puede elegir para un líder: `pa -m` no lo conoce (Gemini, Ollama). Fuera de los selectores de worker. */
  soloLider?: boolean;
  /** Un líder con este modelo no puede delegar con `pa` (Ollama: `pa` se niega bajo un endpoint local). La caja lo avisa. */
  sinWorkers?: boolean;
  /** Los niveles de esfuerzo que tiene, del más bajo al más alto. */
  efforts: readonly string[];
  /** Con el que arranca si el usuario no eligió otro para este modelo (ante la duda entre dos, el más alto en Claude). */
  effortDefecto: string;
};

/**
 * En el orden de los selectores (pedido del usuario, 2026-10-18): Fable, Opus, Sonnet, Haiku y después los locales. El menú
 * agrupa por empresa (Anthropic y las que traen los locales: las filas de una empresa van juntas) y marca con un chip a los locales. El default (`rec`) sigue siendo Opus, el de routing: el orden no lo cambia.
 */
const tabla: ModeloDef[] = [
  { id: "claude-fable-5-1", clave: "fable", empresa: "anthropic", nombre: "Fable 5.1", desc: "modelo.fable", efforts: EFFORTS_CLAUDE, effortDefecto: "high" },
  { id: "claude-opus-5-5", clave: "opus", empresa: "anthropic", nombre: "Opus 5.5", desc: "modelo.opus", rec: true, efforts: EFFORTS_CLAUDE, effortDefecto: "high" },
  { id: "claude-sonnet-5-5", clave: "sonnet", empresa: "anthropic", nombre: "Sonnet 5.5", desc: "modelo.sonnet", efforts: EFFORTS_CLAUDE, effortDefecto: "high" },
  { id: "claude-haiku-5-5", clave: "haiku", empresa: "anthropic", nombre: "Haiku 5.5", desc: "modelo.haiku", efforts: EFFORTS_CLAUDE, effortDefecto: "high" },
];

/**
 * Lo que `~/.config/trama/modelos.json` y `locales.json` agregan: sin esos archivos la tabla es la de arriba, igual que siempre. Gemini (`agy`) está
 * si el archivo lo habilita, cada modelo de Ollama que anota en `locales` es una fila más y cada uno de `locales.json` (llama-server, en la GPU) también. Se arma una vez, antes de pintar.
 */
const GEMINI: ModeloDef[] = [
  { id: "gemini-4-argon", clave: "gemini-4-argon", empresa: "google", nombre: "Gemini 4 Argon · por Google", desc: "modelo.gemini4", soloLider: true, efforts: EFFORTS_GEMINI, effortDefecto: "high" },
  { id: "gemini-3.8-flash", clave: "gemini-3.8-flash", empresa: "google", nombre: "Gemini 3.8 Flash · por Google", desc: "modelo.gemini38", soloLider: true, efforts: EFFORTS_GEMINI, effortDefecto: "high" },
  { id: "agy:claude-opus-5-5", clave: "agy:claude-opus-5-5", empresa: "google", nombre: "Claude Opus 5.5 · por Google", desc: "modelo.agyOpus", soloLider: true, efforts: EFFORTS_GEMINI, effortDefecto: "high" },
  { id: "agy:claude-sonnet-5-5", clave: "agy:claude-sonnet-5-5", empresa: "google", nombre: "Claude Sonnet 5.5 · por Google", desc: "modelo.agySonnet", soloLider: true, efforts: EFFORTS_GEMINI, effortDefecto: "high" },
  { id: "agy:gpt-oss-120b", clave: "agy:gpt-oss-120b", empresa: "google", nombre: "GPT-OSS 120B · por Google", desc: "modelo.agyGpt", soloLider: true, efforts: EFFORTS_GEMINI, effortDefecto: "medium" },
];
/**
 * DeepSeek Harness (`dsh`): el de la API de DeepSeek, siempre (los gratis de OpenCode ya no están: sólo andan por el programa `opencode`, abajo); los de Ollama salen de `locales`
 * (`dsh:ollama/<modelo>`, el mismo modelo que ya agregó el usuario). Un líder de dsh sí delega con `pa` (no hay `sinWorkers`); sin
 * esfuerzo (el modelo no lo expone) y sólo de líder, igual que Gemini y Ollama.
 */
const dsh = (id: string, nombre: string, desc: ModeloDef["desc"]): ModeloDef => ({ id, clave: id, empresa: "dsh", nombre, desc, efforts: [], effortDefecto: "high" });
const DSH: ModeloDef[] = [
  dsh("dsh:deepseek/deepseek-v4-flash", "DeepSeek V4 Flash · DeepSeek", "modelo.dshDeepseek"),
];

/** `opencode/deepseek-v4.1-flash-free` → «DeepSeek V4.1 Flash»: el nombre que se lee de un id de `opencode models` (sin `-free`; las siglas en mayúsculas). */
export function nombreOpencode(valor: string): string {
  const modelo = (valor.split("/").pop() ?? valor).replace(/-free$/, "");
  const SIGLAS: Record<string, string> = { gpt: "GPT", glm: "GLM", vl: "VL", mimo: "MiMo", deepseek: "DeepSeek", oss: "OSS", llm: "LLM" };
  return modelo
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => SIGLAS[w] ?? (/^v?\d/.test(w) ? w.replace(/^v/, "V").replace(/(\d)b$/i, "$1B") : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}
/** ¿Es gratis? (`*-free` y `big-pickle` de OpenCode.) Igual que `esGratis` de electron/opencode.ts. */
export const esGratisOpencode = (valor: string) => /-free$/.test(valor) || valor === "opencode/big-pickle";
/** ¿Es de OpenCode Go? (proveedor `opencode-go`.) Igual que `esModeloGo` de electron/opencode.ts. */
export const esGoOpencode = (valor: string) => /^(?:opencode:)?opencode-go\//.test(valor);
/** Un modelo del programa `opencode`: el id es `opencode:<proveedor>/<modelo>` (lo que imprime `opencode models`, con el prefijo). Con el plan Go prendido, los de Go dicen «plan Go» (con texto, nunca sólo color). */
const opencode = (valor: string, niveles: readonly string[] = [], planGo = false): ModeloDef => {
  const gratis = esGratisOpencode(valor);
  const go = planGo && esGoOpencode(valor);
  const prov = valor.slice(0, valor.indexOf("/"));
  return {
    id: `opencode:${valor}`,
    clave: `opencode:${valor}`,
    empresa: "opencode",
    nombre: `${nombreOpencode(valor)} · ${gratis ? "Gratis" : go ? "Plan Go" : prov === "opencode" ? "Zen" : prov}`,
    desc: gratis ? "modelo.opencodeGratis" : go ? "modelo.opencodeGo" : "modelo.opencode",
    ...(gratis ? { gratis: true } : {}),
    ...(go ? { go: true } : {}),
    // Los niveles que `opencode models --verbose` dice (`variants`); sin ellos el modelo no razona y no hay selector. Por defecto `medium` si está.
    efforts: niveles,
    effortDefecto: niveles.includes("medium") ? "medium" : (niveles[0] ?? "high"),
  };
};
const BASE = tabla.slice();
export const TABLA: readonly ModeloDef[] = tabla;

export type ConfigModelos = {
  /** Gemini disponible (el archivo lo habilita, o es el líder por defecto). */
  gemini: boolean;
  /** DeepSeek Harness disponible: `dsh` está instalado (o es el líder por defecto). */
  dsh?: boolean;
  /** Los modelos que lista `opencode models` (`<proveedor>/<modelo>`), si el programa `opencode` está instalado: los gratis primero. Sin él (o sin la clave), ninguno. */
  opencode?: string[];
  /** Los niveles de esfuerzo de esos modelos (`opencode/xxx` → `["low","medium","high"]`); el que no figura no razona. */
  opencodeEfforts?: Record<string, string[]>;
  /** El plan de OpenCode Go prendido en Ajustes (`go` o `go-plus`); ausente: apagado, los modelos de OpenCode se ven como siempre. */
  opencodePlan?: "go" | "go-plus";
  /** Los modelos de Ollama del archivo: su id (`ollama:…`), el nombre que se ve y el que Ollama conoce (para `dsh:ollama/<modelo>`). Ni la url ni nada más llega acá. */
  locales: { id: string; nombre: string; modelo?: string }[];
  /** Los modelos de llama-server que declara `locales.json`: su id, el nombre y quién lo hace. Ni la unit ni las rutas llegan acá. */
  llama?: { id: string; nombre: string; empresa: string }[];
  /** El líder por defecto (`lider` del archivo), o `null`: el de siempre. */
  lider: { modelo: string; effort: string | null } | null;
};

/** `gemini-4-argon-high` → `["gemini-4-argon", "high"]`; cualquier otro, tal cual y sin nivel. */
export const partirGeminiId = (id: string): [string, string | null] => {
  const m = /^((?:gemini-|agy:).+?)-(low|medium|high)$/.exec(id);
  return m ? [m[1]!, m[2]!] : [id, null];
};

/**
 * Deja la tabla como la piden `modelos.json` y `locales.json`: llama-server, Gemini y Ollama agregados (cada empresa contigua, los locales de GPU antes de Ollama) y,
 * si el archivo dice un líder por defecto que existe en la tabla, ése lleva la marca de default y su esfuerzo. Devuelve el id de ese líder
 * (`null`: Opus, el de siempre). Idempotente. Los ids de Ollama traen el prefijo; la clave es el id entero (un nombre como "haiku" dentro no confunde).
 */
export function ponerConfig(c: ConfigModelos | null): { modelo: string; effort: string | null } | null {
  const ollama: ModeloDef[] = (c?.locales ?? []).map((l) => ({
    id: l.id,
    clave: l.id,
    empresa: "ollama" as const,
    nombre: l.nombre,
    desc: "modelo.ollama" as const,
    soloLider: true,
    sinWorkers: true,
    efforts: [],
    effortDefecto: "high",
  }));
  // Cada empresa en filas contiguas (el divisor del menú es uno por empresa), en el orden en que aparece en `locales.json`.
  const empresasLlama = [...new Set((c?.llama ?? []).map((l) => l.empresa))];
  const llama: ModeloDef[] = [...(c?.llama ?? [])].sort((x, y) => empresasLlama.indexOf(x.empresa) - empresasLlama.indexOf(y.empresa)).map((l) => ({
    id: l.id,
    clave: l.id,
    empresa: "local" as const,
    empresaNombre: l.empresa,
    nombre: l.nombre,
    desc: "modelo.llama" as const,
    local: true,
    efforts: EFFORTS_LOCAL,
    effortDefecto: "medium",
  }));
  // Un líder por defecto de dsh aparece aunque `dsh` ya no esté instalado; los de Ollama de dsh, los del mismo archivo que los de Ollama.
  const delLider = c?.lider && esDsh(c.lider.modelo) ? c.lider.modelo : null;
  const dshOllama = (c?.locales ?? []).flatMap((l) => (l.modelo ? [dsh(`dsh:ollama/${l.modelo}`, `${l.nombre} · Ollama`, "modelo.dshOllama")] : []));
  const dshTodos = c?.dsh || delLider ? [...DSH.map((m) => ({ ...m })), ...dshOllama] : [];
  if (delLider && !dshTodos.some((m) => m.id === delLider)) dshTodos.push(dsh(delLider, delLider.slice("dsh:".length), delLider.startsWith("dsh:opencode/") ? "modelo.dshOpencode" : delLider.startsWith("dsh:deepseek/") ? "modelo.dshDeepseek" : "modelo.dshOllama"));
  // Un líder por defecto de opencode aparece aunque el programa ya no lo liste; los gratis, primero.
  const delOpencode = c?.lider && esOpencode(c.lider.modelo) ? c.lider.modelo.slice("opencode:".length) : null;
  const valores = [...new Set([...(c?.opencode ?? []), ...(delOpencode ? [delOpencode] : [])])];
  const planGo = !!c?.opencodePlan;
  // Gratis primero y, con el plan Go prendido, los de Go enseguida; el resto de Zen / proveedores propios al final.
  const ordenOc = (v: string) => (esGratisOpencode(v) ? 0 : planGo && esGoOpencode(v) ? 1 : 2);
  const opencodeTodos = [...valores].sort((a, b) => ordenOc(a) - ordenOc(b)).map((v) => opencode(v, c?.opencodeEfforts?.[v] ?? [], planGo));
  const base = BASE.map((m) => ({ ...m }));
  tabla.length = 0;
  tabla.push(...base, ...llama, ...(c?.gemini ? GEMINI.map((m) => ({ ...m })) : []), ...ollama, ...dshTodos, ...opencodeTodos);
  const lider = c?.lider ?? null;
  if (!lider) return null;
  const [id, nivel] = partirGeminiId(lider.modelo);
  const fila = tabla.find((m) => m.id === id);
  if (!fila) return null;
  const effort = [nivel, lider.effort].find((e): e is string => !!e && fila.efforts.includes(e)) ?? null;
  for (const m of tabla) delete m.rec;
  fila.rec = true;
  if (effort) fila.effortDefecto = effort;
  return { modelo: fila.id, effort };
}

/** La fila de un modelo por su id exacto (o por la clave dentro del id de un hilo, que puede traer fecha o sufijo). */
export const defDe = (modelo: string | null | undefined): ModeloDef | undefined => {
  if (!modelo) return undefined;
  const base = partirGeminiId(modelo)[0];
  const prefijo = /^(?:ollama|agy|dsh|opencode):/.exec(modelo)?.[0];
  return (
    TABLA.find((m) => m.id === modelo || m.id === base) ??
    TABLA.find((m) => (prefijo ? m.id.startsWith(prefijo) : !/^(?:ollama|agy|dsh|opencode):/.test(m.id)) && modelo.includes(m.clave))
  );
};

export const esLocal = (modelo: string | null | undefined) => defDe(modelo)?.local === true;

/** ¿Un líder con este modelo corre por `agy` (`gemini-*` o `agy:*`)? */
export const esAgy = (modelo: string | null | undefined): boolean =>
  defDe(modelo)?.empresa === "google" || /^(?:gemini-|agy:)/.test(modelo ?? "");

/** ¿Un líder con este modelo corre por DeepSeek Harness (`dsh:<proveedor>/<modelo>`)? */
export const esDsh = (modelo: string | null | undefined): boolean => /^dsh:/.test(modelo ?? "");

/** ¿Un líder con este modelo corre por el programa `opencode` (`opencode:<proveedor>/<modelo>`)? */
export const esOpencode = (modelo: string | null | undefined): boolean => /^opencode:/.test(modelo ?? "");

/**
 * El motor de un líder: un líder no cambia de uno a otro en la misma sesión (otro proceso, otro transcript); dentro del mismo sí.
 * Claude y Ollama son el mismo `claude`.
 */
export const familiaDe = (modelo: string | null | undefined): "claude" | "agy" | "dsh" | "opencode" => (esOpencode(modelo) ? "opencode" : esDsh(modelo) ? "dsh" : esAgy(modelo) ? "agy" : "claude");

/**
 * El motor que corre un modelo, para decirlo en la caja ("arranca una sesión nueva de Gemini (agy)"). Nombres propios: no se traducen.
 * Un modelo de Ollama corre por su endpoint (el mismo `claude` contra otro destino), pero es lo que la persona reconoce.
 */
export const motorNombre = (modelo: string | null | undefined): string =>
  esOpencode(modelo) ? "OpenCode" : esDsh(modelo) ? "DeepSeek Harness" : esAgy(modelo) ? "Gemini (agy)" : /^ollama:/.test(modelo ?? "") ? "Ollama" : "Claude Code";

/** ¿Un líder con este modelo no puede delegar con `pa`? Los locales de GPU y Ollama. */
export const sinWorkers = (modelo: string | null | undefined) => {
  const d = defDe(modelo);
  return d?.local === true || d?.sinWorkers === true;
};

/** Los niveles de un modelo; uno que la tabla no conoce tiene los de Claude (salvo uno de OpenCode o dsh: no los inventa, no tiene). */
export const effortsDe = (modelo: string | null | undefined): readonly string[] =>
  defDe(modelo)?.efforts ?? (esOpencode(modelo) || esDsh(modelo) ? [] : esAgy(modelo) ? EFFORTS_GEMINI : EFFORTS_CLAUDE);

/** El esfuerzo de ese modelo si existe en su lista, si no `null`. */
export const effortDeModelo = (modelo: string | null | undefined, e: string | null | undefined): string | null =>
  e && effortsDe(modelo).includes(e) ? e : null;

/**
 * El esfuerzo de un modelo: el último que el usuario eligió para él (si todavía es un nivel suyo) o el de la tabla.
 * Un modelo que la tabla no conoce usa `high`.
 */
export const effortPara = (modelo: string, prefs: Record<string, string>): string =>
  effortDeModelo(modelo, prefs[modelo]) ?? defDe(modelo)?.effortDefecto ?? "high";

/**
 * Al cambiar de modelo: el esfuerzo que le toca a ese modelo, que siempre es un nivel suyo (el último que el usuario eligió para él, o
 * el de la tabla). Se recuerda por modelo (Opus vuelve a `high` aunque Sonnet quedó en `medium`); el `actual` sólo sirve para
 * que el resultado, si el modelo nuevo no lo tiene, no lo arrastre: nunca queda un nivel que el modelo no existe (`off` en Claude, `high`/`max` en un local).
 */
export const reajustarEffort = (modelo: string, _actual: string | null | undefined, prefs: Record<string, string>): string => effortPara(modelo, prefs);
