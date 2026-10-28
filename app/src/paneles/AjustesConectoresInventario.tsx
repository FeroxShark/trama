// Ajustes > Conectores, lo que tiene conectado Claude Code: skills, plugins, servidores MCP y hooks agrupados por tipo, cada uno con su
// nombre, de dónde viene, qué hace en una línea y si está prendido; se prende o apaga lo que Claude Code deja (plugins y servidores de
// `.mcp.json`). Buscador arriba y, antes, los catálogos de plugins para instalar más (AjustesPlugins.tsx). Todo se lee de los archivos de Claude Code (electron/conectores-claude.ts) y nunca trae un secreto.
// Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { fuentePaneles, type Conector, type Inventario } from "../datos/paneles";
import { t, textoMain, type ClaveSola } from "../i18n";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Boton, Interruptor } from "../ui/componentes";
import { Estado } from "./AjustesDsh";
import { CatalogosPlugins } from "./AjustesPlugins";
import { FilaAjuste, GrupoAjustes } from "./AjustesPiezas";
import { PanelCargando } from "./PanelCargando";
import { delTipo, deDonde, filtrar, TIPOS } from "./conectores-vista";

const TITULO: Record<Conector["tipo"], [ClaveSola, ClaveSola]> = {
  skill: ["conectores.tSkill", "conectores.tSkillSub"],
  plugin: ["conectores.tPlugin", "conectores.tPluginSub"],
  mcp: ["conectores.tMcp", "conectores.tMcpSub"],
  hook: ["conectores.tHook", "conectores.tHookSub"],
};
/** Cuántos se ven de entrada en cada grupo si no se busca nada. */
const VISIBLES = 8;

const origenTexto = (c: Conector) =>
  c.origen === "usuario" ? t("conectores.oUsuario") : c.origen === "proyecto" ? t("conectores.oProyecto", { n: deDonde(c) }) : c.origen === "plugin" ? t("conectores.oPlugin", { n: c.de }) : t("conectores.oClaudeai");

function estadoTexto(c: Conector): string {
  if (c.activo) return t("conectores.on");
  if (c.nota === "sigue-plugin") return t("conectores.offPlugin");
  if (c.nota === "sin-aprobar") return t("conectores.sinAprobar");
  if (c.nota === "no-instalado") return t("conectores.off") + " · " + t("conectores.noInstalado");
  return t("conectores.off");
}

function Fila({ c, ocupado, alCambiar }: { c: Conector; ocupado: boolean; alCambiar: (c: Conector, activo: boolean) => void }) {
  const ayuda = (
    <>
      <span className="cn-origen">{origenTexto(c)}{c.clase && c.tipo === "plugin" ? ` · v${c.clase}` : ""}{c.clase && c.tipo === "mcp" ? ` · ${c.clase}` : ""}</span>
      {c.descripcion ? <span className="cn-desc">{c.descripcion}</span> : null}
      {c.destino ? <code className="cn-destino">{c.destino}</code> : null}
      {c.variables?.length ? <span className="cn-desc">{t("conectores.vars", { v: c.variables.join(", ") })}</span> : null}
    </>
  );
  return (
    <FilaAjuste
      className="cn-fila"
      titulo={c.nombre}
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

function Grupo({ tipo, items, buscando, ocupado, alCambiar }: { tipo: Conector["tipo"]; items: Conector[]; buscando: boolean; ocupado: boolean; alCambiar: (c: Conector, activo: boolean) => void }) {
  const [todos, setTodos] = useState(false);
  const [tit, sub] = TITULO[tipo];
  const ver = buscando || todos ? items : items.slice(0, VISIBLES);
  return (
    <GrupoAjustes titulo={`${t(tit)} · ${items.length}`} subtitulo={t(sub)} className="cn-grupo">
      {ver.map((c) => (
        <Fila key={c.id} c={c} ocupado={ocupado} alCambiar={alCambiar} />
      ))}
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
        <span className="cn-cuenta" role="status">{t("conectores.cuenta", { n: visibles.length, total: inv.items.length })}</span>
        <Boton onClick={leer} disabled={ocupado} aria-label={t("conectores.actualizar")} title={t("conectores.actualizar")}>
          <RefreshCw size={14} strokeWidth={2} aria-hidden /> <span>{t("conectores.actualizar")}</span>
        </Boton>
      </div>
      {error ? <div className="pn-error dsh-err" role="alert">{textoMain(error)}</div> : null}
      {buscando && !visibles.length ? <p className="ol-nota">{t("conectores.sinResultados")}</p> : null}
      {TIPOS.map((tipo) => {
        const items = delTipo(visibles, tipo);
        if (!items.length && buscando) return null;
        return items.length ? (
          <Grupo key={tipo} tipo={tipo} items={items} buscando={buscando} ocupado={ocupado} alCambiar={(c, v) => void cambiar(c, v)} />
        ) : (
          <GrupoAjustes key={tipo} titulo={`${t(TITULO[tipo][0])} · 0`} subtitulo={t(TITULO[tipo][1])} className="cn-grupo">
            <p className="ol-nota cn-vacio">{t("conectores.sinNada")}</p>
          </GrupoAjustes>
        );
      })}
    </div>
  );
}
