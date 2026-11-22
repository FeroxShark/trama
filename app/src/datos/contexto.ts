// De dónde saca los datos el panel de contexto: el main (`contexto:desglose`, `skills:catalogo`, `apagados:leer`, `apagados:fijar`) o,
// en bench y capturas, los fixtures. Leer anda también por la red (celular); apagar es sólo de la PC.
import { MODO } from "../modo";
import { main, mensaje } from "../puente";
import type { Desglose } from "../../electron/contexto-desglose";
import type { Catalogo, VistaApagados } from "../../electron/contexto-panel";
import type { VistaPrevia } from "../../electron/contexto-previa";
import type { Auditoria } from "../../electron/auditoria-contexto-texto";
import type { GastoSubagentes } from "../../electron/subagentes-gasto";
import { APAGADOS_FALSOS, auditoriaFalsa, catalogoFalso, desgloseFalso, previaFalsa, subagentesFalsos } from "./fixtures-contexto";
import type { TipoApagado } from "../paneles/contexto-vista";

export type Quien = { lider: string } | { worker: string } | { subagente: { lider: string; id: string } };
/** Lo que contesta apagar o prender algo: el registro nuevo y qué pasó con los líderes (el aviso es siempre "próximo mensaje"). */
export type Fijado = VistaApagados & { lideres: { reiniciados: number; pendientes: number }; aviso: "proximo-mensaje" };

/** Lo que se pide a la vista previa: un líder o worker nuevo, en qué proyecto (`""`: el home) y con qué modelo. */
export type PedidoPrevia = { tipo: "lider" | "worker"; proyecto: string; modelo: string };

export type FuenteContexto = {
  /** `fresco`: el botón de refrescar; sin él, el main devuelve lo guardado si el transcript no cambió. */
  desglose(q: Quien & { fresco?: boolean }): Promise<Desglose>;
  /** Los subagentes que lanzó un líder (herramienta Agent) y lo que gastó cada uno. */
  subagentes(sid: string): Promise<GastoSubagentes>;
  /** Con `sid` de un líder de Claude vivo, los tokens de cada skill son exactos. */
  catalogo(sid?: string): Promise<Catalogo>;
  apagados(): Promise<VistaApagados>;
  /** Qué cargaría un líder o worker nuevo, calculado sin lanzar nada. */
  previa(q: PedidoPrevia): Promise<VistaPrevia>;
  /** «Revisar con IA»: un modelo barato revisa lo que se carga en cada mensaje del proyecto (`""`: el home); devuelve la revisión al terminar. `modelo` vacío: el que elija Trama. */
  auditar(q: { proyecto: string; modelo?: string }): Promise<Auditoria>;
  /** La última revisión del proyecto, o `null`; mientras corre trae `estado: "corriendo"` y `avance`. */
  auditoria(proyecto: string): Promise<Auditoria | null>;
  /** Aplica hallazgos (el main guarda una copia antes de escribir). Devuelve la revisión con los estados nuevos. */
  aplicar(id: string, hallazgos: string[]): Promise<Auditoria>;
  /** Captura el prompt base de la versión instalada de `claude` (una vez por versión; `forzar`: otra vez). Sólo desde la PC. */
  capturarBase(forzar?: boolean): Promise<void>;
  fijar(tipo: TipoApagado, nombre: string, apagado: boolean): Promise<Fijado>;
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

let apagadosFijo: VistaApagados = structuredClone(APAGADOS_FALSOS);
// La base del prompt de las fixtures: la captura "contexto-panel-previa" la trae lista; con HILOS_VARIANTE=sin-base arranca faltando y se "captura" al pedirla.
let baseFija = !(MODO.captura === "contexto-panel-previa" && MODO.variante === "sin-base");

// «Revisar con IA» de las fixtures: la revisión por proyecto. La captura "contexto-auditoria" arranca con la de atlas ya hecha; en las demás se
// "revisa" al apretar el botón (1,4 s con una línea de avance) y devuelve la misma. Aplicar cambia el estado de los hallazgos y nada más.
const auditorias = new Map<string, Auditoria>();
const aplicadosFijos = new Set<string>(["h5"]);
const ATLAS = "/home/persona/proyectos/atlas";
if (MODO.captura === "contexto-auditoria") auditorias.set(ATLAS, auditoriaFalsa(ATLAS, [...aplicadosFijos]));

const fija: FuenteContexto = {
  async desglose(q) {
    await espera(40);
    const d = desgloseFalso(q);
    // Captura `contexto-panel` con HILOS_VARIANTE=lleno: el líder con la ventana casi llena (el anillo y la tarjeta en ámbar, con su palabra).
    if (MODO.captura === "contexto-panel" && MODO.variante === "lleno" && d.quien.tipo === "lider" && d.usado !== null) {
      const extra = 70_000;
      return { ...d, usado: d.usado + extra, categorias: d.categorias.map((c) => (c.id === "mensajes" && !c.diferido ? { ...c, tokens: c.tokens + extra } : c.id === "libre" ? { ...c, tokens: Math.max(0, c.tokens - extra) } : c)) };
    }
    return d;
  },
  async subagentes(sid) {
    await espera(40);
    return subagentesFalsos(sid);
  },
  async catalogo() {
    await espera(40);
    const c = catalogoFalso();
    // El estado sale del registro, como en el main.
    for (const s of c.skills) if (s.estado !== "plugin-apagado") s.estado = apagadosFijo.apagados.skills.includes(s.clave) ? "apagada" : "activa";
    return c;
  },
  async apagados() {
    await espera(20);
    return structuredClone(apagadosFijo);
  },
  async previa(q) {
    await espera(60);
    const v = previaFalsa(q);
    if (baseFija) return v;
    return previaFalsa(q, { estado: "falta", version: null, instalada: "2.1.314", capturadoEn: null });
  },
  async auditar(q) {
    auditorias.set(q.proyecto, { ...auditoriaFalsa(q.proyecto, []), id: `aud-${q.proyecto || "home"}`, estado: "corriendo", avance: "Leyendo CLAUDE.md…", hallazgos: [], archivos: [], respaldo: null });
    await espera(1400);
    aplicadosFijos.clear();
    const lista = { ...auditoriaFalsa(q.proyecto, []), id: `aud-${q.proyecto || "home"}`, modelo: q.modelo || "claude-haiku-5-5" };
    auditorias.set(q.proyecto, lista);
    return lista;
  },
  async auditoria(proyecto) {
    await espera(20);
    const a = auditorias.get(proyecto) ?? null;
    return a ? structuredClone(a) : null;
  },
  async aplicar(id, hallazgos) {
    await espera(120);
    const proyecto = [...auditorias].find(([, a]) => a.id === id)?.[0];
    if (proyecto === undefined) throw new Error("La revisión ya no existe: volvé a revisar.");
    for (const h of hallazgos) aplicadosFijos.add(h);
    const a = auditoriaFalsa(proyecto, [...aplicadosFijos]);
    auditorias.set(proyecto, { ...a, id });
    return structuredClone({ ...a, id });
  },
  async capturarBase() {
    await espera(900);
    baseFija = true;
  },
  async fijar(tipo, nombre, apagado) {
    await espera(60);
    const l = apagadosFijo.apagados[tipo];
    apagadosFijo = { ...apagadosFijo, apagados: { ...apagadosFijo.apagados, [tipo]: apagado ? [...new Set([...l, nombre])] : l.filter((n) => n !== nombre) } };
    return { ...structuredClone(apagadosFijo), lideres: { reiniciados: 0, pendientes: 0 }, aviso: "proximo-mensaje" };
  },
};

const fallar = (e: unknown): never => {
  throw new Error(mensaje(e));
};

const conMain = (m: NonNullable<typeof main>): FuenteContexto => ({
  async desglose(q) {
    return (await m.paneles.desgloseContexto(q).catch(fallar)) as Desglose;
  },
  async subagentes(sid) {
    return (await m.paneles.subagentesContexto({ lider: sid }).catch(fallar)) as GastoSubagentes;
  },
  async catalogo(sid) {
    return (await m.paneles.catalogoSkills(sid ? { sid } : {}).catch(fallar)) as Catalogo;
  },
  async apagados() {
    return (await m.paneles.leerApagados().catch(fallar)) as VistaApagados;
  },
  async previa(q) {
    return (await m.paneles.previaContexto(q).catch(fallar)) as VistaPrevia;
  },
  async auditar(q) {
    return (await m.paneles.auditarContexto(q.modelo ? q : { proyecto: q.proyecto }).catch(fallar)) as Auditoria;
  },
  async auditoria(proyecto) {
    return (await m.paneles.auditoriaContexto({ proyecto }).catch(fallar)) as Auditoria | null;
  },
  async aplicar(id, hallazgos) {
    return (await m.paneles.aplicarHallazgos({ id, hallazgos }).catch(fallar)) as Auditoria;
  },
  async capturarBase(forzar) {
    await m.paneles.capturarBaseContexto(forzar ? { forzar: true } : {}).catch(fallar);
  },
  async fijar(tipo, nombre, apagado) {
    return (await m.paneles.fijarApagado(tipo, nombre, apagado).catch(fallar)) as Fijado;
  },
});

export const fuenteContexto: FuenteContexto = MODO.fixtures || !main ? fija : conMain(main);
