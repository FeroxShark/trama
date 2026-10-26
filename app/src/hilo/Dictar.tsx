// El botón de dictar de la caja del líder (docs/estado/dictado.md): al lado de Mandar. Apretás y graba (contador
// de tiempo, tope de 5 min); apretás de nuevo y el audio, ya en WAV 16 kHz mono (src/hilo/dictado.ts), va al motor
// por el RPC de siempre (`fuente.dictar`, Handy en la máquina del motor). El texto se AGREGA al borrador de la caja
// de donde se empezó, no se manda solo. Si falla, la grabación queda acá: Reintentar o Descartar, nunca se pierde
// callada. Por http (el celular en la tailnet) el navegador no deja usar el micrófono: el botón se ve apagado y dice por qué.
import { LoaderCircle, Mic, RotateCcw, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { esAngosto } from "../angosto";
import { latir } from "../barra/latido";
import { fuente } from "../datos/fuente";
import { t as tr } from "../i18n";
import { MODO } from "../modo";
import { leerBorrador, llenarBorrador } from "./borradores";
import { aWav, agregarDictado, empezar, ErrorDictado, MINIMO_S, reloj, soporte, TOPE_S, type Grabacion } from "./dictado";

type Fase = "libre" | "pidiendo" | "grabando" | "transcribiendo" | "error";

type Props = {
  /** La caja (borrador) a la que va lo dictado: la de donde se empezó a grabar. */
  clave: string;
  /** Un aviso que es un error (rojo) o nada. */
  alError: (m: string | null) => void;
  /** Un aviso que no es un error. */
  alNota: (m: string | null) => void;
  /** Ya está el texto en la caja de `clave`. */
  alListo: (clave: string) => void;
};

export function Dictar({ clave, alError, alNota, alListo }: Props) {
  // Las capturas (`lider-dictado`) fuerzan un estado: no hay micrófono ni Handy en una ventana de prueba.
  const forzada = MODO.captura === "lider-dictado" ? (MODO.variante ?? "libre") : null;
  const sop = forzada ? (forzada === "inseguro" ? "inseguro" : "si") : soporte();
  const [fase, setFase] = useState<Fase>(forzada === "grabando" || forzada === "transcribiendo" || forzada === "error" ? forzada : "libre");
  const [seg, setSeg] = useState(forzada === "grabando" ? 47 : 0);
  const grabando = useRef<{ g: Grabacion; desde: number; clave: string } | null>(null);
  /** Lo grabado que todavía no tiene texto: sigue acá si Handy falló. */
  const guardado = useRef<{ datos: Uint8Array; clave: string } | null>(null);
  const alListoRef = useRef(alListo);
  alListoRef.current = alListo;

  useEffect(() => {
    if (forzada !== "error") return;
    alError(tr("dictado.error", { motivo: tr("main.dictadoFalla", { motivo: "handy exited with code 1" }) }));
  }, []);

  // El contador y el tope: sólo mientras graba.
  useEffect(() => {
    if (fase !== "grabando" || forzada) return;
    const id = setInterval(() => {
      const g = grabando.current;
      if (!g) return;
      const s = (performance.now() - g.desde) / 1000;
      if (s >= TOPE_S) void parar(true);
      else setSeg(Math.floor(s));
    }, 250);
    return () => clearInterval(id);
  }, [fase]);

  // El punto que late y el aro que gira los mueve latido.ts (nada de animaciones CSS infinitas).
  useEffect(() => {
    if (fase === "grabando" || fase === "transcribiendo") latir();
  }, [fase]);

  // Si la caja se va con el micrófono abierto, se suelta.
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      grabando.current?.g.cancelar();
      grabando.current = null;
    };
  }, []);

  const mala = (e: unknown) => {
    setFase("libre");
    alError(tr(e instanceof ErrorDictado ? (e.clave as "dictado.sinAcceso") : "dictado.sinAcceso"));
  };

  const empezarAhora = async () => {
    alError(null);
    alNota(null);
    setFase("pidiendo");
    try {
      const g = await empezar();
      // La caja se fue mientras esperaba el permiso: el micrófono recién abierto se suelta ya.
      if (!vivo.current) return g.cancelar();
      grabando.current = { g, desde: performance.now(), clave };
      setSeg(0);
      setFase("grabando");
    } catch (e) {
      if (vivo.current) mala(e);
    }
  };

  const transcribir = async () => {
    const dato = guardado.current;
    if (!dato) return setFase("libre");
    setFase("transcribiendo");
    alError(null);
    // Angosto: el botón sólo tiene el aro, el texto va debajo de la caja.
    if (esAngosto()) alNota(tr("dictado.transcribiendo"));
    try {
      const texto = await fuente.dictar(dato.datos);
      guardado.current = null;
      alNota(null);
      llenarBorrador(dato.clave, agregarDictado(leerBorrador(dato.clave).texto, texto));
      setFase("libre");
      alListoRef.current(dato.clave);
    } catch (e) {
      setFase("error");
      alNota(null);
      alError(tr("dictado.error", { motivo: (e as Error).message }));
    }
  };

  const parar = async (tope = false) => {
    const g = grabando.current;
    if (!g) return;
    grabando.current = null;
    const s = (performance.now() - g.desde) / 1000;
    setFase("transcribiendo");
    try {
      const blob = await g.g.parar();
      if (s < MINIMO_S) {
        setFase("libre");
        return alNota(tr("dictado.corto"));
      }
      if (tope) alNota(tr("dictado.tope"));
      guardado.current = { datos: await aWav(blob), clave: g.clave };
    } catch (e) {
      return mala(e);
    }
    await transcribir();
  };

  const descartar = () => {
    guardado.current = null;
    alError(null);
    setFase("libre");
  };

  const clic = () => {
    if (forzada) return;
    if (sop !== "si") return alNota(tr(sop === "inseguro" ? "dictado.inseguro" : "dictado.sinSoporte"));
    if (fase === "libre") void empezarAhora();
    else if (fase === "grabando") void parar();
    else if (fase === "error") void transcribir();
  };

  const apagado = sop !== "si" || fase === "pidiendo" || fase === "transcribiendo";
  const tip =
    sop === "inseguro" ? tr("dictado.inseguro") : sop === "sin" ? tr("dictado.sinSoporte") : fase === "grabando" ? tr("dictado.parar") : fase === "error" ? tr("dictado.reintentarTip") : tr("dictado.dictar");
  const nombre = fase === "grabando" ? `${tr("dictado.parar")} (${reloj(seg)})` : fase === "transcribiendo" ? tr("dictado.transcribiendo") : fase === "error" ? tr("dictado.reintentar") : tr("dictado.dictar");

  return (
    <div className="dic" data-fase={fase} data-sop={sop === "si" ? undefined : sop}>
      {fase === "error" ? (
        <button type="button" className="clip" aria-label={tr("dictado.descartar")} data-tip={tr("dictado.descartar")} onMouseDown={(e) => e.preventDefault()} onClick={descartar}>
          <X size={13} strokeWidth={2} />
        </button>
      ) : null}
      <button
        type="button"
        className="dic-b"
        data-fase={fase}
        aria-label={nombre}
        aria-disabled={apagado || undefined}
        aria-busy={fase === "pidiendo" || fase === "transcribiendo" || undefined}
        data-tip={tip}
        onMouseDown={(e) => e.preventDefault()}
        // Apagado por falta de contexto seguro: tocarlo explica el motivo (en el celular no hay hover).
        onClick={() => (sop !== "si" || !apagado) && clic()}
      >
        {fase === "grabando" ? (
          <>
            <span className="dic-punto late" aria-hidden />
            <span className="dic-t" aria-hidden>
              {reloj(seg)}
            </span>
            <Square size={11} strokeWidth={0} fill="currentColor" aria-hidden />
          </>
        ) : fase === "transcribiendo" ? (
          <>
            <LoaderCircle className="gira" size={13} strokeWidth={2.2} aria-hidden />
            <span className="dic-t">{tr("dictado.transcribiendo")}</span>
          </>
        ) : fase === "error" ? (
          <>
            <RotateCcw size={13} strokeWidth={2} aria-hidden />
            <span className="dic-t">{tr("dictado.reintentar")}</span>
          </>
        ) : (
          <Mic size={14} strokeWidth={2} aria-hidden />
        )}
      </button>
    </div>
  );
}
