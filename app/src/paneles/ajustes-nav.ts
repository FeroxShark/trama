// La estructura de Ajustes: las categorías de la barra lateral, el índice de lo que se busca (cada fila, con sus sinónimos), qué
// categoría está abierta (se recuerda en el hash de la página: `#ajustes/modelos`) y las marcas de "falta algo" de cada una.
// Puro (sin React ni puente): lo prueba tests/ajustes-nav.test.ts. Las vistas están en AjustesNav.tsx.
import type { Clave, ClaveSola } from "../i18n";
import { TIPOS } from "../../electron/modelos-tipos";

export const CATS = ["cuentas", "modelos", "cupos", "locales", "opencode", "dsh", "conectores", "celular", "actualizaciones", "proyectos", "general", "guia"] as const;
export type CatId = (typeof CATS)[number];

export const esCat = (x: unknown): x is CatId => typeof x === "string" && (CATS as readonly string[]).includes(x);

/** Una fila de Ajustes que se puede buscar: `nombre` es la misma clave con que se pinta (`data-opc` de la fila). */
export type Item = { cat: CatId; nombre: ClaveSola; que: ClaveSola | null; sin: string; /** Sólo existe en el .exe de Windows (la fila no se pinta en Linux). */ soloWindows?: true };

const tipoDe = (tipo: (typeof TIPOS)[number]): Item => ({
  cat: "modelos",
  nombre: `mdl.t.${tipo}` as ClaveSola,
  que: `mdl.t.${tipo}Que` as ClaveSola,
  sin: `worker tipo ${tipo} task tarea modelo model`,
});

/** Los sinónimos van en los dos idiomas y sin tildes (no se ven: sólo ayudan a encontrar). */
export const ITEMS: readonly Item[] = [
  { cat: "cuentas", nombre: "ajustes.ctaClaude", que: "ajustes.ctaClaudeQue", sin: "anthropic login iniciar sesion cuenta conectar account sign in" },
  { cat: "cuentas", nombre: "ajustes.ctaGemini", que: "ajustes.ctaGeminiQue", sin: "google agy antigravity login iniciar sesion cuenta conectar account sign in" },

  { cat: "modelos", nombre: "ajustes.mdlLider", que: "ajustes.mdlLiderQue", sin: "lider leader jefe orquestador opus sonnet haiku fable esfuerzo effort" },
  { cat: "modelos", nombre: "ajustes.mdlTodo", que: "ajustes.mdlTodoQue", sin: "uno solo single un modelo todo one model suscripcion" },
  ...TIPOS.map(tipoDe),
  { cat: "modelos", nombre: "ajustes.mdlAutomatico", que: "ajustes.mdlAutomaticoQue", sin: "auto automatico reparto calidad cupo suscripcion elegir modelo hoy elegiria fijo" },
  { cat: "modelos", nombre: "ajustes.mdlWk", que: "ajustes.mdlWkQue", sin: "modelos workers excluir inteligencia calidad apagar permitir fable opus sonnet haiku no usar prohibir dejar afuera gratis opencode" },
  { cat: "modelos", nombre: "ajustes.mdlDestrabar", que: "ajustes.mdlDestrabarQue", sin: "gemini repite bucle trabado destrabar loop interrumpir flash argon" },
  { cat: "modelos", nombre: "ajustes.mdlPermitirMax", que: "ajustes.mdlPermitirMaxQue", sin: "max esfuerzo effort permitir gasta cupo" },
  { cat: "modelos", nombre: "ajustes.dictado", que: "ajustes.dictadoQue", sin: "dictar dictation voz voice microfono microphone transcribir transcribe stt whisper turbo handy" },

  { cat: "cupos", nombre: "ajustes.planSus", que: "ajustes.planQue", sin: "suscripcion subscription pro max plan precio" },
  { cat: "cupos", nombre: "cu.claude", que: "cu.claudeQue", sin: "claude anthropic suscripcion subscription plan cupo quota ventana window 5h semana week conectar connect login" },
  { cat: "cupos", nombre: "cu.google", que: "cu.googleQue", sin: "google gemini agy ai pro suscripcion subscription plan cupo quota ventana window conectar connect login" },
  { cat: "cupos", nombre: "cu.opencode", que: "cu.opencodeQue", sin: "opencode open code gratis free cupo quota agotado exhausted limite limit compartido shared cuenta account conectar connect login pedidos requests uso usage" },
  { cat: "cupos", nombre: "ajustes.ocPlan", que: "ajustes.ocPlanQue", sin: "opencode open code plan go plus pago paid suscripcion subscription gratis free topes limites limits cupo quota modelos models" },
  { cat: "cupos", nombre: "cu.opencodeGo", que: "cu.opencodeGoQue", sin: "opencode open code go plus plan pago paid topes limites limits pedidos requests 5h cinco horas five hours cupo quota agotado exhausted uso usage modelo model" },
  { cat: "cupos", nombre: "cu.nvidia", que: "cu.nvidiaQue", sin: "nvidia nim build.nvidia.com gratis free cupo quota pedidos requests minuto minute tope limit 429 clave key uso usage" },
  { cat: "cupos", nombre: "cu.chatgpt", que: "cu.chatgptQue", sin: "chatgpt openai codex gpt suscripcion subscription plan cupo quota conectar connect login" },
  { cat: "cupos", nombre: "cu.topes", que: "cu.topesQue", sin: "tope limite limit cupo quota llena full umbral threshold porcentaje percent usado used dejar de usar stop using claude google gemini chatgpt codex opencode reserva reserve guardar save sesiones sessions codigo code fabrica factory" },
  { cat: "cupos", nombre: "ajustes.cuposSinCupo", que: "ajustes.cuposSinCupoQue", sin: "sin cupo out of quota agotado usar otro use another esperar wait fallar fail reemplazo fallback proveedor provider" },

  { cat: "locales", nombre: "ajustes.mdlLocales", que: "ajustes.mdlOllamaQue", sin: "ollama local llama gpu offline detectar detect" },
  { cat: "locales", nombre: "ajustes.mdlInstalados", que: "ajustes.mdlInstaladosQue", sin: "ollama instalados installed modelos locales agregar add usar" },
  { cat: "locales", nombre: "ajustes.mdlBajar", que: "ajustes.mdlBajarQue", sin: "ollama descargar download pull bajar modelo model" },
  { cat: "locales", nombre: "ajustes.mdlLocalesAgregados", que: "ajustes.mdlLocalesQue", sin: "ollama locales agregados added direccion address url servidor server quitar remove" },

  { cat: "opencode", nombre: "ajustes.ocPrograma", que: "ajustes.ocProgramaQue", sin: "opencode open code gratis free connect login console zen modelos models actualizar refresh instalar install" },
  { cat: "opencode", nombre: "ajustes.nimClave", que: "ajustes.nimClaveQue", sin: "nvidia nim build.nvidia.com clave key api token gratis free probar test get api key desarrollo prototipos prototyping" },
  { cat: "opencode", nombre: "ajustes.nimModelos", que: "ajustes.nimModelosQue", sin: "nvidia nim modelos models deepseek v4.1 flash prender apagar ofrecer offer reparto router agregar add id" },
  { cat: "dsh", nombre: "ajustes.dshPrograma", que: "ajustes.dshProgramaQue", sin: "dsh deepseek harness instalar install npm version programa" },
  { cat: "opencode", nombre: "ajustes.dshOpencode", que: "ajustes.dshOpencodeQue", sin: "opencode zen clave key api token pago paid modelos dsh" },
  { cat: "dsh", nombre: "ajustes.dshDeepseek", que: "ajustes.dshDeepseekQue", sin: "deepseek clave key api token probar test v4 flash" },
  { cat: "dsh", nombre: "ajustes.dshOllama", que: "ajustes.dshOllamaQue", sin: "ollama local dsh probar test" },

  { cat: "conectores", nombre: "conectores.propios", que: "conectores.propiosQue", sin: "mcp servidor server conector connector notion gmail calendar calendario herramientas tools agregar add token clave key stdio http sse url comando command variables entorno env cabecera header" },
  { cat: "conectores", nombre: "conectores.motores", que: "conectores.motoresQue", sin: "mcp motores engines claude deepseek dsh opencode gemini agy workers lider leader soporta supported" },
  { cat: "conectores", nombre: "conectores.claudeai", que: "conectores.claudeaiQue", sin: "claude.ai conectores connectors web navegador browser gmail calendar notion drive cuenta account mcp" },

  { cat: "celular", nombre: "ajustes.celGuia", que: "ajustes.celPaso1Que", sin: "telefono movil phone mobile tailscale tailnet instalar install qr codigo code escanear scan direccion address url conectar connect guia guide" },
  { cat: "celular", nombre: "ajustes.celAcceso", que: "ajustes.celAccesoQue", sin: "telefono movil phone mobile tailscale tailnet remoto remote encender apagar on off" },
  { cat: "celular", nombre: "ajustes.celPuerto", que: "ajustes.celPuertoQue", sin: "telefono movil phone mobile tailscale tailnet remoto remote port" },
  { cat: "celular", nombre: "ajustes.celDisp", que: "ajustes.celDispQue", sin: "telefono movil phone mobile tailscale tailnet dispositivos devices permitidos allowed agregar add" },

  { cat: "actualizaciones", nombre: "carcasa.act", que: "carcasa.actQue", sin: "windows update version buscar check descargar download reiniciar restart exe trama github release novedades" },
  { cat: "actualizaciones", nombre: "carcasa.restos", que: "carcasa.restosQue", sin: "windows limpiar clean restos leftovers versiones anteriores previous desinstalar uninstall", soloWindows: true },

  { cat: "proyectos", nombre: "pry.nombres", que: "pry.nombresQue", sin: "renombrar rename nombre name alias proyecto project mostrar display titulo title slug registro registry shark" },
  { cat: "proyectos", nombre: "pry.instrucciones", que: "pry.instruccionesQue", sin: "agents.md agents claude.md gemini.md unificar unify instrucciones instructions import stub modelos models fuente unica single source editar edit manual" },

  { cat: "general", nombre: "ajustes.idioma", que: "ajustes.idiomaQue", sin: "language english espanol ingles spanish traduccion idioma" },
  { cat: "general", nombre: "ajustes.tema", que: "ajustes.temaQue", sin: "theme tema color colores oscuro dark claro light sistema system modo apariencia appearance bosque forest atardecer sunset grafito graphite contraste contrast daltonismo" },
  { cat: "general", nombre: "ajustes.letra", que: "ajustes.letraQue", sin: "tamano size texto text zoom font fuente grande chico letra" },
  { cat: "general", nombre: "ajustes.fuente", que: "ajustes.fuenteQue", sin: "tipografia typeface font letra inter sistema system" },
  { cat: "general", nombre: "ajustes.mono", que: "ajustes.monoQue", sin: "monoespaciada monospace codigo code fira tipografia font fuente" },
  { cat: "general", nombre: "ajustes.tiernos", que: "ajustes.tiernosQue", sin: "mensajes carinosos tiernos friendly messages gatito carita" },
  { cat: "general", nombre: "ajustes.avisarEspera", que: "ajustes.avisarEsperaQue", sin: "notificacion notification aviso te necesita te espera lider escritorio desktop alerta" },
  { cat: "general", nombre: "ajustes.avisarWorkers", que: "ajustes.avisarWorkersQue", sin: "notificacion notification aviso worker falla fallo cupo cuota quota terminaron tanda celular phone escritorio desktop alerta" },
  { cat: "general", nombre: "ajustes.avisoLider", que: "ajustes.avisoLiderQue", sin: "notificacion aviso lider worker tanda terminar falla cada uno todos lanzo leader" },
  { cat: "general", nombre: "ajustes.compactar", que: "ajustes.compactarQue", sin: "compactacion compaction contexto context autocompact ventana window tokens" },
  { cat: "general", nombre: "ajustes.atajos", que: "ajustes.atajosQue", sin: "teclado keyboard shortcuts hotkeys teclas atajos" },
  { cat: "general", nombre: "ajustes.aplicarAuto", que: "ajustes.aplicarAutoQue", sin: "ramas branches veredictos verdicts analista analyst aplicar apply automatico automatic integrar descartar" },
  { cat: "general", nombre: "ajustes.bienvenida", que: "ajustes.bienvenidaQue", sin: "welcome bienvenida primer arranque first start setup asistente configurar inicio" },

  { cat: "guia", nombre: "tour.mostrar", que: "tour.mostrarQue", sin: "guias tour recorrido tutorial ayuda onboarding coach marks globos pistas help guides show hide apagar desactivar disable" },
  { cat: "guia", nombre: "tour.reiniciar", que: "tour.reiniciarQue", sin: "guias tour recorrido reiniciar resetear volver a mostrar reset show again guides" },
  { cat: "guia", nombre: "guia.lider", que: "guia.liderQue", sin: "lider leader worker workers rama branch tarea task brief delegar delegate" },
  { cat: "guia", nombre: "guia.modelos", que: "guia.modelosQue", sin: "modelo model opus sonnet haiku esfuerzo effort inteligencia intelligence gratis free opencode low medium high xhigh elegir choose" },
  { cat: "guia", nombre: "guia.tablero", que: "guia.tableroQue", sin: "tablero board pendientes todo tareas tasks kanban preguntas questions iniciar start" },
  { cat: "guia", nombre: "guia.ramas", que: "guia.ramasQue", sin: "ramas branches integrar integrate descartar discard analizar analyze veredicto verdict aplicar apply verificar verified" },
  { cat: "guia", nombre: "guia.cupos", que: "guia.cuposQue", sin: "cupo cupos quota quotas limite limit suscripcion subscription ventana window reservar reserve" },
  { cat: "guia", nombre: "guia.temas", que: "guia.temasQue", sin: "tema theme color oscuro dark claro light paleta palette contraste contrast daltonismo colorblind" },
  { cat: "guia", nombre: "guia.agents", que: "guia.agentsQue", sin: "agents.md agents md manual proyecto project contrato contract plantilla template crear create" },
  { cat: "guia", nombre: "guia.auditoria", que: "guia.auditoriaQue", sin: "auditoria auditar audit review revisar revisor severidad severity diff" },
  { cat: "guia", nombre: "guia.lecciones", que: "guia.leccionesQue", sin: "lecciones lessons podar prune notas notes aprendizaje learned" },
];

/** Minúsculas y sin tildes: "Sesión" se encuentra con "sesion". */
export const normalizar = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export type Resultado = { item: Item; titulo: string; desc: string; cat: string };

/**
 * Lo que responde el buscador: cada palabra de la consulta tiene que estar en el título, la descripción, los sinónimos o el
 * nombre de la categoría (en el idioma de ahora, `traducir`); primero lo que la tiene en el título, y a igual puntaje el orden
 * de Ajustes. `disponible` deja afuera lo que no existe en esta máquina (cuentas y restos fuera de Windows).
 */
export function buscar(consulta: string, traducir: (k: ClaveSola) => string, nombreCat: (c: CatId) => string, disponible: (c: CatId, item: Item) => boolean = () => true, tope = 8): Resultado[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  const llenos: { r: Resultado; punto: number; i: number }[] = [];
  ITEMS.forEach((item, i) => {
    if (!disponible(item.cat, item)) return;
    const titulo = traducir(item.nombre);
    const desc = item.que ? traducir(item.que) : "";
    const cat = nombreCat(item.cat);
    const nt = normalizar(titulo);
    const resto = normalizar(`${desc} ${item.sin} ${cat}`);
    if (!palabras.every((p) => nt.includes(p) || resto.includes(p))) return;
    const punto = nt.includes(palabras.join(" ")) ? 0 : palabras.every((p) => nt.includes(p)) ? 1 : 2;
    llenos.push({ r: { item, titulo, desc, cat }, punto, i });
  });
  return llenos
    .sort((a, b) => a.punto - b.punto || a.i - b.i)
    .slice(0, tope)
    .map((x) => x.r);
}

// --- Qué categoría está abierta, qué se pidió mostrar y las marcas ---

export type Salto = { opc: string; n: number };

const oyentes = new Set<() => void>();
let abierta: CatId | null = null;
let salto: Salto | null = null;
let marcas: Partial<Record<CatId, Clave | null>> = {};
let marcasVars: Partial<Record<CatId, Record<string, string>>> = {};
let nSalto = 0;

const avisar = () => {
  for (const f of [...oyentes]) f();
};

/** El hash recuerda la categoría entre recargas (el celular) sin otro archivo ni `localStorage`. */
const HASH = "#ajustes/";
function deHash(): CatId | null {
  const h = typeof location === "undefined" ? "" : location.hash;
  const c = h.startsWith(HASH) ? h.slice(HASH.length) : "";
  return esCat(c) ? c : null;
}
function aHash(c: CatId) {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  try {
    history.replaceState(history.state, "", `${HASH}${c}`);
  } catch {
    /* un contexto sin historial (una captura offscreen): no se recuerda y listo */
  }
}

/** La categoría que se recuerda (la del hash, o la última a la que se fue), o `null` si nunca se eligió una. */
export const categoria = (): CatId | null => abierta ?? (abierta = deHash());

/** Va a una categoría y, con `opc`, a esa fila (que se resalta cuando está a la vista). */
export function irA(cat: CatId, opc?: string) {
  const cambia = abierta !== cat;
  abierta = cat;
  aHash(cat);
  if (opc) salto = { opc, n: ++nSalto };
  if (cambia || opc) avisar();
}

export const pendienteDeMostrar = (): Salto | null => salto;

/** La marca de una categoría: la clave del texto corto que dice qué falta (o `null`: ya está). */
export function marcar(cat: CatId, clave: Clave | null, vars?: Record<string, string>) {
  const mismoVars = JSON.stringify(marcasVars[cat] ?? null) === JSON.stringify(vars ?? null);
  if ((marcas[cat] ?? null) === clave && mismoVars) return;
  marcas = { ...marcas, [cat]: clave };
  marcasVars = { ...marcasVars, [cat]: vars };
  avisar();
}
export const marcasDe = () => marcas;
export const varsDe = (cat: CatId): Record<string, string> | undefined => marcasVars[cat];

export function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}

/** La categoría que se ve: la recordada si existe en esta máquina; si no, la primera que haya. */
export function efectiva(hay: (c: CatId) => boolean): CatId {
  const c = categoria();
  if (c && hay(c)) return c;
  return CATS.find(hay) ?? "general";
}

/** Sin avisar a nadie: la categoría con que nace Ajustes si todavía no se eligió ninguna (las capturas). */
export function inicial(cat: CatId) {
  if (categoria() === null) abierta = cat;
}

/** Qué categoría muestra cada variante de captura de Ajustes (`HILOS_VARIANTE`), para que la foto caiga donde está lo que se quiere ver. */
export function deVariante(v: string | null | undefined): CatId | null {
  if (!v) return null;
  if (v.startsWith("cuentas")) return "cuentas";
  if (v.startsWith("carcasa") || v === "trama-al-dia" || v === "trama-nueva") return "actualizaciones";
  if (v === "mdl-agregar" || v === "mdl-bajando" || v === "mdl-sinollama" || v === "mdl-apagado" || v === "mdl-sugeridos" || v === "mdl-servidores" || v === "mdl-prender" || v === "mdl-win" || v === "mdl-guias") return "locales";
  if (v === "mdl-tope" || v.startsWith("cupos") || v === "editando" || v === "editando-mal") return "cupos";
  if (v === "celular" || v === "prendiendo") return "celular";
  if (v.startsWith("dsh")) return "dsh";
  if (v.startsWith("oc-") || v.startsWith("nim")) return "opencode";
  if (v.startsWith("mcp") || v.startsWith("plugins")) return "conectores";
  if (v.startsWith("mdl") || v === "sinmdl" || v === "modelo" || v === "dictado") return "modelos";
  if (v.startsWith("proyectos")) return "proyectos";
  if (v.startsWith("guia")) return "guia";
  if (v === "fuente" || v === "mono" || v === "compactar" || v === "general") return "general";
  return null;
}

// --- Qué categorías existen en esta máquina (Celular sólo si el acceso es editable; Cuentas y Actualizaciones, sólo en el .exe) ---
let presentes: Partial<Record<CatId, boolean>> = {};
export const presentesDe = () => presentes;
/** Una sección dice si existe en esta máquina (llega tarde: se pregunta al main). */
export function declarar(cat: CatId, hay: boolean) {
  if (presentes[cat] === hay) return;
  presentes = { ...presentes, [cat]: hay };
  avisar();
}

// --- Abrir Ajustes desde afuera (la pastilla "Falta configurar") ---
let alAbrir: (() => void) | null = null;
/** La barra dice cómo se abre el panel de Ajustes. */
export function alPedirAjustes(f: () => void) {
  alAbrir = f;
  return () => {
    if (alAbrir === f) alAbrir = null;
  };
}
/** Abre Ajustes en una categoría. */
export function abrirAjustes(cat: CatId) {
  irA(cat);
  alAbrir?.();
}

let alAbrirRamas: (() => void) | null = null;
export function alPedirRamas(f: () => void) {
  alAbrirRamas = f;
  return () => {
    if (alAbrirRamas === f) alAbrirRamas = null;
  };
}
export function abrirRamas() {
  alAbrirRamas?.();
}

/** Para los tests: todo como al arrancar. */
export function reiniciar() {
  oyentes.clear();
  abierta = null;
  salto = null;
  marcas = {};
  marcasVars = {};
  presentes = {};
  nSalto = 0;
  alAbrir = null;
}
