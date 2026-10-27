// Las instrucciones de un proyecto para todos los modelos (AGENTS.md como fuente única): el estado de los tres archivos, la vista previa de
// "Unificar" con su confirmación y un editor simple de AGENTS.md (el mismo patrón que el de lecciones, Lecciones.tsx). Se usa en
// Ajustes > Proyectos y en la tarjeta AGENTS.md de la Guía.
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Merge, PencilLine, X } from "lucide-react";
import { fuenteProyectos, type EstadoMd, type PlanMd } from "../datos/proyectos";
import { locale, t, textoMain, type Clave } from "../i18n";
import { mensaje } from "../puente";
import { lineasDeCambio } from "./unificar-vista";
import "./lecciones-panel.css";
import "./proyectos.css";

const tv = t as (k: Clave, v: Record<string, string | number>) => string;
const num = (n: number) => n.toLocaleString(locale());

/** Una línea por archivo: existe o no, cuánto pesa, si es un stub. Dice el estado con palabras (nunca sólo con color). */

export function EstadoLecturaMotores({ estado }: { estado: EstadoMd }) {
  const fAgents = estado.archivos.find((f) => f.archivo === "AGENTS.md");
  const fClaude = estado.archivos.find((f) => f.archivo === "CLAUDE.md");

  let claudeTexto: string;
  let claudeOk = false;
  let claudeFalta = false;

  if (fClaude?.tipo === "stub") {
    if (fAgents?.tipo === "real") {
      claudeTexto = tv("pry.md.claudeLee", { f: "AGENTS.md" });
      claudeOk = true;
    } else {
      claudeTexto = t("pry.md.claudeSin");
      claudeFalta = true;
    }
  } else if (fClaude?.tipo === "real") {
    claudeTexto = tv("pry.md.claudeLee", { f: "CLAUDE.md" });
    claudeOk = true;
  } else if (fAgents?.tipo === "real") {
    claudeTexto = t("pry.md.claudeFalta");
    claudeFalta = true;
  } else {
    claudeTexto = t("pry.md.claudeSin");
    claudeFalta = true;
  }

  let otrosTexto: string;
  let otrosOk = false;
  let otrosAviso = false;
  let otrosFalta = false;

  if (fAgents?.tipo === "real") {
    if (estado.truncado) {
      otrosTexto = t("pry.md.otrosParte");
      otrosAviso = true;
    } else {
      otrosTexto = tv("pry.md.otrosReciben", { f: "AGENTS.md" });
      otrosOk = true;
    }
  } else if (fClaude?.tipo === "real") {
    if (estado.truncado) {
      otrosTexto = t("pry.md.otrosParte");
      otrosAviso = true;
    } else {
      otrosTexto = tv("pry.md.otrosReciben", { f: "CLAUDE.md" });
      otrosOk = true;
    }
  } else {
    otrosTexto = t("pry.md.otrosSin");
    otrosFalta = true;
  }

  return (
    <div className="pry-md-motores" data-estado-motores>
      <div className="pry-md-motor" data-motor="claude" data-ok={claudeOk ? "true" : undefined} data-falta={claudeFalta ? "true" : undefined}>
        {claudeOk ? <Check size={12} strokeWidth={2} aria-hidden="true"></Check> : <AlertTriangle size={12} strokeWidth={2} aria-hidden="true"></AlertTriangle>}
        <span>{claudeTexto}</span>
      </div>
      <div className="pry-md-motor" data-motor="otros" data-ok={otrosOk ? "true" : undefined} data-aviso={otrosAviso ? "true" : undefined} data-falta={otrosFalta ? "true" : undefined}>
        {otrosOk ? <Check size={12} strokeWidth={2} aria-hidden="true"></Check> : <AlertTriangle size={12} strokeWidth={2} aria-hidden="true"></AlertTriangle>}
        <span>{otrosTexto}</span>
      </div>
    </div>
  );
}

export function ArchivosMd({ estado }: { estado: EstadoMd }) {
  const dice = (f: EstadoMd["archivos"][number]): string => {
    if (f.tipo === "real") return tv("pry.md.real", { n: num(f.caracteres) });
    return t(`pry.md.${f.tipo}` as "pry.md.falta");
  };
  return (
    <ul className="pry-md-ar">
      {estado.archivos.map((f) => (
        <li key={f.archivo} data-archivo={f.archivo} data-tipo={f.tipo}>
          <span className="pry-md-f">{f.archivo}</span>
          <span className="pry-md-e">{f.tipo === "stub" ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : null}{dice(f)}</span>
        </li>
      ))}
    </ul>
  );
}

/** El aviso de que AGENTS.md pasa el tope de los modelos que no son Claude. */
export function AvisoLargo({ caracteres, tope }: { caracteres: number; tope: number }) {
  return (
    <p className="pry-largo" role="status" data-largo>
      <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
      {tv("pry.md.larga", { n: num(caracteres), tope: num(tope) })}
    </p>
  );
}

/** Dónde queda la copia de lo que cambia (la carpeta de estado de `pa`; el main escribe la ruta real al aplicar). */
const DONDE_BACKUP = "~/.local/state/pa/<slug>/md-backup/";

/** El texto de cada acción del plan, en el idioma de ahora. */
export function textoAccion(a: PlanMd["acciones"][number]): string {
  switch (a.que) {
    case "crea":
      return t(`pry.um.crea.${a.de === "ambos" || a.de === "iguales" ? a.de : (a.de ?? "CLAUDE.md")}` as "pry.um.crea.ambos");
    case "anexa":
      return t(`pry.um.anexa.${a.de ?? "CLAUDE.md"}` as "pry.um.anexa.CLAUDE.md");
    default:
      return tv(`pry.um.${a.que}` as Clave, { f: a.archivo });
  }
}

/** La vista previa de lo que cambia en un archivo: las líneas que salen (−) y entran (+), con una de contexto. */
function Cambio({ archivo, antes, despues }: { archivo: string; antes: string | null; despues: string }) {
  const { lineas, quita, pone } = lineasDeCambio(antes, despues);
  return (
    <div className="pry-um-arch" data-archivo={archivo}>
      <div className="pry-um-cab">
        <b>{archivo}</b>
        <span>{antes === null ? t("pry.um.nuevo") : `−${quita} +${pone}`}</span>
        <span>{tv("pry.um.lineas", { n: num(despues.replace(/\n$/, "").split("\n").length) })}</span>
      </div>
      <pre className="pry-um-pre" tabIndex={0} aria-label={`${t("pry.um.cambios")}: ${archivo}`}>
        {lineas.map((l, i) =>
          l.signo === "…" ? (
            <span key={i} className="pry-l" data-s="…">
              {tv("pry.um.masLineas", { n: num(l.n) })}
            </span>
          ) : (
            <span key={i} className="pry-l" data-s={l.signo}>
              <b aria-hidden="true">{l.signo}</b>
              <span>{l.texto || " "}</span>
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

/**
 * "Unificar en AGENTS.md": lee el plan (sin escribir nada), muestra qué cambia y espera la confirmación. Al confirmar manda la huella del
 * plan que se vio: si los archivos cambiaron en el medio, el main no escribe y se vuelve a leer el plan.
 */
export function UnificarPanel({ slug, nombre, alCerrar, alHecho }: { slug: string; nombre: string; alCerrar: () => void; alHecho?: () => void }) {
  const [plan, setPlan] = useState<PlanMd | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const leer = () => {
    setPlan(null);
    setError(null);
    fuenteProyectos.mdPlan(slug).then(setPlan, (e) => setError(mensaje(e)));
  };
  useEffect(leer, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = async () => {
    if (!plan || aplicando) return;
    setAplicando(true);
    setError(null);
    try {
      const r = await fuenteProyectos.mdAplicar(slug, plan.huella);
      setHecho(r.backup ?? "");
      alHecho?.();
    } catch (e) {
      setError(mensaje(e));
      // Cambiaron los archivos desde que se leyó el plan: se muestra el nuevo para que se vuelva a confirmar.
      fuenteProyectos.mdPlan(slug).then(setPlan, () => {});
    } finally {
      setAplicando(false);
    }
  };

  const archivos = plan ? (["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const).filter((a) => plan.despues[a] !== undefined) : [];
  return (
    <div className="pry-um" role="group" aria-label={tv("pry.um.titulo", { p: nombre })} data-um>
      <div className="pry-um-t">
        <Merge size={14} strokeWidth={1.8} aria-hidden="true" />
        {tv("pry.um.titulo", { p: nombre })}
      </div>
      {!plan && !error ? <p className="pn-nota">{t("pry.um.leyendo")}</p> : null}
      {plan && plan.nada ? <p className="pn-nota" role="status">{t(`pry.um.nada.${plan.nada}` as "pry.um.nada.unificado")}</p> : null}
      {plan && !plan.nada && !hecho ? (
        <>
          <ul className="pry-um-acc">
            {plan.acciones.map((a, i) => (
              <li key={i}>{textoAccion(a)}</li>
            ))}
            {plan.avisos.map((a) => (
              <li key={a.archivo} className="pry-um-av">
                <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" /> {tv(`pry.um.aviso.${a.motivo}` as Clave, { f: a.archivo })}
              </li>
            ))}
          </ul>
          {plan.truncado ? <AvisoLargo caracteres={plan.caracteres} tope={plan.tope} /> : null}
          {archivos.map((a) => (
            <Cambio key={a} archivo={a} antes={plan.antes[a] ?? null} despues={plan.despues[a] as string} />
          ))}
          <p className="pn-nota">{tv("pry.um.backup", { donde: DONDE_BACKUP })}</p>
          <p className="pn-nota">{t("pry.um.commit")}</p>
        </>
      ) : null}
      {hecho !== null ? (
        <p className="pn-nota pry-ok" role="status">
          <Check size={13} strokeWidth={2} aria-hidden="true" /> {tv("pry.um.hecho", { backup: hecho || DONDE_BACKUP })}
        </p>
      ) : null}
      {error ? <p className="pn-error" role="alert">{textoMain(error)}</p> : null}
      <div className="pry-acc">
        {plan && !plan.nada && hecho === null ? (
          <button type="button" className="mini pn-primario" data-confirmar disabled={aplicando} onClick={() => void aplicar()}>
            <Merge size={13} strokeWidth={1.8} aria-hidden="true" />
            {aplicando ? t("pry.um.aplicando") : t("pry.um.confirmar")}
          </button>
        ) : null}
        <button type="button" className="mini" data-cerrar onClick={alCerrar}>
          <X size={13} strokeWidth={1.8} aria-hidden="true" />
          {hecho !== null || plan?.nada ? t("pry.um.cerrar") : t("pry.cancelar")}
        </button>
      </div>
    </div>
  );
}

/** Un editor simple de AGENTS.md: un texto, la cuenta contra el tope de los modelos que no son Claude y Guardar. */
export function EditorAgents({ slug, nombre, alCerrar, alGuardar }: { slug: string; nombre: string; alCerrar: () => void; alGuardar?: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [tope, setTope] = useState(20000);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let vivo = true;
    fuenteProyectos.leerAgents(slug).then(
      (x) => vivo && setTexto(x),
      (e) => vivo && setError(mensaje(e)),
    );
    fuenteProyectos.mdEstado(slug).then((e) => vivo && setTope(e.tope), () => {});
    return () => {
      vivo = false;
    };
  }, [slug]);
  const n = [...(texto ?? "")].length;
  const largo = n > tope;
  const guardar = async () => {
    if (texto === null || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await fuenteProyectos.guardarAgents(slug, texto);
      setOk(true);
      alGuardar?.();
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="lc-ed pry-ed" data-editor-agents>
      <div className="lc-ed-t">{tv("pry.ed.titulo", { p: nombre })}</div>
      <textarea
        className="lz-texto lc-area"
        value={texto ?? ""}
        rows={12}
        spellCheck={false}
        disabled={texto === null || guardando}
        placeholder={texto === null && !error ? t("pry.ed.cargando") : ""}
        aria-label={tv("pry.ed.titulo", { p: nombre })}
        onChange={(e) => {
          setTexto(e.target.value);
          setOk(false);
        }}
      />
      <div className="lc-pie">
        <span className="lc-cuenta" data-pasa={largo ? "" : undefined}>
          {largo ? <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" /> : <Check size={12} strokeWidth={2} aria-hidden="true" />}
          {largo ? tv("pry.ed.tope", { n: num(n), tope: num(tope) }) : tv("pry.ed.cuenta", { n: num(n) })}
        </span>
        <button type="button" className="mini pn-primario" data-guardar disabled={texto === null || guardando} onClick={() => void guardar()}>
          <PencilLine size={13} strokeWidth={1.8} aria-hidden="true" />
          {guardando ? t("pry.ed.guardando") : t("pry.ed.guardar")}
        </button>
        <button type="button" className="mini" data-cerrar onClick={alCerrar}>
          <X size={13} strokeWidth={1.8} aria-hidden="true" />
          {t("pry.md.cerrarBtn")}
        </button>
      </div>
      <p className="pn-nota">{t("pry.ed.backup")}</p>
      {ok ? (
        <p className="pn-nota pry-ok" role="status">
          <Check size={13} strokeWidth={2} aria-hidden="true" /> {t("pry.ed.guardado")}
        </p>
      ) : null}
      {error ? <p className="pn-error" role="alert">{textoMain(error)}</p> : null}
    </div>
  );
}

