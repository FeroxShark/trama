// Ajustes > Locales, lo que Trama detecta en esta máquina: llama.cpp, LM Studio, vLLM y Ollama (instalado / apagado / andando), los modelos de
// cada uno, el botón para prender o apagar su servicio (pide confirmar: prender un modelo ocupa la GPU) y para usarlo como motor de workers o
// del líder con el arnés que se elija. Mirar no prende nada: sólo los botones, con el clic. El cambio de motor va al borrador de Modelos y se
// aplica con su Guardar. Las guías de instalación (Linux y Windows) salen de locales-detectados.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ModeloDetectado, ResultadoDeteccion, ServidorLocal } from "../../electron/locales-deteccion";
import { fuente } from "../datos/fuente";
import { MODO } from "../modo";
import { idioma, t, textoMain, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { Boton, Chip, FilaAjuste, Tarjeta } from "../ui/componentes";
import { Comando } from "./AjustesLocales";
import { ARNESES_USO, choqueDePuerto, gbDeMiB, guiaDe, usarComo, usoActual, type ArnesUso, type RolUso } from "./locales-detectados";
import type { Borrador } from "./modelos-borrador";

/** Segundos que la confirmación de prender espera antes de volver sola al botón (un clic suelto no queda armado). */
const CONFIRMA_S = 12;
/** Cada cuánto se vuelve a mirar después de prender (el modelo tarda en cargar) y cuántas veces. */
const SONDEO_MS = 3000;
const SONDEOS = 10;

const TONO: Record<ServidorLocal["estado"], "ok" | "aviso" | undefined> = { andando: "ok", apagado: "aviso", "no-instalado": undefined };

type Nota = { tipo: "ok" | "error"; texto: string };

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace(".", idioma() === "es" ? "," : ".");

export function LocalesDetectados({ b, cambiar }: { b: Borrador; cambiar: (b: Borrador) => void }) {
  useIdioma();
  const [r, setR] = useState<ResultadoDeteccion | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [mirando, setMirando] = useState(true);
  const [armado, setArmado] = useState<string | null>(null);
  const [haciendo, setHaciendo] = useState<string | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  const [arnes, setArnes] = useState<Record<string, ArnesUso>>({});
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sondeo = useRef<ReturnType<typeof setTimeout>>(undefined);
  const vivo = useRef(true);

  const mirar = useCallback(async () => {
    setMirando(true);
    try {
      const x = await fuente.detectarLocales();
      if (!vivo.current) return;
      setR(x);
      setFallo(null);
      return x;
    } catch (e) {
      if (vivo.current) setFallo(textoMain(mensaje(e)));
    } finally {
      if (vivo.current) setMirando(false);
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    // Captura `mdl-prender`: deja abierto el aviso de prender el primer servicio apagado.
    void mirar().then((x) => {
      const m = MODO.variante === "mdl-prender" ? x?.modelos.find((o) => o.unit && o.estadoServidor === "apagado") : undefined;
      if (m && vivo.current) setArmado(m.id);
    });
    return () => {
      vivo.current = false;
      clearTimeout(reloj.current);
      clearTimeout(sondeo.current);
    };
  }, [mirar]);

  // Captura: cuando ya cargó (y con el aviso abierto en `mdl-prender`), deja a la vista lo que cada variante quiere mostrar.
  useEffect(() => {
    const v = MODO.variante;
    if (!r || !v?.startsWith("mdl-")) return;
    const sel = v === "mdl-prender" ? (armado ? ".lc-aviso" : null) : v === "mdl-guias" || v === "mdl-win" ? '.lc-sv[data-estado="no-instalado"]' : null;
    if (sel) document.querySelector(sel)?.scrollIntoView({ block: "center" });
  }, [r, armado]);

  const desarmar = () => {
    clearTimeout(reloj.current);
    setArmado(null);
  };
  const armar = (id: string) => {
    clearTimeout(reloj.current);
    setArmado(id);
    setNota(null);
    reloj.current = setTimeout(() => setArmado(null), CONFIRMA_S * 1000);
  };

  /** Después de prender, el modelo tarda en cargar: se vuelve a mirar cada tanto hasta que conteste (o se cansa). */
  const esperarQueCargue = (id: string, n = 0) => {
    clearTimeout(sondeo.current);
    sondeo.current = setTimeout(async () => {
      const x = await mirar();
      if (!vivo.current) return;
      const listo = x?.modelos.find((m) => m.id === id)?.estadoServidor === "prendido";
      if (!listo && n + 1 < SONDEOS) esperarQueCargue(id, n + 1);
    }, SONDEO_MS);
  };

  const accion = async (m: ModeloDetectado, que: "prender" | "apagar") => {
    if (haciendo || !m.unit) return;
    desarmar();
    setHaciendo(m.id);
    setNota(null);
    try {
      const res = que === "prender" ? await fuente.prenderLocal(m.unit) : await fuente.apagarLocal(m.unit);
      if (res.ok) {
        setNota({ tipo: "ok", texto: t(que === "prender" ? "ajustes.locListo" : "ajustes.locListoApagado", { nombre: m.nombre }) });
        await mirar();
        if (que === "prender") esperarQueCargue(m.id);
      } else setNota({ tipo: "error", texto: textoMain(res.error ?? "") });
    } catch (e) {
      setNota({ tipo: "error", texto: textoMain(mensaje(e)) });
    } finally {
      if (vivo.current) setHaciendo(null);
    }
  };

  const dshInstalado = r?.arneses.find((a) => a.id === "dsh")?.instalado ?? false;
  const coma = idioma() === "es";

  return (
    <Tarjeta titulo={t("ajustes.locTitulo")}>
      <div className="lc" data-opc="ajustes.mdlLocales">
        <div className="lc-cab">
          <p className="ol-nota">{t("ajustes.locQue")}</p>
          <Boton onClick={() => void mirar()} disabled={mirando}>
            {mirando ? t("ajustes.locMirando") : t("ajustes.locMirar")}
          </Boton>
        </div>
        {r ? (
          <div className="ol-chips">
            <Chip tono={r.vramGpuMiB === null ? "aviso" : undefined}>{r.vramGpuMiB !== null ? t("ajustes.locGpu", { gb: gbDeMiB(r.vramGpuMiB, coma) }) : t("ajustes.locSinGpu")}</Chip>
          </div>
        ) : null}
        {fallo ? (
          <p className="pn-error" role="alert">
            {t("ajustes.locFallo", { motivo: fallo })}
          </p>
        ) : null}
        {nota ? (
          <p className="lc-nota" data-tipo={nota.tipo} role={nota.tipo === "error" ? "alert" : "status"}>
            {nota.tipo === "ok" ? <Check size={13} aria-hidden="true" /> : null}
            <span>{nota.texto}</span>
          </p>
        ) : null}
        {r?.servidores.map((s) => {
          const guia = guiaDe(s.id, r.plataforma);
          const suyos = s.modelos.flatMap((id) => r.modelos.filter((m) => m.id === id));
          return (
            <section key={s.id} className="lc-sv" data-estado={s.estado} aria-label={s.nombre}>
              <div className="lc-sv-cab">
                <span className="lc-sv-nom">{s.nombre}</span>
                <Chip tono={TONO[s.estado]}>{t(`ajustes.locEstado_${s.estado}` as ClaveSola)}</Chip>
                <span className="lc-sv-meta">
                  {s.version ? `${t("ajustes.locVersion", { v: s.version })} · ` : ""}
                  {t("ajustes.locPuerto", { n: s.puerto })}
                </span>
              </div>
              {s.instalado ? (
                suyos.length ? (
                  <div className="lc-modelos" role="list" aria-label={s.nombre}>
                    {suyos.map((m) => {
                      const prendido = m.estadoServidor === "prendido";
                      const choque = choqueDePuerto(m, r.modelos);
                      const esArmado = armado === m.id;
                      const ocupa = m.vramEstimadaMiB ?? null;
                      const elegido = arnes[m.id] ?? "claude";
                      const comoWorkers = usoActual(b, m, "workers");
                      const comoLider = usoActual(b, m, "lider");
                      const usar = (rol: RolUso) => cambiar(usarComo(b, m, elegido, rol));
                      const detalle = [
                        m.tamanoBytes ? t("ajustes.locDisco", { gb: gb(m.tamanoBytes) }) : null,
                        ocupa !== null && !prendido ? t("ajustes.locVram", { gb: gbDeMiB(ocupa, coma) }) : null,
                        m.origenDetalle,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div role="listitem" key={m.id} className="lc-m" data-armado={esArmado ? "" : undefined}>
                          <FilaAjuste titulo={<span className="lc-m-nom">{m.nombre}</span>} detalle={detalle}>
                            <Chip tono={prendido ? "ok" : undefined}>{t(prendido ? "ajustes.locModeloPrendido" : "ajustes.locModeloApagado")}</Chip>
                            {m.unit && r.plataforma === "linux" && !esArmado ? (
                              prendido ? (
                                <Boton disabled={haciendo !== null} aria-label={t("ajustes.locApagarA", { nombre: m.nombre })} onClick={() => void accion(m, "apagar")}>
                                  {haciendo === m.id ? t("ajustes.locApagando") : t("ajustes.locApagar")}
                                </Boton>
                              ) : (
                                <Boton primario disabled={haciendo !== null} aria-label={t("ajustes.locPrenderA", { nombre: m.nombre })} onClick={() => armar(m.id)}>
                                  {haciendo === m.id ? t("ajustes.locPrendiendo") : t("ajustes.locPrender")}
                                </Boton>
                              )
                            ) : null}
                          </FilaAjuste>
                          {esArmado ? (
                            <div className="lc-aviso" role="alertdialog" aria-label={t("ajustes.locPrenderTitulo", { nombre: m.nombre })}>
                              <div className="lc-aviso-t">{t("ajustes.locPrenderTitulo", { nombre: m.nombre })}</div>
                              <p className="ol-nota">
                                {ocupa !== null && r.vramGpuMiB !== null
                                  ? t("ajustes.locPrenderAviso", { gb: gbDeMiB(ocupa, coma), total: gbDeMiB(r.vramGpuMiB, coma) })
                                  : t("ajustes.locPrenderAvisoGen")}
                              </p>
                              {choque ? <p className="ol-nota lc-choque">{t("ajustes.locPrenderChoque", { otro: choque.nombre })}</p> : null}
                              <div className="lc-aviso-b">
                                <Boton primario disabled={haciendo !== null || choque !== null} onClick={() => void accion(m, "prender")}>
                                  {t("ajustes.locConfirmar")}
                                </Boton>
                                <Boton onClick={desarmar}>{t("ajustes.locCancelar")}</Boton>
                              </div>
                            </div>
                          ) : null}
                          {!m.unit && !prendido ? (
                            <p className="ol-nota lc-pie">{t(r.plataforma === "win32" ? "ajustes.locNoServicioWin" : "ajustes.locNoServicio")}</p>
                          ) : !m.unit && prendido ? (
                            <p className="ol-nota lc-pie">{t(r.plataforma === "win32" ? "ajustes.locNoServicioWin" : "ajustes.locNoServicioPuerto")}</p>
                          ) : m.unit && r.plataforma !== "linux" ? (
                            <p className="ol-nota lc-pie">{t("ajustes.locNoServicioWin")}</p>
                          ) : null}
                          <div className="lc-uso" role="group" aria-label={t("ajustes.locUsar")}>
                            <span className="lc-uso-t" title={t("ajustes.locArnesQue")}>
                              {t("ajustes.locArnes")}
                            </span>
                            <div className="lc-seg" role="radiogroup" aria-label={t("ajustes.locArnes")}>
                              {ARNESES_USO.map((a) => {
                                const falta = a === "dsh" && !dshInstalado;
                                return (
                                  <button
                                    key={a}
                                    type="button"
                                    role="radio"
                                    aria-checked={elegido === a}
                                    className="lc-seg-b"
                                    disabled={falta}
                                    title={falta ? t("ajustes.locArnesDshFalta") : undefined}
                                    onClick={() => setArnes((x) => ({ ...x, [m.id]: a }))}
                                  >
                                    {elegido === a ? <Check size={12} aria-hidden="true" /> : null}
                                    {t(`ajustes.locArnes_${a}` as ClaveSola)}
                                  </button>
                                );
                              })}
                            </div>
                            <Boton aria-label={t("ajustes.locParaWorkersA", { nombre: m.nombre })} aria-pressed={comoWorkers !== null} onClick={() => usar("workers")}>
                              {t("ajustes.locParaWorkers")}
                            </Boton>
                            <Boton aria-label={t("ajustes.locParaLiderA", { nombre: m.nombre })} aria-pressed={comoLider !== null} onClick={() => usar("lider")}>
                              {t("ajustes.locParaLider")}
                            </Boton>
                          </div>
                          {comoWorkers || comoLider ? (
                            <div className="ol-chips lc-pie">
                              {comoWorkers ? <Chip tono="ok">{t("ajustes.locEnUsoWorkers", { arnes: t(`ajustes.locArnes_${comoWorkers}` as ClaveSola) })}</Chip> : null}
                              {comoLider ? <Chip tono="ok">{t("ajustes.locEnUsoLider", { arnes: t(`ajustes.locArnes_${comoLider}` as ClaveSola) })}</Chip> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <p className="ol-nota lc-pie">{t("ajustes.locAplicar")}</p>
                  </div>
                ) : (
                  <p className="ol-nota">{t("ajustes.locSinModelos")}</p>
                )
              ) : null}
              {s.estado !== "andando" ? (
                <div className="lc-guia">
                  <div className="ol-paso-t">{t(s.instalado ? "ajustes.locGuiaArrancar" : "ajustes.locGuiaInstalar")}</div>
                  <p className="ol-nota">{t(s.instalado ? guia.notaArrancar : guia.notaInstalar)}</p>
                  {s.instalado ? (
                    guia.arrancar ? <Comando texto={guia.arrancar} etiqueta={t("ajustes.locGuiaArrancar")} /> : null
                  ) : (
                    <>
                      {guia.instalar ? <Comando texto={guia.instalar} etiqueta={t("ajustes.locGuiaInstalar")} /> : null}
                      {guia.web ? (
                        <a className="ui-btn mdl-enlace" href={guia.web} target="_blank" rel="noopener noreferrer">
                          {t("ajustes.locGuiaWeb")}
                        </a>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </Tarjeta>
  );
}
