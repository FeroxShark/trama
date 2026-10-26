// Ajustes > Modelos > «Modelos para workers»: cada modelo que `reparto` conoce (reparto --tabla), agrupado por empresa, con su
// logo, un interruptor permitido/no (se guarda en `excluir` por id exacto), la inteligencia editable de 0 a 100 (se guarda en
// `calidad`; "estimada" mientras nadie la fijó) y, sólo para leer, cuánto cupo queda y cuándo se reinicia. Trabaja sobre el borrador
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
import {
  agrupar,
  calidadEscrita,
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
  type GrupoTabla,
} from "./modelos-workers";

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

/** El campo de inteligencia: escribe un entero 0–100 (vacío: vuelve a la estimada); lo que no vale queda marcado y no cambia el borrador. */
function CampoInteligencia({ f, valor, fijada, alCambiar }: { f: FilaTabla; valor: number; fijada: boolean; alCambiar: (n: number | null) => void }) {
  const [texto, setTexto] = useState(String(valor));
  const [enfoque, setEnfoque] = useState(false);
  useEffect(() => {
    if (!enfoque) setTexto(String(valor));
  }, [valor, enfoque]);
  const n = calidadEscrita(texto);
  const mal = texto.trim() !== "" && n === null;
  return (
    <input
      className="pn-campo wk-num"
      inputMode="numeric"
      value={texto}
      maxLength={3}
      aria-invalid={mal || undefined}
      aria-label={t("ajustes.mdlWkInteligencia", { modelo: f.nombre })}
      data-tip={fijada ? t("ajustes.mdlWkFijada") : t("ajustes.mdlWkInteligenciaQue")}
      onFocus={() => setEnfoque(true)}
      onBlur={() => {
        setEnfoque(false);
        setTexto(String(valor));
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

/** Una fila: interruptor, nombre y datos de cupo, y la inteligencia. */
function Fila({ f, b, cambiar }: { f: FilaTabla; b: Borrador; cambiar: (n: Borrador) => void }) {
  const est = estadoDe(f, b);
  const q = inteligenciaDe(f, b);
  const o = origenDe(f, b);
  // «gratis» se dice una vez (la etiqueta): el cupo de uno gratis sólo se nombra si ya se gastó algo.
  const cupo =
    f.libre !== null ? (f.gratis ? (f.libre < 100 ? t("ajustes.mdlWkQueda", { pct: String(f.libre) }) : null) : t("ajustes.mdlWkLibre", { pct: String(f.libre) })) : f.gratis ? t("ajustes.mdlWkSinCupo") : t("ajustes.mdlWkSinDato");
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
          {f.agotado ? (
            <span className="wk-agotado">{t("ajustes.mdlWkAgotado")}</span>
          ) : (
            cupo && <span>{cupo}</span>
          )}
          {f.libre !== null && f.vuelve !== null ? <Vuelve ms={f.vuelve} /> : null}
        </span>
        {/* Los excluidos no entran al reparto: la fila va atenuada (arriba) y sin el desglose por effort, que no se usa. */}
        {est.permitido && o.tipo === "aa" && Object.keys(f.calidadPorEffort).length > 0 ? (
          <span className="wk-efforts" data-tip={t("ajustes.mdlWkPorEffortQue")}>
            {EFFORTS_CALIDAD.filter((e) => f.calidadPorEffort[e] !== undefined)
              .map((e) => `${t(`ajustes.mdlWkEffort_${e}`)} ${f.calidadPorEffort[e]}`)
              .join(" · ")}
          </span>
        ) : null}
      </div>
      <div className="wk-q">
        <CampoInteligencia f={f} valor={q.valor} fijada={q.fijada} alCambiar={(n) => cambiar(ponerInteligencia(b, f, n))} />
        <span className="wk-est" data-origen={o.tipo} data-tip={o.tipo === "estimada" ? t("ajustes.mdlWkEstimadaQue") : o.tipo === "usuario" ? t("ajustes.mdlWkOrigenUsuarioQue") : o.tipo === "aa" ? t("ajustes.mdlWkOrigenAAQue", { fecha: o.fecha ?? "" }) : undefined}>
          {o.tipo === "estimada" ? t("ajustes.mdlWkOrigenEstimada") : o.tipo === "usuario" ? t("ajustes.mdlWkOrigenUsuario") : o.tipo === "aa" ? t("ajustes.mdlWkOrigenAA", { fecha: o.fecha ?? "" }) : ""}
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
                      <Fila key={f.id} f={f} b={b} cambiar={cambiar} />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </>
      ) : null}

      {filas.some((f) => f.origen === "artificial-analysis") ? (
        <p className="pn-nota wk-aa-pie">
          <AtribucionAA />
        </p>
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

