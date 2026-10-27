// El nombre para mostrar de cada proyecto (`titulo` del registry, ver electron/proyectos-alias.ts) y las instrucciones que comparten
// los modelos (AGENTS.md, ver electron/unificar-md.ts): de `pa` y sus archivos por el main o, en bench y capturas, de los fixtures.
// Un solo almacén para todo lo que muestra un proyecto (barra, Tablero, Ramas, Estadísticas, selectores, Guía): al renombrar, todos se enteran.
import { useMemo, useSyncExternalStore } from "react";
import { MODO } from "../modo";
import { main, mensaje } from "../puente";
import { mapaNombres } from "../../electron/proyectos-nombre";
import type { ProyectoNombre } from "../../electron/proyectos-alias";
import type { Aplicado, EstadoMd, PlanMd } from "../../electron/unificar-md";
import { AGENTS_FALSO, ESTADOS_MD_FALSOS, PROYECTOS_FALSOS, planFalso } from "./fixtures-proyectos";

export type { Aplicado, EstadoMd, PlanMd, ProyectoNombre };
export type MedidaAgents = { caracteres: number; tope: number; truncado: boolean };

export interface FuenteProyectos {
  lista(): Promise<ProyectoNombre[]>;
  /** Pone el nombre para mostrar (`null`: lo saca). Rechaza con el motivo (clave de i18n del main). */
  renombrar(slug: string, nombre: string | null): Promise<ProyectoNombre>;
  mdEstado(slug: string): Promise<EstadoMd>;
  mdPlan(slug: string): Promise<PlanMd>;
  /** Escribe lo que dice el plan que se vio (`huella`); rechaza si los archivos cambiaron desde entonces. */
  mdAplicar(slug: string, huella: string): Promise<Aplicado>;
  leerAgents(slug: string): Promise<string>;
  guardarAgents(slug: string, texto: string): Promise<MedidaAgents>;
  mdFusionar(slug: string, tipo?: "acortar" | "fusionar"): Promise<{ rc: number; dijo: string }>;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Fixtures ----------------------------------------------------------------------------------------------------
let falsos: ProyectoNombre[] = PROYECTOS_FALSOS.map((p) => ({ ...p }));
let agentsFalso = AGENTS_FALSO;

const fija: FuenteProyectos = {
  async lista() {
    return falsos.map((p) => ({ ...p }));
  },
  async renombrar(slug, nombre) {
    await espera(150);
    const p = falsos.find((x) => x.slug === slug);
    if (!p) throw new Error(slug);
    p.titulo = nombre;
    return { ...p };
  },
  async mdEstado(slug) {
    return ESTADOS_MD_FALSOS[slug] ?? ESTADOS_MD_FALSOS.baliza;
  },
  async mdPlan(slug) {
    await espera(150);
    return planFalso(slug);
  },
  async mdAplicar(slug) {
    await espera(300);
    const e = ESTADOS_MD_FALSOS[slug];
    if (e) {
      e.archivos = e.archivos.map((f) => (f.archivo === "AGENTS.md" ? { ...f, tipo: "real" as const, caracteres: f.caracteres || e.caracteres } : f.tipo === "real" || f.tipo === "falta" && f.archivo === "CLAUDE.md" ? { ...f, tipo: "stub" as const } : f));
      e.unificado = true;
      e.porUnificar = false;
    }
    return { backup: `~/.local/state/pa/${slug}/md-backup/20261026-101500`, escritos: ["AGENTS.md", "CLAUDE.md"], plan: planFalso(slug) };
  },
  async leerAgents() {
    return agentsFalso;
  },
  async guardarAgents(_slug, texto) {
    await espera(200);
    if (MODO.falla === "agents") throw new Error("EACCES: permission denied");
    agentsFalso = texto;
    return { caracteres: texto.length, tope: 20000, truncado: texto.length > 20000 };
  },
  async mdFusionar(slug, tipo = "fusionar") {
    await espera(200);
    const e = ESTADOS_MD_FALSOS[slug];
    if (e) {
      e.tareaEnCurso = tipo;
    }
    return { rc: 0, dijo: `pa ${slug}: worker en camino` };
  },
};

// --- Con el main -------------------------------------------------------------------------------------------------
const rechazo = (e: unknown): never => {
  throw new Error(mensaje(e));
};

const conMain = (m: NonNullable<typeof main>): FuenteProyectos => ({
  async lista() {
    const r = await m.proyectosNombres.lista().catch(() => []);
    return Array.isArray(r) ? (r as ProyectoNombre[]) : [];
  },
  async renombrar(slug, nombre) {
    return (await m.proyectosNombres.renombrar(slug, nombre).catch(rechazo)) as ProyectoNombre;
  },
  async mdEstado(slug) {
    return (await m.paneles.mdEstado(slug).catch(rechazo)) as EstadoMd;
  },
  async mdPlan(slug) {
    return (await m.paneles.mdPlan(slug).catch(rechazo)) as PlanMd;
  },
  async mdAplicar(slug, huella) {
    return (await m.paneles.mdAplicar(slug, huella).catch(rechazo)) as Aplicado;
  },
  async leerAgents(slug) {
    return m.paneles.leerAgents(slug).catch(rechazo);
  },
  async guardarAgents(slug, texto) {
    return (await m.paneles.guardarAgents(slug, texto).catch(rechazo)) as MedidaAgents;
  },
  async mdFusionar(slug, tipo) {
    return (await m.paneles.mdFusionar(slug, tipo).catch(rechazo)) as { rc: number; dijo: string };
  },
});

const base: FuenteProyectos = MODO.fixtures || !main ? fija : conMain(main);

// --- El almacén ------------------------------------------------------------------------------------------------------
let lista: readonly ProyectoNombre[] = [];
let pedido = false;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

/** Vuelve a leer los proyectos (después de renombrar, o al abrir Ajustes). */
export async function recargarProyectos(): Promise<readonly ProyectoNombre[]> {
  const nueva = await base.lista().catch(() => lista);
  lista = nueva;
  pedido = true;
  avisar();
  return lista;
}

function suscribir(fn: () => void) {
  oyentes.add(fn);
  if (!pedido) {
    pedido = true;
    void recargarProyectos();
  }
  return () => void oyentes.delete(fn);
}

export const fuenteProyectos: FuenteProyectos = {
  ...base,
  async renombrar(slug, nombre) {
    const r = await base.renombrar(slug, nombre);
    await recargarProyectos();
    return r;
  },
};

export const useProyectos = (): readonly ProyectoNombre[] => useSyncExternalStore(suscribir, () => lista);

/** `(x) => nombre para mostrar`, al día con los renombres (x: el nombre del registry o el slug del proyecto). */
export function useNombreProyecto(): (x: string) => string {
  const l = useProyectos();
  return useMemo(() => {
    const mapa = mapaNombres(l);
    return (x: string) => mapa.get(x.toLowerCase()) ?? x;
  }, [l]);
}

/** slug → nombre para mostrar, sólo de los que tienen uno (lo que la barra llama `titulos`). */
export function useTitulosProyectos(): Readonly<Record<string, string>> {
  const l = useProyectos();
  return useMemo(() => Object.fromEntries(l.flatMap((p) => (p.titulo ? [[p.slug, p.titulo] as const] : []))), [l]);
}
