// Ajustes > Proyectos: una tarjeta por proyecto con todo junto: cómo se llama en la app y en `pa` (el `titulo` del registry; sólo cambia el nombre
// que se ve: slug, carpeta, ramas y estado quedan) y el estado de sus instrucciones para todos los modelos (AGENTS.md / CLAUDE.md / GEMINI.md),
// con "Unificar en AGENTS.md" (vista previa y confirmación) y un editor de AGENTS.md. Arriba, un resumen de los que tienen las instrucciones
// repartidas y "Unificar todos": aplica directo sólo los casos mecánicos (unificar-clase.ts) y deja los que hay que fusionar para su tarjeta.
// Los datos: src/datos/proyectos.ts.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Bot, Check, FileText, GitBranch, Merge, PencilLine, RotateCcw, Sparkles, X } from "lucide-react";
import { NOMBRE_MAX, validarNombre } from "../../electron/proyectos-nombre";
import { fuenteProyectos, recargarProyectos, useProyectos, type EstadoMd, type PlanMd, type ProyectoNombre } from "../datos/proyectos";
import { t, textoMain, type Clave } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Cat } from "./AjustesNav";
import { abrirRamas } from "./ajustes-nav";
import { FilaFusion } from "./FilaFusion";
import { ArchivosMd, AvisoLargo, EditorAgents, EstadoLecturaMotores, textoAccion, UnificarPanel } from "./ProyectosMd";
import { clasePlan } from "./unificar-clase";
import "./proyectos.css";

const tv = t as (k: Clave, v: Record<string, string | number>) => string;

/** La captura `proyectos-renombrar` abre el editor del primero con un nombre que no vale; `-unificar` y `-editor` abren esos paneles; `-todos` la confirmación de Unificar todos. */
const CAPTURA = MODO.variante?.startsWith("proyectos-") ? MODO.variante : null;

/** Lo que pasó con un proyecto en "Unificar todos". */
type Resultado = { ok: true; backup: string } | { ok: false; fusion: true } | { ok: false; error: string };

export function Proyectos() {
  useIdioma();
  const lista = useProyectos();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estados, setEstados] = useState<Record<string, EstadoMd | string>>({});
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
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
  // El estado de las instrucciones de cada proyecto (o el error al leerlo): lo usan la tarjeta y el resumen de arriba.
  const leerMd = useCallback((slug: string) => {
    fuenteProyectos.mdEstado(slug).then(
      (e) => setEstados((x) => ({ ...x, [slug]: e })),
      (e) => setEstados((x) => ({ ...x, [slug]: mensaje(e) })),
    );
  }, []);
  const slugs = lista.map((p) => p.slug).join("\n");
  useEffect(() => {
    for (const p of lista) leerMd(p.slug);
  }, [slugs]); // eslint-disable-line react-hooks/exhaustive-deps

  const repartidos = lista.filter((p) => p.existe && typeof estados[p.slug] === "object" && (estados[p.slug] as EstadoMd).porUnificar);
  return (
    <Cat id="proyectos">
      <section className="pn-sec" data-opc="pry.nombres">
        <h2 className="pn-h">{t("pry.titulo")}</h2>
        <p className="pn-nota">{t("pry.intro")}</p>
        <p className="pn-nota">{t("pry.instruccionesQue")}</p>
        {error ? <p className="pn-error" role="alert">{tv("pry.error", { e: textoMain(error) })}</p> : null}
        {cargando && !lista.length ? <p className="pn-nota">{t("pry.cargando")}</p> : null}
        {!cargando && !lista.length && !error ? <p className="pn-nota">{t("pry.sinProyectos")}</p> : null}
        <div data-opc="pry.instrucciones">
          {repartidos.length ? (
            <UnificarTodos
              proyectos={repartidos}
              estados={estados}
              releer={leerMd}
              abierto={CAPTURA === "proyectos-todos"}
              alTerminar={(r) => {
                setResultados((x) => ({ ...x, ...r }));
                for (const s of Object.keys(r)) leerMd(s);
              }}
            />
          ) : null}
        </div>
        <div className="pry">
          {lista.map((p, i) => (
            <div key={p.slug} className="pry-fila" data-proyecto={p.slug} data-nombre-fila data-md-fila>
              <FilaNombre p={p} todos={lista} abierto={CAPTURA === "proyectos-renombrar" && i === 0} />
              <FilaInstrucciones
                p={p}
                estado={estados[p.slug] ?? null}
                resultado={resultados[p.slug] ?? null}
                releer={() => leerMd(p.slug)}
                abrir={CAPTURA === "proyectos-unificar" && p.slug === "asistente-voz" ? "unificar" : CAPTURA === "proyectos-editor" && p.slug === "atlas" ? "editor" : null}
              />
            </div>
          ))}
        </div>
      </section>
    </Cat>
  );
}

/**
 * El aviso de arriba ("N proyectos tienen las instrucciones repartidas") y "Unificar todos": lee el plan de cada uno, muestra en una lista
 * corta qué se haría y, al confirmar, aplica sólo los mecánicos (con la huella del plan que se vio; aplicarUnificar deja la copia en
 * md-backup). Los que hay que fusionar quedan señalados para revisarlos en su tarjeta.
 */
function UnificarTodos({ proyectos, estados, abierto, alTerminar, releer }: { proyectos: ProyectoNombre[]; estados: Record<string, EstadoMd | string>; abierto: boolean; alTerminar: (r: Record<string, Resultado>) => void; releer: (slug: string) => void }) {
  const [planes, setPlanes] = useState<{ p: ProyectoNombre; plan: PlanMd }[] | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<number | null>(null);
  // Fusionar con IA desde la fila: el mismo lanzamiento que la tarjeta (mdFusionar); si ya hay una tarea en curso no se relanza.
  const [lanzando, setLanzando] = useState<string | null>(null);
  const [lanzadas, setLanzadas] = useState<Record<string, "fusionar">>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const tareaDe = (slug: string) => lanzadas[slug] ?? (typeof estados[slug] === "object" ? (estados[slug] as EstadoMd).tareaEnCurso ?? null : null);
  const fusionar = async (slug: string) => {
    if (lanzando || tareaDe(slug)) return;
    setLanzando(slug);
    setErrores((x) => ({ ...x, [slug]: "" }));
    try {
      await fuenteProyectos.mdFusionar(slug, "fusionar");
      setLanzadas((x) => ({ ...x, [slug]: "fusionar" }));
      releer(slug);
    } catch (e) {
      setErrores((x) => ({ ...x, [slug]: textoMain(mensaje(e)) }));
    } finally {
      setLanzando(null);
    }
  };
  const preparar = async () => {
    if (leyendo) return;
    setLeyendo(true);
    setError(null);
    setHecho(null);
    try {
      setPlanes(await Promise.all(proyectos.map(async (p) => ({ p, plan: await fuenteProyectos.mdPlan(p.slug) }))));
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setLeyendo(false);
    }
  };
  useEffect(() => {
    if (abierto) void preparar();
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  const mecanicos = planes?.filter((x) => clasePlan(x.plan) === "mecanico") ?? [];
  const fusiones = planes?.filter((x) => clasePlan(x.plan) === "fusion") ?? [];
  const aplicar = async () => {
    if (aplicando) return;
    setAplicando(true);
    const r: Record<string, Resultado> = {};
    // De a uno: cada uno con la huella de su plan; si los archivos cambiaron desde la vista previa, ése falla y los demás siguen.
    for (const { p, plan } of mecanicos) {
      try {
        const a = await fuenteProyectos.mdAplicar(p.slug, plan.huella);
        r[p.slug] = { ok: true, backup: a.backup ?? "" };
      } catch (e) {
        r[p.slug] = { ok: false, error: mensaje(e) };
      }
    }
    for (const { p } of fusiones) r[p.slug] = { ok: false, fusion: true };
    setAplicando(false);
    setHecho(Object.values(r).filter((x) => x.ok).length);
    setPlanes(null);
    alTerminar(r);
  };

  return (
    <div className="pry-todos" role="region" aria-label={t("pry.todos.titulo")} data-unificar-todos>
      <p className="pry-todos-t">
        <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
        {proyectos.length === 1 ? t("pry.todos.uno") : tv("pry.todos.varios", { n: proyectos.length })}
      </p>
      {!planes ? (
        <div className="pry-acc">
          <button type="button" className="mini pn-primario" data-unificar-todos-btn disabled={leyendo} onClick={() => void preparar()}>
            <Merge size={13} strokeWidth={1.8} aria-hidden="true" />
            {leyendo ? t("pry.um.leyendo") : t("pry.todos.btn")}
          </button>
        </div>
      ) : (
        <>
          {mecanicos.length ? <p className="pn-nota">{t("pry.todos.seAplica")}</p> : null}
          <ul className="pry-todos-l">
            {mecanicos.map(({ p, plan }) => (
              <li key={p.slug} data-clase="mecanico">
                <b>{p.titulo ?? p.nombre}</b>: {plan.acciones.filter((a) => a.que !== "ya-dentro").map(textoAccion).join(" · ")}
              </li>
            ))}
          </ul>
          {fusiones.length ? (
            <>
              <p className="pn-nota">{t("pry.todos.fusionQue")}</p>
              <ul className="pry-todos-l pry-todos-fus">
                {fusiones.map(({ p }) => (
                  <FilaFusion
                    key={p.slug}
                    slug={p.slug}
                    nombre={p.titulo ?? p.nombre}
                    tarea={tareaDe(p.slug)}
                    lanzando={lanzando === p.slug}
                    error={errores[p.slug] || null}
                    alFusionar={() => void fusionar(p.slug)}
                    alIrRamas={abrirRamas}
                  />
                ))}
              </ul>
            </>
          ) : null}
          {mecanicos.length ? (
            <>
              <p className="pn-nota">{tv("pry.um.backup", { donde: "~/.local/state/pa/<slug>/md-backup/" })}</p>
              <p className="pn-nota">{t("pry.um.commit")}</p>
            </>
          ) : null}
          <div className="pry-acc">
            {mecanicos.length ? (
              <button type="button" className="mini pn-primario" data-confirmar-todos disabled={aplicando} onClick={() => void aplicar()}>
                <Merge size={13} strokeWidth={1.8} aria-hidden="true" />
                {aplicando ? t("pry.um.aplicando") : tv("pry.todos.confirmar", { n: mecanicos.length })}
              </button>
            ) : null}
            <button type="button" className="mini" data-cerrar disabled={aplicando} onClick={() => setPlanes(null)}>
              <X size={13} strokeWidth={1.8} aria-hidden="true" />
              {mecanicos.length ? t("pry.todos.noAplicar") : t("pry.todos.cerrar")}
            </button>
          </div>
        </>
      )}
      {hecho !== null ? (
        <p className="pn-nota pry-ok" role="status">
          <Check size={13} strokeWidth={2} aria-hidden="true" /> {tv("pry.todos.hecho", { n: hecho })}
        </p>
      ) : null}
      {error ? <p className="pn-error" role="alert">{textoMain(error)}</p> : null}
    </div>
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
    <>
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
    </>
  );
}

/**
 * Las instrucciones de un proyecto, dentro de su tarjeta: qué archivos hay, el aviso si están repartidas y qué hacer (Unificar, Abrir AGENTS.md),
 * y lo que pasó si se unificó con "Unificar todos".
 */
function FilaInstrucciones({ p, estado: e, resultado, releer, abrir }: { p: ProyectoNombre; estado: EstadoMd | string | null; resultado: Resultado | null; releer: () => void; abrir: "unificar" | "editor" | null }) {
  const [panel, setPanel] = useState<"unificar" | "editor" | null>(abrir);
  const [lanzando, setLanzando] = useState(false);
  const [tareaLocal, setTareaLocal] = useState<"acortar" | "fusionar" | null>(null);
  const [errorTarea, setErrorTarea] = useState<string | null>(null);
  const estado = typeof e === "object" ? e : null;
  const error = typeof e === "string" ? e : null;
  const nombre = visible(p);
  const conContenido = estado?.archivos.filter((f) => f.tipo === "real").map((f) => f.archivo) ?? [];
  const tareaActiva = tareaLocal ?? estado?.tareaEnCurso ?? null;

  const lanzar = async (tipo: "acortar" | "fusionar") => {
    if (lanzando || tareaActiva) return;
    setLanzando(true);
    setErrorTarea(null);
    try {
      await fuenteProyectos.mdFusionar(p.slug, tipo);
      setTareaLocal(tipo);
    } catch (err) {
      setErrorTarea(mensaje(err));
    } finally {
      setLanzando(false);
    }
  };
  return (
    <div className="pry-ins">
      <div className="pry-cab">
        <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className="pry-ins-t">{t("pry.instrucciones")}</span>
        {estado?.unificado && !estado.porUnificar ? (
          <span className="pry-estado" data-unificado>
            <Check size={13} strokeWidth={2} aria-hidden="true" /> {t("pry.md.unificado")}
          </span>
        ) : estado?.porUnificar ? (
          <span className="pry-estado" data-repartido>
            <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" /> {t("pry.md.pendiente")}
          </span>
        ) : null}
      </div>
      {error ? <p className="pry-err" role="alert"><AlertTriangle size={13} strokeWidth={2} aria-hidden="true" /> {textoMain(error)}</p> : null}
      {estado ? <EstadoLecturaMotores estado={estado}></EstadoLecturaMotores> : null}
      {estado ? (
        <details className="pry-md-detalles">
          <summary className="pry-md-sum">{t("pry.md.detallesArchivos")}</summary>
          <ArchivosMd estado={estado}></ArchivosMd>
        </details>
      ) : null}
      {estado?.truncado ? <AvisoLargo caracteres={estado.caracteres} tope={estado.tope} /> : null}
      {tareaActiva === "acortar" ? (
        <p className="pry-aviso" data-agente-acortando>
          <Bot size={13} strokeWidth={1.8} aria-hidden="true"></Bot>
          <span>{t("pry.md.agenteAcortando")}</span>
          <button type="button" className="mini pry-btn-inline" onClick={abrirRamas} data-ir-ramas>
            <GitBranch size={12} strokeWidth={1.8} aria-hidden="true"></GitBranch>
            {t("pry.md.irRamas")}
          </button>
        </p>
      ) : null}
      {tareaActiva === "fusionar" ? (
        <p className="pry-aviso" data-agente-fusionando>
          <Bot size={13} strokeWidth={1.8} aria-hidden="true"></Bot>
          <span>{t("pry.md.agenteFusionando")}</span>
          <button type="button" className="mini pry-btn-inline" onClick={abrirRamas} data-ir-ramas>
            <GitBranch size={12} strokeWidth={1.8} aria-hidden="true"></GitBranch>
            {t("pry.md.irRamas")}
          </button>
        </p>
      ) : null}
      {errorTarea ? (
        <p className="pry-err" role="alert">
          <AlertTriangle size={13} strokeWidth={2} aria-hidden="true"></AlertTriangle> {textoMain(errorTarea)}
        </p>
      ) : null}
      {estado && estado.porUnificar && tareaActiva !== "fusionar" ? (
        <p className="pry-aviso" data-aviso-repartido>
          <AlertTriangle size={13} strokeWidth={2} aria-hidden="true"></AlertTriangle>
          {conContenido.length > 1 ? tv("pry.md.distintos", { f: conContenido.join(", ") }) : conContenido.some((f) => f !== "AGENTS.md") ? t("pry.md.porUnificar") : t("pry.md.faltaImport")}
        </p>
      ) : null}
      {estado && !estado.porUnificar && !estado.unificado && estado.archivos.every((f) => f.tipo === "falta") ? <p className="pn-nota">{t("pry.md.sinNada")}</p> : null}
      {resultado ? (
        resultado.ok ? (
          <p className="pn-nota pry-ok" role="status" data-resultado="ok">
            <Check size={13} strokeWidth={2} aria-hidden="true" /> {tv("pry.um.hecho", { backup: resultado.backup || "~/.local/state/pa/<slug>/md-backup/" })}
          </p>
        ) : "fusion" in resultado ? (
          <p className="pry-aviso" role="status" data-resultado="fusion">
            <Merge size={13} strokeWidth={1.8} aria-hidden="true" /> {t("pry.todos.fusionTarjeta")}
          </p>
        ) : (
          <p className="pry-err" role="alert" data-resultado="error">
            <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" /> {textoMain(resultado.error)}
          </p>
        )
      ) : null}
      {estado && p.existe ? (
        <div className="pry-acc">
          {estado.truncado && tareaActiva !== "acortar" ? (
            <button type="button" className="mini pn-primario" data-acortar disabled={lanzando} onClick={() => void lanzar("acortar")}>
              <Sparkles size={13} strokeWidth={1.8} aria-hidden="true"></Sparkles>
              {lanzando ? t("pry.md.lanzando") : t("pry.md.acortarBtn")}
            </button>
          ) : null}
          {estado.porUnificar && conContenido.length > 1 && tareaActiva !== "fusionar" ? (
            <button type="button" className="mini pn-primario" data-fusionar disabled={lanzando} onClick={() => void lanzar("fusionar")}>
              <Merge size={13} strokeWidth={1.8} aria-hidden="true"></Merge>
              {lanzando ? t("pry.md.lanzando") : t("pry.md.fusionarBtn")}
            </button>
          ) : null}
          {estado.porUnificar ? (
            <button type="button" className={conContenido.length > 1 ? "mini" : "mini pn-primario"} data-unificar aria-expanded={panel === "unificar"} onClick={() => setPanel(panel === "unificar" ? null : "unificar")}>
              <Merge size={13} strokeWidth={1.8} aria-hidden="true"></Merge>
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
            releer();
          }}
          alHecho={releer}
        />
      ) : null}
      {panel === "editor" ? <EditorAgents slug={p.slug} nombre={nombre} alCerrar={() => setPanel(null)} alGuardar={releer} /> : null}
    </div>
  );
}
