// Los subagentes de una sesión, colgando bajo su fila como un worker: descripción, modelo, estado, cuánto lleva,
// lo último que hizo en una linea y sus tokens. Al terminar, las primeras lineas de su informe y "Ver informe".
// Tocar la tarjeta abre sus pasos en la vista grande (como un worker, src/hilo/Subagente.tsx); la flecha despliega el resumen.
import { memo, useContext, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Subagente } from "../../electron/subagentes";
import { fuente } from "../datos/fuente";
import { t as tr } from "../i18n";
import { locale } from "../i18n/index";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { pintorDura, pintorHace } from "../tiempo";
import { Punto, Reloj } from "./piezas";
import { activo, archivarSub, archivarTodosSubs, claveSub, pintaSub, SubAbierto, useSubagentes } from "./subagentes-logica";

const compacto = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);

const Fila = memo(function Fila({ u, vivo, activa, alAbrir }: { u: Subagente; vivo: boolean; activa: boolean; alAbrir: ((sid: string, id: string) => void) | null }) {
  useIdioma();
  const [abierto, setAbierto] = useState(false);
  const [entero, setEntero] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const dura = useMemo(() => pintorDura(u.inicio), [u.inicio]);
  const hace = useMemo(() => pintorHace(u.ultimo_en), [u.ultimo_en]);
  const { tipo, clave } = pintaSub(u, vivo);
  const estado = tr(clave);
  const linea = u.estado === "terminado" ? (u.resultado?.split("\n").find((x) => x.trim()) ?? u.ultimo) : u.ultimo;
  const cuerpo = entero ?? (u.estado === "terminado" ? u.resultado : u.ultimo);
  const verInforme = () => {
    if (pidiendo) return;
    setPidiendo(true);
    void fuente.subagenteInforme(u.sid, u.id).then(
      (x) => {
        setEntero(x ?? u.resultado ?? "");
        setPidiendo(false);
      },
      () => setPidiendo(false),
    );
  };
  return (
    <li className="w sub" data-estado={vivo || u.estado !== "corriendo" ? u.estado : "obsoleto"} data-sub={u.id} data-activa={activa ? "" : undefined}>
      <div className="sub-cab">
        <button
          type="button"
          className="sub-fila"
          aria-current={activa ? "true" : undefined}
          data-tip={alAbrir ? tr("sub.abrirTip") : undefined}
          onClick={() => (alAbrir ? alAbrir(u.sid, u.id) : setAbierto((a) => !a))}
        >
          <span className="sub-pt">
            <Punto tipo={tipo} clave={`sub:${u.id}`} />
          </span>
          <span className="sub-txt">
            <span className="sub-t">
              <span className="sub-desc">{u.descripcion}</span>
              {u.modelo ? <span className="sub-modelo">{u.modelo}</span> : null}
            </span>
            <span className="sub-s">
              <span className={`sub-estado c-${tipo}`}>{estado}</span>
              {vivo ? <Reloj pintor={dura} className="sub-dura" /> : <Reloj pintor={hace} className="sub-dura" />}
              {u.tokens > 0 ? <span className="sub-tok">{tr("sub.tokens", { n: compacto(u.tokens) })}</span> : null}
              {!abierto && linea ? <span className="sub-ultimo">{linea}</span> : null}
            </span>
          </span>
        </button>
        {!vivo ? (
          <span className="acc sub-acc">
            <button
              type="button"
              className="mini"
              data-cerrar="archivar"
              data-tip={tr("accion.archivarTip")}
              onClick={(e) => {
                e.stopPropagation();
                archivarSub(u.sid, u.id);
              }}
            >
              {tr("accion.archivar")}
            </button>
          </span>
        ) : null}
        <button type="button" className="sub-plegar" aria-expanded={abierto} aria-label={tr(abierto ? "sub.plegar" : "sub.desplegar")} onClick={() => setAbierto((a) => !a)}>
          <ChevronDown className="chevron" size={11} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {abierto ? (
        <div className="sub-cuerpo">
          {cuerpo ? <pre className="sub-informe">{cuerpo}</pre> : <p className="sub-vacio">{tr("sub.sinTexto")}</p>}
          <div className="sub-pie-acciones">
            {u.estado === "terminado" && u.hay_mas && entero === null ? (
              <button type="button" className="sub-ver" onClick={verInforme} disabled={pidiendo}>
                tr(pidiendo ? "sub.cargando" : "sub.verInforme")
              </button>
            ) : null}
            {!vivo ? (
              <button
                type="button"
                className="sub-archivar mini"
                data-cerrar="archivar"
                data-tip={tr("accion.archivarTip")}
                onClick={() => archivarSub(u.sid, u.id)}
              >
                {tr("accion.archivar")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
});

export const Subagentes = memo(function Subagentes({ sid }: { sid: string }) {
  useIdioma();
  const lista = useSubagentes(sid);
  const sub = useContext(SubAbierto);
  const alAbrir = sub?.abrir ?? null;
  const [desplegado, setDesplegado] = useState(() => MODO.captura === "subagentes" && MODO.variante === "abierto");
  const { vivos, cerrados } = useMemo(() => {
    const ahora = Math.floor(Date.now() / 1000);
    const v = lista.filter((u) => activo(u, ahora));
    const c = lista.filter((u) => !activo(u, ahora)).sort((a, b) => b.ultimo_en - a.ultimo_en);
    return { vivos: v, cerrados: c };
  }, [lista]);

  if (!lista.length) return null;

  return (
    <ul className="ramas subs" aria-label={tr("sub.lista")} data-subs={sid}>
      {vivos.map((u) => (
        <Fila key={u.id} u={u} vivo activa={sub?.abierta === claveSub(u.sid, u.id)} alAbrir={alAbrir} />
      ))}
      {cerrados.length > 0 ? (
        <li key="pliegue" className="w pliegue" data-abierto={desplegado ? "" : undefined}>
          <button
            type="button"
            className="mini-pliegue"
            aria-expanded={desplegado}
            onClick={() => setDesplegado((x) => !x)}
          >
            {desplegado
              ? tr("barra.ocultarTerminados")
              : tr(cerrados.length === 1 ? "barra.terminado1" : "barra.terminadosN", { n: cerrados.length })}
            <ChevronDown className="chevron" size={11} strokeWidth={2} />
          </button>
          <span className="acc pliegue-acc">
            <button
              type="button"
              className="mini"
              data-cerrar="archivar"
              data-tip={tr("sub.archivarTodosTip")}
              onClick={(e) => {
                e.stopPropagation();
                archivarTodosSubs(sid);
              }}
            >
              {tr("accion.archivar")}
            </button>
          </span>
        </li>
      ) : null}
      {desplegado
        ? cerrados.map((u) => (
          <Fila key={u.id} u={u} vivo={false} activa={sub?.abierta === claveSub(u.sid, u.id)} alAbrir={alAbrir} />
        ))
        : null}
    </ul>
  );
});
