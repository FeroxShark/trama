// El contexto (`-c` de llama-server) de un modelo local: un botón en la caja, junto al esfuerzo, que abre el mismo tipo de
// detalle que el anillo de contexto (`.ctx-det`). Un deslizador y un campo para el número, la cuenta de cuánto entra en la
// VRAM y la RAM (estimada: electron/locales-calc.ts), las opciones para llegar a mucho contexto (MTP, precisión del KV, KV en RAM, capas
// en la GPU: se escriben en el env de la unit junto al `-c`), qué se puede liberar si no entra (LiberarVram.tsx), "Probar" (carga el
// modelo de verdad, sólo con el clic) y Guardar. La cuenta se rehace acá con cada opción que se toca, sin pedirla de nuevo al main.
// Esc o clic afuera lo cierra. Sin animaciones propias: se abre con la misma `abre` de los demás detalles.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronRight, Cpu } from "lucide-react";
import {
  CAPAS_DEFECTO,
  ctxValido,
  entraEnRam,
  MARGEN_RAM_MIB,
  estimar,
  mejorCombinacion,
  MTP_MIB_DEFECTO,
  NGL_TODAS,
  OPCIONES_DEFECTO,
  opcionesIguales,
  ramNecesitaMiB,
  TIPOS_KV,
  type Opciones,
  type TipoKv,
} from "../../electron/locales-calc";
import type { EstadoLocales, LocalInfo, ResultadoProbar } from "../../electron/locales";
import { fuente } from "../datos/fuente";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { LiberarVram } from "./LiberarVram";
import { nombreModelo } from "./opciones";

/** 32768 → "32"; 98304 → "96"; 5000 → "4.9". */
export const kilo = (x: number) => {
  const k = x / 1024;
  return Number.isInteger(k) ? String(k) : k.toFixed(1);
};
const gb = (miB: number) => (miB / 1024).toFixed(1);

type Nota = { tipo: "ok" | "error"; texto: string };

/** Las opciones en una línea ("sin MTP · q4_0 · KV en RAM"), para el resumen y para decir qué combinación se eligió. */
export const describirOpciones = (o: Opciones) =>
  [
    o.mtp ? t("ctxl.conMtp") : t("ctxl.sinMtp"),
    o.kv,
    ...(o.kvRam ? [t("ctxl.kvEnRam")] : []),
    ...(o.ngl < NGL_TODAS ? [t("ctxl.nglCapas", { n: o.ngl })] : []),
  ].join(" · ");

/** Minutos que la vista espera a Probar antes de soltar el botón (un poco más que el tope del main). */
const TOPE_MIN = 6;

type Props = {
  /** El id de la tabla (`modelo-local-ejemplo`). */
  modelo: string;
  lado?: "izq" | "der";
  /** Para las capturas: nace abierto. */
  abierto?: boolean;
};

export function ContextoLocal({ modelo, lado = "der", abierto: deEntrada = false }: Props) {
  useIdioma();
  const [estado, setEstado] = useState<EstadoLocales | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(deEntrada);
  // Lo que el usuario escribió o arrastró; `null`: todavía nada (vale lo guardado).
  const [borrador, setBorrador] = useState<string | null>(null);
  // Las opciones que el usuario tocó; `null`: todavía ninguna (valen las guardadas).
  const [opcBorrador, setOpcBorrador] = useState<Opciones | null>(null);
  const [avAbierto, setAvAbierto] = useState<boolean | null>(null);
  const [fase, setFase] = useState<"libre" | "guardando" | "probando">("libre");
  const [nota, setNota] = useState<Nota | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const detalle = useRef<HTMLDivElement>(null);
  const id = useId();
  const idAv = useId();

  const info: LocalInfo | undefined = estado?.modelos.find((m) => m.id === modelo);

  const leer = useCallback(() => {
    fuente.locales().then(
      (e) => {
        setEstado(e);
        setFallo(null);
      },
      (e) => setFallo(mensaje(e)),
    );
  }, []);
  useEffect(leer, [leer, modelo]);
  // Al abrir se relee (la GPU cambió desde la última vez) y el campo parte de lo guardado.
  useEffect(() => {
    if (abierto) leer();
  }, [abierto, leer]);
  useLayoutEffect(() => {
    if (abierto) detalle.current?.focus();
    else setNota(null);
  }, [abierto]);

  const cerrar = (conFoco = true) => {
    setAbierto(false);
    setBorrador(null);
    setOpcBorrador(null);
    setAvAbierto(null);
    if (conFoco) boton.current?.focus();
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cerrar();
    } else if (e.key === "Tab") {
      // El foco se queda dentro mientras el detalle está abierto.
      const f = [...(detalle.current?.querySelectorAll<HTMLElement>("input, button:not(:disabled)") ?? [])];
      if (!f.length) return;
      const [primero, ultimo] = [f[0], f[f.length - 1]];
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === detalle.current)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }
  };

  const nombre = nombreModelo(modelo);
  const guardado = info?.ctx ?? null;
  const texto = borrador ?? (info ? String(info.ctx) : "");
  const n = /^\d+$/.test(texto) ? Number(texto) : null;
  const valido = info && n != null ? ctxValido(n, info.ctxMin, info.ctxMax) : null;
  const opc: Opciones = opcBorrador ?? info?.opciones ?? OPCIONES_DEFECTO;
  // La cuenta se rehace acá con las opciones del momento (la GPU y la RAM las leyó el main al abrir).
  const est = info?.gpu ? estimar(info.gpu, info.cuenta, undefined, opc, info.ram) : null;
  const opcionesCambiaron = info != null && !opcionesIguales(opc, info.opciones);
  const capas = info?.cuenta.capasTotal ?? CAPAS_DEFECTO;
  const ramPide = est && valido != null ? ramNecesitaMiB(est, valido) : 0;
  const ramFalta = est?.ram && valido != null && !entraEnRam(est, valido) ? Math.ceil(ramPide - (est.ram.libreMiB - MARGEN_RAM_MIB)) : 0;
  // Si lo que frena es la RAM, liberar VRAM no ayuda.
  const frenaRam = ramFalta > 0;
  const toca = (o: Partial<Opciones>) => setOpcBorrador({ ...opc, ...o });
  // Abre solo si ya hay algo distinto del default: se ve qué rige sin tener que buscarlo.
  const avisible = avAbierto ?? !opcionesIguales(opc, OPCIONES_DEFECTO);
  // Lo que entra ahora (con lo que ya corre) y lo que entra dejando lugar a Handy y al TTS por si cargan.
  const maxAhora = est?.maxCtxSinReservas ?? 0;
  const pasa = est && valido != null && valido > maxAhora;
  const sinLugar = est && valido != null && !pasa && est.reservas.length > 0 && valido > est.maxCtx;
  const lista = est?.reservas.map((r) => r.nombre).join(", ") ?? "";
  const chip = guardado != null ? t("ctxl.chip", { k: kilo(guardado) }) : "—";
  const tip = t("ctxl.chipTip", { k: guardado != null ? kilo(guardado) : "—" });

  const ocupado = fase !== "libre";
  const guardar = async () => {
    if (!info || valido == null || ocupado) return;
    setFase("guardando");
    setNota(null);
    try {
      setEstado(await fuente.guardarLocal(modelo, valido, opc));
      setBorrador(null);
      setOpcBorrador(null);
      setNota({ tipo: "ok", texto: t("ctxl.guardado") });
    } catch (e) {
      setNota({ tipo: "error", texto: mensaje(e) });
    } finally {
      setFase("libre");
    }
  };
  const probar = async () => {
    if (!info || valido == null || ocupado) return;
    setFase("probando");
    setNota(null);
    try {
      // El main corta la carga a los 330 s (`PROBAR_ESPERA_MS`); esto cubre que la respuesta no llegue nunca (el motor se reinició):
      // el botón nunca se queda en "Cargando…" para siempre.
      let tope: ReturnType<typeof setTimeout> | undefined;
      const sinRespuesta = new Promise<never>((_, mal) => {
        tope = setTimeout(() => mal(new Error(t("ctxl.noContesto", { min: TOPE_MIN }))), TOPE_MIN * 60_000);
      });
      const r: ResultadoProbar = await Promise.race([fuente.probarLocal(modelo, valido, opc), sinRespuesta]).finally(() => clearTimeout(tope));
      if (r.ok) {
        setNota({ tipo: "ok", texto: t("ctxl.ok", { k: kilo(valido), usado: gb(r.usadoMiB ?? 0), total: gb(r.total ?? 0) }) });
        setBorrador(null);
        setOpcBorrador(null);
      } else setNota({ tipo: "error", texto: textoMain(r.error ?? "") });
      leer();
    } catch (e) {
      setNota({ tipo: "error", texto: mensaje(e) });
    } finally {
      setFase("libre");
    }
  };

  // "Máximo contexto": la combinación más rápida con la que entra el `-c` más alto del modelo.
  const maximoContexto = () => {
    if (!info?.gpu) return;
    const mejor = mejorCombinacion(info.gpu, info.cuenta, info.ram, info.ctxMax);
    if (!mejor) {
      setNota({ tipo: "error", texto: t("ctxl.maxContextoNo", { k: kilo(info.ctxMax) }) });
      return;
    }
    setBorrador(String(info.ctxMax));
    setOpcBorrador(mejor);
    setAvAbierto(true);
    setNota({ tipo: "ok", texto: t("ctxl.maxContextoListo", { opciones: describirOpciones(mejor) }) });
  };

  // El deslizador pinta hasta dónde entra (verde) y lo que pasa (ámbar): sólo variables de color, nada se anima.
  const rango = info ? info.ctxMax - info.ctxMin : 1;
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - (info?.ctxMin ?? 0)) / rango) * 100));
  const entra = est ? pct(maxAhora || info!.ctxMin) : 0;
  const lleva = valido != null && info ? pct(valido) : 0;

  return (
    <div className="pick ctx-w">
      <button
        ref={boton}
        type="button"
        className="pbtn cl-chip"
        data-tip={abierto ? undefined : tip}
        aria-label={tip}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        onClick={() => setAbierto((a) => !a)}
      >
        <Cpu size={13} aria-hidden="true" />
        <span className="cl-k">{chip}</span>
      </button>
      {abierto ? (
        <>
          <button type="button" className="fondo" tabIndex={-1} aria-label={t("comun.cerrarMenu")} onClick={() => cerrar(false)} />
          <div ref={detalle} id={id} className="ctx-det cl-det" data-lado={lado} role="dialog" aria-label={t("ctxl.titulo")} tabIndex={-1} onKeyDown={tecla}>
            <div className="ctx-h">
              <span>{t("ctxl.titulo")}</span>
              <span className="ctx-pct">{valido != null ? `${kilo(valido)}K` : "—"}</span>
            </div>
            <p className="ctx-relevo">{t("ctxl.ayuda", { modelo: nombre })}</p>
            {!info ? (
              <p className="cl-nota" data-tipo={fallo ? "error" : undefined}>
                {fallo ?? "…"}
              </p>
            ) : (
              <>
                <input
                  type="range"
                  className="cl-rango"
                  aria-label={t("ctxl.deslizador")}
                  min={info.ctxMin}
                  max={info.ctxMax}
                  step={info.paso}
                  value={valido ?? info.ctx}
                  disabled={ocupado}
                  style={{ "--entra": `${entra}%`, "--lleva": `${lleva}%`, "--sin-datos": est ? undefined : "0" } as React.CSSProperties}
                  onChange={(e) => setBorrador(e.target.value)}
                />
                <label className="cl-campo">
                  <span>{t("ctxl.valor")}</span>
                  <input
                    className="cl-num"
                    inputMode="numeric"
                    value={texto}
                    disabled={ocupado}
                    aria-invalid={valido == null}
                    spellCheck={false}
                    onChange={(e) => setBorrador(e.target.value.replace(/[^\d]/g, ""))}
                    onBlur={() => valido != null && borrador != null && setBorrador(String(valido))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void guardar();
                      }
                    }}
                  />
                  {est && maxAhora > 0 ? (
                    <button type="button" className="btn2 cl-max" disabled={ocupado} onClick={() => setBorrador(String(maxAhora))}>
                      {t("ctxl.usarMax", { k: kilo(maxAhora) })}
                    </button>
                  ) : null}
                </label>
                <div className="cl-av">
                  <button type="button" className="cl-av-h" aria-expanded={avisible} aria-controls={idAv} onClick={() => setAvAbierto(!avisible)}>
                    <ChevronRight size={13} aria-hidden="true" className="cl-av-fl" />
                    <span>{t("ctxl.avanzado")}</span>
                    <span className="cl-av-res">{describirOpciones(opc)}</span>
                  </button>
                  {avisible ? (
                    <div id={idAv} className="cl-av-c">
                      {est ? (
                        <button type="button" className="btn2 cl-maxctx" disabled={ocupado} data-tip={t("ctxl.maxContextoQue", { k: kilo(info.ctxMax) })} onClick={maximoContexto}>
                          {t("ctxl.maxContexto", { k: kilo(info.ctxMax) })}
                        </button>
                      ) : null}
                      <label className="cl-op">
                        <input type="checkbox" className="cl-chk" checked={opc.mtp} disabled={ocupado} onChange={(e) => toca({ mtp: e.target.checked })} />
                        <span className="cl-op-t">{t("ctxl.mtp")}</span>
                        <span className="cl-op-a">{t("ctxl.mtpAyuda", { gb: gb(info.cuenta.mtpMiB ?? MTP_MIB_DEFECTO) })}</span>
                      </label>
                      <div className="cl-op" role="group" aria-label={t("ctxl.kv")}>
                        <span className="cl-op-t">{t("ctxl.kv")}</span>
                        <span className="cl-seg">
                          {TIPOS_KV.map((k: TipoKv) => (
                            <button key={k} type="button" className="cl-seg-b" aria-pressed={opc.kv === k} disabled={ocupado} onClick={() => toca({ kv: k })}>
                              {k}
                            </button>
                          ))}
                        </span>
                        <span className="cl-op-a">{t("ctxl.kvAyuda")}</span>
                      </div>
                      <label className="cl-op">
                        <input type="checkbox" className="cl-chk" checked={opc.kvRam} disabled={ocupado} onChange={(e) => toca({ kvRam: e.target.checked })} />
                        <span className="cl-op-t">{t("ctxl.kvRam")}</span>
                        <span className="cl-op-a">{t("ctxl.kvRamAyuda")}</span>
                      </label>
                      <div className="cl-op">
                        <label className="cl-op-t" htmlFor={`${idAv}-ngl`}>
                          {t("ctxl.ngl")}
                        </label>
                        <span className="cl-ngl">
                          <input
                            id={`${idAv}-ngl`}
                            type="range"
                            className="cl-rango"
                            min={0}
                            max={capas}
                            step={1}
                            value={Math.min(opc.ngl, capas)}
                            disabled={ocupado}
                            aria-valuetext={opc.ngl >= capas ? t("ctxl.nglTodas") : t("ctxl.nglDe", { n: opc.ngl, total: capas })}
                            style={{ "--entra": "0%" } as React.CSSProperties}
                            onChange={(e) => toca({ ngl: Number(e.target.value) >= capas ? NGL_TODAS : Number(e.target.value) })}
                          />
                          <span className="cl-ngl-v">{opc.ngl >= capas ? t("ctxl.nglTodas") : t("ctxl.nglDe", { n: opc.ngl, total: capas })}</span>
                        </span>
                        <span className="cl-op-a">{t("ctxl.nglAyuda")}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
                {est ? (
                  <dl>
                    <dt>{maxAhora > 0 ? t("ctxl.entra") : t("ctxl.noEntra", { k: kilo(info.ctxMin) })}</dt>
                    <dd data-tono={maxAhora > 0 ? undefined : "rojo"}>{maxAhora > 0 ? `${kilo(maxAhora)}K` : "—"}</dd>
                    {est.reservas.length ? (
                      <>
                        <dt>{t("ctxl.conLugar", { lista })}</dt>
                        <dd>{est.maxCtx > 0 ? `${kilo(est.maxCtx)}K` : "—"}</dd>
                      </>
                    ) : null}
                  </dl>
                ) : (
                  <p className="cl-nota">{t("ctxl.sinGpu")}</p>
                )}
                {est ? (
                  <p className="cl-det-chico">
                    {t("ctxl.gpu", { otros: gb(est.otrosMiB), total: gb(est.totalMiB) })}
                    <br />
                    {t("ctxl.modelo", { n: gb(est.modeloMiB), kv: est.kvMiBPorK.toFixed(0) })}
                  </p>
                ) : null}
                {est?.ram && (est.ramPesosMiB > 0 || est.ramKvMiBPorK > 0) ? (
                  <p className="cl-nota" data-tipo={frenaRam ? "aviso" : undefined}>
                    {t("ctxl.ram", { usa: gb(ramPide), libre: gb(est.ram.libreMiB) })}
                    {frenaRam ? <> · {t("ctxl.ramNo", { gb: gb(ramFalta) })}</> : null}
                  </p>
                ) : null}
                {pasa ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.pasaDeLoQueEntra")}</p> : null}
                {sinLugar ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.sinLugar", { lista })}</p> : null}
                {est && (pasa || maxAhora === 0) && !frenaRam ? <LiberarVram est={est} info={info} pedido={valido} alLiberar={leer} /> : null}
                {info.dsh != null && info.dsh !== info.ctx ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.dshDistinto", { n: kilo(info.dsh) })}</p> : null}
                {info.ctxFijo != null ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.unitFija", { k: kilo(info.ctxFijo) })}</p> : null}
                <div className="cl-acc" aria-busy={fase === "probando"}>
                  <button type="button" className="btn2" disabled={valido == null || ocupado} data-tip={t("ctxl.probarQue", { modelo: nombre })} onClick={probar}>
                    {fase === "probando" ? t("ctxl.probando") : t("ctxl.probar")}
                  </button>
                  <button type="button" className="btn2 cl-guardar" disabled={valido == null || ocupado || (valido === guardado && !opcionesCambiaron)} onClick={guardar}>
                    {fase === "guardando" ? t("ctxl.guardando") : t("ctxl.guardar")}
                  </button>
                </div>
                {nota ? (
                  <p className="cl-nota" data-tipo={nota.tipo} role={nota.tipo === "error" ? "alert" : "status"}>
                    {nota.tipo === "ok" ? <Check size={13} aria-hidden="true" /> : null}
                    <span>{nota.texto}</span>
                  </p>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
