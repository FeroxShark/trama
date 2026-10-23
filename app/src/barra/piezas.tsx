// Piezas chicas compartidas: el span del reloj y los puntos de estado.
import { useEffect, useLayoutEffect, useRef, type HTMLAttributes } from "react";
import type { Estado, Hilo } from "../datos/contrato";
import { t, type ClaveSola } from "../i18n";
import { suscribir, type Pintor } from "../reloj";
import { arrancando } from "./arbol";
import { latir } from "./latido";

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** Texto que cambia con el tiempo. Lo escribe el reloj compartido, no React: `pintor` tiene que ser estable. */
export function Reloj({ pintor, ...resto }: { pintor: Pintor } & HTMLAttributes<HTMLSpanElement>) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => suscribir(ref.current!, pintor), [pintor]);
  return <span ref={ref} {...resto} />;
}

/** Cómo se ve cada estado activo: la palabra, su color y qué punto lleva. */
export type Tipo = "trab" | "nec" | "term" | "trabado" | "fallo" | "frenado" | "cola";

// `texto` es un getter: dice la palabra en el idioma de ahora.
const tipo = (tipo: Tipo, clave: ClaveSola) => ({
  tipo,
  get texto() {
    return t(clave);
  },
});

export const TIPO: Partial<Record<Estado, { tipo: Tipo; readonly texto: string }>> = {
  trabajando: tipo("trab", "estado.trabajando"),
  decision: tipo("nec", "estado.decision"),
  listo: tipo("term", "estado.termino"),
  entregado: tipo("term", "estado.termino"),
  colgado: tipo("trabado", "estado.trabado"),
  murio: tipo("fallo", "estado.fallo"),
};

/** Un worker que frenó `pa --parar` a propósito: lo lista como `murio`, pero no es un fallo (apagado, sin rojo). */
const FRENADO = tipo("frenado", "estado.frenado");

/** Esperando puesto o lugar (`en_cola`): `pa --hilos` lo lista `trabajando`, pero no trabaja todavía. Quieto, sin onda ni frase. */
const COLA = tipo("cola", "estado.enCola");
/** Murió en la cola sin llegar a arrancar: no hay tarea que mostrar ni nada que se haya hecho. */
const NO_ARRANCO = tipo("fallo", "estado.noArranco");

type ParaTipo = Pick<Hilo, "frenado_en"> & Partial<Pick<Hilo, "en_cola" | "sin_arrancar">>;

/** El tipo de una fila: el de su estado, salvo `murio` frenado a propósito o sin arrancar, y `trabajando` en cola. */
export const tipoDe = (h: ParaTipo, estado: Estado) =>
  estado === "murio" ? (h.frenado_en != null ? FRENADO : h.sin_arrancar ? NO_ARRANCO : TIPO[estado]) : estado === "trabajando" && h.en_cola ? COLA : TIPO[estado];

/** La palabra del estado; en cola, con su motivo ("En cola · tope global: 5 workers vivos"). */
export const textoEstado = (h: ParaTipo & Pick<Hilo, "cola_motivo">, estado: Estado): string | undefined => {
  const x = tipoDe(h, estado);
  return x && x.tipo === "cola" && h.cola_motivo ? `${x.texto} · ${h.cola_motivo}` : x?.texto;
};

const CIERRES = {
  integrado: "cierre.integrado",
  archivado: "cierre.archivado",
  descartado: "cierre.descartado",
  revertido: "cierre.revertido",
} as const satisfies Partial<Record<Estado, ClaveSola>>;

/** Lo ya cerrado, con la palabra de cómo se cerró (`undefined` si no está cerrado). */
/**
 * La tarea de un hilo; sin tarea, "Arrancando…" si recién lo lanzaron (`arrancando`: `pa` todavía no escribió
 * sus datos) o el texto de "No task". Se resuelve al pintar, en el idioma de ahora, no al leer la lista.
 */
export const tareaDe = (h: Pick<Hilo, "tarea" | "estado" | "rama" | "inicio" | "arrancando" | "en_cola" | "sin_arrancar">) =>
  h.tarea ||
  (arrancando(h, Math.floor(Date.now() / 1000))
    ? t("comun.arrancando")
    : h.sin_arrancar
      ? t("comun.sinArrancar")
      : h.en_cola
        ? t("estado.enCola")
        : t("comun.sinTarea"));

export const cierre = (e: Estado): string | undefined => (e in CIERRES ? t(CIERRES[e as keyof typeof CIERRES]) : undefined);

// Los puntos que ya hicieron su entrada (pop, sacudida): al volver a montarse
// (colapsar, buscar) aparecen quietos.
const entraron = new Set<string>();

/**
 * El punto de estado de una fila. Trabajando: doble onda y latido. Te
 * necesita: halo que respira. Terminó: pop al aparecer. Trabado: anillo
 * punteado que gira. Falló: sacudida al aparecer. Lo que no termina lo mueve
 * `latido.ts`; pop y sacudida son CSS de una sola vez.
 */
export function Punto({ tipo, clave }: { tipo: Tipo; clave: string }) {
  const sinFin = tipo === "trab" || tipo === "nec" || tipo === "trabado";
  useEffect(() => {
    if (sinFin) latir();
  }, [sinFin]);
  const id = `${clave}:${tipo}`;
  const visto = entraron.has(id);
  useEffect(() => {
    // Recién cuando la entrada terminó: si se desmonta antes, la próxima la repite.
    const t = window.setTimeout(() => entraron.add(id), 1100);
    return () => clearTimeout(t);
  }, [id]);

  switch (tipo) {
    case "trab":
      return (
        <>
          <span className="onda" />
          <span className="onda" data-b="" />
          <span className="pt pt-trab late" />
        </>
      );
    case "nec":
      return (
        <>
          <span className="halo" />
          <span className="pt pt-nec late" data-lento="" />
        </>
      );
    case "term":
      return <span className="pt pt-term" data-visto={visto ? "" : undefined} />;
    case "trabado":
      return <span className="pt pt-trabado gira" />;
    case "fallo":
      return <span className="pt pt-fallo" data-visto={visto ? "" : undefined} />;
    case "frenado":
      return <span className="pt pt-frenado" />;
    case "cola":
      return <span className="pt pt-cola" />;
  }
}
