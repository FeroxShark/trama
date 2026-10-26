// Ajustes > Proyectos: (1) cómo se llama cada proyecto en la app y en `pa` (el `titulo` del registry; sólo cambia el nombre que se ve: slug, carpeta,
// ramas y estado quedan) y (2) las instrucciones de cada proyecto para todos los modelos: qué archivos hay (AGENTS.md / CLAUDE.md / GEMINI.md),
// "Unificar en AGENTS.md" (vista previa y confirmación) y un editor de AGENTS.md. Los datos: src/datos/proyectos.ts.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Check, FileText, Merge, PencilLine, RotateCcw, X } from "lucide-react";
import { NOMBRE_MAX, validarNombre } from "../../electron/proyectos-nombre";
import { fuenteProyectos, recargarProyectos, useProyectos, type EstadoMd, type ProyectoNombre } from "../datos/proyectos";
import { t, textoMain, type Clave } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Cat } from "./AjustesNav";
import { ArchivosMd, AvisoLargo, EditorAgents, UnificarPanel } from "./ProyectosMd";
import "./proyectos.css";

const tv = t as (k: Clave, v: Record<string, string | number>) => string;

/** La captura `proyectos-renombrar` abre el editor del primero con un nombre que no vale; `-unificar` y `-editor` abren esos paneles. */
const CAPTURA = MODO.variante?.startsWith("proyectos-") ? MODO.variante : null;

export function Proyectos() {
  useIdioma();
  const lista = useProyectos();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    recargarProyectos().then(
      () => vivo && setCargando(false),
      (e) => vivo && (setError(mensaje(e)), setCargando(false)),
    );
    return () => {
      vivo = false;
    };
  }, []);
  return (
    <Cat id="proyectos">
      <section className="pn-sec" data-opc="pry.nombres">
        <h2 className="pn-h">{t("pry.nombres")}</h2>
        <p className="pn-nota">{t("pry.intro")}</p>
        {error ? <p className="pn-error" role="alert">{tv("pry.error", { e: textoMain(error) })}</p> : null}
        {cargando && !lista.length ? <p className="pn-nota">{t("pry.cargando")}</p> : null}
        {!cargando && !lista.length && !error ? <p className="pn-nota">{t("pry.sinProyectos")}</p> : null}
        <div className="pry">
          {lista.map((p, i) => (
            <FilaNombre key={p.slug} p={p} todos={lista} abierto={CAPTURA === "proyectos-renombrar" && i === 0} />
          ))}
        </div>
      </section>
      <section className="pn-sec" data-opc="pry.instrucciones">
        <h2 className="pn-h">{t("pry.instrucciones")}</h2>
        <p className="pn-nota">{t("pry.instruccionesQue")}</p>
        <div className="pry">
          {lista.map((p) => (
            <FilaInstrucciones key={p.slug} p={p} abrir={CAPTURA === "proyectos-unificar" && p.slug === "asistente-voz" ? "unificar" : CAPTURA === "proyectos-editor" && p.slug === "atlas" ? "editor" : null} />
          ))}
        </div>
      </section>
    </Cat>
  );
}

const visible = (p: ProyectoNombre) => p.titulo ?? p.nombre;

/** Un proyecto: su nombre para mostrar, la carpeta y Renombrar (en la misma fila: un campo, la cuenta, el motivo si no vale). */
function FilaNombre({ p, todos, abierto }: { p: ProyectoNombre; todos: readonly ProyectoNombre[]; abierto: boolean }) {
  const [editando, setEditando] = useState(abierto);
  const [valor, setValor] = useState(abierto ? "trama" : (p.titulo ?? ""));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  const usados = todos.map((x) => ({ nombre: x.nombre, slug: x.slug, ruta: x.ruta, otros: [...(x.titulo ? [x.titulo] : []), ...x.alias] }));
  const r = validarNombre(valor, p.ruta, usados);
  // Mientras se escribe sólo se avisa de lo que ya está mal (un campo vacío no es un error, es que falta escribir).
  const malo = !r.ok && valor.trim() !== "" ? r : null;
  const igual = r.ok && r.valor === (p.titulo ?? p.nombre);

  const abrir = () => {
    setValor(p.titulo ?? "");
    setError(null);
    setAviso(null);
    setEditando(true);
  };
  const cerrar = () => {
    setEditando(false);
    setError(null);
  };
  const guardar = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!r.ok || guardando || igual) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await fuenteProyectos.renombrar(p.slug, r.valor);
      setAviso(tv("pry.guardado", { p: p.nombre, n: visible(nuevo) }));
      setEditando(false);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setGuardando(false);
    }
  };
  const quitar = async () => {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await fuenteProyectos.renombrar(p.slug, null);
      setAviso(tv("pry.quitado", { p: p.nombre }));
      setEditando(false);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setGuardando(false);
    }
  };
  const motivoTexto = malo && !malo.ok ? tv(`pry.err.${malo.motivo}` as Clave, { max: NOMBRE_MAX, con: malo.con ?? "" }) : null;
  const n = [...valor.trim()].length;

  return (
    <div className="pry-fila" data-proyecto={p.slug} data-nombre-fila>
      <div className="pry-cab">
        <span className="pry-nom">{visible(p)}</span>
        {p.titulo ? <span className="pry-orig" data-tip={t("pry.original")}>{p.nombre}</span> : null}
        {!editando ? (
          <button type="button" className="mini" data-renombrar aria-label={tv("pry.renombrarDe", { p: visible(p) })} onClick={abrir}>
            <PencilLine size={13} strokeWidth={1.8} aria-hidden="true" />
            {t("pry.renombrar")}
          </button>
        ) : null}
      </div>
      <p className="pry-meta">
        {p.ruta} · {t("pry.slug")}: {p.slug}
      </p>
      {!p.existe ? (
        <p className="pry-falta">
          <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" /> {t("pry.sinCarpeta")}
        </p>
      ) : null}
      {editando ? (
        <form className="pry-edita" onSubmit={(e) => void guardar(e)}>
          <div className="pry-campo">
            <input
              ref={campo}
              type="text"
              value={valor}
              maxLength={NOMBRE_MAX * 2}
              spellCheck={false}
              autoComplete="off"
              aria-label={tv("pry.nombreLabel", { p: p.nombre })}
              aria-invalid={malo ? "true" : undefined}
              disabled={guardando}
              onChange={(e) => {
                setValor(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  cerrar();
                }
              }}
            />
            <span className="pry-cuenta">{tv("pry.cuenta", { n, max: NOMBRE_MAX })}</span>
            <button type="submit" className="mini pn-primario" data-guardar disabled={!r.ok || igual || guardando}>
              <Check size={13} strokeWidth={2} aria-hidden="true" />
              {t("pry.guardar")}
            </button>
            <button type="button" className="mini" data-cancelar onClick={cerrar} disabled={guardando}>
              <X size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("pry.cancelar")}
            </button>
            {p.titulo ? (
              <button type="button" className="mini" data-quitar onClick={() => void quitar()} disabled={guardando}>
                <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
                {t("pry.quitar")}
              </button>
            ) : null}
          </div>
          {motivoTexto ? (
            <p className="pry-err" role="alert">
              <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" /> {motivoTexto}
            </p>
          ) : null}
          {error ? <p className="pry-err" role="alert"><AlertTriangle size={13} strokeWidth={2} aria-hidden="true" /> {textoMain(error)}</p> : null}
          {r.ok && !igual ? <p className="pn-nota">{tv("pry.paAlias", { n: r.valor, p: p.nombre })}</p> : null}
        </form>
      ) : null}
      {aviso && !editando ? (
        <p className="pn-nota pry-ok" role="status">
          <Check size={13} strokeWidth={2} aria-hidden="true" /> {aviso}
        </p>
      ) : null}
    </div>
  );
}

/** Las instrucciones de un proyecto: qué archivos hay y qué se puede hacer (Unificar, Abrir AGENTS.md). */
function FilaInstrucciones({ p, abrir }: { p: ProyectoNombre; abrir: "unificar" | "editor" | null }) {
  const [estado, setEstado] = useState<EstadoMd | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"unificar" | "editor" | null>(abrir);
  const leer = () => {
    fuenteProyectos.mdEstado(p.slug).then(
      (e) => (setEstado(e), setError(null)),
      (e) => setError(mensaje(e)),
    );
  };
  useEffect(leer, [p.slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const nombre = visible(p);
  return (
    <div className="pry-fila" data-proyecto={p.slug} data-md-fila>
      <div className="pry-cab">
        <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="pry-nom">{nombre}</span>
        {estado?.unificado ? (
          <span className="pry-estado" data-unificado>
            <Check size={13} strokeWidth={2} aria-hidden="true" /> {t("pry.md.unificado")}
          </span>
        ) : null}
      </div>
      {error ? <p className="pry-err" role="alert"><AlertTriangle size={13} strokeWidth={2} aria-hidden="true" /> {textoMain(error)}</p> : null}
      {estado ? <ArchivosMd estado={estado} /> : null}
      {estado?.truncado ? <AvisoLargo caracteres={estado.caracteres} tope={estado.tope} /> : null}
      {estado && !estado.unificado && estado.porUnificar ? (
        <p className="pn-nota">{estado.archivos.some((f) => f.archivo !== "AGENTS.md" && f.tipo === "real") ? t("pry.md.porUnificar") : t("pry.md.faltaImport")}</p>
      ) : null}
      {estado && !estado.porUnificar && !estado.unificado && estado.archivos.every((f) => f.tipo === "falta") ? <p className="pn-nota">{t("pry.md.sinNada")}</p> : null}
      {estado && p.existe ? (
        <div className="pry-acc">
          {estado.porUnificar ? (
            <button type="button" className="mini pn-primario" data-unificar aria-expanded={panel === "unificar"} onClick={() => setPanel(panel === "unificar" ? null : "unificar")}>
              <Merge size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("pry.md.unificarBtn")}
            </button>
          ) : null}
          <button type="button" className="mini" data-abrir-agents aria-expanded={panel === "editor"} onClick={() => setPanel(panel === "editor" ? null : "editor")}>
            <PencilLine size={13} strokeWidth={1.8} aria-hidden="true" />
            {t("pry.md.abrirBtn")}
          </button>
        </div>
      ) : null}
      {panel === "unificar" ? (
        <UnificarPanel
          slug={p.slug}
          nombre={nombre}
          alCerrar={() => {
            setPanel(null);
            leer();
          }}
          alHecho={leer}
        />
      ) : null}
      {panel === "editor" ? <EditorAgents slug={p.slug} nombre={nombre} alCerrar={() => setPanel(null)} alGuardar={leer} /> : null}
    </div>
  );
}
