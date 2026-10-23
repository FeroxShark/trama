// El contexto (`-c` de llama-server) de un modelo local: un botón en la caja, junto al esfuerzo, que abre el mismo tipo de
// detalle que el anillo de contexto (`.ctx-det`). Un deslizador y un campo para el número, la cuenta de cuánto entra en la
// VRAM (estimada: electron/locales-calc.ts), qué se puede liberar si no entra (LiberarVram.tsx), "Probar" (carga el modelo de verdad, sólo con el clic) y Guardar.
// Esc o clic afuera lo cierra. Sin animaciones propias: se abre con la misma `abre` de los demás detalles.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Cpu } from "lucide-react";
import { ctxValido } from "../../electron/locales-calc";
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

/** Minutos que la vista espera a Probar antes de soltar el botón (un poco más que el tope del main). */
const TOPE_MIN = 6;

type Props = {
  /** El id de la tabla (`qwen-local`). */
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
  const [fase, setFase] = useState<"libre" | "guardando" | "probando">("libre");
  const [nota, setNota] = useState<Nota | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const detalle = useRef<HTMLDivElement>(null);
  const id = useId();

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
  const est = info?.est ?? null;
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
      setEstado(await fuente.guardarLocal(modelo, valido));
      setBorrador(null);
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
      const r: ResultadoProbar = await Promise.race([fuente.probarLocal(modelo, valido), sinRespuesta]).finally(() => clearTimeout(tope));
      if (r.ok) {
        setNota({ tipo: "ok", texto: t("ctxl.ok", { k: kilo(valido), usado: gb(r.usadoMiB ?? 0), total: gb(r.total ?? 0) }) });
        setBorrador(null);
      } else setNota({ tipo: "error", texto: textoMain(r.error ?? "") });
      leer();
    } catch (e) {
      setNota({ tipo: "error", texto: mensaje(e) });
    } finally {
      setFase("libre");
    }
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
                {pasa ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.pasaDeLoQueEntra")}</p> : null}
                {sinLugar ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.sinLugar", { lista })}</p> : null}
                {est && (pasa || maxAhora === 0) ? <LiberarVram est={est} info={info} pedido={valido} alLiberar={leer} /> : null}
                {info.dsh != null && info.dsh !== info.ctx ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.dshDistinto", { n: kilo(info.dsh) })}</p> : null}
                {info.ctxFijo != null ? <p className="cl-nota" data-tipo="aviso">{t("ctxl.unitFija", { k: kilo(info.ctxFijo) })}</p> : null}
                <div className="cl-acc" aria-busy={fase === "probando"}>
                  <button type="button" className="btn2" disabled={valido == null || ocupado} data-tip={t("ctxl.probarQue", { modelo: nombre })} onClick={probar}>
                    {fase === "probando" ? t("ctxl.probando") : t("ctxl.probar")}
                  </button>
                  <button type="button" className="btn2 cl-guardar" disabled={valido == null || ocupado || valido === guardado} onClick={guardar}>
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
