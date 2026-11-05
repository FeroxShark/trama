// Ajustes > Conectores, lo que tiene conectado Claude Code: skills, plugins, servidores MCP y hooks agrupados por tipo, cada uno con su
// nombre, de dónde viene, qué hace en una línea y si está prendido; se prende o apaga lo que Claude Code deja (plugins y servidores de
// `.mcp.json`). Buscador arriba y, antes, los catálogos de plugins para instalar más (AjustesPlugins.tsx). Todo se lee de los archivos de Claude Code (electron/conectores-claude.ts) y nunca trae un secreto.
// Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCw, Search } from "lucide-react";
import { claveSkill as claveDe, usosDeHistorial, DIAS_USOS } from "../../electron/usos-historial";
import { fuentePaneles, type Conector, type Historial, type Inventario } from "../datos/paneles";
import { t, textoMain, type ClaveSola } from "../i18n";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Boton, Interruptor } from "../ui/componentes";
import { Estado } from "./AjustesDsh";
import { CatalogosPlugins } from "./AjustesPlugins";
import { FilaAjuste, GrupoAjustes } from "./AjustesPiezas";
import { PanelCargando } from "./PanelCargando";
import { delTipo, deDonde, enBloques, esDeTrama, filtrar, haceDias, nombreHook, ordenarPorUso, ORDENES, SIN_DATO, TIPOS, usosPorConector, type Orden, type UsoConector } from "./conectores-vista";

const TITULO: Record<Conector["tipo"], [ClaveSola, ClaveSola]> = {
  skill: ["conectores.tSkill", "conectores.tSkillSub"],
  plugin: ["conectores.tPlugin", "conectores.tPluginSub"],
  mcp: ["conectores.tMcp", "conectores.tMcpSub"],
  hook: ["conectores.tHook", "conectores.tHookSub"],
};
/** Cuántos se ven de entrada en cada grupo si no se busca nada. */
const VISIBLES = 8;

/** Desde cuántas filas un grupo se dibuja por bloques (sólo se monta lo que está cerca de la pantalla). */
const VIRTUAL_DESDE = 200;
/** Filas por bloque virtual. */
const BLOQUE = 25;

const ORDEN_TEXTO: Record<Orden, ClaveSola> = {
  origen: "conectores.ordenOrigen",
  mas: "conectores.ordenMas",
  menos: "conectores.ordenMenos",
  ultimo: "conectores.ordenUltimo",
};

const origenTexto = (c: Conector) =>
  esDeTrama(c) ? t("conectores.oTrama") : c.origen === "usuario" ? t("conectores.oUsuario") : c.origen === "proyecto" ? t("conectores.oProyecto", { n: deDonde(c) }) : c.origen === "plugin" ? t("conectores.oPlugin", { n: c.de }) : t("conectores.oClaudeai");

function estadoTexto(c: Conector): string {
  if (c.activo) return t("conectores.on");
  if (c.nota === "sigue-plugin") return t("conectores.offPlugin");
  if (c.nota === "sin-aprobar") return t("conectores.sinAprobar");
  if (c.nota === "no-instalado") return t("conectores.off") + " · " + t("conectores.noInstalado");
  return t("conectores.off");
}

/** Cuándo fue, dicho con palabras: hoy, ayer o hace N días (contra el último día del registro). */
const cuando = (dia: string, hoy: string) => {
  const n = haceDias(dia, hoy);
  return n === 0 ? t("conectores.hoy") : n === 1 ? t("conectores.ayer") : t("conectores.haceDias", { n });
};

/** El renglón de uso: tres estados que nunca se confunden (usado, sin uso en 30 días, sin dato). */
function textoUso(u: UsoConector, hoy: string | null): string {
  if (u.veces === null) return t("conectores.usoSinDato");
  if (u.veces === 0) return t("conectores.usoCero", { dias: DIAS_USOS });
  const base = t("conectores.usoVeces", { n: u.veces, dias: DIAS_USOS });
  return u.ultimo && hoy ? `${base} · ${t("conectores.usoUltimo", { cuando: cuando(u.ultimo, hoy) })}` : base;
}

function Fila({ c, ocupado, uso, hoy, alCambiar }: { c: Conector; ocupado: boolean; uso: UsoConector | null; hoy: string | null; alCambiar: (c: Conector, activo: boolean) => void }) {
  const esHook = c.tipo === "hook";
  const ayuda = (
    <>
      <span className="cn-origen">
        {esHook ? `${c.nombre} · ` : ""}
        {origenTexto(c)}
        {c.clase && c.tipo === "plugin" ? ` · v${c.clase}` : ""}
        {c.clase && c.tipo === "mcp" ? ` · ${c.clase}` : ""}
      </span>
      {uso ? <span className="cn-uso" data-uso={uso.veces === null ? "sin-dato" : uso.veces === 0 ? "cero" : "usado"}>{textoUso(uso, hoy)}</span> : null}
      {c.descripcion ? <span className="cn-desc">{c.descripcion}</span> : null}
      {c.destino ? <code className="cn-destino">{c.destino}</code> : null}
      {c.variables?.length ? <span className="cn-desc">{t("conectores.vars", { v: c.variables.join(", ") })}</span> : null}
    </>
  );
  return (
    <FilaAjuste
      className="cn-fila"
      titulo={esHook ? nombreHook(c) : c.nombre}
      ayuda={ayuda}
      control={
        <span className="cn-ctrl">
          <Estado ok={c.activo} texto={estadoTexto(c)} />
          {c.conmutable ? <Interruptor activo={c.activo} disabled={ocupado} aria-label={t(c.activo ? "conectores.apagar" : "conectores.prender", { n: c.nombre })} alCambiar={(v) => alCambiar(c, v)} /> : null}
        </span>
      }
    />
  );
}

/**
 * Un bloque de filas que, fuera de la pantalla, deja de dibujar sus filas y guarda su alto: una lista de cientos (307 skills) no pesa más que
 * lo que se ve. Con IntersectionObserver (margen de una pantalla); sin él (pruebas) se dibuja todo.
 */
function BloqueVirtual({ primero, hijos }: { primero: boolean; hijos: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);
  const alto = useRef(0);
  const [cerca, setCerca] = useState(primero);
  useEffect(() => {
    const el = raiz.current;
    if (!el || typeof IntersectionObserver === "undefined") return setCerca(true);
    const o = new IntersectionObserver((es) => es.forEach((e) => setCerca(e.isIntersecting)), { rootMargin: "900px 0px" });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  // El alto real mientras está dibujado: es el que ocupa su lugar cuando se descarga.
  useLayoutEffect(() => {
    if (cerca && raiz.current) alto.current = raiz.current.offsetHeight;
  });
  return (
    <div ref={raiz} className="cn-bloque" data-bloque={cerca ? "montado" : "vacio"} style={cerca ? undefined : { height: alto.current || BLOQUE * 72 }}>
      {cerca ? hijos : null}
    </div>
  );
}

function Grupo({ tipo, items, buscando, ocupado, orden, uso, hoy, alCambiar }: { tipo: Conector["tipo"]; items: Conector[]; buscando: boolean; ocupado: boolean; orden: Orden; uso: Map<string, UsoConector> | null; hoy: string | null; alCambiar: (c: Conector, activo: boolean) => void }) {
  const [todos, setTodos] = useState(false);
  const [tit, sub] = TITULO[tipo];
  // Ordenado por uso se ve el principio de la lista (lo que se busca), no el orden de origen.
  const ver = buscando || todos ? items : items.slice(0, VISIBLES);
  const fila = (c: Conector) => <Fila key={c.id} c={c} ocupado={ocupado} uso={uso ? (uso.get(c.id) ?? SIN_DATO) : null} hoy={hoy} alCambiar={alCambiar} />;
  const virtual = ver.length > VIRTUAL_DESDE;
  return (
    <GrupoAjustes titulo={`${t(tit)} · ${items.length}`} subtitulo={t(sub)} className="cn-grupo">
      {virtual ? enBloques(ver, BLOQUE).map((b, i) => <BloqueVirtual key={`${orden}:${i}:${b[0].id}`} primero={i < 2} hijos={b.map(fila)} />) : ver.map(fila)}
      {!buscando && items.length > VISIBLES ? (
        <div className="cn-mas">
          <Boton onClick={() => setTodos((v) => !v)} aria-expanded={todos}>
            {todos ? t("conectores.verMenos") : t("conectores.verTodos", { n: items.length })}
          </Boton>
        </div>
      ) : null}
    </GrupoAjustes>
  );
}

export function InventarioConectores() {
  const [inv, setInv] = useState<Inventario | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState<Orden>(MODO.variante === "mcp-uso" ? "mas" : "origen");
  /** Lo que dice el registro histórico: `undefined` mientras llega, y después el resultado (o el error). */
  const [historial, setHistorial] = useState<Historial | undefined>(undefined);
  const vivo = useRef(true);
  const raiz = useRef<HTMLDivElement>(null);

  const leer = () => {
    setFalla(null);
    setOcupado(true);
    void fuentePaneles.inventarioConectores().then(
      (r) => vivo.current && (setInv(r), setOcupado(false)),
      (x) => vivo.current && (setFalla(mensaje(x)), setOcupado(false)),
    );
  };
  useEffect(() => {
    vivo.current = true;
    leer();
    return () => void (vivo.current = false);
  }, []);

  // El uso de los últimos 30 días llega aparte: la lista se ve de entrada y el uso se suma cuando el registro contesta.
  useEffect(() => {
    void fuentePaneles.historial(DIAS_USOS).then(
      (h) => vivo.current && setHistorial(h),
      () => vivo.current && setHistorial({ version: 1, error: "no se pudo leer" }),
    );
  }, []);

  // Captura `ajustes` con HILOS_VARIANTE=mcp: la sección a la vista una vez cargada.
  useEffect(() => {
    if (inv && MODO.variante?.startsWith("mcp")) raiz.current?.scrollIntoView({ block: "start" });
  }, [inv]);

  const cambiar = async (c: Conector, activo: boolean) => {
    setOcupado(true);
    setError(null);
    try {
      const r = await fuentePaneles.alternarConector(c.id, activo);
      if (vivo.current) setInv(r);
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };

  const usos = useMemo(() => {
    if (!inv || !historial) return null;
    const skills = inv.items.filter((c) => c.tipo === "skill").map((c) => ({ clave: claveDe(c), nombre: c.nombre, origen: c.origen, de: c.de }));
    return usosDeHistorial(historial, skills);
  }, [inv, historial]);
  const uso = useMemo(() => (inv && historial !== undefined ? usosPorConector(inv.items, usos) : null), [inv, historial, usos]);
  // "Hoy" es el último día del registro (el main lo calcula con su reloj): sin fecha suelta en la interfaz.
  const hoy = historial && "hasta" in historial ? historial.hasta : null;

  if (falla) return <div className="pn-aviso" data-error>{textoMain(falla)}</div>;
  if (!inv) return <PanelCargando />;

  const visibles = filtrar(inv.items, busca);
  const buscando = busca.trim() !== "";
  return (
    <div className="cn-inv" data-conectores-claude ref={raiz}>
      <p className="pn-nota pn-intro">{t("conectores.invIntro")}</p>
      <CatalogosPlugins alCambiar={leer} />
      <div className="cn-barra">
        <label className="cn-buscar">
          <Search size={14} strokeWidth={2} aria-hidden />
          <input className="pn-campo" type="search" value={busca} spellCheck={false} autoComplete="off" placeholder={t("conectores.buscar")} aria-label={t("conectores.buscar")} onChange={(ev) => setBusca(ev.target.value)} />
        </label>
        <label className="cn-orden" data-guia="conectores-orden">
          <span>{t("conectores.ordenar")}</span>
          <select className="pn-campo" value={orden} onChange={(ev) => setOrden(ev.target.value as Orden)}>
            {ORDENES.map((o) => (
              <option key={o} value={o}>{t(ORDEN_TEXTO[o])}</option>
            ))}
          </select>
        </label>
        <span className="cn-cuenta" role="status">{t("conectores.cuenta", { n: visibles.length, total: inv.items.length })}</span>
        <Boton onClick={leer} disabled={ocupado} aria-label={t("conectores.actualizar")} title={t("conectores.actualizar")}>
          <RefreshCw size={14} strokeWidth={2} aria-hidden /> <span>{t("conectores.actualizar")}</span>
        </Boton>
      </div>
      {error ? <div className="pn-error dsh-err" role="alert">{textoMain(error)}</div> : null}
      {orden !== "origen" ? (
        <p className="ol-nota cn-nota-uso" role="status">
          {historial === undefined ? t("conectores.usoCargando") : usos ? t("conectores.usoNota", { dias: DIAS_USOS, n: usos.sesiones }) : t("conectores.usoNoHay")}
        </p>
      ) : null}
      {buscando && !visibles.length ? <p className="ol-nota">{t("conectores.sinResultados")}</p> : null}
      {TIPOS.map((tipo) => {
        const items = ordenarPorUso(delTipo(visibles, tipo), orden, uso ?? new Map());
        if (!items.length && buscando) return null;
        return items.length ? (
          <Grupo key={tipo} tipo={tipo} items={items} buscando={buscando} ocupado={ocupado} orden={orden} uso={uso} hoy={hoy} alCambiar={(c, v) => void cambiar(c, v)} />
        ) : (
          <GrupoAjustes key={tipo} titulo={`${t(TITULO[tipo][0])} · 0`} subtitulo={t(TITULO[tipo][1])} className="cn-grupo">
            <p className="ol-nota cn-vacio">{t("conectores.sinNada")}</p>
          </GrupoAjustes>
        );
      })}
    </div>
  );
}
