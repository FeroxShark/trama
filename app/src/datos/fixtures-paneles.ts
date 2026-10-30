// Datos falsos de los paneles del pie (Ajustes y Estadísticas), para el bench
// y las capturas. Ramas sale de los hilos de fixtures.ts. Todo inventado.
import { MODO } from "../modo";
import { resumir } from "../paneles/resumen";
import type { EstadoModelos } from "../../electron/modelos-config";
import type { EntornoOllama } from "../../electron/ollama-entorno";
import type { EstadoDsh } from "../../electron/dsh-ajustes";
import type { EstadoNim } from "../../electron/nvidia-nim";
import type { EstadoMcp } from "../../electron/mcp";
import type { VistaServidorMcp } from "../../electron/mcp-config";
import type { Conector, Inventario } from "../../electron/conectores-claude";
import type { EstadoCatalogos } from "../../electron/plugins-claude";
import type { EstadoOpencodeUi } from "../../electron/opencode-ajustes";
import type { VistaPlanGo } from "../../electron/opencode-go";
import type { FilaTabla, TablaReparto } from "../../electron/reparto-tabla";
import { viejaAAa } from "../../electron/calidad-migracion";
import type { Ajustes, Consulta, Medido, Corrida, EstadoAuto, EstadoSalud, Medicion, Muestra, PiezaConsulta } from "./paneles";

const AHORA = Math.floor(Date.now() / 1000);
const DIA = 86400;

export const AJUSTES: Ajustes = {
  version: 1,
  plan: "max",
  plan_error: null,
  red_seguridad: 300_000,
  routing: {
    version: 1,
    filas: [
      { rol: "codigo", modelo: "claude-opus-5-5", effort: "medium", nota: "medium acotado, high si toca varias partes" },
      { rol: "explorar", modelo: "claude-sonnet-5-5", effort: "high", nota: "high; xhigh auditoría grande" },
      { rol: "diseno", modelo: "claude-fable-5-1", effort: "high", nota: "high" },
    ],
  },
};

/**
 * La config de modelos de los fixtures (`~/.config/trama/modelos.json`; vive mientras la página). Sin variante no hay archivo
 * (se ve lo de hoy y no se crea nada hasta guardar); `mdl` trae uno armado como lo dejaría alguien que usa Gemini y un Ollama.
 */
export const MODELOS_FIJOS = (con: boolean, auto = false): EstadoModelos => ({
  version: 1,
  ruta: "~/.config/trama/modelos.json",
  existe: con,
  error: null,
  // Con el reparto automático `pa --modelos --json` dice qué elegiría hoy por tipo (`null`: no pudo elegir).
  efectivo:
    auto || !con
      ? {
          lider: { modelo: "claude-opus-5-5", effort: "xhigh" },
          workers: {},
          reparto: {
            default: { modelo: "claude-sonnet-5-5", effort: "high", motor: "claude", motivo: "mejor calidad con cupo libre" },
            "codigo-acotado": { modelo: "claude-sonnet-5-5", effort: "medium", motor: "claude", motivo: "calidad suficiente, gasta poco cupo" },
            "codigo-multi": { modelo: "claude-opus-5-5", effort: "high", motor: "claude", motivo: "mejor calidad con cupo libre" },
            frontend: { modelo: "claude-sonnet-5-5", effort: "high", motor: "claude", motivo: "mejor calidad con cupo libre" },
            debug: { modelo: "claude-opus-5-5", effort: "high", motor: "claude", motivo: "mejor calidad con cupo libre" },
            diseno: { modelo: "gemini-4-argon-high", effort: null, motor: "agy", motivo: "Claude pasó el tope: sigue Gemini con cupo libre" },
            lectura: { modelo: "claude-haiku-5-5", effort: "low", motor: "claude", motivo: "tarea liviana: el más barato que alcanza" },
            mecanico: null,
          },
        }
      : null,
  config: con
    ? {
        ...(auto ? { reparto: "auto" as const } : { reparto: "fijo" as const }),
        excluir: ["fable"],
        calidad: {},
        permitir_max: false,
        lider: { modelo: "gemini-4-argon-high" },
        workers: {
          default: { modelo: "claude-sonnet-5-5", effort: "high" },
          "codigo-acotado": { modelo: "gemini-4-argon-medium" },
          mecanico: { modelo: "ollama:qwen3-coder:30b" },
          lectura: { modelo: "ollama:llama3.2:3b" },
        },
        locales: [
          { id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", url: "http://localhost:11434", modelo: "qwen3-coder:30b" },
          { id: "ollama:llama3.2:3b", nombre: "llama3.2:3b", url: "http://caido.local:11434", modelo: "llama3.2:3b" },
        ],
        gemini: {},
        sin_cupo: "esperar",
        claude: { tope_7d: 60 },
        destrabar: { "gemini-4-argon": true },
      }
    : { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} },
  // Con archivo (alguien que usa Gemini) ya hubo destrabos; sin él, ninguno.
  destrabo: con ? { veces: 3, bien: 2, mal: 1, cortado: 0, pendiente: 0 } : { veces: 0, bien: 0, mal: 0, cortado: 0, pendiente: 0 },
});

/** Los modelos que "tiene instalados" el Ollama de mentira de los fixtures (una dirección con `caido` no contesta). */
export const OLLAMA_FALSO: { nombre: string; bytes: number | null }[] = [
  { nombre: "qwen3-coder:30b", bytes: 18_600_000_000 },
  { nombre: "llama3.2:3b", bytes: 2_000_000_000 },
  { nombre: "gemma3:12b", bytes: 8_100_000_000 },
];

/** Lo que hay en la máquina de las capturas para Ollama: `mdl-sinollama` no lo tiene (Ubuntu, instalador oficial), `mdl-apagado` lo tiene sin arrancar (Arch con su servicio); el resto, andando. */
export const ENTORNO_OLLAMA = (variante: string | null): EntornoOllama => {
  const gpu = { fabricante: "nvidia" as const, nombre: "NVIDIA GeForce RTX 4070", vramMiB: 12282 };
  if (variante === "mdl-sinollama")
    return {
      version: 1,
      instalado: false,
      distro: { id: "ubuntu", nombre: "Ubuntu 24.04.1 LTS", familia: "debian" },
      gpu,
      instalar: { via: "script", comando: "curl -fsSL https://ollama.com/install.sh | sh" },
      arrancar: { via: "systemd", comando: "sudo systemctl enable --now ollama" },
    };
  return {
    version: 1,
    instalado: true,
    distro: { id: "arch", nombre: "Arch Linux", familia: "arch" },
    gpu,
    instalar: { via: "pacman", comando: "sudo pacman -S ollama-cuda" },
    arrancar: { via: "systemd", comando: "sudo systemctl enable --now ollama" },
  };
};

/**
 * DeepSeek Harness en la máquina de las capturas: `dsh-sin` (no instalado ni con keys), `dsh-falla` (no instalado y sin npm que ande: Instalar falla; DeepSeek
 * rechaza su key); el resto, instalado, con la key de OpenCode guardada y la de DeepSeek sin poner.
 */
export const ESTADO_DSH = (variante: string | null): EstadoDsh => {
  const comando = "npm i -g @deepseek-ai/dsh";
  if (variante === "dsh-sin") return { version: 1, instalado: false, versionDsh: null, hayNpm: true, comando, claves: { OPENCODE_API_KEY: false, DEEPSEEK_API_KEY: false, ARTIFICIAL_ANALYSIS_API_KEY: false, NVIDIA_API_KEY: false } };
  if (variante === "dsh-falla") return { version: 1, instalado: false, versionDsh: null, hayNpm: true, comando, claves: { OPENCODE_API_KEY: true, DEEPSEEK_API_KEY: true, ARTIFICIAL_ANALYSIS_API_KEY: false, NVIDIA_API_KEY: false } };
  return { version: 1, instalado: true, versionDsh: "0.2.1", hayNpm: true, comando, claves: { OPENCODE_API_KEY: true, DEEPSEEK_API_KEY: false, ARTIFICIAL_ANALYSIS_API_KEY: variante?.startsWith("mdl-wk-aa") === true, NVIDIA_API_KEY: conNim(variante) } };
};

/** El acceso desde el celular de los fixtures (se edita en Ajustes; vive mientras la página). */
export const REMOTO = { activo: true, puerto: 8791, dispositivos: ["celu-de-prueba", "tablet-sala"] };
/** Quién entró hace poco (datos inventados): el primero hace minutos, el segundo hace tres días. */
export const ACCESOS_FALSOS = () => [
  { nombre: "celu-de-prueba", sistema: "android", ip: "192.0.2.12", visto: Date.now() - 4 * 60_000 },
  { nombre: "tablet-sala", sistema: "iOS", ip: "192.0.2.31", visto: Date.now() - 3 * 24 * 3600_000 },
];
export const URL_REMOTO_FALSA = (puerto: number) => `http://pc-de-prueba.tail1234.ts.net:${puerto}/`;

// Siempre las mismas corridas (un generador con semilla fija): las capturas no cambian entre corridas.
let semilla = 20261003;
const azar = () => (semilla = (semilla * 48271) % 2147483647) / 2147483647;
const elegir = <T>(xs: [T, number][]): T => {
  let r = azar() * xs.reduce((s, [, p]) => s + p, 0);
  for (const [x, p] of xs) if ((r -= p) < 0) return x;
  return xs[0][0];
};

// Cuántas corridas hubo cada día, de hace 59 días a hoy (los fines de semana, pocas o ninguna).
const POR_DIA = [
  1, 2, 0, 0, 2, 3, 1, 2, 4, 1, 0, 0, 3, 2, 4, 3, 5, 0, 1, 2, 4, 3, 2, 5, 3, 1, 0, 4, 6, 3,
  3, 5, 2, 0, 1, 4, 6, 3, 5, 4, 0, 0, 6, 7, 4, 8, 5, 1, 0, 5, 9, 6, 7, 4, 0, 2, 8, 6, 9, 5,
];
/** Con `HILOS_POCOS`: sólo los últimos 3 días, como `medicion.tsv` recién empezado. */
const DIAS = MODO.pocos ? 3 : POR_DIA.length;

const corridas: Corrida[] = POR_DIA.slice(-DIAS).flatMap((n, i) =>
  Array.from({ length: n }, (_, k): Corrida => {
    const modelo = elegir([
      ["claude-opus-5-5", 6],
      ["claude-sonnet-5-5", 3],
      ["claude-fable-5-1", 1.5],
    ]);
    const tokens = Math.round((0.3 + azar() * azar() * 9) * 1e6);
    // La caché se anota desde hace 10 días; antes la columna no existía.
    const conCache = i >= DIAS - 10;
    return {
      ts: AHORA - (DIAS - 1 - i) * DIA - Math.round(((k + 1) / (n + 1)) * 10 * 3600),
      proyecto: elegir([
        ["atlas", 5],
        ["brote", 4],
        ["cauce", 3],
        ["duna", 2],
        ["eco", 1],
      ]),
      modelo,
      duracion_s: Math.round(60 + azar() * azar() * 2400),
      tokens,
      bien: elegir<Corrida["bien"]>([
        ["si", 5],
        ["parcial", 1],
        ["no", 0.4],
        [null, 4],
      ]),
      compactaciones: conCache ? (tokens > 5e6 ? 1 : 0) : null,
      cache_read: conCache ? Math.round(tokens * (0.86 + azar() * 0.12)) : null,
      // La espera (`espera_s`) también es de hace 10 días; la mayoría de las corridas arranca sin esperar.
      espera_s: conCache ? (azar() < 0.6 ? 0 : Math.round(azar() * azar() * 900)) : null,
    };
  }),
);

// La cuota: tres semanas que terminaron en 74 %, 88 % y la actual en 52 % (con
// `HILOS_POCOS`, sólo las últimas horas de la actual). Una muestra cada 6 h.
const RESET = Math.ceil((AHORA + 1.2 * DIA) / 3600) * 3600;
const cuota: Muestra[] = [];
for (const [semana, fin] of [
  [2, 74],
  [1, 88],
  [0, 52],
] as const) {
  if (MODO.pocos && semana > 0) continue;
  const reset = RESET - semana * 7 * DIA;
  const desde = MODO.pocos ? AHORA - 0.25 * DIA : reset - 7 * DIA;
  const hasta = semana === 0 ? AHORA : reset - 3600;
  for (let ts = desde; ts <= hasta; ts += 6 * 3600) {
    const h5 = Math.round(azar() * 70);
    cuota.push({ ts, h5, h5_reset: ts + 3 * 3600, sem: Math.round((fin * (ts - (reset - 7 * DIA))) / (hasta - (reset - 7 * DIA))), sem_reset: reset });
  }
}

// Unos `-m claude-*` que pa pasó solo a agy (reparto --sustituir): de los últimos tres días.
const sustituciones = [
  { ts: AHORA - 0.2 * DIA, de: "claude-sonnet-5-5", a: "agy:claude-sonnet-5-5-high" },
  { ts: AHORA - 0.9 * DIA, de: "claude-sonnet-5-5", a: "agy:claude-sonnet-5-5-high" },
  { ts: AHORA - 2.1 * DIA, de: "claude-opus-5-5", a: "agy:claude-opus-5-5-medium" },
];

export const MEDICION: Medicion = { version: 1, corridas, desde: corridas[0]?.ts ?? null, cuota, sustituciones };

/** Lo que mide "Medir exacto" (electron/arranque.ts), por sesión: la misma que arranca de ejemplo en el registro (32 k por sesión, estimado). */
export const arranqueMedidoFalso: Medido = {
  version: 1,
  medido_en: new Date(2026, 9, 13, 18, 40).getTime(),
  total: 33_480,
  partes: { sistema: 14_300, skills: 3_100, mcp: 1_700, resto: 14_380 },
};

/** "Integrar solo lo seguro" (B22): una integrada sola y una que dio tests rojos. */
export const AUTO: EstadoAuto = {
  version: 1,
  prendido: true,
  enCurso: [],
  integradas: [{ id: "20261001-162208-31045", proyecto: "atlas", tarea: "Reintentos con backoff en el cliente HTTP", ts: AHORA - 2 * DIA }],
  fallas: [
    {
      id: "20261003-095902-47733",
      rama: "pa/duna/20261003-095902-47733",
      proyecto: "duna",
      error: "tests failed: main untouched",
      rc: 93,
      ts: AHORA - 600,
    },
  ],
};

/**
 * La salud de lo integrado (B25): la de backoff, sola y verde; la de Temporal
 * rompió los tests de main; la de cotizaciones se revirtió.
 */
export const SALUD: EstadoSalud = {
  version: 1,
  integradas: {
    "20261001-162208-31045": {
      id: "20261001-162208-31045",
      proyecto: "atlas",
      rama: "pa/atlas/20261001-162208-31045",
      head_antes: "3f9c2a1d0b7e4c6a8f1d2e3b4c5a6f7e8d9c0b1a",
      head_despues: "7a1e9c4b2d3f5a6c8e0b1d2f3a4c5e6b7d8f9a0c",
      commits: 4,
      auto: true,
      accion: "integrada",
      ts: AHORA - 2 * DIA,
    },
    "20261002-141530-52210": {
      id: "20261002-141530-52210",
      proyecto: "atlas",
      rama: "pa/atlas/20261002-141530-52210",
      head_antes: "7a1e9c4b2d3f5a6c8e0b1d2f3a4c5e6b7d8f9a0c",
      head_despues: "c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3",
      commits: 6,
      auto: false,
      accion: "integrada",
      ts: AHORA - 1 * DIA,
    },
  },
  bienNo: [],
  chequeos: {
    "20261001-162208-31045": { head: "7a1e9c4b2d3f5a6c8e0b1d2f3a4c5e6b7d8f9a0c", rc: 0, cola: "", ts: AHORA - 2 * DIA },
    "20261002-141530-52210": {
      head: "c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3",
      rc: 1,
      cola: [
        "▶ fechas › parsea ISO con zona",
        "  ✖ parsea ISO con zona (3.1ms)",
        "    AssertionError: expected 2026-10-02T14:15:30-03:00",
        "    + actual: 2026-10-02T17:15:30Z",
        "ℹ tests 214",
        "ℹ pass 213",
        "ℹ fail 1",
      ].join("\n"),
      ts: AHORA - 1 * DIA,
    },
  },
  corriendo: [],
};

// El registro histórico (electron/historial.ts) inventado: 7 y 30 días. Los pesos por pieza son por sesión
// (estimados); una skill, `pdf-forms`, se carga en todas las sesiones y nunca se usa.
const M = 1e6;
/** Lo que cuenta Estadísticas (entrada + caché leído + salida: `total` de src/paneles/historial-logica.ts) repartido en sus tres partes; el caché escrito va aparte y no suma. */
const suma = (t: number) => {
  const entrada = Math.round(t * 0.004);
  const salida = Math.round(t * 0.016);
  return { entrada, cacheCreado: Math.round(t * 0.065), cacheLeido: t - entrada - salida, salida };
};
const modelos = (opus: number, sonnet: number, fable: number): Consulta["modelos"] => ({
  "claude-opus-5-5": suma(opus),
  "claude-sonnet-5-5": suma(sonnet),
  ...(fable ? { "claude-fable-5-1": suma(fable) } : {}),
});
const IDS = { Opus: "claude-opus-5-5", Sonnet: "claude-sonnet-5-5", Fable: "claude-fable-5-1" } as const;
/**
 * Los workers del registro son las mismas corridas de `medicion.tsv` de esos días (`MEDICION`): "Tokens" de arriba y la
 * fila "Workers" de "En qué se van los tokens" dan el mismo número, que es lo que pasa con datos reales.
 */
const modelosWorkers = (dias: number): Consulta["modelos"] => {
  const r: Consulta["modelos"] = {};
  for (const p of resumir(corridas, dias, AHORA, null).porModelo) if (p.familia in IDS) r[IDS[p.familia as keyof typeof IDS]] = suma(p.tokens);
  return r;
};
const sumar = (...xs: Consulta["modelos"][]): Consulta["modelos"] => {
  const r: Consulta["modelos"] = {};
  for (const x of xs)
    for (const [id, m] of Object.entries(x)) {
      const a = (r[id] ??= { entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0 });
      a.entrada += m.entrada;
      a.cacheCreado += m.cacheCreado;
      a.cacheLeido += m.cacheLeido;
      a.salida += m.salida;
    }
  return r;
};

/** Quién usó cada pieza (líderes, workers, subagentes); lo que no está acá se reparte 20 / 60 / 20. */
const REPARTO: Record<string, [number, number, number]> = { simplify: [0, 1, 0], "code-review": [1, 0, 0] };
/** Veces por sesión que corrió el hook de un plugin (sus skills, si las tiene, no se usan). */
const GANCHOS: Record<string, number> = { caveman: 12 };

export function historialFalso(dias: 7 | 30, rol?: "lider" | "worker" | "subagente"): Consulta {
  const k = dias === 7 ? 1 : 3.6;
  const n = (x: number) => Math.round(x * k);
  const todas = { lider: n(6), worker: n(28), subagente: n(14) };
  const [lideres, workers, subagentes] = [rol && rol !== "lider" ? 0 : todas.lider, rol && rol !== "worker" ? 0 : todas.worker, rol && rol !== "subagente" ? 0 : todas.subagente];
  const sesiones = lideres + workers + subagentes;
  const arranque = { sesiones, tokens: sesiones * 32_000 };
  const parteDe = (nombre: string) => {
    const r = REPARTO[nombre] ?? [0.2, 0.6, 0.2];
    return rol ? r[["lider", "worker", "subagente"].indexOf(rol)] : 1;
  };
  // [clase, nombre, fracción de las sesiones que la cargó, tokens por sesión que la cargó, usos, origen]
  const hay: [PiezaConsulta["clase"], string, number, number, number | null, PiezaConsulta["origen"]][] = [
    ["sistema", "sistema", 1, 3200, null, null],
    ["herramientas", "herramientas", 1, 11000, null, null],
    ["claudemd", "~/CLAUDE.md", 1, 4800, null, null],
    ["claudemd", "atlas/CLAUDE.md", 0.6, 1500, null, null],
    ["skill", "pdf-forms", 1, 900, 0, "usuario"],
    ["skill", "simplify", 1, 700, n(12), "usuario"],
    ["skill", "code-review", 1, 600, n(9), "usuario"],
    ["skill", "frontend-design:frontend-design", 1, 1100, n(3), "plugin"],
    ["plugin", "frontend-design", 1, 1500, n(3), null],
    ["plugin", "caveman", 1, 800, 0, null],
    ["hook", "notas", 1, 300, null, null],
    ["mcp", "tablero", 1, 1600, n(21), null],
    ["agentes", "agentes", 1, 1200, null, null],
    ["estilo", "estilo", 1, 200, null, null],
  ];
  const piezas: PiezaConsulta[] = hay
    .map(([clase, nombre, parte, porSesion, usos, origen]) => ({
      clase,
      nombre,
      sesiones: Math.round(sesiones * parte),
      chars: Math.round(porSesion * 3.1),
      peso: Math.round(sesiones * parte * porSesion),
      pesoPorTurnos: Math.round(sesiones * parte * porSesion * 24),
      despues: clase === "hook" ? Math.round(sesiones * 24 * 300) : 0,
      usos: usos === null ? null : Math.round(usos * parteDe(nombre)),
      ganchos: clase === "plugin" ? Math.round(sesiones * parte * (GANCHOS[nombre] ?? 0)) : 0,
      origen,
    }))
    .sort((a, b) => b.peso - a.peso);
  const vacio = { sesiones: 0, modelos: {} };
  const roles: Consulta["roles"] = {
    lider: rol && rol !== "lider" ? vacio : { sesiones: lideres, modelos: modelos(n(70) * M, 0, 0) },
    worker: rol && rol !== "worker" ? vacio : { sesiones: workers, modelos: modelosWorkers(dias) },
    subagente: rol && rol !== "subagente" ? vacio : { sesiones: subagentes, modelos: modelos(0, n(25) * M, 0) },
  };
  return {
    version: 1,
    desde: "2026-10-07",
    hasta: "2026-10-13",
    rol: rol ?? null,
    sesiones,
    modelos: rol ? roles[rol].modelos : sumar(roles.lider.modelos, roles.worker.modelos, roles.subagente.modelos),
    roles,
    arranque,
    compactaciones: n(5),
    piezas,
    herramientas: { Bash: n(480), Read: n(350), Edit: n(190) },
    subagentes: { Explore: n(14) },
    comandos: {},
    sinDato: { sinArranque: 0, sinCalibrar: dias === 7 ? 0 : 2, lineas: 0, parserViejo: 0, meses: 0 },
  };
}

/** OpenCode en la máquina de las capturas: `oc-sin` (no instalado), `oc-sin-login` (instalado, sin conectar); si no, instalado y conectado a OpenCode Console. */
export const ESTADO_OPENCODE = (variante: string | null): EstadoOpencodeUi => {
  const comun = { version: 1 as const, comando: "npm i -g opencode-ai" };
  if (variante === "oc-sin") return { ...comun, instalado: false, versionOpencode: null, logueado: null, proveedores: [], consola: false, modelos: 0, gratis: 0, go: 0, plan: "gratis", actualizado: null };
  if (variante === "oc-sin-login") return { ...comun, instalado: true, versionOpencode: "2.1.4", logueado: false, proveedores: [], consola: false, modelos: 9, gratis: 9, go: 0, plan: "gratis", actualizado: null };
  if (variante === "oc-go") return { ...comun, instalado: true, versionOpencode: "2.1.4", logueado: true, proveedores: ["opencode", "opencode-go"], consola: true, modelos: 20, gratis: 9, go: 11, plan: "go", actualizado: 1_760_000_000_000 };
  return { ...comun, instalado: true, versionOpencode: "2.1.4", logueado: true, proveedores: ["opencode"], consola: true, modelos: 12, gratis: 9, go: 0, plan: "gratis", actualizado: 1_760_000_000_000 };
};

/** OpenCode Go de las capturas: los topes de la tabla de motor/opencode/go-topes.json (algunos modelos), con el plan elegido. */
export const PLAN_GO = (plan: "gratis" | "go" | "go-plus"): VistaPlanGo => {
  const go = plan !== "go-plus";
  const m = (slug: string, nombre: string, a: number, b: number, c: number, d: number) => ({ id: `opencode-go/${slug}`, nombre, pedidos5h: go ? a : b, usdMes: go ? c : d });
  return {
    plan,
    fuente: "https://opencode.ai/go",
    fecha: "2026-10-27",
    origen: "cache",
    leido: "2026-10-27T09:30:00.000Z",
    precio: go ? 10 : 40,
    modelos: [m("kimi-k3.1-pro", "Kimi K3.1 Pro", 147, 588, 15, 60), m("minimax-m3", "MiniMax M3", 3200, 9600, 60, 180), m("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", 34670, 69330, 80, 160)],
    usoDisponible: false,
  };
};

/**
 * `reparto --tabla --json` de las capturas: Claude con la semana por reiniciarse, Gemini, ChatGPT, los gratis de OpenCode (uno sin
 * `calidad` propia: estimada por el nombre) y un local. `excluir: ["fable"]` y las demás reglas las aplica el panel sobre el borrador.
 */
export const TABLA_REPARTO = (aa = false): TablaReparto => {
  const h = (horas: number) => Date.now() + horas * 3_600_000;
  const base = { cuenta: null, effortUsado: null as FilaTabla["effortUsado"], calidadPorEffort: {} as FilaTabla["calidadPorEffort"], effortsEstimados: [] as FilaTabla["effortsEstimados"], calidadEstimadaPorEffort: {} as FilaTabla["calidadEstimadaPorEffort"], estimada: false, origen: "defecto" as const, aaFecha: null as string | null, gratis: false, ventanas: [], urgencia: 0, permitido: true, excluidoPor: null, agotado: false };
  const claude = (id: string, nombre: string, familia: string, calidad: number): FilaTabla => ({
    ...base, id, nombre, proveedor: "claude", familia, familiaExcluir: familia, calidad: viejaAAa(calidad), libre: 62, vuelve: h(20), urgencia: 0.62,
    ventanas: [{ id: "5h", libre: 80, vuelve: h(2) }, { id: "7d", libre: 62, vuelve: h(20) }],
  });
  const goog = (id: string, nombre: string, familia: string, calidad: number, libre: number, dias: number): FilaTabla => ({
    ...base, id, nombre, proveedor: "google", familia, familiaExcluir: familia, calidad: viejaAAa(calidad), libre, vuelve: h(dias * 24), urgencia: 0.2,
    ventanas: [{ id: "5h", libre: Math.min(100, libre + 20), vuelve: h(3) }, { id: "7d", libre, vuelve: h(dias * 24) }],
  });
  const oc = (m: string, calidad: number, estimada: boolean): FilaTabla => ({
    ...base, id: `opencode:opencode/${m}`, nombre: `${m} (OpenCode, gratis)`, proveedor: "opencode", familia: "dsh", familiaExcluir: "opencode",
    calidad: viejaAAa(calidad), estimada, origen: estimada ? "estimada" : "defecto", gratis: true, libre: 100, vuelve: null,
  });
  const modelos: FilaTabla[] = [
    claude("claude-opus-5-5", "Claude Opus 5.5", "opus", 100),
    claude("claude-sonnet-5-5", "Claude Sonnet 5.5", "sonnet", 88),
    claude("claude-haiku-5-5", "Claude Haiku 5.5", "haiku", 60),
    goog("gemini-4-argon", "Gemini 4 Argon", "argon", 85, 71, 5),
    goog("gemini-3.8-flash", "Gemini 3.8 Flash", "flash", 60, 40, 5),
    goog("agy:claude-sonnet-5-5", "Claude Sonnet 5.5 (por Google)", "sonnet", 88, 33, 5),
    goog("agy:gpt-oss-120b", "GPT-OSS 120B", "gpt-oss", 45, 33, 5),
    { ...base, id: "codex:gpt-6.1-sol", nombre: "GPT-6.1 Sol (Codex)", proveedor: "openai", familia: "sol", familiaExcluir: "sol", calidad: viejaAAa(88), libre: 54, vuelve: h(60), urgencia: 0.3,
      ventanas: [{ id: "5h", libre: 90, vuelve: h(4) }, { id: "7d", libre: 54, vuelve: h(60) }] },
    oc("big-pickle", 60, false),
    oc("glm-5.3-flash-free", 55, false),
    oc("nemotron-3-ultra-free", 55, false),
    oc("zeta-ultra-free", 60, true),
    oc("kilo-mini-free", 40, true),
    { ...base, id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", proveedor: "local", familia: "local", familiaExcluir: "local", calidad: viejaAAa(35), estimada: true, origen: "estimada", gratis: true, libre: 100 , vuelve: null },
  ];
  // Con Artificial Analysis: lo medido pisa a los defaults (menos lo que fijó el dueño, Sonnet, y lo que AA no conoce).
  const ayer = new Date(Date.now() - 20 * 3_600_000).toISOString().slice(0, 10);
  const conAA = (f: FilaTabla): FilaTabla => {
    if (!aa || f.estimada || f.origen !== "defecto" || f.familia === "sonnet" || f.id.includes("big-pickle")) return f;
    // Índice de inteligencia de AA al esfuerzo que se usaría (high; si no está medido, estimado); costo y tokens por tarea como los trae AA.
    const q: Record<string, number> = { "claude-opus-5-5": 50.2, "claude-haiku-5-5": 37.8, "gemini-4-argon": 51, "gemini-3.8-flash": 45, "agy:gpt-oss-120b": 32, "codex:gpt-6.1-sol": 53, "opencode:opencode/glm-5.3-flash-free": 42, "opencode:opencode/nemotron-3-ultra-free": 47 };
    const por: Record<string, Partial<FilaTabla>> = {
      // Opus 5.5: AA sólo midió max; el resto se estima (y así se rotula).
      "claude-opus-5-5": { calidadPorEffort: { max: 57.6 }, effortsEstimados: ["low", "medium", "high", "xhigh"], calidadEstimadaPorEffort: { low: 39.2, medium: 44.7, high: 50.2, xhigh: 54.7 }, fuentePorEffort: { max: "api" }, tokensPorEffort: { max: 1400000 }, tiempoPorEffort: { max: 520 } },
      // Haiku 5.5: low, high y xhigh de AA; max de la tabla propia (aproximado); medium estimado. Coding y agentic sólo como extra del tooltip.
      "claude-haiku-5-5": { calidadPorEffort: { low: 29.5, high: 37.8, xhigh: 41.2, max: 43.4 }, effortsEstimados: ["medium"], calidadEstimadaPorEffort: { medium: 33.6 }, fuentePorEffort: { low: "api", high: "api", xhigh: "api", max: "suplemento~" }, costoPorEffort: { max: 0.2 }, codingPorEffort: { high: 52.1 }, agenticPorEffort: { high: 40.3 } },
    };
    return q[f.id] === undefined ? f : { ...f, calidad: q[f.id]!, effortUsado: por[f.id] ? "high" : null, ...(por[f.id] ?? {}), origen: "artificial-analysis", aaFecha: ayer };
  };
  const usuario = (f: FilaTabla): FilaTabla => (aa && f.familia === "sonnet" ? { ...f, calidad: 52.2, origen: "usuario" } : f);
  return { version: 1, leido: Date.now(), modelos: modelos.map(conAA).map(usuario) };
};

/** Los servidores MCP propios de la máquina de las capturas: `mcp-vacio` ninguno; si no, uno por URL (con cabecera guardada) y uno por comando. */
export const ESTADO_MCP_FIJOS = (variante: string | null): VistaServidorMcp[] =>
  variante === "mcp-vacio"
    ? []
    : [
        { nombre: "notion", tipo: "http", url: "https://mcp.notion.com/mcp", variables: [{ tipo: "cabecera", nombre: "Authorization", hay: true }] },
        { nombre: "archivos", tipo: "stdio", comando: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/ana/docs"], variables: [] },
      ];

/** Lo que tiene conectado Claude Code en la máquina de las capturas (todo inventado): un poco de cada tipo, prendido y apagado. */
export const CONECTORES_FIJOS = (variante: string | null): Inventario => {
  if (variante === "mcp-vacio") return { version: 1, items: [], proyectos: [] };
  const p = "/home/ana/proyectos/tienda";
  const items: Conector[] = [
    { id: "skill|usuario|diseno", tipo: "skill", nombre: "diseno", origen: "usuario", de: "", descripcion: "Tarea de diseño: crear, rediseñar o pulir cómo se ve algo.", activo: true, conmutable: false },
    { id: "skill|usuario|revisar", tipo: "skill", nombre: "revisar", origen: "usuario", de: "", descripcion: "Revisar el diff actual en busca de errores antes de commitear.", activo: true, conmutable: false },
    { id: `skill|proyecto|${p}|deploy`, tipo: "skill", nombre: "deploy", origen: "proyecto", de: p, descripcion: "Publicar la tienda en el servidor de pruebas.", activo: true, conmutable: false },
    { id: "skill|plugin|estilo@mercado||tono", tipo: "skill", nombre: "tono", origen: "plugin", de: "estilo@mercado", descripcion: "Ajusta el tono de los textos largos.", activo: true, conmutable: false },
    { id: "plugin|estilo@mercado|", tipo: "plugin", nombre: "estilo", origen: "usuario", de: "mercado", descripcion: "Textos más claros y cortos.", activo: true, conmutable: true, clase: "1.2.0" },
    { id: "plugin|graficos@mercado|", tipo: "plugin", nombre: "graficos", origen: "usuario", de: "mercado", descripcion: "Gráficos y tableros a partir de datos.", activo: false, conmutable: true, clase: "0.9.1" },
    { id: "mcp|usuario|archivos", tipo: "mcp", nombre: "archivos", origen: "usuario", de: "", descripcion: "", activo: true, conmutable: false, clase: "stdio", destino: "npx -y @modelcontextprotocol/server-filesystem /home/ana/docs", variables: [] },
    { id: `mcp|proyecto|${p}|calendario`, tipo: "mcp", nombre: "calendario", origen: "proyecto", de: p, descripcion: "", activo: true, conmutable: true, clase: "http", destino: "https://mcp.ejemplo.com/calendario", variables: ["Authorization"] },
    { id: `mcp|proyecto|${p}|base`, tipo: "mcp", nombre: "base", origen: "proyecto", de: p, descripcion: "", activo: false, conmutable: true, clase: "stdio", destino: "node servidor.js --token ••••", variables: ["DB_PASSWORD"] },
    { id: "plugin|claudeai|cuenta-1|design", tipo: "plugin", nombre: "design", origen: "claudeai", de: "knowledge-work-plugins", descripcion: "Críticas de diseño, accesibilidad y entrega a desarrollo.", activo: true, conmutable: false, clase: "0040" },
    { id: "skill|claudeai|cuenta-1|design|design-critique", tipo: "skill", nombre: "design-critique", origen: "claudeai", de: "design", descripcion: "Devolución estructurada sobre un diseño.", activo: true, conmutable: false },
    { id: "mcp|claudeai|claude.ai Correo", tipo: "mcp", nombre: "Correo", origen: "claudeai", de: "", descripcion: "", activo: false, conmutable: false, clase: "http" },
    { id: "hook|usuario||settings.json|0", tipo: "hook", nombre: "PreToolUse · Bash", origen: "usuario", de: "", descripcion: "", activo: true, conmutable: false, clase: "PreToolUse", destino: "bash ~/.claude/hooks/guardia.sh" },
    { id: "hook|plugin|estilo@mercado||0", tipo: "hook", nombre: "SessionStart", origen: "plugin", de: "estilo@mercado", descripcion: "Cargando el estilo…", activo: true, conmutable: false, clase: "SessionStart", destino: "node estilo/arranque.js" },
  ];
  return { version: 1, items, proyectos: [p] };
};

/** Los catálogos de plugins de las capturas (todo inventado): el de skills de Anthropic agregado y a medias, el oficial sin agregar y uno propio. `plugins-vacio`: ninguno agregado. */
export const CATALOGOS_FIJOS = (variante: string | null): EstadoCatalogos => {
  const sinAgregar = { id: "claude-plugins-official", repo: "anthropics/claude-plugins-official", conocido: true, agregado: false, plugins: [] };
  if (variante === "plugins-vacio") return { version: 1, cuentas: [], catalogos: [{ id: "anthropic-agent-skills", repo: "anthropics/skills", conocido: true, agregado: false, plugins: [] }, sinAgregar] };
  return {
    version: 1,
    cuentas: ["cuenta-2"],
    catalogos: [
      {
        id: "anthropic-agent-skills",
        repo: "anthropics/skills",
        conocido: true,
        agregado: true,
        plugins: [
          { nombre: "claude-api", descripcion: "Armar apps con la API de Claude: modelos, herramientas y caché.", categoria: "", instalado: false },
          { nombre: "document-skills", descripcion: "Crear y editar documentos de Word, planillas de Excel, presentaciones de PowerPoint y PDF.", categoria: "", instalado: true },
          { nombre: "example-skills", descripcion: "Ejemplos de skills: arte generativo, diseño de temas, servidores MCP y más.", categoria: "", instalado: false },
        ],
      },
      sinAgregar,
      {
        id: "mercado-de-ana",
        repo: "ana/plugins",
        conocido: false,
        agregado: true,
        plugins: [{ nombre: "estilo", descripcion: "Textos más claros y cortos.", categoria: "escritura", instalado: false }],
      },
    ],
  };
};

/** Los conectores apagados para el proyecto del líder en las capturas (`mcp-vacio`: ninguno). */
export const ESTADO_MCP_APAGADOS = (variante: string | null): string[] => (variante === "mcp-vacio" ? [] : ["claude.ai Notion", "claude.ai Google Drive"]);

/** Lo que ve `/mcp` en las capturas: los conectores de claude.ai (uno con login pendiente, uno caído) y los de Trama. */
export const ESTADO_MCP = (motor: string, local: boolean, propios: VistaServidorMcp[]): EstadoMcp => {
  const m = motor === "agy" || motor === "dsh" || motor === "opencode" ? motor : "claude";
  const sinTrama = m === "claude" && local ? "local" : m === "agy" ? "agy" : null;
  return {
    version: 1,
    motor: m,
    claude:
      m === "claude" && !local
        ? {
            error: null,
            servidores: [
              { nombre: "claude.ai Gmail", destino: "https://gmailmcp.googleapis.com/mcp/v1", tipo: "HTTP", estado: "ok", detalle: "Connected" },
              { nombre: "claude.ai Slack", destino: "https://mcp.slack.com/mcp", tipo: "HTTP", estado: "ok", detalle: "Connected" },
              { nombre: "claude.ai Google Calendar", destino: "https://calendarmcp.googleapis.com/mcp/v1", tipo: "HTTP", estado: "auth", detalle: "Needs authentication" },
              { nombre: "plugin:design:figma", destino: "https://mcp.figma.com/mcp", tipo: "HTTP", estado: "falla", detalle: "Failed to connect" },
            ],
          }
        : null,
    trama: propios.map((s) => ({ nombre: s.nombre, tipo: s.tipo, destino: s.tipo === "stdio" ? [s.comando, ...(s.args ?? [])].join(" ") : (s.url ?? ""), pasa: sinTrama === null })),
    sinTrama,
  };
};

const conNim = (variante: string | null) => variante === "nim" || variante === "nim-falla" || variante === "cupos-nim";
/** NVIDIA NIM: `nim` con la clave guardada y dos modelos prendidos, `nim-falla` donde la prueba falla; sin variante, sin clave y sólo el modelo base. */
export const ESTADO_NIM = (variante: string | null, dsh: EstadoDsh, fijo?: string[]): EstadoNim => ({
  version: 1,
  hayClave: dsh.claves.NVIDIA_API_KEY,
  modelos: fijo ?? (conNim(variante) ? ["deepseek-ai/deepseek-v4.1-flash", "meta/llama-3.3-70b-instruct"] : ["deepseek-ai/deepseek-v4.1-flash"]),
  base: "deepseek-ai/deepseek-v4.1-flash",
  tope: 40,
});
