// Ajustes > Actualizaciones fuera de Windows (Linux, el celular): la versión de Trama y "Buscar actualizaciones" (consulta ya a GitHub,
// sin esperar el reloj). Es la misma forma que la de Windows (AjustesCarcasa.tsx), pero sin "Quitar restos". Si hay una nueva, la barra
// la avisa sola con su Actualizar (el evento `trama:version`); acá sólo se muestra el resultado de esa consulta.
import { useEffect, useId, useState } from "react";
import { version as VERSION_TRAMA } from "../../package.json";
import { fuente, type BuscadaTrama, type EstadoActTrama } from "../datos/fuente";
import { MODO } from "../modo";
import { t } from "../i18n";
import { Avance } from "../ui/Avance";
import { IcAtencion, IcOk, ICONO } from "../ui/iconos";
import type { FilaDato } from "./AjustesEditar";
import { DIAS_SALUD, resumirSalud, type ResumenSalud } from "./salud-resumen";
import "./salud-ajustes.css";

type Estado = { paso: "quieta" } | { paso: "buscando" } | { paso: "resultado"; r: BuscadaTrama };

// Las capturas (`HILOS_VARIANTE=trama-al-dia|trama-nueva`) arrancan con el resultado ya puesto: el botón no hace falta.
const estadoInicial = (): Estado => {
  if (MODO.captura !== "ajustes") return { paso: "quieta" };
  if (MODO.variante === "trama-al-dia") return { paso: "resultado", r: { ultima: VERSION_TRAMA, nueva: false } };
  if (MODO.variante === "trama-nueva") return { paso: "resultado", r: { ultima: "0.2.16", nueva: true } };
  return { paso: "quieta" };
};

function textoBusqueda(e: Estado): string {
  if (e.paso === "quieta") return "";
  if (e.paso === "buscando") return t("carcasa.buscando");
  if (!e.r.ultima) return t("ajustes.tramaNoSe");
  return e.r.nueva ? t("ajustes.tramaNueva", { v: e.r.ultima }) : t("carcasa.alDia", { v: VERSION_TRAMA });
}

export function TramaActualizaciones({ Dato }: { Dato: FilaDato }) {
  const [estado, setEstado] = useState<Estado>(estadoInicial);
  const buscar = () => {
    setEstado({ paso: "buscando" });
    void fuente.buscarTrama().then(
      (r) => setEstado({ paso: "resultado", r }),
      () => setEstado({ paso: "resultado", r: { ultima: null, nueva: false } }),
    );
  };
  // La instalación en curso (la que pidió el aviso de la barra): mientras dure, su avance acá también. El main avisa cada cambio de paso.
  const [act, setAct] = useState<EstadoActTrama>({ fase: "nada" });
  useEffect(() => {
    let vivo = true;
    void fuente.estadoActTrama().then((e) => vivo && setAct(e));
    const baja = fuente.alCambiarActTrama((e) => vivo && setAct(e));
    return () => {
      vivo = false;
      baja();
    };
  }, []);
  return (
    <section className="pn-sec pn-edita">
      <div className="pn-estado pn-car-version">{t("carcasa.version", { v: VERSION_TRAMA })}</div>

      <Dato nombre="carcasa.act" que="ajustes.tramaActQue">
        <div className="pn-car-col">
          {act.fase === "instalando" ? (
            <div className="pn-car-av">
              <Avance estado={act} />
            </div>
          ) : null}
          <div className="pn-acciones-btns">
            <button type="button" className="btn2" disabled={estado.paso === "buscando"} onClick={buscar}>
              {t("carcasa.buscar")}
            </button>
          </div>
          <div className="pn-car-estado" role="status" aria-live="polite" aria-atomic="true">
            {textoBusqueda(estado)}
          </div>
        </div>
      </Dato>
    </section>
  );
}

// Las capturas `salud-abierto` y `salud-bien-abierto` arrancan con el bloque desplegado (plegado es lo normal).
const abiertoInicial = () => MODO.captura === "ajustes" && !!MODO.variante?.startsWith("salud") && MODO.variante.endsWith("-abierto");

/** El título plegado ya dice lo importante: «Todo bien» (con ✓) o cuántas cosas hay para mirar (con ⚠). Nunca sólo el color. */
function textoCosas(r: ResumenSalud): string {
  return r.bien ? t("salud.todoBien") : t(r.cosas === 1 ? "salud.cosa1" : "salud.cosas", { n: r.cosas });
}

/**
 * Ajustes > Actualizaciones > Salud: lo que le pasó a Trama en los últimos 30 días, plegado. Abierto, cuatro renglones con cifra y
 * palabra (o una sola línea «Todo bien»). Los eventos los anota el main (electron/salud-eventos.ts); la cuenta es de salud-resumen.ts.
 */
export function SaludTrama({ Dato }: { Dato: FilaDato }) {
  const [resumen, setResumen] = useState<ResumenSalud | null>(null);
  const [abierto, setAbierto] = useState(abiertoInicial);
  const id = useId();
  useEffect(() => {
    let vivo = true;
    void fuente.saludEventos(DIAS_SALUD).then((e) => vivo && setResumen(resumirSalud(e)), () => vivo && setResumen(resumirSalud([])));
    return () => {
      vivo = false;
    };
  }, []);
  return (
    <section className="pn-sec sal-sec">
      <Dato nombre="salud.titulo" que="salud.tituloQue">
        {resumen ? (
          <button type="button" className="sal-sum" data-bien={resumen.bien || undefined} aria-expanded={abierto} aria-controls={id} onClick={() => setAbierto((a) => !a)}>
            {resumen.bien ? <IcOk {...ICONO} aria-hidden="true" /> : <IcAtencion {...ICONO} aria-hidden="true" />}
            <span>{textoCosas(resumen)}</span>
            <i className="sal-flecha" aria-hidden="true" />
          </button>
        ) : null}
      </Dato>
      {resumen && abierto ? (
        <ul className="sal-lista" id={id} aria-label={t("salud.lista", { dias: DIAS_SALUD })}>
          {resumen.bien ? (
            <li className="sal-fila" data-ok>
              <IcOk {...ICONO} aria-hidden="true" />
              <span>{t("salud.todoBien")}</span>
            </li>
          ) : (
            resumen.renglones.map((r) => (
              <li key={r.id} className="sal-fila" data-ok={r.ok || undefined}>
                {r.ok ? <IcOk {...ICONO} aria-hidden="true" /> : <IcAtencion {...ICONO} aria-hidden="true" />}
                <span>{t(r.clave, r.vars as never)}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </section>
  );
}
