// Casos de paridad de reparto: motor/bin/reparto (python) contra app/electron/cli/reparto.ts. Mismo formato que casos.ts.
// Todo determinista: cupos fijos (REPARTO_CUPOS_FIJOS), hora fija (REPARTO_AHORA), dsh y opencode fijos, carga fija y la
// caché de Artificial Analysis de tests/fixtures. El estado de reparto (REPARTO_STATE) va a la carpeta de estado del sandbox
// para que se comparen agotado.json, enfriado.json, plan.json y asignaciones.json.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Caso, Contexto } from "./arnes.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const AA = path.join(FIXTURES, "aa-real-2026-10-27.json");
const GO_TABLA = fileURLToPath(new URL("../../../motor/opencode/go-topes.json", import.meta.url));
const AHORA = "2026-10-26T12:00:00Z";

const escribir = (ruta: string, datos: unknown, modo?: number) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, typeof datos === "string" ? datos : JSON.stringify(datos));
  if (modo) chmodSync(ruta, modo);
};

const w = (id: string, usado: number | null, vuelve?: string) => ({ id, usado, ...(vuelve ? { vuelve } : {}) });
/** Cupos de todos los días: Claude a medias, Gemini con poco uso, Argon casi lleno. */
const CUPOS = {
  version: 1,
  leido: AHORA,
  suscripciones: [
    { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [w("5h", 0.2, "2026-10-26T14:00:00Z"), w("7d", 0.5, "2026-10-30T00:00:00Z")] },
    {
      id: "google",
      nombre: "Google AI Pro",
      grupos: [
        { id: "gemini", nombre: "Gemini", ventanas: [w("5h", 0.1, "2026-10-26T15:00:00Z"), w("7d", 0.3, "2026-10-29T00:00:00Z")] },
        { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: [w("5h", 0.0, "2026-10-26T15:00:00Z"), w("7d", 0.6, "2026-10-29T00:00:00Z")] },
        { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [w("7d", 0.9, "2026-10-28T00:00:00Z")] },
      ],
    },
  ],
};
/** Cupos raros: enteros (1 y 0), una cuenta extra de Claude, una ventana sin dato, Gemini casi lleno y Codex. */
const CUPOS_RAROS = {
  version: 1,
  leido: AHORA,
  suscripciones: [
    { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [w("5h", 1, "2026-10-26T14:00:00Z"), w("7d", 0, "2026-10-30T00:00:00Z")] },
    { id: "trabajo", nombre: "Trabajo", proveedor: "claude", cuenta: "trabajo", ventanas: [w("5h", 0.123456, "2026-10-26T14:00:00Z"), w("7d", 0.875, "2026-10-27T05:00:00Z")] },
    {
      id: "google",
      nombre: "Google AI Pro",
      grupos: [
        { id: "gemini", nombre: "Gemini", ventanas: [w("5h", 0.98, "2026-10-26T15:00:00Z"), w("7d", 0.3)] },
        { id: "claude-gpt", nombre: "Claude y GPT por Google", hasta: "2026-11-01", ventanas: [w("5h", 0.75, "2026-10-26T15:00:00Z"), w("7d", 0.6, "2026-10-29T00:00:00Z")] },
        { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [w("7d", null)] },
      ],
    },
    { id: "openai", nombre: "ChatGPT", grupos: [{ id: "codex", nombre: "Codex", ventanas: [w("5h", 0.5, "2026-10-26T13:00:00Z"), w("7d", 0.25, "2026-11-01T00:00:00Z")] }] },
  ],
};

const cuposDe = (c: Contexto) => path.join(c.aux, "cupos.json");
const modelosDe = (c: Contexto) => path.join(c.aux, "modelos.json");

/** El entorno de todos los casos de reparto (cada caso suma o pisa lo suyo). */
const base = (c: Contexto, extra: Record<string, string> = {}): Record<string, string> => ({
  REPARTO_STATE: c.estado,
  REPARTO_CUPOS_FIJOS: cuposDe(c),
  REPARTO_AHORA: AHORA,
  REPARTO_DSH_FIJO: JSON.stringify({ ollama: ["qwen3:8b"], opencode: false, deepseek: true }),
  REPARTO_OPENCODE_FIJO: JSON.stringify(["opencode/big-pickle", "opencode/glm-5.3-flash-free"]),
  REPARTO_AA: AA,
  REPARTO_CARGA_FIJA: "{}",
  REPARTO_CLAUDE: "1",
  REPARTO_CODEX: "0",
  TRAMA_GO_SIN_RED: "1",
  TRAMA_MODELOS: modelosDe(c),
  ...extra,
});

interface Opciones {
  cupos?: unknown;
  modelos?: unknown;
  env?: Record<string, string> | ((c: Contexto) => Record<string, string>);
  preparar?: (c: Contexto) => void;
  estadoIgnorar?: RegExp[];
}

const preparar = (o: Opciones) => (c: Contexto) => {
  escribir(cuposDe(c), o.cupos ?? CUPOS);
  if (o.modelos !== undefined) escribir(modelosDe(c), o.modelos);
  o.preparar?.(c);
};
const entornoDe = (o: Opciones) => (c: Contexto) => base(c, typeof o.env === "function" ? o.env(c) : o.env);

const rp = (nombre: string, args: string[], rc: number, o: Opciones = {}): Caso => ({
  herramienta: "reparto",
  nombre: `reparto: ${nombre}`,
  args,
  rc,
  preparar: preparar(o),
  env: entornoDe(o),
  estadoIgnorar: o.estadoIgnorar,
});

const rpPasos = (nombre: string, pasos: [string[], number][], o: Opciones = {}): Caso => ({
  herramienta: "reparto",
  nombre: `reparto: ${nombre}`,
  pasos: pasos.map(([args, rc]) => ({ args, rc })),
  preparar: preparar(o),
  env: entornoDe(o),
  estadoIgnorar: o.estadoIgnorar,
});

/** `--opencode-limite`: la salida de OpenCode llega por stdin. */
const rpStdin = (nombre: string, stdin: string, rc: number, o: Opciones = {}): Caso => ({
  herramienta: "reparto",
  nombre: `reparto: ${nombre}`,
  pasos: [{ args: ["--opencode-limite"], stdin, rc }],
  preparar: preparar(o),
  env: entornoDe(o),
  estadoIgnorar: o.estadoIgnorar,
});

/** Un `opencode` falso de shell para `--sondear-opencode`: `models` lista un gratis; `run` dice `respuesta` (por stderr si `error`). */
const opencodeFalso = (respuesta: string, error: boolean) => (c: Contexto) => {
  const salida = error ? `echo "${respuesta}" >&2` : `echo "${respuesta}"`;
  escribir(path.join(c.aux, "opencode-falso"), `#!/bin/sh\nif [ "$1" = models ]; then echo opencode/big-pickle; exit 0; fi\n${salida}\nexit ${error ? 1 : 0}\n`, 0o755);
};
const conOpencodeFalso = (c: Contexto) => ({ HILOS_OPENCODE: path.join(c.aux, "opencode-falso") });

/** Marcas de agotado, de enfriado y un plan ya guardados (con entradas vencidas que no cuentan). */
const conMarcas = (c: Contexto) => {
  escribir(path.join(c.estado, "agotado.json"), {
    "claude-oficial": { hasta: "2026-10-26T15:00:00Z" },
    gemini: { hasta: "2026-10-27T00:00:00+00:00" },
    "dsh-ollama": { hasta: "2026-10-26T13:00:00Z" },
    viejo: { hasta: "2026-10-20T00:00:00Z" },
    "claude-gpt@trabajo": { hasta: "2026-10-26T18:00:00Z" },
  });
  escribir(path.join(c.estado, "enfriado.json"), {
    "opencode:opencode/big-pickle": { hasta: "2026-10-26T14:30:00Z" },
    "Dsh:DeepSeek/deepseek-v4-flash": { hasta: "2026-10-26T13:00:00.500000+00:00" },
    pasado: { hasta: "2026-10-25T00:00:00Z" },
  });
  escribir(path.join(c.estado, "plan.json"), { version: 1, actualizado: "2026-10-26T10:00:00Z", ausente: ["2026-10-27", "2026-10-28", "2020-01-01", "malo"], hoy: { fecha: "2026-10-26", modo: "ahorrar" } });
};

const TIPOS = ["debug", "diseno", "codigo-multi", "frontend", "final", "codigo-acotado", "lectura", "mecanico"];

/** modelos.json que tocan los umbrales y las reglas del reparto. */
const MODELOS: [string, unknown][] = [
  ["perfil ahorro", { perfil: "ahorro" }],
  ["perfil rendimiento y reserva", { perfil: "rendimiento", reserva: 0.3 }],
  ["reserva por ventana y reserva_lider", { reserva: { "5h": 0.85, "7d": 0.4 }, reserva_lider: 0.2 }],
  ["topes_uso", { topes_uso: { google: 50, "google:gemini": 5, openai: 90 } }],
  ["excluir y efforts_permitidos", { excluir: ["opus", "Gemini-3.8-flash", "dsh:*"], efforts_permitidos: { sonnet: ["low", "medium"], haiku: ["max"] } }],
  ["efforts_permitidos vacío", { efforts_permitidos: { opus: [] } }],
  ["uso_por_modelo, tipos_finales y sin_cupo", { sin_cupo: "esperar", uso_por_modelo: { "claude-haiku": "poco_importante", sonnet: "solo_final" }, tipos_finales: ["final", "debug"] }],
  ["calidad, mínimos y calidad_effort", { calidad: { haiku: 95, "dsh:ollama/*": 80, opus: 10.5 }, minimo_por_tipo: { lectura: 90, debug: "opus" }, calidad_effort: { haiku: { low: 50, max: 99 } } }],
  ["calidad en unidades de AA", { calidad_unidades: "aa", calidad: { haiku: 50.5 }, minimo_por_tipo: { mecanico: 45.5 } }],
  ["locales, llena, peso_costo y agy_min_libre_5h", { locales: [{ id: "ollama:qwen3:8b", nombre: "Qwen local" }, { id: "ollama:raro" }], llena: 0.5, peso_costo: 30.5, agy_min_libre_5h: 0.95 }],
  ["agy_min_libre_tipos y preferido_por_tipo", { agy_min_libre_tipos: ["lectura"], agy_min_libre_5h: 0.95, preferido_por_tipo: { "lec*": "opus" } }],
  ["grupo vencido y gemini.sin_claude", { grupos_hasta: { "claude-gpt": "2026-10-25" }, gemini: { sin_claude: "fallar" } }],
  ["inválido: reserva", { reserva: 2 }],
  ["inválido: topes_uso con float", { topes_uso: { google: 50.0 } }],
  ["inválido: perfil", { perfil: "x", excluir: "opus" }],
  ["inválido: effort desconocido", { efforts_permitidos: { opus: ["ultra"] } }],
  ["no es un objeto", [1, 2]],
];

const casosModelos: Caso[] = MODELOS.flatMap(([nombre, modelos], i) => {
  const o: Opciones = { modelos, cupos: i % 2 ? CUPOS_RAROS : CUPOS };
  return [
    rp(`modelos.json (${nombre}): --tipo lectura --json`, ["--tipo", "lectura", "--json"], 0, o),
    rp(`modelos.json (${nombre}): --tipo debug --explicar`, ["--tipo", "debug", "--explicar"], 0, o),
    rp(`modelos.json (${nombre}): --resumen`, ["--resumen"], 0, o),
    rp(`modelos.json (${nombre}): --tabla --json`, ["--tabla", "--json"], 0, o),
  ];
});

/** Un `agy` falso que contesta /quota (Gemini a medias, Claude por Google sin cupo). */
const agyFalso = (c: Contexto) => {
  const quota = {
    command: {
      data: {
        groups: [
          { name: "Gemini Flash", buckets: [{ window: "5h", remaining_fraction: 0.45, reset_time: "2026-10-26T15:00:00Z" }, { window: "weekly", remaining_fraction: 1, reset_time: "2026-10-30T00:00:00Z" }] },
          { name: "Claude and GPT", buckets: [{ window: "5h", remaining_fraction: 0, reset_time: "2026-10-26T13:00:00Z" }] },
          { name: "Gemini 4 Argon", buckets: [{ window: "weekly", remaining_fraction: 0.875, reset_time: "2026-10-31T00:00:00Z" }] },
        ],
      },
    },
  };
  escribir(path.join(c.raiz, "shim", "agy"), `#!/bin/sh\ncat <<'J'\n${JSON.stringify(quota)}\nJ\n`, 0o755);
};

/** Lo que deja el statusline de Claude y el uso.json de hilos (para leer el cupo sin REPARTO_CUPOS_FIJOS). */
const statusline = (c: Contexto) => {
  const sl = path.join(c.estado, "statusline");
  escribir(path.join(sl, "a.json"), { ts: 1793000000, rate_limits: { five_hour: { used_percentage: 37.5, resets_at: 1793020000 }, seven_day: { used_percentage: 61, resets_at: 1793300000 } } });
  escribir(path.join(sl, "b.json"), { ts: 1793005000, config_dir: path.join(c.home, "otra"), rate_limits: { five_hour: { used_percentage: 80, resets_at: 1793020000 } } });
  escribir(path.join(sl, "historial.jsonl"), '{"ts":1793001000,"h5":40,"h5_reset":1793021000,"sem":62.25,"sem_reset":1793300000}\n\n{"ts":1,"h5":99}\n');
  escribir(path.join(c.estado, "hilos", "uso.json"), { ts: 1793002000, five_hour: { pct: 12, resets_at: 1793019000 } });
};
/** Un cuentas.json con la cuenta "trabajo" de Claude como la preferida (la de siempre queda sin elegir). */
const conPreferida: Pick<Opciones, "preparar" | "env"> = {
  preparar: (c) => escribir(path.join(c.estado, "cuentas.json"), { version: 1, cuentas: [{ id: "trabajo", proveedor: "claude", nombre: "Trabajo" }], preferidas: { claude: "trabajo" } }),
  env: (c) => ({ TRAMA_CUENTAS: path.join(c.estado, "cuentas.json"), TRAMA_CUENTAS_HOME: c.home }),
};
const vivo = { REPARTO_CUPOS_FIJOS: "", REPARTO_AGY: "0" };

export const casosReparto: Caso[] = [
  // ayuda y errores de uso
  rp("sin argumentos", [], 2),
  rp("--help", ["--help"], 2),
  rp("opción desconocida", ["--zzz"], 2),
  rp("--tipo sin tipo", ["--tipo"], 2),
  rp("--horas sin valor", ["--tipo", "lectura", "--horas"], 2),
  rp("--mismo-proveedor inválido", ["--mismo-proveedor", "x", "--tipo", "lectura"], 2),

  // --resumen
  rp("--resumen", ["--resumen"], 0),
  rp("--resumen --json", ["--resumen", "--json"], 0),
  rp("--resumen con agotados y enfriados", ["--resumen"], 0, { preparar: conMarcas }),
  rp("--resumen --json con cupos raros", ["--resumen", "--json"], 0, { cupos: CUPOS_RAROS }),
  rp("--resumen sin caché de AA (sólo el suplemento)", ["--resumen"], 0, { env: (c) => ({ REPARTO_AA: path.join(c.aux, "no-hay-aa.json") }) }),

  // elección por tipo
  ...TIPOS.map((t) => rp(`--tipo ${t} --json`, ["--tipo", t, "--json"], 0)),
  ...TIPOS.map((t) => rp(`--tipo ${t} (texto)`, ["--tipo", t], 0, { cupos: CUPOS_RAROS })),
  rp("--tipo final --explicar", ["--tipo", "final", "--explicar"], 0),
  // pa dice qué no sirve ahora (plugin de agy sin cargar, un Claude con el límite a la vista): reparto lo saltea y da el siguiente.
  rp("REPARTO_NO_DISPONIBLE: agy y gemini fuera (--tipo codigo-acotado --json)", ["--tipo", "codigo-acotado", "--json"], 0, { env: { REPARTO_NO_DISPONIBLE: "agy:*, gemini-*" } }),
  rp("REPARTO_NO_DISPONIBLE: claude oficial fuera (--tipo codigo-acotado --explicar)", ["--tipo", "codigo-acotado", "--explicar"], 0, { env: { REPARTO_NO_DISPONIBLE: "claude-*" } }),
  rp("REPARTO_NO_DISPONIBLE: dsh y locales fuera (--tipo lectura --json)", ["--tipo", "lectura", "--json"], 0, { env: { REPARTO_NO_DISPONIBLE: "dsh:*,ollama:*,opencode:*" } }),
  rp("--tipo codigo-multi --explicar con cupos raros", ["--tipo", "codigo-multi", "--explicar"], 0, { cupos: CUPOS_RAROS }),
  rp("--tipo desconocido", ["--tipo", "raro", "--json"], 0),
  rp("--tipo con eñe y mayúsculas", ["--tipo", "Diseño"], 0),
  rp("--tipo --mismo-proveedor google", ["--tipo", "lectura", "--mismo-proveedor", "google", "--json"], 0),
  rp("--tipo --mismo-proveedor claude --explicar", ["--tipo", "lectura", "--mismo-proveedor", "claude", "--explicar"], 0),
  rp("--tipo --cuenta trabajo", ["--tipo", "debug", "--cuenta", "trabajo", "--json"], 0, { cupos: CUPOS_RAROS }),
  // la cuenta preferida (`cuentas preferir`): la única que se reparte; la otra sólo va con --cuenta
  rp("preferida: --tipo con la cuenta de Claude elegida", ["--tipo", "debug", "--json"], 0, { cupos: CUPOS_RAROS, ...conPreferida }),
  rp("preferida: --tipo --explicar", ["--tipo", "lectura", "--explicar"], 0, { cupos: CUPOS_RAROS, ...conPreferida }),
  rp("preferida: --tipo --cuenta pisa la elegida", ["--tipo", "debug", "--cuenta", "claude", "--json"], 0, { cupos: CUPOS_RAROS, ...conPreferida }),
  rp("preferida: --tipo --mismo-proveedor claude", ["--tipo", "lectura", "--mismo-proveedor", "claude", "--json"], 0, { cupos: CUPOS_RAROS, ...conPreferida }),
  rp("preferida: --cuenta-para claude", ["--cuenta-para", "claude-haiku-5-5", "--json"], 0, { cupos: CUPOS_RAROS, ...conPreferida }),
  rp("preferida: --cuenta-para sin elegir sigue siendo la de siempre", ["--cuenta-para", "claude-haiku-5-5", "--json"], 0, { cupos: CUPOS_RAROS }),
  rp("--tipo con agotados, enfriados y plan", ["--tipo", "lectura", "--json"], 0, { preparar: conMarcas }),
  rp("--tipo --explicar con agotados, enfriados y plan", ["--tipo", "debug", "--explicar"], 0, { preparar: conMarcas }),
  rp("--tipo con el plan en otra zona horaria (cambio de hora)", ["--tipo", "codigo-multi", "--json"], 0, { preparar: conMarcas, env: { TZ: "Europe/Madrid" } }),
  rp("reparto fijo", ["--tipo", "lectura", "--json"], 0, { modelos: { reparto: "fijo", workers: { lectura: { modelo: "claude-opus-5-5", effort: "max" } } } }),
  rp("plan Go de OpenCode", ["--tipo", "codigo-acotado", "--json"], 0, {
    modelos: { opencode_plan: "go" },
    env: { REPARTO_GO_TABLA: GO_TABLA, REPARTO_OPENCODE_FIJO: JSON.stringify(["opencode/big-pickle", "opencode-go/kimi-k3.1-pro", "opencode-go/minimax-m3", "opencode-go/claude-haiku-5-5"]) },
  }),
  rp("plan Go de OpenCode: --tabla", ["--tabla"], 0, {
    modelos: { opencode_plan: "go-plus" },
    env: { REPARTO_GO_TABLA: GO_TABLA, REPARTO_OPENCODE_FIJO: JSON.stringify(["opencode-go/kimi-k3.1-pro", "opencode-go/minimax-m3"]) },
  }),
  rp("NVIDIA NIM con key: --tabla", ["--tabla"], 0, { env: { NVIDIA_API_KEY: "clave-de-mentira", TRAMA_CLAVES: "/no/existe" }, modelos: { nvidia_modelos: ["deepseek-ai/deepseek-v4.1-flash", "otro/modelo-x"] } }),
  rp("NVIDIA NIM sin key: --tabla", ["--tabla"], 0, { env: { NVIDIA_API_KEY: "", TRAMA_CLAVES: "/no/existe" } }),
  rpPasos("REPARTO_RESERVAR anota la asignación y la siguiente la cuenta como carga", [[["--tipo", "lectura"], 0], [["--tipo", "lectura", "--json"], 0]], { env: { REPARTO_RESERVAR: "1", REPARTO_CARGA_FIJA: "" } }),

  // cupos
  rp("--cupos", ["--cupos"], 0),
  rp("--cupos --json", ["--cupos", "--json"], 0),
  rp("--cupos --json con agotados", ["--cupos", "--json"], 0, { cupos: CUPOS_RAROS, preparar: conMarcas }),
  rp("--cupos del statusline y uso.json", ["--cupos", "--json"], 0, { preparar: statusline, env: vivo }),
  rp("--tipo con cupos del statusline", ["--tipo", "codigo-acotado", "--explicar"], 0, { preparar: statusline, env: vivo }),
  rp("--cupos con agy (quota)", ["--cupos"], 0, { preparar: (c) => (statusline(c), agyFalso(c)), env: { REPARTO_CUPOS_FIJOS: "" }, estadoIgnorar: [/^quota\.json$/] }),
  rp("--tipo con agy sin cupo de Claude por Google", ["--tipo", "debug", "--json"], 0, { preparar: (c) => (statusline(c), agyFalso(c)), env: { REPARTO_CUPOS_FIJOS: "" }, estadoIgnorar: [/^quota\.json$/] }),
  rp("cupos fijos que no existen", ["--tipo", "lectura"], 1, { env: (c) => ({ REPARTO_CUPOS_FIJOS: path.join(c.aux, "no-hay.json") }) }),

  // enfriamiento
  rpPasos(
    "enfriar, preguntar, elegir y olvidar",
    [
      [["--enfriar", "Opencode:opencode/big-pickle"], 0],
      [["--enfriado", "opencode:opencode/big-pickle"], 0],
      [["--tipo", "lectura", "--json"], 0],
      [["--enfriar", "dsh:deepseek/deepseek-v4-flash", "--horas", "2.5"], 0],
      [["--tabla", "--json"], 0],
      [["--olvidar-agotados"], 0],
      [["--enfriado", "opencode:opencode/big-pickle"], 1],
    ],
  ),
  rp("--enfriar con --horas 0", ["--enfriar", "x", "--horas", "0"], 2),
  rp("--enfriar con --horas no numérico", ["--enfriar", "x", "--horas", "mucho"], 2),
  rp("--enfriar sin id", ["--enfriar", " "], 2),
  rp("--enfriado de una marca vencida", ["--enfriado", "pasado"], 1, { preparar: conMarcas }),
  rp("--enfriado con fracción de segundo", ["--enfriado", "dsh:deepseek/deepseek-v4-flash"], 0, { preparar: conMarcas }),

  // agotados
  rpPasos("agotar y ver los cupos", [
    [["--agotar", "claude-opus-5-5"], 0],
    [["--agotar", "agy:claude-opus-5-5-high"], 0],
    [["--agotar", "gemini-4-argon-high", "--hasta", "2026-10-27T10:00:00Z"], 0],
    [["--agotar", "opencode:opencode-go/glm-5"], 0],
    [["--agotar", "dsh:ollama/qwen3:8b"], 0],
    [["--cupos", "--json"], 0],
    [["--tipo", "lectura", "--explicar"], 0],
  ]),
  rp("--agotar con --cuenta", ["--agotar", "claude-opus-5-5", "--cuenta", "trabajo"], 0, { cupos: CUPOS_RAROS }),
  rp("--agotar codex", ["--agotar", "codex:gpt-6-luna-high"], 0, { cupos: CUPOS_RAROS }),
  rp("--agotar algo que no tiene cupo", ["--agotar", "foo"], 1),
  rp("--agotar con --hasta mal", ["--agotar", "claude-opus-5-5", "--hasta", "mal"], 2),

  // plan
  rp("--plan", ["--plan"], 0),
  rp("--plan --json con plan guardado", ["--plan", "--json"], 0, { preparar: conMarcas }),
  rpPasos("--plan: ausente, presente, gastar-hoy y borrar", [
    [["--plan", "ausente", "2026-10-27,2026-10-28"], 0],
    [["--plan", "ausente", "hoy,mañana", "--json"], 0],
    [["--plan", "presente", "2026-10-27"], 0],
    [["--plan", "gastar-hoy"], 0],
    [["--tipo", "lectura", "--json"], 0],
    [["--plan", "ahorrar-hoy", "--json"], 0],
    [["--plan", "borrar"], 0],
  ]),
  rp("--plan ausente en el pasado", ["--plan", "ausente", "2025-01-01"], 2),
  rp("--plan ausente con rango largo", ["--plan", "ausente", "2026-10-27..2026-12-30"], 2),
  rp("--plan ausente con fecha mala", ["--plan", "ausente", "mañana..2026-10-30"], 2),
  rp("--plan desconocido", ["--plan", "zzz"], 2),

  // las demás consultas
  rp("--tabla", ["--tabla"], 0),
  rp("--tabla --json con cupos raros", ["--tabla", "--json"], 0, { cupos: CUPOS_RAROS }),
  rp("--aa-diag", ["--aa-diag"], 0),
  rp("--aa-diag --json", ["--aa-diag", "--json"], 0),
  rp("--aa-diag sin caché de AA", ["--aa-diag"], 0, { env: { REPARTO_AA: "0" } }),
  rp("--resolver claude", ["--resolver", "claude-opus-5-5"], 0),
  rp("--resolver agy --json", ["--resolver", "agy:gpt-oss-120b-medium", "--json"], 0),
  rp("--resolver codex --json", ["--resolver", "codex:gpt-6-luna-high", "--json"], 0),
  rp("--resolver dsh --json", ["--resolver", "dsh:ollama/qwen3:8b", "--json"], 0),
  rp("--resolver opencode --json", ["--resolver", "opencode:opencode/big-pickle", "--json"], 0),
  rp("--resolver desconocido", ["--resolver", "x"], 1),
  rp("--excluido no", ["--excluido", "claude-opus-5-5"], 1),
  rp("--excluido sí", ["--excluido", "claude-opus-5-5"], 0, { modelos: { excluir: ["opus"] } }),
  rp("--cuenta-para claude", ["--cuenta-para", "claude-haiku-5-5", "--json"], 0, { cupos: CUPOS_RAROS }),
  rp("--cuenta-para agy", ["--cuenta-para", "agy:claude-opus-5-5-high"], 0, { cupos: CUPOS_RAROS, preparar: conMarcas }),
  rp("--cuenta-para codex", ["--cuenta-para", "codex:gpt-6-luna-high", "--json"], 0),
  rp("--cuenta-para algo sin cuenta", ["--cuenta-para", "x"], 1),

  // OpenCode cortó: el límite gratis por stdin, y el sondeo a mano
  rpStdin("--opencode-limite con el límite gratis", "Error: Free usage limit reached. Connect a provider or subscribe to OpenCode Go.\n", 0),
  rpStdin("--opencode-limite con retrying in N", "Free usage exceeded, retrying in 90m\n", 0),
  rpStdin("--opencode-limite con un 429 no toca nada", "Too Many Requests: 429\n", 1),
  rp("--sondear-opencode con el límite gratis", ["--sondear-opencode"], 0, { preparar: opencodeFalso("Error: Free usage limit reached.", true), env: conOpencodeFalso }),
  rp("--sondear-opencode que contesta no toca el grupo", ["--sondear-opencode"], 1, { preparar: opencodeFalso("OK", false), env: conOpencodeFalso }),
  rp("--sondear-opencode sin opencode", ["--sondear-opencode"], 2, { env: (c) => ({ HILOS_OPENCODE: path.join(c.aux, "no-hay-opencode") }) }),

  // umbrales de modelos.json
  ...casosModelos,
];
