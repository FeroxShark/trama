// Dos momentos de un líder que no son una herramienta más (B19): compactar
// ("Compactando conversación…", tres hojas que se pliegan como un fuelle) y
// pasar la posta a un líder nuevo (`bin/relevo`: un testimonio que cruza de un
// punto al otro). Lo continuo lo mueve `latido.ts` (clases `pliega`, `posta`,
// `brillo`): nada de animaciones CSS infinitas. La conversación de verdad no se
// toca: se anima esta figurita.
import { useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { ArrowRight, Repeat } from "lucide-react";
import { latir } from "../barra/latido";
import { Reloj } from "../barra/piezas";
import { pintorDura } from "../tiempo";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { esRelevo, relevoHecho } from "./herramientas";
import type { Item } from "./turnos";

const ENTRA = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.16, ease: "easeOut" } } as const;

/**
 * Las tres hojas que se pliegan: la figurita de "compactando", en el chat y, más
 * chica (`chica`), en la fila de la barra. `className` la ubica.
 */
export function Hojas({ chica, className }: { chica?: boolean; className?: string }) {
  useEffect(latir, []);
  return (
    <span className={className ? `pliegue-f ${className}` : "pliegue-f"} data-chica={chica ? "" : undefined} aria-hidden>
      <span className="pliega" data-k="0" />
      <span className="pliega" data-k="1" />
      <span className="pliega" data-k="2" />
    </span>
  );
}

/**
 * Mientras compacta: en el lugar del "qué hace" del chat. `desde` (epoch, s): hace
 * cuánto, si se sabe (lo dice la marca del hook; el stream de un líder de la app, no).
 */
export function Compactando({ desde = null }: { desde?: number | null }) {
  useIdioma();
  const dura = useMemo(() => (desde !== null ? pintorDura(desde) : null), [desde]);
  return (
    <motion.div className="hace pliegue" role="status" data-compactando {...ENTRA}>
      <Hojas />
      <span className="hace-v brillo">{t("hace.compactandoConv")}</span>
      {dura ? <Reloj pintor={dura} className="hace-x" /> : null}
    </motion.div>
  );
}

/** Mientras corre `relevo`: el testimonio va del líder viejo al nuevo. */
export function Pasando() {
  useIdioma();
  useEffect(latir, []);
  return (
    <motion.div className="hace relevo" role="status" {...ENTRA}>
      <span className="relevo-f" aria-hidden>
        <span className="relevo-p" />
        <span className="posta" />
        <span className="relevo-p" />
      </span>
      <span className="hace-v brillo">{t("relevo.pasando")}</span>
    </motion.div>
  );
}

/** Ya pasó la posta: "Sigue en <nombre>"; con `alAbrir`, lleva al líder nuevo. */
export function Sigue({ nombre, alAbrir }: { nombre: string | null; alAbrir: (() => void) | null }) {
  useIdioma();
  const texto = nombre ? t("relevo.sigue", { n: nombre }) : t("relevo.sigueSin");
  return (
    <motion.div className="sis-div" {...ENTRA}>
      {alAbrir ? (
        <button type="button" className="sis-div-t sis-div-b" onClick={alAbrir}>
          <Repeat size={12} strokeWidth={2} />
          <span>{texto}</span>
          <ArrowRight size={11} strokeWidth={2} />
        </button>
      ) : (
        <span className="sis-div-t">
          <Repeat size={12} strokeWidth={2} />
          <span>{texto}</span>
        </span>
      )}
    </motion.div>
  );
}

/**
 * El último turno que corrió `relevo`: su posición en `items` y si ya salió (la
 * sesión nueva arrancó). Uno que falló cuenta como no hecho; si después hubo
 * otro turno, ya no importa (`null`).
 */
export function relevoEn(items: Item[]): { k: number; hecho: boolean } | null {
  let k = items.length - 1;
  while (k >= 0 && items[k].tipo !== "turno") k--;
  const x = items[k];
  if (!x || x.tipo !== "turno") return null;
  const usos = x.pasos.flatMap((p) => p.usos).filter((u) => esRelevo(u.det));
  if (!usos.length) return null;
  return { k, hecho: usos.some((u) => relevoHecho(u.det)) };
}
