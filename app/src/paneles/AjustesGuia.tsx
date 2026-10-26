// Ajustes > Guía: una guía práctica y corta, un tema por tarjeta (título, una línea y viñetas). Cada tarjeta lleva `data-opc` para que
// el buscador de Ajustes salte a ella. En "AGENTS.md" va la acción de crearlo (`pa <proy> --agents-md` + un líder que lo llena).
import { useEffect, useState } from "react";
import { Bot, ClipboardList, FileText, GitBranch, Gauge, GraduationCap, Layers, Palette, ScanSearch, type LucideIcon } from "lucide-react";
import { fuente } from "../datos/fuente";
import { fuentePaneles } from "../datos/paneles";
import { Selector, type Opcion } from "../hilo/Selector";
import { effortPara } from "../hilo/elegir";
import { effortsLeidos } from "../hilo/efforts";
import { MODELO_DEFAULT } from "../hilo/opciones";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { pasoLider } from "./PasoLanzar";
import { conTexto } from "./lanzar";
import { Cat } from "./AjustesNav";
import { promptAgentsMd } from "./orquestacion-logica";
import "./guia.css";

const TEMAS: { id: string; icono: LucideIcon; n: number }[] = [
  { id: "lider", icono: Bot, n: 3 },
  { id: "modelos", icono: Layers, n: 5 },
  { id: "tablero", icono: ClipboardList, n: 4 },
  { id: "ramas", icono: GitBranch, n: 4 },
  { id: "cupos", icono: Gauge, n: 4 },
  { id: "temas", icono: Palette, n: 3 },
  { id: "agents", icono: FileText, n: 3 },
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

/** "Crear AGENTS.md": elegir proyecto, leer la plantilla de `pa --agents-md` y lanzar un líder en esa carpeta que la llene. */
function CrearAgentsMd() {
  const [proyectos, setProyectos] = useState<Opcion[]>([]);
  const [elegido, setElegido] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuente.slugsPorNombre().then((m) => {
      if (!vivo) return;
      const ops = Object.entries(m).map(([nombre, slug]) => ({ id: slug, nombre, desc: "" }));
      const unicos = [...new Map(ops.map((o) => [o.id, o])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
      setProyectos(unicos);
      setElegido((e) => e || unicos[0]?.id || "");
    });
    return () => {
      vivo = false;
    };
  }, []);
  const crear = async () => {
    if (!elegido || leyendo) return;
    setLeyendo(true);
    setError(null);
    setAviso(null);
    try {
      const d = await fuentePaneles.agentsMd(elegido);
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
        <Selector etiqueta={t("ag.proyecto")} opciones={proyectos} valor={elegido} alElegir={setElegido} disabled={leyendo} />
      </div>
      <button type="button" className="btn2" data-agentsmd disabled={leyendo || !elegido} onClick={() => void crear()}>
        <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
        {leyendo ? t("ag.creando") : t("ag.crear")}
      </button>
      {aviso ? <p className="pn-nota" role="status">{aviso}</p> : null}
      {error ? <p className="pn-error" role="alert">{error}</p> : null}
    </div>
  );
}
