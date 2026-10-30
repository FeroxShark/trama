// Datos falsos del panel de contexto (bench y capturas): un líder y dos workers con ids y nombres inventados.
import type { Desglose, FilaCategoria } from "../../electron/contexto-desglose";
import type { Catalogo, VistaApagados } from "../../electron/contexto-panel";
import type { VistaPrevia } from "../../electron/contexto-previa";
import type { SkillCatalogo } from "../../electron/skills-catalogo";

const cat = (id: FilaCategoria["id"], tokens: number, estimado = false): FilaCategoria => ({ id, nombre: null, tokens, estimado });

const AHORA = Date.now();

/** Lo usado es la suma de las categorías que ocupan la ventana; lo libre, lo que queda tras la reserva. */
const CATS_LIDER = [
  cat("sistema", 9_800),
  cat("herramientas", 15_500),
  cat("mcp", 1_159),
  cat("skills", 2_820),
  cat("memoria", 4_940),
  cat("agentes", 1_100),
  cat("mensajes", 76_500),
];
const USADO_LIDER = CATS_LIDER.reduce((n, c) => n + c.tokens, 0);

const LIDER: Desglose = {
  version: 1,
  quien: { tipo: "lider", id: "" },
  motor: "claude",
  fuente: "claude",
  estimado: false,
  modelo: "claude-opus-5-5",
  usado: USADO_LIDER,
  ventana: 200_000,
  ventanaEstimada: false,
  categorias: [
    ...CATS_LIDER,
    cat("reserva", 33_000),
    cat("libre", 200_000 - USADO_LIDER - 33_000),
    // Los esquemas de las herramientas de MCP sin cargar: existen, pero no están en la ventana ni suman.
    { id: "mcp", nombre: "MCP tools (deferred)", tokens: 160_153, estimado: false, diferido: true },
  ],
  herramientas: [
    { nombre: "Bash", tokens: 3_900, diferida: false, usos: 41 },
    { nombre: "Edit", tokens: 2_100, diferida: false, usos: 18 },
    { nombre: "Read", tokens: 1_800, diferida: false, usos: 33 },
    { nombre: "Agent", tokens: 1_700, diferida: false, usos: 6 },
    { nombre: "WebFetch", tokens: 1_300, diferida: false, usos: 0 },
    { nombre: "Write", tokens: 1_200, diferida: false, usos: 5 },
    { nombre: "NotebookEdit", tokens: 1_100, diferida: false, usos: 0 },
    { nombre: "WebSearch", tokens: 900, diferida: false, usos: 0 },
    { nombre: "Grep", tokens: 800, diferida: false, usos: 12 },
    { nombre: "TodoWrite", tokens: 700, diferida: false, usos: 3 },
    { nombre: "CronCreate", tokens: null, diferida: true, usos: 0 },
    { nombre: "CronDelete", tokens: null, diferida: true, usos: 0 },
    { nombre: "Monitor", tokens: null, diferida: true, usos: 0 },
  ],
  mcp: [
    {
      servidor: "claude_ai_Notion",
      tokens: 482,
      usos: 4,
      instrucciones: 182,
      diferidos: 124_566,
      resultados: 6_200,
      herramientas: [
        { nombre: "notion-search", tokens: 300, cargada: true, usos: 4 },
        { nombre: "notion-fetch", tokens: 70_000, cargada: false, usos: 0 },
        { nombre: "notion-update-page", tokens: 54_566, cargada: false, usos: 0 },
      ],
    },
    {
      servidor: "claude_ai_Gmail",
      tokens: 90,
      usos: 0,
      instrucciones: 90,
      diferidos: 35_587,
      resultados: 0,
      herramientas: [
        { nombre: "search_threads", tokens: 21_000, cargada: false, usos: 0 },
        { nombre: "get_thread", tokens: 14_587, cargada: false, usos: 0 },
      ],
    },
    {
      servidor: "repo-remoto",
      tokens: 587,
      usos: 9,
      instrucciones: 0,
      diferidos: 0,
      resultados: 3_100,
      herramientas: [
        { nombre: "abrir_issue", tokens: 250, cargada: true, usos: 6 },
        { nombre: "listar_prs", tokens: 200, cargada: true, usos: 3 },
        { nombre: "comentar", tokens: 137, cargada: true, usos: 0 },
      ],
    },
  ],
  skills: [
    { nombre: "revisar-diseno", origen: "user", plugin: null, tokens: 600, estimado: false, usos: 0, hook: 0 },
    { nombre: "ui-ux-pro-max", origen: "user", plugin: null, tokens: 520, estimado: false, usos: 2, hook: 0 },
    { nombre: "informe-pdf", origen: "plugin", plugin: "oficina@mercado", tokens: 480, estimado: false, usos: 0, hook: 0 },
    { nombre: "planilla", origen: "plugin", plugin: "oficina@mercado", tokens: 440, estimado: false, usos: 0, hook: 0 },
    { nombre: "workers", origen: "user", plugin: null, tokens: 400, estimado: false, usos: 7, hook: 0 },
    { nombre: "capturas", origen: "project", plugin: null, tokens: 260, estimado: false, usos: 1, hook: 0 },
    { nombre: "caveman:caveman", origen: "plugin", plugin: "caveman@mercado", tokens: 120, estimado: false, usos: 0, hook: 40 },
  ],
  memoria: [
    { ruta: "/home/persona/.claude/CLAUDE.md", tipo: "User", tokens: 1_600, estimado: false },
    { ruta: "/home/persona/proyectos/atlas/CLAUDE.md", tipo: "Project", tokens: 2_100, estimado: false },
    { ruta: "/home/persona/proyectos/atlas/AGENTS.md", tipo: "Project", tokens: 600, estimado: false },
    { ruta: "/home/persona/.claude/projects/atlas/memory/MEMORY.md", tipo: "AutoMem", tokens: 640, estimado: false },
  ],
  sistema: [
    { clave: "intro", tipo: "prompt", nombre: "", detalle: null, seccion: "intro", tokens: 380, estimado: true, texto: "Sos un asistente de ingeniería de software que trabaja en una terminal.\nAyudás con tareas de código: leer, buscar, editar y probar.\n\nNo ayudes con nada que sirva para dañar sistemas ajenos.", truncado: false },
    { clave: "seccion:harness", tipo: "prompt", nombre: "Harness", detalle: null, seccion: "arnes", tokens: 350, estimado: true, texto: "# Harness\n - El texto que escribís fuera de las herramientas se muestra en la terminal como markdown.\n - Las herramientas corren detrás de un modo de permisos que elige la persona; si una se niega, no la repitas igual.\n - Los hooks pueden interceptar llamadas: tomá su salida como una devolución de la persona.", truncado: false },
    { clave: "seccion:session-specific guidance", tipo: "prompt", nombre: "Session-specific guidance", detalle: null, seccion: "sesion", tokens: 120, estimado: true, texto: "# Session-specific guidance\n - Si la persona escribe /<nombre-de-skill>, invocala con la herramienta Skill.", truncado: false },
    { clave: "seccion:memory", tipo: "prompt", nombre: "Memory", detalle: null, seccion: "memoria", tokens: 640, estimado: true, texto: "# Memory\n\nTenés una memoria persistente en archivos, en la carpeta de memoria del proyecto.\nCada recuerdo es un archivo con su nombre, su descripción y su tipo.", truncado: false },
    { clave: "seccion:environment", tipo: "prompt", nombre: "Environment", detalle: null, seccion: "entorno", tokens: 280, estimado: true, texto: "# Environment\n - Los modelos más nuevos son de la familia 5.\n - Claude Code está disponible como CLI, app de escritorio, web y extensiones de editor.", truncado: false },
    { clave: "seccion:context management", tipo: "prompt", nombre: "Context management", detalle: null, seccion: "contexto", tokens: 160, estimado: true, texto: "# Context management\nCuando la conversación crece, se resume sola; seguí trabajando sin apurarte a cerrar.", truncado: false },
    { clave: "suelta", tipo: "prompt", nombre: "", detalle: "Respondé corto y en español rioplatense. Commiteá antes de cada comando lar…", seccion: "suelta", tokens: 1_900, estimado: true, texto: "Respondé corto y en español rioplatense. Commiteá antes de cada comando largo y verificá lo que hiciste.", truncado: false },
    { clave: "hook:SessionStart:startup", tipo: "hook", nombre: "SessionStart:startup", detalle: "SessionStart", seccion: null, tokens: 612, estimado: true, texto: "CAVEMAN MODE ACTIVE — mode: ultracave\nRespond terse. All technical substance stay.", truncado: false },
    { clave: "diferidas", tipo: "diferidas", nombre: "diferidas", detalle: "15", seccion: null, tokens: 410, estimado: true, texto: "CronCreate\nCronDelete\nWebFetch\nWebSearch\nmcp__claude_ai_Notion__notion-fetch", truncado: false },
    { clave: "entorno", tipo: "entorno", nombre: "entorno", detalle: null, seccion: null, tokens: 438, estimado: true, texto: null, truncado: false },
  ],
  promptVersion: "2.1.314",
  usos: { herramientas: {}, skills: { "ui-ux-pro-max": 2, workers: 7, capturas: 1 }, mcp: {}, hook: { "caveman:caveman": 40 } },
  medidoEn: AHORA,
  desactualizado: false,
  sinUso: { herramientas: ["WebFetch", "NotebookEdit", "WebSearch"], mcp: ["claude_ai_Gmail"], skills: ["revisar-diseno", "informe-pdf", "planilla"] },
  motivo: null,
};

const worker = (id: string, usado: number, sinUso: boolean): Desglose => ({
  version: 1,
  quien: { tipo: "worker", id },
  motor: "claude",
  fuente: "transcript",
  estimado: true,
  modelo: "claude-sonnet-5-5",
  usado,
  ventana: 200_000,
  ventanaEstimada: true,
  categorias: [cat("sistema", 21_000, true), cat("herramientas", 7_400, true), cat("skills", 4_800, true), cat("memoria", 3_900, true), cat("mensajes", usado - 37_100, true)],
  herramientas: [
    { nombre: "Bash", tokens: 3_300, diferida: false, usos: 27 },
    { nombre: "Edit", tokens: 1_800, diferida: false, usos: 14 },
    { nombre: "Read", tokens: 1_500, diferida: false, usos: 22 },
    { nombre: "WebSearch", tokens: 800, diferida: false, usos: 0 },
    { nombre: "CronCreate", tokens: null, diferida: true, usos: 0 },
    { nombre: "WebFetch", tokens: null, diferida: true, usos: 0 },
  ],
  mcp: [],
  skills: [
    { nombre: "capturas", origen: "project", plugin: null, tokens: 1_100, estimado: true, usos: 3, hook: 0 },
    { nombre: "revisar-diseno", origen: "user", plugin: null, tokens: 1_400, estimado: true, usos: 0, hook: 0 },
    { nombre: "informe-pdf", origen: "plugin", plugin: "oficina@mercado", tokens: 1_200, estimado: true, usos: 0, hook: 0 },
    { nombre: "planilla", origen: "plugin", plugin: "oficina@mercado", tokens: 1_100, estimado: true, usos: 0, hook: 0 },
  ],
  memoria: [
    { ruta: "/home/persona/proyectos/atlas/CLAUDE.md", tipo: "Project", tokens: 2_100, estimado: true },
    { ruta: "/home/persona/proyectos/atlas/AGENTS.md", tipo: "Project", tokens: 600, estimado: true },
    { ruta: "/home/persona/.claude/CLAUDE.md", tipo: "User", tokens: 1_200, estimado: true },
  ],
  sistema: [
    { clave: "intro", tipo: "prompt", nombre: "", detalle: null, seccion: "intro", tokens: 380, estimado: true, texto: "Sos un asistente de ingeniería de software que trabaja en una terminal.", truncado: false },
    { clave: "seccion:harness", tipo: "prompt", nombre: "Harness", detalle: null, seccion: "arnes", tokens: 350, estimado: true, texto: "# Harness\n - El texto que escribís fuera de las herramientas se muestra en la terminal como markdown.", truncado: false },
    { clave: "seccion:environment", tipo: "prompt", nombre: "Environment", detalle: null, seccion: "entorno", tokens: 280, estimado: true, texto: "# Environment\n - Claude Code está disponible como CLI, app de escritorio, web y extensiones de editor.", truncado: false },
    { clave: "diferidas", tipo: "diferidas", nombre: "diferidas", detalle: "15", seccion: null, tokens: 410, estimado: true, texto: "CronCreate\nCronDelete\nWebFetch", truncado: false },
    { clave: "entorno", tipo: "entorno", nombre: "entorno", detalle: null, seccion: null, tokens: 430, estimado: true, texto: null, truncado: false },
  ],
  usos: { herramientas: { Bash: 27, Edit: 14, Read: 22 }, skills: { capturas: 3 }, mcp: {}, hook: {} },
  medidoEn: null,
  desactualizado: false,
  sinUso: { herramientas: [], mcp: [], skills: sinUso ? ["revisar-diseno", "informe-pdf", "planilla"] : [] },
  motivo: null,
});

/** El desglose falso de un líder o de un worker (el de las capturas es el de "ana-c7" con sus workers). */
export function desgloseFalso(x: { lider: string } | { worker: string }): Desglose {
  if ("lider" in x) return { ...structuredClone(LIDER), quien: { tipo: "lider", id: x.lider } };
  return worker(x.worker, x.worker.endsWith("49377") ? 63_800 : 47_200, true);
}

const sk = (nombre: string, descripcion: string, origen: SkillCatalogo["origen"], de: string, tokens: number, estado: SkillCatalogo["estado"] = "activa"): SkillCatalogo => ({
  id: `skill:${origen}:${de}:${nombre}`,
  clave: origen === "plugin" ? `${de.split("@")[0]}:${nombre}` : nombre,
  nombre,
  descripcion,
  origen,
  de,
  tokens,
  tokensEstimado: false,
  estado,
});

export const CATALOGO_FALSO: SkillCatalogo[] = [
  sk("revisar-diseno", "Revisa una interfaz contra el estándar visual: contraste, espaciado, jerarquía y estados.", "usuario", "", 1_400),
  sk("ui-ux-pro-max", "Guía de diseño de interfaces para web, móvil y escritorio, con paletas, tipografías y reglas de accesibilidad.", "usuario", "", 1_300),
  sk("informe-pdf", "Crea, lee y combina archivos PDF; extrae tablas y rellena formularios.", "plugin", "oficina@mercado", 1_200),
  sk("planilla", "Abre, edita y crea hojas de cálculo; limpia datos desordenados.", "plugin", "oficina@mercado", 1_100),
  sk("capturas", "Saca una captura de la app en un estado forzado, sin abrir ventanas.", "proyecto", "atlas", 1_100),
  sk("workers", "Delegar trabajo a un worker que corre dentro del proyecto.", "usuario", "", 1_000),
  sk("presentacion", "Arma una presentación de diapositivas a partir de un esquema.", "plugin", "oficina@mercado", 950, "apagada"),
  sk("nube-despliegue", "Despliega y revisa servicios en la nube desde la terminal.", "plugin", "nube@mercado", 880),
  sk("nube-base-datos", "Crea y consulta bases de datos de la nube.", "plugin", "nube@mercado", 760),
  sk("investigar", "Investiga un tema en varias fuentes y escribe un informe con citas.", "claudeai", "Investigación", 700),
  sk("bocetos", "Dibuja bocetos de pantallas en HTML para elegir entre dos o tres estilos.", "usuario", "", 640),
  sk("migrar-esquema", "Escribe y revisa migraciones de esquema con vuelta atrás.", "proyecto", "atlas", 520, "apagada"),
  sk("traducir", "Traduce textos de la interfaz entre español e inglés manteniendo las variables.", "usuario", "", 430),
  sk("diagramas", "Dibuja diagramas de arquitectura y de flujo.", "plugin", "nube@mercado", 410, "plugin-apagado"),
  sk("caveman", "Respuestas cortas y directas: activa el modo conciso en cada mensaje.", "plugin", "caveman@mercado", 120),
];

export const APAGADOS_FALSOS: VistaApagados = {
  version: 1,
  apagados: { version: 1, skills: ["presentacion", "migrar-esquema"], mcp: [], herramientas: [], memoria: [] },
  tipos: ["skills", "mcp", "herramientas", "memoria"],
  protegidas: ["Bash", "Read", "Edit", "Write"],
  motores: { claude: true, gemini: false, dsh: false, opencode: false, ollama: false, local: false },
};

/** Lo que se usó en las últimas semanas en todas las sesiones de la persona (la skill de un plugin con hook se carga sola). */
export const USOS_FALSOS: NonNullable<Catalogo["usos"]> = {
  dias: 30,
  sesiones: 64,
  skills: { "ui-ux-pro-max": 31, workers: 22, capturas: 9, investigar: 3, "informe-pdf": 2, traducir: 1 },
  porHook: ["caveman:caveman"],
};

export const catalogoFalso = (): Catalogo => ({ version: 1, skills: structuredClone(CATALOGO_FALSO), total: CATALOGO_FALSO.length, exactos: true, usos: structuredClone(USOS_FALSOS) });

// --- Vista previa: qué cargaría un líder o worker nuevo (sin lanzar nada) -----------------------------------------------------------------

const PROYECTOS_PREVIA = [
  { ruta: "/home/persona/proyectos/atlas", nombre: "atlas" },
  { ruta: "/home/persona/proyectos/faro", nombre: "faro" },
];

/** Lo que dice `contexto:previa` para un líder o worker nuevo: el sistema y las herramientas de la base, sus archivos de memoria y sus skills; el peso de los MCP no se sabe hasta conectar. */
export function previaFalsa(x: { tipo: "lider" | "worker"; proyecto?: string; modelo?: string }, base: VistaPrevia["base"] = { estado: "lista", version: "2.1.314", instalada: "2.1.314", capturadoEn: AHORA - 3_600_000 }): VistaPrevia {
  const lider = x.tipo === "lider";
  const modelo = x.modelo || "claude-opus-5-5";
  const vista = { version: 1 as const, tipo: x.tipo, proyecto: x.proyecto ?? "", modelo, base, proyectos: PROYECTOS_PREVIA };
  const hooks = [
    { evento: "SessionStart", nombre: "caveman-activar", comando: "node ~/.claude/hooks/caveman-activar.js", origen: "caveman" },
    { evento: "PreToolUse", nombre: "guarda-destructiva", comando: "node ~/.claude/hooks/guarda.mjs", origen: "usuario" },
  ];
  if (base.estado === "falta") return { ...vista, hooks, desglose: null };
  const de = structuredClone(LIDER);
  const sistema = de.sistema.filter((p) => p.tipo === "prompt");
  const herramientas = de.herramientas.map((h) => ({ ...h, usos: 0 }));
  const mcp = lider ? ["claude_ai_Notion", "claude_ai_Gmail", "repo-remoto"].map((servidor) => ({ servidor, tokens: null, usos: 0, instrucciones: 0, diferidos: null, resultados: null, herramientas: [] })) : [];
  const skills = de.skills.map((s) => ({ ...s, estimado: true, usos: 0, hook: 0 }));
  const memoria = de.memoria.filter((m) => lider || m.tipo !== "User").map((m) => ({ ...m, estimado: true }));
  const suma = (xs: (number | null)[]) => xs.reduce<number>((n, v) => n + (v ?? 0), 0);
  const categorias = [
    cat("sistema", suma(sistema.map((s) => s.tokens)), true),
    cat("herramientas", suma(herramientas.filter((h) => !h.diferida).map((h) => h.tokens)), true),
    ...(mcp.length ? [cat("mcp", 0, true)] : []),
    cat("skills", suma(skills.map((s) => s.tokens)), true),
    cat("memoria", suma(memoria.map((m) => m.tokens)), true),
  ];
  return {
    ...vista,
    hooks,
    desglose: {
      version: 1,
      quien: { tipo: x.tipo, id: "" },
      motor: "claude",
      fuente: "previa",
      estimado: true,
      modelo,
      usado: suma(categorias.map((c) => c.tokens)),
      ventana: 1_000_000,
      ventanaEstimada: true,
      categorias,
      herramientas,
      mcp,
      skills,
      memoria,
      sistema,
      promptVersion: base.version,
      usos: { herramientas: {}, skills: {}, mcp: {}, hook: {} },
      medidoEn: null,
      desactualizado: false,
      sinUso: { herramientas: [], mcp: [], skills: [] },
      motivo: null,
    },
  };
}
