// Ajustes > Modelos > «Modelos para workers»: cada modelo que `reparto` conoce (reparto --tabla), agrupado por empresa, con su
// logo, un interruptor permitido/no (se guarda en `excluir` por id exacto), la inteligencia en unidades de Artificial Analysis (editable: se
// guarda en `calidad`), un chip por esfuerzo que se prende o apaga para los workers (se guarda en `efforts_permitidos`) y, sólo para leer, cuánto
// cupo queda y cuándo se reinicia. El número grande es la inteligencia al esfuerzo que `reparto` usaría (nunca el máximo por defecto). Trabaja sobre el borrador
// de AjustesModelos: nada se escribe hasta Guardar. Las reglas de `excluir` por familia o patrón siguen valiendo y se ven abajo.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Interruptor } from "../ui/componentes";
import { EFFORTS_CALIDAD } from "../../electron/efforts-calidad";
import type { FilaTabla } from "../../electron/reparto-tabla";
import { fuentePaneles, type TablaReparto } from "../datos/paneles";
import { EMPRESAS } from "../hilo/modelos";
import { Logo } from "../hilo/Logos";
import { Reloj } from "../barra/piezas";
import { PanelCargando } from "./PanelCargando";
import { idioma, t } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { MODO } from "../modo";
import { pintorVuelve } from "../tiempo";
import { AtribucionAA, ClaveArtificialAnalysis } from "./AjustesWorkersAA";
import { quitarExcluido, type Borrador } from "./modelos-borrador";
import { aplicarSugerencias, dominados, paresDe, permitidosDe, ponerEffort, type Dominado } from "./efforts-dominados";
import {
  agrupar,
  calidadEnEffort,
  calidadEscrita,
  cifra,
  effortsMostrados,
  esEstimado,
  EMPRESA_DE_GRUPO,
  estadoDe,
  filasUnicas,
  filtrar,
  inteligenciaDe,
  nombreVisible,
  origenDe,
  ponerInteligencia,
  ponerPermitido,
  reglasSueltas,
  usadoDe,
  type GrupoTabla,
} from "./modelos-workers";

/** Tokens por tarea en una palabra («850k», «1,2 M»). */
const tokensCorto = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
/** Segundos por tarea («42 s», «3 min 10 s»). */
const tiempoTarea = (s: number): string => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const dinero = (n: number): string => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

/** De dónde sale la cifra de un esfuerzo, con palabras (no sólo color): estimado, o medido por AA / en la tabla propia del dueño. */
function estadoEffort(f: FilaTabla, e: (typeof EFFORTS_CALIDAD)[number]): string {
  if (esEstimado(f, e)) return t("ajustes.mdlWkChipEstimado");
  const fu = f.fuentePorEffort?.[e];
  return fu === "suplemento" ? t("ajustes.mdlWkChipMedidoSup") : fu === "suplemento~" ? t("ajustes.mdlWkChipMedidoSupAprox") : t("ajustes.mdlWkChipMedido");
}

/** El tooltip de un chip de esfuerzo: medido o estimado, código y agentes de AA (extras, si los hay), costo, tokens y tiempo por tarea. */
function tipChip(f: FilaTabla, e: (typeof EFFORTS_CALIDAD)[number]): string {
  const partes: string[] = [estadoEffort(f, e)];
  if (esEstimado(f, e)) partes.push(t("ajustes.mdlWkChipEstimadoQue"));
  const cod = f.codingPorEffort?.[e];
  if (cod !== undefined) partes.push(t("ajustes.mdlWkChipCodigo", { n: cifra(cod) }));
  const ag = f.agenticPorEffort?.[e];
  if (ag !== undefined) partes.push(t("ajustes.mdlWkChipAgentes", { n: cifra(ag) }));
  const c = f.costoPorEffort?.[e];
  partes.push(c !== undefined ? t("ajustes.mdlWkChipCosto", { n: dinero(c) }) : t("ajustes.mdlWkChipCostoEst"));
  const k = f.tokensPorEffort?.[e];
  if (k !== undefined) partes.push(t("ajustes.mdlWkChipTokens", { n: tokensCorto(k) }));
  const m = f.tiempoPorEffort?.[e];
  if (m !== undefined) partes.push(t("ajustes.mdlWkChipTiempo", { n: tiempoTarea(m) }));
  return partes.join(" · ");
}

const nombreGrupo = (g: GrupoTabla): string => {
  if (g === "openai") return t("ajustes.mdlWkOpenai");
  const e = EMPRESA_DE_GRUPO[g];
  return e ? EMPRESAS[e] : g;
};

/** "vuelve en 20 h": lo escribe el reloj compartido (el valor llega en ms). */
function Vuelve({ ms }: { ms: number }) {
  const pintor = useMemo(() => pintorVuelve(Math.round(ms / 1000)), [ms]);
  return <Reloj pintor={pintor} className="wk-vuelve" />;
}

/** El campo de inteligencia: escribe unidades de AA, 0–200 con un decimal (vacío: vuelve a la estimada); lo que no vale queda marcado y no cambia el borrador. */
function CampoInteligencia({ f, valor, fijada, alCambiar }: { f: FilaTabla; valor: number; fijada: boolean; alCambiar: (n: number | null) => void }) {
  const [texto, setTexto] = useState(cifra(valor));
  const [enfoque, setEnfoque] = useState(false);
  useEffect(() => {
    if (!enfoque) setTexto(cifra(valor));
  }, [valor, enfoque]);
  const n = calidadEscrita(texto);
  const mal = texto.trim() !== "" && n === null;
  return (
    <input
      className="pn-campo wk-num"
      inputMode="numeric"
      value={texto}
      maxLength={5}
      aria-invalid={mal || undefined}
      aria-label={t("ajustes.mdlWkInteligencia", { modelo: f.nombre })}
      data-tip={fijada ? t("ajustes.mdlWkFijada") : t("ajustes.mdlWkInteligenciaQue")}
      onFocus={() => setEnfoque(true)}
      onBlur={() => {
        setEnfoque(false);
        setTexto(cifra(valor));
      }}
      onChange={(ev) => {
        const s = ev.target.value;
        setTexto(s);
        if (s.trim() === "") alCambiar(null);
        else {
          const v = calidadEscrita(s);
          if (v !== null) alCambiar(v);
        }
      }}
    />
  );
}

/** Una fila: interruptor, nombre y datos de cupo, los chips de esfuerzo y la inteligencia al esfuerzo que se usaría. */
function Fila({ f, b, cambiar, dom }: { f: FilaTabla; b: Borrador; cambiar: (n: Borrador) => void; dom: Dominado[] }) {
  const est = estadoDe(f, b);
  const q = inteligenciaDe(f, b);
  const u = usadoDe(f, b);
  const o = origenDe(f, b);
  // «gratis» se dice una vez (la etiqueta): el cupo de uno gratis sólo se nombra si ya se gastó algo.
  const cupo =
    f.libre !== null ? (f.gratis ? (f.libre < 100 ? t("ajustes.mdlWkQueda", { pct: String(f.libre) }) : null) : t("ajustes.mdlWkLibre", { pct: String(f.libre) })) : f.gratis ? t("ajustes.mdlWkSinCupo") : t("ajustes.mdlWkSinDato");
  const medidos = effortsMostrados(f);   // medidos + estimados (cada chip dice cuál es)
  const permitidos = permitidosDe(f, b);
  const ningunoPermitido = est.permitido && medidos.length > 0 && permitidos.length === 0;
  const dominadoDe = (e: (typeof EFFORTS_CALIDAD)[number]) => dom.find((d) => d.par.id === f.id && d.par.effort === e);
  return (
    <li className="wk-fila" data-id={f.id} data-off={est.permitido ? undefined : ""} style={est.permitido ? undefined : { opacity: 0.55 }}>
      <Interruptor
        activo={est.permitido}
        disabled={est.regla !== null}
        data-tip={est.regla !== null ? t("ajustes.mdlWkRegla", { regla: est.regla }) : undefined}
        aria-label={t("ajustes.mdlWkPermitir", { modelo: f.nombre })}
        alCambiar={(v) => cambiar(ponerPermitido(b, f, v))}
      />
      <div className="wk-datos">
        <span className="wk-nombre">{nombreVisible(f.nombre, idioma())}</span>
        <span className="wk-meta">
          {f.gratis ? <span className="wk-gratis">{t("ajustes.mdlWkGratis")}</span> : null}
          {f.plan ? <span className="wk-gratis" data-plan={f.plan}>{t("selector.planGo")}</span> : null}
          {f.agotado ? (
            <span className="wk-agotado">{t("ajustes.mdlWkAgotado")}</span>
          ) : (
            cupo && <span>{cupo}</span>
          )}
          {f.libre !== null && f.vuelve !== null ? <Vuelve ms={f.vuelve} /> : null}
        </span>
        {/* Los excluidos no entran al reparto: la fila va atenuada (arriba) y sin el desglose por effort, que no se usa. */}
        {est.permitido && o.tipo === "aa" ? (
          medidos.length > 0 ? (
            <span className="wk-efforts" role="group" aria-label={t("ajustes.mdlWkEfforts", { modelo: f.nombre })}>
              {medidos.map((e) => {
                const on = permitidos.includes(e);
                const d = on ? dominadoDe(e) : undefined;
                return (
                  <button
                    key={e}
                    type="button"
                    className="wk-chip"
                    aria-pressed={on}
                    data-on={on ? "si" : "no"}
                    data-usado={u.efecto === e ? "" : undefined}
                    data-dominado={d ? "" : undefined}
                    data-tip={tipChip(f, e)}
                    onClick={() => cambiar(ponerEffort(b, f, e, !on))}
                  >
                    <span className="wk-chip-n">{t(`ajustes.mdlWkEffort_${e}`)}</span> <span className="wk-chip-v">{esEstimado(f, e) ? "~" : ""}{cifra(f.calidadPorEffort[e] ?? f.calidadEstimadaPorEffort[e] ?? calidadEnEffort(f.calidadPorEffort, e, f.calidad))}</span>
                    <span className="wk-chip-m">{esEstimado(f, e) ? ` · ${t("ajustes.mdlWkChipEstimado")}` : ""}{!on ? ` · ${t("ajustes.mdlWkChipOff")}` : d ? ` · ${t("ajustes.mdlWkChipNoConviene")}` : u.efecto === e ? ` · ${t("ajustes.mdlWkChipUsado")}` : ""}</span>
                  </button>
                );
              })}
            </span>
          ) : (
            <span className="wk-sin-efforts">{t("ajustes.mdlWkSinEfforts")}</span>
          )
        ) : null}
        {ningunoPermitido ? <span className="wk-hint" role="note">{t("ajustes.mdlWkNingunEffort")}</span> : null}
        {est.permitido
          ? dom.filter((d) => d.par.id === f.id && permitidos.includes(d.par.effort)).map((d) => (
              <span className="wk-hint" role="note" key={d.par.effort}>
                {t("ajustes.mdlWkNoConviene", { effort: t(`ajustes.mdlWkEffort_${d.par.effort}`), alternativa: `${nombreVisible(d.por.nombre, idioma())} ${t(`ajustes.mdlWkEffort_${d.por.effort}`)}` })}
              </span>
            ))
          : null}
      </div>
      <div className="wk-q">
        {u.valor === null ? (
          <span className="wk-est" data-origen="excluido">{t("ajustes.mdlWkSinUso")}</span>
        ) : (
          <>
            <CampoInteligencia f={f} valor={u.valor ?? q.valor} fijada={q.fijada} alCambiar={(n) => cambiar(ponerInteligencia(b, f, n))} />
            {u.efecto ? <span className="wk-est" data-origen="esfuerzo">{t("ajustes.mdlWkAlEsfuerzo", { effort: t(`ajustes.mdlWkEffort_${u.efecto}`) })}{u.estimado ? ` · ${t("ajustes.mdlWkChipEstimado")}` : ""}</span> : null}
          </>
        )}
        <span className="wk-est" data-origen={o.tipo} data-tip={o.tipo === "estimada" || o.tipo === "defecto" ? t("ajustes.mdlWkSinDatoAAQue") : o.tipo === "usuario" ? t("ajustes.mdlWkOrigenUsuarioQue") : o.tipo === "aa" ? t("ajustes.mdlWkOrigenAAQue", { fecha: o.fecha ?? "" }) : undefined}>
          {o.tipo === "estimada" || o.tipo === "defecto" ? t("ajustes.mdlWkSinDatoAA") : o.tipo === "usuario" ? t("ajustes.mdlWkOrigenUsuario") : o.tipo === "aa" ? t("ajustes.mdlWkOrigenAA", { fecha: o.fecha ?? "" }) : ""}
        </span>
      </div>
    </li>
  );
}

export function ModelosParaWorkers({ b, cambiar }: { b: Borrador; cambiar: (n: Borrador) => void }) {
  const [tabla, setTabla] = useState<TablaReparto | null | "cargando">("cargando");
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Partial<Record<GrupoTabla, boolean>>>(MODO.variante === "mdl-wk-todo" || MODO.variante === "mdl-wk-aa-todo" ? { anthropic: true, google: true, openai: true, opencode: true, deepseek: true, ollama: true, local: true } : { anthropic: true });
  const [version, setVersion] = useState(0);
  const recargar = () => setVersion((v) => v + 1);
  useEffect(() => {
    let vivo = true;
    fuentePaneles.repartoTabla().then(
      (r) => vivo && setTabla(r),
      () => vivo && setTabla(null),
    );
    return () => void (vivo = false);
  }, [version]);
  // Artificial Analysis se bajó de fondo mientras estaba abierto el panel: se vuelve a pedir la tabla (sin esqueleto: la de antes se queda hasta que llegue).
  useEffect(() => fuentePaneles.alTablaNueva(recargar), []);

  const filas = useMemo(() => (tabla && tabla !== "cargando" ? filasUnicas(tabla.modelos) : []), [tabla]);
  const buscando = q.trim() !== "";
  const grupos = useMemo(() => agrupar(filtrar(filas, q), b), [filas, q, b]);
  const sueltas = reglasSueltas(b.excluir, filas);
  // Los pares modelo+esfuerzo dominados (otro permitido rinde igual o más por menos): se ven en cada fila y se desmarcan con «Aplicar sugerencias».
  const dom = useMemo(() => dominados(paresDe(filas, b)), [filas, b]);
  const [confirmando, setConfirmando] = useState(false);
  const hayAA = filas.some((f) => f.origen === "artificial-analysis");
  const nombreRegla = (id: string) => ({ fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", argon: "Gemini Argon", flash: "Gemini Flash", "gpt-oss": "GPT-OSS" } as Record<string, string>)[id] ?? id;

  return (
    <div className="mdl-wk" data-wk data-opc="ajustes.mdlWk">
      <h3 className="pn-sub-h">{t("ajustes.mdlWk")}</h3>
      <Fijo k="ajustes.mdlWkQue" bloque className="pn-nota" />
      <ClaveArtificialAnalysis alActualizar={recargar} />
      {tabla === "cargando" ? <PanelCargando enLinea /> : null}
      {tabla === null ? <Fijo k="ajustes.mdlWkSin" bloque className="pn-nota" /> : null}
      {filas.length > 0 ? (
        <>
          <input
            className="pn-campo wk-buscar"
            type="search"
            value={q}
            placeholder={t("ajustes.mdlWkBuscar")}
            aria-label={t("ajustes.mdlWkBuscarEt")}
            onChange={(ev) => setQ(ev.target.value)}
          />
          {grupos.length === 0 ? <div className="pn-nota">{t("ajustes.mdlWkNada")}</div> : null}
          {grupos.map((g) => {
            const abierto = buscando || abiertos[g.grupo] === true;
            const nombre = nombreGrupo(g.grupo);
            const emp = EMPRESA_DE_GRUPO[g.grupo];
            const Flecha = abierto ? ChevronDown : ChevronRight;
            return (
              <section className="wk-grupo" key={g.grupo} data-grupo={g.grupo}>
                <button
                  type="button"
                  className="wk-cab"
                  aria-expanded={abierto}
                  aria-label={t(abierto ? "ajustes.mdlWkGrupoCerrar" : "ajustes.mdlWkGrupoAbrir", { grupo: nombre })}
                  onClick={() => setAbiertos((a) => ({ ...a, [g.grupo]: !abierto }))}
                >
                  <Flecha size={14} aria-hidden />
                  {emp ? <Logo empresa={emp} /> : null}
                  <span className="wk-cab-n">{nombre}</span>
                  <span className="wk-cab-c">{t("ajustes.mdlWkGrupo", { n: String(g.permitidos), total: String(g.filas.length) })}</span>
                </button>
                {abierto ? (
                  <ul className="wk-lista" aria-label={nombre}>
                    {g.filas.map((f) => (
                      <Fila key={f.id} f={f} b={b} cambiar={cambiar} dom={dom} />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </>
      ) : null}

      {filas.length > 0 ? (
        <div className="wk-sugerencias">
          <p className="pn-nota" data-wk-indice>
            {t("ajustes.mdlWkIndice")} <AtribucionAA />
          </p>
          <p className="pn-nota">{t("ajustes.mdlWkCostoNota")}</p>
          {dom.length > 0 ? (
            confirmando ? (
              <p className="pn-nota" role="alert">
                {t("ajustes.mdlWkAplicarPregunta", { n: String(dom.length) })}{" "}
                <button
                  type="button"
                  className="btn2"
                  onClick={() => {
                    cambiar(aplicarSugerencias(b, filas, dom));
                    setConfirmando(false);
                  }}
                >
                  {t("ajustes.mdlWkAplicarSi")}
                </button>{" "}
                <button type="button" className="btn2" onClick={() => setConfirmando(false)}>
                  {t("ajustes.cancelar")}
                </button>
              </p>
            ) : (
              <button type="button" className="btn2" onClick={() => setConfirmando(true)}>
                {t("ajustes.mdlWkAplicar", { n: String(dom.length) })}
              </button>
            )
          ) : hayAA ? (
            <p className="pn-nota">{t("ajustes.mdlWkNadaSugerir")}</p>
          ) : null}
        </div>
      ) : null}

      {sueltas.length ? (
        <p className="pn-nota wk-reglas-linea">
          {t("ajustes.mdlWkReglasLinea", { reglas: sueltas.map(nombreRegla).join(", ") })}{" "}
          <button type="button" className="btn2" onClick={() => cambiar(sueltas.reduce((x, id) => quitarExcluido(x, id), b))}>
            {t("accion.quitar")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

