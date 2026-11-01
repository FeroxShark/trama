// Programar y posponer, desde la caja de un líder (#1792). Un botón junto a Dictar abre un globo con dos cosas:
//  - «Mandar este mensaje más tarde»: lo escrito en la caja sale solo a la hora elegida ("en 30 min", "18:30", "mañana 9:00"), aunque
//    Trama se cierre y se vuelva a abrir: vive en el main, guardado (electron/programados.ts).
//  - «Posponer esta conversación»: se va de la barra y vuelve sola a esa hora, con un aviso.
// Abajo, lo que esta conversación ya tiene programado, con su ✕. La hora se escribe o se toma de un atajo; antes de confirmar se ve
// a qué hora cae («Sale hoy 18:30»), así nunca hay sorpresas. Nada depende del color: cada estado lleva su palabra.
import { CalendarClock, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t as tr } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { cuandoFuturo } from "../tiempo";
import { deLider, leerHora, resumen } from "../programados-logica";
import { useProgramados } from "../programados";
import "./programar.css";

type Props = {
  sid: string;
  nombre: string;
  /** Lo escrito en la caja (lo que se programa). */
  texto: string;
  /** Hay adjuntos o imágenes en la caja: eso no se programa. */
  conAdjuntos: boolean;
  modelo: string;
  effort: string;
  modo?: string;
  /** Ya se programó: quien llama vacía la caja. */
  alProgramado: () => void;
  /** Ya se pospuso: quien llama suelta la conversación (sale de la barra). */
  alPospuesto?: () => void;
  /** Para las capturas: nace abierto. */
  abierto?: boolean;
};

/** Los atajos: etiqueta y el texto de hora que entiende `resolverCuando`. */
const ATAJOS = [
  ["progr.r15", "en 15 min"],
  ["progr.r1h", "en 1 h"],
  ["progr.r3h", "en 3 h"],
  ["progr.rManana", "mañana 9:00"],
] as const;

const aSegundos = (ms: number) => ms / 1000;

/** Un campo de hora con sus atajos y la vista previa de a qué hora cae. */
function Cuando({ id, valor, alCambiar, alEnter }: { id: string; valor: string; alCambiar: (v: string) => void; alEnter: () => void }) {
  return (
    <>
      <div className="pr-atajos" role="group" aria-label={tr("progr.cuando")}>
        {ATAJOS.map(([k, v]) => (
          <button key={k} type="button" className="pr-atajo" data-activo={valor === v ? "" : undefined} aria-pressed={valor === v} onClick={() => alCambiar(v)}>
            {tr(k)}
          </button>
        ))}
      </div>
      <input
        id={id}
        className="pr-campo"
        type="text"
        value={valor}
        placeholder={tr("progr.cuandoAyuda")}
        aria-label={tr("progr.cuando")}
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
        onChange={(e) => alCambiar(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            alEnter();
          }
        }}
      />
    </>
  );
}

export function Programar({ sid, nombre, texto, conAdjuntos, modelo, effort, modo, alProgramado, alPospuesto, abierto: deEntrada = false }: Props) {
  useIdioma();
  const [abierto, setAbierto] = useState(deEntrada);
  const [horaMsg, setHoraMsg] = useState("");
  const [horaPos, setHoraPos] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [haciendo, setHaciendo] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const idMsg = useId();
  const idPos = useId();
  const programados = useProgramados();
  const mios = deLider(programados, sid);
  const [ahora, setAhora] = useState(() => Date.now());

  const cerrar = useCallback(() => setAbierto(false), []);
  useFoco(globo, { activo: abierto, alCerrar: cerrar, devolver: () => boton.current });
  // El globo, pegado al botón (arriba si entra), en un portal para que ningún `overflow` de la caja lo recorte.
  useLayoutEffect(() => {
    if (!abierto || !boton.current || !globo.current) return;
    const r = boton.current.getBoundingClientRect();
    const g = globo.current;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    g.style.maxHeight = `${Math.max(160, Math.max(r.top, vh - r.bottom) - 24)}px`;
    const alto = g.offsetHeight;
    if (alto + 14 <= r.top) {
      g.style.top = "auto";
      g.style.bottom = `${vh - r.top + 6}px`;
    } else {
      g.style.bottom = "auto";
      g.style.top = `${r.bottom + 6}px`;
    }
    const ancho = g.offsetWidth;
    g.style.left = `${Math.max(8, Math.min(r.right - ancho, vw - 8 - ancho))}px`;
  }, [abierto, mios.length, error, nota, horaMsg, horaPos]);
  useEffect(() => {
    if (!abierto) return;
    setAhora(Date.now());
    setError(null);
    setNota(null);
    const afuera = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!globo.current?.contains(n) && !boton.current?.contains(n)) setAbierto(false);
    };
    addEventListener("pointerdown", afuera, true);
    return () => removeEventListener("pointerdown", afuera, true);
  }, [abierto]);

  const mensajeHora = leerHora(horaMsg, ahora);
  const posHora = leerHora(horaPos, ahora);
  const texto1 = texto.trim();
  const sinTexto = !texto1;
  const cuandoTxt = (ms: number) => cuandoFuturo(aSegundos(ms), aSegundos(ahora));

  const programar = async () => {
    if (haciendo || sinTexto || conAdjuntos) return;
    if (!mensajeHora || "error" in mensajeHora) return setError(tr("progr.noEntiendo"));
    setHaciendo(true);
    setError(null);
    try {
      await fuente.programar({ sid, texto: texto1, cuando: mensajeHora.cuando, modelo, effort, nombre, ...(modo ? { modo } : {}) });
      setNota(tr("progr.programado", { cuando: cuandoTxt(mensajeHora.cuando) }));
      setHoraMsg("");
      alProgramado();
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setHaciendo(false);
    }
  };
  const posponer = async () => {
    if (haciendo) return;
    if (!posHora || "error" in posHora) return setError(tr("progr.noEntiendo"));
    setHaciendo(true);
    setError(null);
    try {
      await fuente.posponerLider(sid, posHora.cuando, nombre);
      setAbierto(false);
      alPospuesto?.();
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setHaciendo(false);
    }
  };

  return (
    <>
      <button
        ref={boton}
        type="button"
        className="dic-b pr-boton"
        data-n={mios.length || undefined}
        aria-label={tr("progr.boton")}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        data-tip={tr("progr.boton")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAbierto((x) => !x)}
      >
        <CalendarClock size={14} strokeWidth={2} aria-hidden="true" />
        {mios.length ? <span className="pr-n">{mios.length}</span> : null}
      </button>
      {abierto
        ? createPortal(
            <div ref={globo} className="cmenu pr-globo" role="dialog" aria-label={tr("progr.titulo")} tabIndex={-1}>
              <section className="pr-sec" aria-labelledby={`${idMsg}-t`}>
                <h3 id={`${idMsg}-t`} className="pr-t">{tr("progr.mensajeTit")}</h3>
                {conAdjuntos ? (
                  <p className="pr-n-txt" role="status">{tr("progr.sinAdjuntos")}</p>
                ) : sinTexto ? (
                  <p className="pr-n-txt" role="status">{tr("progr.sinTexto")}</p>
                ) : (
                  <>
                    <p className="pr-cita" title={texto1}>{resumen(texto1)}</p>
                    <Cuando id={idMsg} valor={horaMsg} alCambiar={(v) => (setHoraMsg(v), setError(null))} alEnter={() => void programar()} />
                    <div className="pr-pie">
                      <span className="pr-previa" aria-live="polite">
                        {mensajeHora && "cuando" in mensajeHora ? tr("progr.sale", { cuando: cuandoTxt(mensajeHora.cuando) }) : ""}
                      </span>
                      <button type="button" className="pr-ok" disabled={haciendo || !mensajeHora || "error" in mensajeHora} onClick={() => void programar()}>
                        {tr("progr.programar")}
                      </button>
                    </div>
                  </>
                )}
              </section>
              <section className="pr-sec" aria-labelledby={`${idPos}-t`}>
                <h3 id={`${idPos}-t`} className="pr-t">{tr("progr.posponerTit")}</h3>
                <p className="pr-n-txt">{tr("progr.posponerAyuda")}</p>
                <Cuando id={idPos} valor={horaPos} alCambiar={(v) => (setHoraPos(v), setError(null))} alEnter={() => void posponer()} />
                <div className="pr-pie">
                  <span className="pr-previa" aria-live="polite">
                    {posHora && "cuando" in posHora ? tr("progr.vuelveEn", { cuando: cuandoTxt(posHora.cuando) }) : ""}
                  </span>
                  <button type="button" className="pr-ok" disabled={haciendo || !posHora || "error" in posHora} onClick={() => void posponer()}>
                    {tr("progr.posponer")}
                  </button>
                </div>
              </section>
              {error ? <p className="pr-error" role="alert">{error}</p> : null}
              {nota ? <p className="pr-nota" role="status">{nota}</p> : null}
              {mios.length ? (
                <section className="pr-sec" aria-label={tr("progr.deEsta")}>
                  <h3 className="pr-t">{tr("progr.deEsta")}</h3>
                  <ul className="pr-lista">
                    {mios.map((m) => (
                      <li key={m.id} className="pr-fila" data-error={m.error ? "" : undefined}>
                        <div className="pr-fila-x">
                          <div className="pr-fila-t" title={m.texto}>{resumen(m.texto, 70)}</div>
                          <div className="pr-fila-c">{m.error ? tr("progr.fallo", { e: m.error }) : cuandoTxt(m.cuando)}</div>
                          {m.error ? (
                            <button type="button" className="pr-re" onClick={() => void fuente.programadoReprogramar(m.id, Date.now() + 60_000).catch((e) => setError(mensaje(e)))}>
                              {tr("progr.reintentar")}
                            </button>
                          ) : null}
                        </div>
                        <button type="button" className="avs-d" aria-label={tr("progr.quitar")} data-tip={tr("progr.quitar")} onClick={() => void fuente.programadoQuitar(m.id)}>
                          <X size={12} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
