// Qué motor corre cada modelo de pa (agy, codex, dsh, opencode, ollama o claude), los modelos válidos de cada uno, su
// equivalente Claude cuando caen, y qué flags de pa no van con cada motor. Copia de motor/bin/pa (es_gemini, GEMINI_MODELOS,
// gemini_equivalente, es_codex, CODEX_MODELOS, codex_equivalente, es_dsh, es_opencode, DSH_MODELOS, OC_MODELOS, dsh_proveedor,
// dsh_modelo_de, dsh_gratis, opencode_gratis, es_local, proveedor_de_modelo, proveedor_cuenta_de y los rechazos del armado).

/** El programa que corre al worker. `dsh` cubre también a opencode (runner node, stream NDJSON, sin --seguir). */
export type Motor = "claude" | "agy" | "codex" | "dsh" | "ollama";
export type Proveedor = "claude" | "google" | "chatgpt" | "opencode" | "";

export const GEMINI_MODELOS = "gemini-4-argon-(low|medium|high)|gemini-3\\.8-flash-(low|medium|high)|agy:(claude-(opus|sonnet)-5-5-(low|medium|high)|gpt-oss-120b-medium)";
export const CODEX_MODELOS = "codex:(gpt-6\\.1-sol|gpt-6-sol|gpt-6-luna|gpt-6-astra)-(low|medium|high)";
/** `[^[:space:]]` del bash: sin blancos ASCII. */
const NO_BLANCO = "[^ \\t\\n\\v\\f\\r]";
export const DSH_MODELOS = `dsh:(ollama|opencode|deepseek)/${NO_BLANCO}+`;
export const OC_MODELOS = `opencode:[A-Za-z0-9][A-Za-z0-9._-]*/${NO_BLANCO}+`;
/** Lo que `opencode models` lista como gratis cuando no contesta. */
export const OC_GRATIS_CONOCIDOS =
  "big-pickle beam-free deepseek-v4.1-flash-free flint-40b-free glm-5.3-flash-free mimo-v2.6-flash-free minimax-m3.1-flash-free nemotron-3-ultra-free nemotron-3.5-lightning-free nemotron-3.5-super-vl-free".split(" ");
export const DSH_DEEPSEEK_MODELOS = ["deepseek-v4-flash"];

/** `[[ x =~ ^(re)$ ]]`. */
export const calza = (re: string, x: string) => new RegExp(`^(${re})$`).test(x);

const min = (m: string) => m.toLowerCase();
export const esGemini = (m: string) => min(m).startsWith("gemini") || min(m).startsWith("agy:");
export const esCodex = (m: string) => min(m).startsWith("codex:");
export const esOpencode = (m: string) => min(m).startsWith("opencode:");
export const esDsh = (m: string) => min(m).startsWith("dsh:") || esOpencode(m);
export const esLocal = (m: string) => min(m).startsWith("ollama:");

/** El motor de un modelo ya validado (el `motor` que deja el bash cuando nada cae). */
export function motorDe(m: string): Motor {
  if (esGemini(m)) return "agy";
  if (esCodex(m)) return "codex";
  if (esDsh(m)) return "dsh";
  if (esLocal(m)) return "ollama";
  return "claude";
}

/** `dsh:opencode/big-pickle` → `opencode` (también `opencode:<proveedor>/…` → el proveedor). */
export const dshProveedor = (m: string) => {
  const r = m.slice(m.indexOf(":") + 1);
  const i = r.indexOf("/");
  return i < 0 ? r : r.slice(0, i);
};
/** `dsh:opencode/big-pickle` → `big-pickle`. */
export const dshModeloDe = (m: string) => {
  const r = m.slice(m.indexOf(":") + 1);
  const i = r.indexOf("/");
  return i < 0 ? r : r.slice(i + 1);
};
/** ¿No cuesta? ollama siempre; opencode big-pickle y los *-free; deepseek nunca. */
export function dshGratis(m: string): boolean {
  const p = dshProveedor(m);
  if (p === "ollama") return true;
  if (p === "opencode") {
    const x = dshModeloDe(m);
    return x === "big-pickle" || x.endsWith("-free");
  }
  return false;
}
/** opencode: gratis son `opencode/big-pickle` y los `*-free`. */
export function opencodeGratis(m: string): boolean {
  const v = m.startsWith("opencode:") ? m.slice("opencode:".length) : m;
  return v === "opencode/big-pickle" || v.endsWith("-free");
}

/** La suscripción que paga el modelo (para reparto); vacío para un local o dsh. */
export function proveedorDeModelo(m: string): Proveedor {
  if (esLocal(m) || esDsh(m)) return "";
  if (esCodex(m)) return "chatgpt";
  if (esGemini(m)) return "google";
  return "claude";
}
/** La de las cuentas: opencode:* también tiene cuentas (proveedor opencode). */
export const proveedorCuentaDe = (m: string): Proveedor => (esOpencode(m) ? "opencode" : proveedorDeModelo(m));

/** `"modelo effort"` del Claude oficial al que cae un modelo de agy (vacío si no hay). */
export function geminiEquivalente(m: string): string {
  const fijos: Record<string, string> = {
    "gemini-4-argon-high": "claude-opus-5-5 medium",
    "gemini-4-argon-medium": "claude-sonnet-5-5 high",
    "gemini-4-argon-low": "claude-sonnet-5-5 medium",
    "gemini-3.8-flash-high": "claude-haiku-5-5 xhigh",
    "gemini-3.8-flash-medium": "claude-haiku-5-5 high",
    "gemini-3.8-flash-low": "claude-haiku-5-5 medium",
  };
  if (fijos[m]) return fijos[m];
  const e = m.slice(m.lastIndexOf("-") + 1);
  if (m.startsWith("agy:claude-opus-5-5-")) return `claude-opus-5-5 ${e}`;
  if (m.startsWith("agy:claude-sonnet-5-5-")) return `claude-sonnet-5-5 ${e}`;
  if (m.startsWith("agy:gpt-oss-120b-")) return "claude-sonnet-5-5 medium";
  return "";
}
/** `"modelo effort"` del Claude oficial al que cae un modelo de codex. */
export function codexEquivalente(m: string): string {
  const e = m.slice(m.lastIndexOf("-") + 1);
  if (m.startsWith("codex:gpt-6-astra-")) return `claude-opus-5-5 ${e}`;
  if (m.startsWith("codex:gpt-6-luna-")) return `claude-haiku-5-5 ${e === "low" ? "medium" : e === "medium" ? "high" : "xhigh"}`;
  if (m.startsWith("codex:")) return `claude-sonnet-5-5 ${e}`;
  return "";
}

// ---------------------------------------------------------------- validar el -m y los flags que no van

/** Lo que pidió la llamada y cambia lo que un motor acepta. */
export interface FlagsLanzar {
  /** --effort explícito (no PA_EFFORT ni modelos.json). */
  esfuerzoFlag?: boolean;
  seguir?: boolean;
  aca?: boolean;
  mcp?: boolean;
  leer?: boolean;
  maxBudget?: string;
  cuentaFlag?: string;
}

/** Un modelo de otro motor normalizado, o el mensaje de error (sale 2) tal cual lo dice el bash. */
export type Validacion = { ok: true; modelo: string; motor: Motor } | { ok: false; error: string };

const noVa = (m: string, que: string) => `pa: ${que} no va con '${m}'. Sacalo, o usá un modelo Claude.`;

/**
 * La validación del `-m` de un modelo que no es Claude y de los flags que ese motor no tiene (los `exit 2` del bash, en el mismo
 * orden). No mira la privacidad ni si el programa está: eso es `chequear` (motores/chequeo.ts). `null`: es un Claude.
 */
export function validarOtroMotor(modelo: string, f: FlagsLanzar = {}): Validacion | null {
  const err = (error: string): Validacion => ({ ok: false, error });
  if (esGemini(modelo)) {
    if (!calza(GEMINI_MODELOS, min(modelo)))
      return err(`pa: modelo '${modelo}' no va. Modelos de agy en pa: gemini-{4-argon,3.8-flash}-{low,medium,high}, agy:claude-{opus,sonnet}-5-5-{low,medium,high} o agy:gpt-oss-120b-medium.`);
    const m = min(modelo);
    if (f.esfuerzoFlag) return err(`pa: --effort no va con '${m}': en agy el effort es parte del nombre (…-low, …-medium, …-high).`);
    if (f.seguir) return err(noVa(m, "--seguir (agy no retoma una sesión de pa)"));
    if (f.aca) return err(noVa(m, "--aca/--sucio-mio (un worker de agy trabaja siempre en su worktree)"));
    if (f.mcp) return err(noVa(m, "--mcp (los MCP de claude.ai no existen en agy)"));
    if (f.maxBudget) return err(`pa: --max-budget-usd no va con '${m}' (agy se paga con el cupo, no en US$).`);
    return { ok: true, modelo: m, motor: "agy" };
  }
  if (esCodex(modelo)) {
    if (!calza(CODEX_MODELOS, min(modelo)))
      return err(`pa: modelo '${modelo}' no va. Modelos de codex en pa: codex:{gpt-6.1-sol,gpt-6-sol,gpt-6-luna,gpt-6-astra}-{low,medium,high}.`);
    const m = min(modelo);
    if (f.esfuerzoFlag) return err(`pa: --effort no va con '${m}': en codex el effort es parte del nombre (…-low, …-medium, …-high).`);
    if (f.seguir) return err(noVa(m, "--seguir (codex no retoma una sesión de pa)"));
    if (f.aca) return err(noVa(m, "--aca/--sucio-mio (un worker de codex trabaja siempre en su worktree)"));
    if (f.mcp) return err(noVa(m, "--mcp (los MCP de claude.ai no existen en codex)"));
    if (f.maxBudget) return err(`pa: --max-budget-usd no va con '${m}' (codex se paga con la suscripción de ChatGPT, no en US$).`);
    return { ok: true, modelo: m, motor: "codex" };
  }
  if (esDsh(modelo)) {
    let m: string;
    let eng: string;
    if (esOpencode(modelo)) {
      eng = "opencode";
      m = `opencode:${modelo.slice(modelo.indexOf(":") + 1)}`;
      if (!calza(OC_MODELOS, m))
        return err(`pa: modelo '${m}' no va. Los de opencode son opencode:<proveedor>/<modelo> (ej. opencode:opencode/deepseek-v4.1-flash-free; la lista sale de \`opencode models\`).`);
    } else {
      eng = "dsh";
      m = `dsh:${dshProveedor(modelo).replace(/[A-Z]/g, (c) => c.toLowerCase())}/${dshModeloDe(modelo)}`;
      if (!calza(DSH_MODELOS, m))
        return err(`pa: modelo '${m}' no va. Los de dsh son dsh:<ollama|opencode|deepseek>/<modelo> (ej. dsh:ollama/qwen3-coder:30b); los gratis de OpenCode van con opencode:opencode/<modelo>.`);
      if (f.esfuerzoFlag) return err(`pa: --effort no va con '${m}': ${eng} no tiene effort.`);
    }
    if (f.seguir) return err(noVa(m, `--seguir (${eng} no retoma una sesión de pa)`));
    if (f.aca) return err(noVa(m, `--aca/--sucio-mio (un worker de ${eng} trabaja siempre en su worktree)`));
    if (f.mcp) return err(noVa(m, `--mcp (los MCP de claude.ai no existen en ${eng})`));
    if (f.leer) return err(noVa(m, `--leer (${eng} no tiene un modo de sólo lectura que alcance al bash)`));
    if (f.maxBudget) return err(`pa: --max-budget-usd no va con '${m}' (${eng} no mide el gasto en US$).`);
    if (f.cuentaFlag && !esOpencode(m)) return err(`pa: --cuenta no va con '${m}': ${eng} no usa ninguna suscripción de pa.`);
    return { ok: true, modelo: m, motor: "dsh" };
  }
  if (esLocal(modelo)) {
    if (!/^[Oo][Ll][Ll][Aa][Mm][Aa]:[^ \t\n\v\f\r]+$/.test(modelo)) return err(`pa: modelo '${modelo}' no va: un local es ollama:<modelo> (ej. ollama:qwen3-coder:30b).`);
    const m = `ollama:${modelo.slice(modelo.indexOf(":") + 1)}`;
    if (f.esfuerzoFlag) return err(`pa: --effort no va con '${m}': un modelo local no tiene effort.`);
    if (f.maxBudget) return err(`pa: --max-budget-usd no va con '${m}' (un local no se paga en US$).`);
    return { ok: true, modelo: m, motor: "ollama" };
  }
  return null;
}
