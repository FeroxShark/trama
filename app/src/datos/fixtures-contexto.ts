// Datos falsos del panel de contexto (bench y capturas): un líder y dos workers con ids y nombres inventados.
import type { Desglose, FilaCategoria } from "../../electron/contexto-desglose";
import type { Catalogo, VistaApagados } from "../../electron/contexto-panel";
import type { SkillCatalogo } from "../../electron/skills-catalogo";

const cat = (id: FilaCategoria["id"], tokens: number, estimado = false): FilaCategoria => ({ id, nombre: null, tokens, estimado });

const LIDER: Desglose = {
  version: 1,
  quien: { tipo: "lider", id: "" },
  motor: "claude",
  fuente: "claude",
  estimado: false,
  modelo: "claude-opus-5-5",
  usado: 126_400,
  ventana: 200_000,
  ventanaEstimada: false,
  categorias: [
    cat("sistema", 8_900),
    cat("herramientas", 15_300),
    cat("mcp", 13_200),
    cat("skills", 7_100),
    cat("memoria", 4_300),
    cat("agentes", 1_100),
    cat("mensajes", 76_500),
    cat("reserva", 33_000),
    cat("libre", 40_600),
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
  ],
  mcp: [
    {
      servidor: "docs-internos",
      tokens: 6_800,
      usos: 0,
      herramientas: [
        { nombre: "buscar", tokens: 2_900, cargada: true, usos: 0 },
        { nombre: "crear_pagina", tokens: 2_300, cargada: true, usos: 0 },
        { nombre: "mover_pagina", tokens: 1_600, cargada: true, usos: 0 },
      ],
    },
    {
      servidor: "repo-remoto",
      tokens: 6_400,
      usos: 9,
      herramientas: [
        { nombre: "abrir_issue", tokens: 2_200, cargada: true, usos: 6 },
        { nombre: "listar_prs", tokens: 2_000, cargada: true, usos: 3 },
        { nombre: "comentar", tokens: 2_200, cargada: true, usos: 0 },
      ],
    },
  ],
  skills: [
    { nombre: "revisar-diseno", origen: "user", plugin: null, tokens: 1_400, estimado: false, usos: 0 },
    { nombre: "ui-ux-pro-max", origen: "user", plugin: null, tokens: 1_300, estimado: false, usos: 2 },
    { nombre: "informe-pdf", origen: "plugin", plugin: "oficina@mercado", tokens: 1_200, estimado: false, usos: 0 },
    { nombre: "planilla", origen: "plugin", plugin: "oficina@mercado", tokens: 1_100, estimado: false, usos: 0 },
    { nombre: "workers", origen: "user", plugin: null, tokens: 1_000, estimado: false, usos: 7 },
    { nombre: "capturas", origen: "project", plugin: null, tokens: 1_100, estimado: false, usos: 1 },
  ],
  memoria: [
    { ruta: "/home/persona/.claude/CLAUDE.md", tipo: "User", tokens: 1_600, estimado: false },
    { ruta: "/home/persona/proyectos/atlas/CLAUDE.md", tipo: "Project", tokens: 2_100, estimado: false },
    { ruta: "/home/persona/proyectos/atlas/AGENTS.md", tipo: "Project", tokens: 600, estimado: false },
  ],
  usos: { herramientas: {}, skills: { "ui-ux-pro-max": 2, workers: 7, capturas: 1 }, mcp: {} },
  sinUso: { herramientas: ["WebFetch", "NotebookEdit", "WebSearch"], mcp: ["docs-internos"], skills: ["revisar-diseno", "informe-pdf", "planilla"] },
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
  categorias: [cat("sistema", 21_000, true), cat("herramientas", 0, true), cat("skills", 4_800, true), cat("memoria", 3_900, true), cat("mensajes", usado - 29_700, true)],
  herramientas: [
    { nombre: "Bash", tokens: null, diferida: false, usos: 27 },
    { nombre: "Edit", tokens: null, diferida: false, usos: 14 },
    { nombre: "Read", tokens: null, diferida: false, usos: 22 },
  ],
  mcp: [],
  skills: [
    { nombre: "capturas", origen: "project", plugin: null, tokens: 1_100, estimado: true, usos: 3 },
    { nombre: "revisar-diseno", origen: "user", plugin: null, tokens: 1_400, estimado: true, usos: 0 },
    { nombre: "informe-pdf", origen: "plugin", plugin: "oficina@mercado", tokens: 1_200, estimado: true, usos: 0 },
    { nombre: "planilla", origen: "plugin", plugin: "oficina@mercado", tokens: 1_100, estimado: true, usos: 0 },
  ],
  memoria: [
    { ruta: "/home/persona/proyectos/atlas/CLAUDE.md", tipo: "Project", tokens: 2_100, estimado: true },
    { ruta: "/home/persona/proyectos/atlas/AGENTS.md", tipo: "Project", tokens: 600, estimado: true },
    { ruta: "/home/persona/.claude/CLAUDE.md", tipo: "User", tokens: 1_200, estimado: true },
  ],
  usos: { herramientas: { Bash: 27, Edit: 14, Read: 22 }, skills: { capturas: 3 }, mcp: {} },
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
];

export const APAGADOS_FALSOS: VistaApagados = {
  version: 1,
  apagados: { version: 1, skills: ["presentacion", "migrar-esquema"], mcp: [], herramientas: [], memoria: [] },
  tipos: ["skills", "mcp", "herramientas", "memoria"],
  protegidas: ["Bash", "Read", "Edit", "Write"],
  motores: { claude: true, gemini: false, dsh: false, opencode: false, ollama: false, local: false },
};

export const catalogoFalso = (): Catalogo => ({ version: 1, skills: structuredClone(CATALOGO_FALSO), total: CATALOGO_FALSO.length, exactos: true });
