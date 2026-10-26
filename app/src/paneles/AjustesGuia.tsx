// Ajustes > Guía: una guía práctica y corta, un tema por tarjeta (título, una línea y viñetas). Cada tarjeta lleva `data-opc` para que
// el buscador de Ajustes salte a ella. En "AGENTS.md" va la acción: unificar el CLAUDE.md que ya hay en AGENTS.md, o crearlo (`pa <proy> --agents-md` + un líder que lo llena).
import { useEffect, useState } from "react";
import { Bot, ClipboardList, FileText, GitBranch, Gauge, GraduationCap, Layers, Merge, Palette, ScanSearch, type LucideIcon } from "lucide-react";
import { fuente } from "../datos/fuente";
import { fuentePaneles } from "../datos/paneles";
import { fuenteProyectos, recargarProyectos, useProyectos, type EstadoMd } from "../datos/proyectos";
import { Selector, type Opcion } from "../hilo/Selector";
import { effortPara } from "../hilo/elegir";
import { effortsLeidos } from "../hilo/efforts";
import { MODELO_DEFAULT } from "../hilo/opciones";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { pasoLider } from "./PasoLanzar";
import { conTexto } from "./lanzar";
import { Cat } from "./AjustesNav";
import { promptAgentsMd } from "./orquestacion-logica";
import { UnificarPanel } from "./ProyectosMd";
import "./guia.css";

const TEMAS: { id: string; icono: LucideIcon; n: number }[] = [
  { id: "lider", icono: Bot, n: 3 },
  { id: "modelos", icono: Layers, n: 5 },
  { id: "tablero", icono: ClipboardList, n: 4 },
  { id: "ramas", icono: GitBranch, n: 4 },
  { id: "cupos", icono: Gauge, n: 4 },
  { id: "temas", icono: Palette, n: 3 },
  { id: "agents", icono: FileText, n: 4 },
  { id: "auditoria", icono: ScanSearch, n: 4 },
  { id: "lecciones", icono: GraduationCap, n: 3 },
];

export function Guia() {
  useIdioma();
  return (
    <Cat id="guia">
      <section className="pn-sec gu">
        <p className="pn-nota">{t("gu.intro")}</p>
        {TEMAS.map(({ id, icono: I, n }) => (
          <article key={id} className="gu-tema" data-opc={`guia.${id}`}>
            <h3 className="gu-t">
              <I size={15} strokeWidth={1.8} aria-hidden="true" />
              {t(`guia.${id}` as ClaveSola)}
            </h3>
            <p className="gu-lead">{t(`guia.${id}Que` as ClaveSola)}</p>
            <ul className="gu-lista">
              {Array.from({ length: n }, (_, i) => (
                <li key={i}>{t(`guia.${id}.${i + 1}` as ClaveSola)}</li>
              ))}
            </ul>
            {id === "agents" ? <CrearAgentsMd /> : null}
          </article>
        ))}
      </section>
    </Cat>
  );
}

/**
 * La acción de la tarjeta AGENTS.md. Si el proyecto elegido ya tiene un CLAUDE.md con contenido, ofrece "Unificar" (pasa lo que hay a AGENTS.md,
 * con vista previa y confirmación: ProyectosMd.tsx); si no, "Crear AGENTS.md": elegir proyecto, leer la plantilla de `pa --agents-md` y lanzar
 * un líder en esa carpeta que la llene.
 */
function CrearAgentsMd() {
  const lista = useProyectos();
  const proyectos: Opcion[] = [...lista]
    .map((p) => ({ id: p.slug, nombre: p.titulo ?? p.nombre, desc: p.titulo ? p.nombre : "" }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const [elegido, setElegido] = useState(MODO.variante === "guia-unificar" ? "asistente-voz" : "");
  const [estado, setEstado] = useState<EstadoMd | null>(null);
  const [unificando, setUnificando] = useState(MODO.variante === "guia-unificar");
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void recargarProyectos();
  }, []);
  const id = elegido || proyectos[0]?.id || "";
  const actual = proyectos.find((p) => p.id === id);
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    setEstado(null);
    fuenteProyectos.mdEstado(id).then(
      (e) => vivo && setEstado(e),
      () => vivo && setEstado(null),
    );
    return () => {
      vivo = false;
    };
  }, [id]);
  // Con CLAUDE.md propio (y algo que pasar a AGENTS.md) se ofrece unificar; crear de cero queda como segunda opción.
  const hayClaude = !!estado && estado.porUnificar && estado.archivos.some((f) => f.archivo !== "AGENTS.md" && f.tipo === "real");
  const [crearIgual, setCrearIgual] = useState(false);
  useEffect(() => {
    setCrearIgual(false);
    if (MODO.variante !== "guia-unificar") setUnificando(false);
  }, [id]);
  const crear = async () => {
    if (!id || leyendo) return;
    setLeyendo(true);
    setError(null);
    setAviso(null);
    try {
      const d = await fuentePaneles.agentsMd(id);
      if (d.existe || !d.plantilla) return setAviso(t("ag.existe", { p: d.proyecto }));
      pasoLider("agentsmd", async (e) => {
        await fuente.liderNuevo({ texto: conTexto(promptAgentsMd(d.proyecto, d.ruta, d.plantilla as string), e.texto), modelo: e.modelo, effort: e.effort, ...(d.ruta ? { carpeta: d.ruta } : {}) });
        setAviso(t("ag.lanzado", { p: d.proyecto }));
      }, { modelo: MODELO_DEFAULT, effort: effortPara(MODELO_DEFAULT, effortsLeidos() ?? {}) });
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setLeyendo(false);
    }
  };
  if (!proyectos.length) return <p className="pn-nota">{t("ag.sinProyectos")}</p>;
  return (
    <div className="gu-accion">
      <div className="pn-abajo gu-sel">
        <Selector etiqueta={t("ag.proyecto")} opciones={proyectos} valor={id} alElegir={setElegido} disabled={leyendo} />
      </div>
      {hayClaude && !crearIgual ? (
        <>
          <p className="pn-nota">{t("ag.unificarQue", { p: actual?.nombre ?? id })}</p>
          <button type="button" className="btn2" data-primario data-unificar-guia aria-expanded={unificando} onClick={() => setUnificando(!unificando)}>
            <Merge size={13} strokeWidth={1.8} aria-hidden="true" />
            {t("ag.unificar")}
          </button>
          <button type="button" className="btn2" data-crear-igual onClick={() => setCrearIgual(true)}>
            {t("ag.unificarOtro")}
          </button>
          {unificando ? (
            <div className="gu-um">
              <UnificarPanel
                slug={id}
                nombre={actual?.nombre ?? id}
                alCerrar={() => setUnificando(false)}
                alHecho={() => fuenteProyectos.mdEstado(id).then(setEstado, () => {})}
              />
            </div>
          ) : null}
        </>
      ) : (
        <button type="button" className="btn2" data-agentsmd disabled={leyendo || !id} onClick={() => void crear()}>
          <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
          {leyendo ? t("ag.creando") : t("ag.crear")}
        </button>
      )}
      {aviso ? <p className="pn-nota" role="status">{aviso}</p> : null}
      {error ? <p className="pn-error" role="alert">{error}</p> : null}
    </div>
  );
}
