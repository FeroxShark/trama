// La pastilla arriba de la caja de escribir: lo que el líder dejó corriendo de fondo. Así se distingue "terminó" de "terminó su turno y
// espera algo". Tocándola, la lista con cada tarea y hace cuánto corre. No ocupa nada si no hay ninguna.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import type { Mensaje } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { MODO } from "../modo";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { duracion } from "../tiempo";
import { tareasDeFondo, type SalidaTarea, type TareaFondo } from "./fondo-logica";
import { alScroll, bajar, seguidor, seguir } from "./seguir";
import "./fondo-pastilla.css";

const MIRAR_MS = 15_000;
/** Cada cuánto se vuelve a leer el final de la salida de una tarea desplegada (sólo con la vista a la vista; plegada o desmontada no se lee). */
const SALIDA_MS = 2000;

const hace = (x: TareaFondo, ahora: number) => (x.desde === null ? null : duracion(Math.max(0, Math.round((ahora - x.desde) / 1000))));

/**
 * Las últimas líneas de lo que escribe una tarea. Existe sólo mientras la tarea está desplegada: al plegar, al desmontarse la vista o al
 * terminar la tarea (sale de la lista) el efecto se va y con él la lectura. Sin ruta, o sin archivo todavía, una línea corta.
 */
function Salida({ ruta, que }: { ruta: string | null; que: string }) {
  const [sal, setSal] = useState<SalidaTarea | null>(null);
  const caja = useRef<HTMLPreElement>(null);
  const seg = useRef(seguidor()).current;
  useEffect(() => {
    if (!ruta) return;
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const paso = async () => {
      espera = undefined;
      // Con la ventana escondida no se lee; `visibilitychange` retoma.
      if (document.hidden) return;
      const r = await fuente.tareaSalida(ruta).catch(() => null);
      if (!vivo) return;
      setSal((p) => (p && r && p.texto === r.texto && p.recortado === r.recortado ? p : r));
      espera = setTimeout(paso, SALIDA_MS);
    };
    const volvio = () => {
      if (!document.hidden && vivo && espera === undefined) void paso();
    };
    document.addEventListener("visibilitychange", volvio);
    void paso();
    return () => {
      vivo = false;
      if (espera !== undefined) clearTimeout(espera);
      document.removeEventListener("visibilitychange", volvio);
    };
  }, [ruta]);
  const texto = sal?.texto ?? "";
  const hay = texto.trim() !== "";
  const primera = useRef(true);
  useLayoutEffect(() => {
    const z = caja.current;
    if (!z) return void (primera.current = true);
    if (primera.current) {
      primera.current = false;
      bajar(z, seg);
    } else seguir(z, seg);
  }, [texto, hay, seg]);
  if (!hay) return <p className="bgt-vacia">{t("fondo.sinSalida")}</p>;
  return (
    <pre className="bgt-s" ref={caja} tabIndex={0} aria-label={t("fondo.salida", { que })} aria-live="off" onScroll={(e) => alScroll(e.currentTarget, seg)}>
      {texto}
    </pre>
  );
}

/** Una fila de la lista: tocarla muestra u oculta la salida en vivo de esa tarea. */
function Fila({ x, ahora, abierta0 }: { x: TareaFondo; ahora: number; abierta0: boolean }) {
  const [abierta, setAbierta] = useState(abierta0);
  const tiempo = hace(x, ahora);
  return (
    <li>
      <button type="button" className="bgt-f" aria-expanded={abierta} aria-label={t("fondo.ver", { que: x.que })} onClick={() => setAbierta((v) => !v)}>
        <ChevronRight className="bgt-c" size={13} strokeWidth={2} aria-hidden="true" />
        <span className="bgt-que">{x.que}</span>
        {tiempo ? <span className="bgt-t">{tiempo}</span> : null}
      </button>
      {x.comando && x.comando !== x.que ? <code>{x.comando}</code> : null}
      {abierta ? <Salida ruta={x.salida} que={x.que} /> : null}
    </li>
  );
}

export const Fondo = memo(function Fondo({ mensajes }: { mensajes: readonly Mensaje[] }) {
  useIdioma();
  const tareas = useMemo(() => tareasDeFondo(mensajes), [mensajes]);
  // Captura `lider-imagenes` con `HILOS_VARIANTE=fondo-abierto`: la lista y la salida de la primera tarea ya desplegadas.
  const [abierta, setAbierta] = useState(() => MODO.variante === "fondo-abierto");
  const [ahora, setAhora] = useState(() => Date.now());
  const hay = tareas.length > 0;
  useEffect(() => {
    if (!hay) return;
    setAhora(Date.now());
    const iv = setInterval(() => setAhora(Date.now()), MIRAR_MS);
    return () => clearInterval(iv);
  }, [hay]);
  if (!hay) return null;
  const primera = tareas[0];
  const tiempo = hace(primera, ahora);
  return (
    <div className="bgt">
      <button type="button" className="bgt-p" aria-expanded={abierta} onClick={() => setAbierta((x) => !x)}>
        <LoaderCircle className="bgt-gira" size={13} strokeWidth={2} aria-hidden="true" />
        <span className="bgt-n">{t("fondo.cuantas", { n: tareas.length })}</span>
        <span className="bgt-que">{primera.que}</span>
        {tiempo ? <span className="bgt-t">{tiempo}</span> : null}
        <ChevronDown className="bgt-v" size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {abierta ? (
        <ul className="bgt-l">
          {tareas.map((x, i) => (
            <Fila key={x.id} x={x} ahora={ahora} abierta0={MODO.variante === "fondo-abierto" && i < 2} />
          ))}
        </ul>
      ) : null}
    </div>
  );
});
