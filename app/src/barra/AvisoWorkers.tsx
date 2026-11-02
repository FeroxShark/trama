// Los avisos de workers al pie de la barra, junto a "falta configurar": una pastilla con un puntito rojo y cuántos hay (cupos y
// colgados que el dueño no descartó; las muertes no: salen en un cartelito que se va solo, ver CartelMuertes). El clic abre un globito con cada uno: quién, por qué (el cupo dice el proveedor y cuándo vuelve)
// y, si fue por cupo, "Relanzar con otro modelo" (la misma tarea, sin modelo fijo: `reparto` elige entre lo que tiene cupo) y "Seguir con otro
// modelo" (abre el selector de modelo y sigue la misma conversación con un resumen de lo hecho, #1791). La ✕ lo
// descarta. Sin avisos no se ve nada. Lo anota src/avisos-worker.ts; lo detecta el main (electron/avisos-worker.ts).
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRightLeft, X } from "lucide-react";
import { avisosPendientes, cartelMuertes, cerrarCartelMuertes, descartarAviso, pausarCartelMuertes, suscribirAvisos, textoCartelMuertes, textoMotivo } from "../avisos-worker";
import type { AvisoWorker } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { mensaje } from "../puente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODELOS_WORKER, modeloDe, nombreModelo } from "../hilo/opciones";
import { SeguirCon } from "../hilo/SeguirCon";

type Relanzo = "relanzando" | "hecho" | { error: string };

/**
 * «Murió un worker» / «Murieron 3 workers»: se dice una vez y se va solo a los pocos segundos (sin color de alarma ni movimiento);
 * con el puntero o el foco encima no se va. Lo que murió sigue a la vista en su fila; esto sólo avisa.
 */
const CartelMuertes = memo(function CartelMuertes() {
  useIdioma();
  const c = useSyncExternalStore(suscribirAvisos, cartelMuertes);
  if (!c) return null;
  const texto = textoCartelMuertes(c);
  return (
    <div
      className="avc avm"
      role="status"
      onPointerEnter={() => pausarCartelMuertes(true)}
      onPointerLeave={() => pausarCartelMuertes(false)}
      onFocus={() => pausarCartelMuertes(true)}
      onBlur={() => pausarCartelMuertes(false)}
    >
      <div className="avm-c" title={c.motivo ? `${texto}. ${c.motivo}` : texto}>
        <span className="avm-t">{texto}</span>
        <button type="button" className="avm-x" aria-label={t("avisoW.cerrarMuerte")} onClick={cerrarCartelMuertes}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

export const AvisoWorkers = memo(function AvisoWorkers() {
  return (
    <>
      <CartelMuertes />
      <PastillaWorkers />
    </>
  );
});

const PastillaWorkers = memo(function PastillaWorkers() {
  useIdioma();
  const avisos = useSyncExternalStore(suscribirAvisos, avisosPendientes);
  const [abierto, setAbierto] = useState(false);
  const [relanzos, setRelanzos] = useState<Record<string, Relanzo>>({});
  // «Seguir con otro modelo»: el aviso cuyo selector está abierto y, por aviso, con qué modelo se siguió.
  const [seguirA, setSeguirA] = useState<AvisoWorker | null>(null);
  const [seguidos, setSeguidos] = useState<Record<string, string>>({});
  const caja = useRef<HTMLDivElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  const alCerrar = useCallback(() => setAbierto(false), []);
  useFoco(globo, { activo: abierto, alCerrar, devolver: () => boton.current });
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    addEventListener("pointerdown", afuera, true);
    return () => removeEventListener("pointerdown", afuera, true);
  }, [abierto]);
  useEffect(() => {
    if (!avisos.length) setAbierto(false);
  }, [avisos.length]);

  if (!avisos.length) return null;

  const relanzar = (a: AvisoWorker) => {
    setRelanzos((r) => ({ ...r, [a.clave]: "relanzando" }));
    fuente.relanzarWorker(a.id).then(
      () => setRelanzos((r) => ({ ...r, [a.clave]: "hecho" })),
      (e) => setRelanzos((r) => ({ ...r, [a.clave]: { error: mensaje(e) } })),
    );
  };

  return (
    <div className="avc avs" ref={caja}>
      <button ref={boton} type="button" className="avc-b" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        <span className="avc-p avw-p" aria-hidden="true" />
        {t(avisos.length === 1 ? "avisoW.pastilla1" : "avisoW.pastilla", { n: avisos.length })}
      </button>
      {abierto ? (
        <div ref={globo} className="avc-g" role="dialog" aria-label={t("avisoW.titulo")} tabIndex={-1}>
          <div className="avc-t">{t("avisoW.titulo")}</div>
          <ul className="avs-l">
            {avisos.map((a) => {
              const r = relanzos[a.clave];
              return (
                <li key={a.clave} className="avs-f" data-id={a.id} data-tipo={a.tipo}>
                  <div className="avs-x">
                    <div className="avs-n" title={a.tarea || a.id}>{a.tarea || a.id}</div>
                    <div className="avc-n">{textoMotivo(a)}</div>
                    {r && typeof r === "object" ? <div className="avc-n avw-e">{t("avisoW.relanzarFallo", { e: r.error })}</div> : null}
                  </div>
                  <button type="button" className="avs-d" aria-label={t("avisoW.descartar")} data-tip={t("avisoW.descartar")} onClick={() => descartarAviso(a.clave)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                  {a.tipo === "cupo" ? (
                    <div className="avs-acciones">
                      <button type="button" className="avs-a" disabled={r === "relanzando" || r === "hecho"} data-tip={t("avisoW.relanzarTip")} onClick={() => relanzar(a)}>
                        {t(r === "relanzando" ? "avisoW.relanzando" : r === "hecho" ? "avisoW.relanzado" : "avisoW.relanzar")}
                      </button>
                      <button
                        type="button"
                        className="avs-a avs-seguir"
                        data-seguir-con
                        disabled={!!seguidos[a.clave]}
                        onClick={() => {
                          setAbierto(false);
                          setSeguirA(a);
                        }}
                      >
                        <ArrowRightLeft size={12} strokeWidth={2.2} aria-hidden="true" />
                        {seguidos[a.clave] ? t("avisoW.seguido", { modelo: nombreModelo(seguidos[a.clave]) }) : t("aviso.seguir")}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {seguirA ? (
        <SeguirCon
          de="worker"
          opciones={MODELOS_WORKER}
          actual={modeloDe(seguirA.modelo)}
          alElegir={async (modelo) => {
            await fuente.seguirConWorker(seguirA.id, modelo);
            setSeguidos((s) => ({ ...s, [seguirA.clave]: modelo }));
            setSeguirA(null);
          }}
          alCerrar={() => setSeguirA(null)}
        />
      ) : null}
    </div>
  );
});
