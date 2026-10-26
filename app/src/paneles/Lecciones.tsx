// El aviso "Lecciones por podar" del Tablero: `pa` deja `lecciones.necesita-poda` en el estado del proyecto cuando lecciones.md pasa
// el tope (30 líneas / 3 000 caracteres). Dos salidas: "Podar con un agente" (un líder nuevo con la instrucción de
// `pa <proy> --lecciones-podar`) o "Editar a mano" (un editor simple de lecciones.md que guarda el archivo).
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, Check, PencilLine, X } from "lucide-react";
import { fuente } from "../datos/fuente";
import { fuenteTablero } from "../datos/fuenteTablero";
import { fuentePaneles, type LeccionesPendiente } from "../datos/paneles";
import { effortPara } from "../hilo/elegir";
import { effortsLeidos } from "../hilo/efforts";
import { MODELO_DEFAULT } from "../hilo/opciones";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { pasoLider } from "./PasoLanzar";
import { conTexto } from "./lanzar";
import { medidaLecciones, promptPodar } from "./orquestacion-logica";
import "./lecciones.css";

/** Lo que escribe `pa` en la marca ("34 líneas, 3410 caracteres (tope 30 / 3000)") en el idioma de ahora; si no calza, tal cual. */
const motivoDe = (m: string): string => {
  const x = /^(\d+) líneas, (\d+) caracteres/.exec(m);
  return x ? t("lec.motivo", { l: x[1], c: x[2] }) : m || "—";
};

export function AvisoLecciones() {
  useIdioma();
  const [lista, setLista] = useState<LeccionesPendiente[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const leer = useCallback(() => {
    void fuentePaneles.leccionesPendientes().then(setLista, () => setLista([]));
  }, []);
  useEffect(() => {
    leer();
    // El aviso se actualiza cuando el tablero cambia (el agente poda y la marca se va).
    const soltar = fuenteTablero.alCambiar(leer);
    const iv = window.setInterval(leer, 30_000);
    return () => {
      window.clearInterval(iv);
      soltar();
    };
  }, [leer]);
  useEffect(() => {
    if (MODO.captura === "tablero-lecciones" && MODO.variante === "editor" && lista[0]) setEditando(lista[0].proyecto);
  }, [lista]);

  const podar = (p: LeccionesPendiente) => {
    setHecho(null);
    pasoLider(
      "podar",
      async (e) => {
        const instruccion = await fuentePaneles.textoPoda(p.proyecto);
        await fuente.liderNuevo({ texto: conTexto(promptPodar(instruccion), e.texto), modelo: e.modelo, effort: e.effort });
        setHecho(t("lec.podaLanzada"));
      },
      { modelo: MODELO_DEFAULT, effort: effortPara(MODELO_DEFAULT, effortsLeidos() ?? {}) },
    );
  };

  if (!lista.length && !hecho) return null;
  return (
    <div className="lc">
      {lista.map((p) => (
        <div key={p.proyecto} className="lc-aviso" role="status">
          <div className="lc-t">
            <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            {t("lec.titulo")} · <b>{p.proyecto}</b>
          </div>
          <p className="lc-d">{t("lec.detalle", { proyecto: p.proyecto, motivo: motivoDe(p.motivo) })}</p>
          <div className="lc-acc">
            <button type="button" className="mini pn-primario" data-podar onClick={() => podar(p)}>
              <Bot size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("lec.podar")}
            </button>
            <button type="button" className="mini" data-editar onClick={() => setEditando(p.proyecto)}>
              <PencilLine size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("lec.editar")}
            </button>
          </div>
          {editando === p.proyecto ? (
            <Editor
              proyecto={p.proyecto}
              alCerrar={() => {
                setEditando(null);
                leer();
              }}
            />
          ) : null}
        </div>
      ))}
      {hecho ? (
        <p className="pn-nota lc-ok" role="status">
          <Check size={13} strokeWidth={2} aria-hidden="true" /> {hecho}
        </p>
      ) : null}
    </div>
  );
}

/** Un editor simple de lecciones.md: un texto, la cuenta contra el tope y Guardar. */
function Editor({ proyecto, alCerrar }: { proyecto: string; alCerrar: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let vivo = true;
    fuentePaneles.leerLecciones(proyecto).then(
      (x) => vivo && setTexto(x),
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [proyecto]);
  const m = medidaLecciones(texto ?? "");
  const guardar = async () => {
    if (texto === null || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await fuentePaneles.guardarLecciones(proyecto, texto);
      setOk(true);
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="lc-ed">
      <div className="lc-ed-t">{t("lec.editorTitulo", { proyecto })}</div>
      <textarea
        className="lz-texto lc-area"
        value={texto ?? ""}
        rows={10}
        spellCheck={false}
        disabled={texto === null || guardando}
        placeholder={texto === null && !error ? t("lec.cargando") : ""}
        aria-label={t("lec.editorTitulo", { proyecto })}
        onChange={(e) => {
          setTexto(e.target.value);
          setOk(false);
        }}
      />
      <div className="lc-pie">
        <span className="lc-cuenta" data-pasa={m.pasa ? "" : undefined}>
          {m.pasa ? <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" /> : <Check size={12} strokeWidth={2} aria-hidden="true" />}
          {t("lec.cuenta", { l: m.lineas, c: m.cars })} · {t(m.pasa ? "lec.pasa" : "lec.dentro")}
        </span>
        {ok ? <span className="pn-nota" role="status">{t("lec.guardado")}</span> : null}
        <button type="button" className="mini" onClick={alCerrar}>
          <X size={12} strokeWidth={2} aria-hidden="true" />
          {t("lec.cerrar")}
        </button>
        <button type="button" className="mini pn-primario" data-guardar disabled={texto === null || guardando} onClick={() => void guardar()}>
          {t("lec.guardar")}
        </button>
      </div>
      {error ? <p className="pn-error" role="alert">{error}</p> : null}
    </div>
  );
}
