// El perfil de reparto en la barra de cupos: un ícono chico bajo los anillos que dice cuál está activo (equilibrado, ahorro, agresivo o
// rendimiento: cada uno con su propio ícono, nunca sólo un color) y, al tocarlo, un menú con los cuatro y qué hace cada uno. Elegir uno lo
// guarda en `modelos.json` en el momento (datos/perfil-reparto.ts, el mismo camino que Ajustes > Plan y cupos, sin barra de Guardar):
// si falla vuelve al anterior y lo dice en una línea. Sólo vale para los workers que se lancen después; el menú lo dice.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { fuentePaneles } from "../datos/paneles";
import { EVENTO_PERFIL, guardarPerfil, leerPerfil, PERFILES, type Perfil } from "../datos/perfil-reparto";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { useFoco } from "../foco";
import { IcOk, IcPerfilAgresivo, IcPerfilAhorro, IcPerfilEquilibrado, IcPerfilRendimiento } from "../ui/iconos";

const ICONOS = { equilibrado: IcPerfilEquilibrado, ahorro: IcPerfilAhorro, agresivo: IcPerfilAgresivo, rendimiento: IcPerfilRendimiento } as const;

/** Los mismos textos que Ajustes > Plan y cupos (`PERFIL_CLAVES` en paneles/AjustesCupos.tsx). */
const CLAVES: Record<Perfil, { nombre: ClaveSola; que: ClaveSola }> = {
  equilibrado: { nombre: "cu.perfilEquilibrado", que: "cu.perfilEquilibradoQue" },
  ahorro: { nombre: "cu.perfilAhorro", que: "cu.perfilAhorroQue" },
  agresivo: { nombre: "cu.perfilAgresivo", que: "cu.perfilAgresivoQue" },
  rendimiento: { nombre: "cu.perfilRendimiento", que: "cu.perfilRendimientoQue" },
};

/** La captura `normal` con la variante `perfil-menu` deja el menú abierto. */
const VER_ABIERTO = MODO.variante === "perfil-menu";

export function PerfilRiel({ alAbrir }: { alAbrir?: () => void }) {
  useIdioma();
  // `null`: todavía no se leyó (o no se pudo): se ve como el equilibrado, discreto, y se puede abrir igual.
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [abierto, setAbierto] = useState(VER_ABIERTO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const vivo = useRef(true);
  const ocupado = useRef(false);

  const leer = useCallback(() => {
    leerPerfil(fuentePaneles).then(
      (p) => {
        // Mientras se guarda manda lo que se eligió, no lo que había.
        if (vivo.current && !ocupado.current) {
          setPerfil(p);
          setError(null);
        }
      },
      (x) => vivo.current && !ocupado.current && setError(t("riel.perfilLeerFallo", { motivo: mensaje(x) })),
    );
  }, []);

  useEffect(() => {
    vivo.current = true;
    leer();
    // Ajustes (o este mismo menú) guardó otro perfil: se ve acá sin releer el archivo.
    const alAvisar = (e: Event) => vivo.current && setPerfil((e as CustomEvent<Perfil>).detail);
    window.addEventListener(EVENTO_PERFIL, alAvisar);
    return () => {
      vivo.current = false;
      window.removeEventListener(EVENTO_PERFIL, alAvisar);
    };
  }, [leer]);

  const cerrar = useCallback(() => setAbierto(false), []);

  // Al abrir se vuelve a mirar el archivo (puede haberse editado a mano).
  useEffect(() => {
    if (abierto) leer();
  }, [abierto, leer]);

  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("pointerdown", afuera, true);
    return () => document.removeEventListener("pointerdown", afuera, true);
  }, [abierto]);

  // Esc cierra y el foco vuelve al ícono; Tab se puede salir del menú.
  useFoco(menu, { activo: abierto, alCerrar: cerrar, atrapar: false, enfocar: false, devolver: () => boton.current });

  const abrir = () => {
    if (!abierto) alAbrir?.();
    setAbierto((x) => !x);
  };

  const elegir = async (nuevo: Perfil) => {
    if (ocupado.current) return;
    if (nuevo === (perfil ?? "equilibrado")) return setAbierto(false);
    const antes = perfil;
    ocupado.current = true;
    setGuardando(true);
    setError(null);
    setPerfil(nuevo);
    try {
      const quedo = await guardarPerfil(nuevo, fuentePaneles);
      if (vivo.current) {
        setPerfil(quedo);
        setAbierto(false);
      }
    } catch (x) {
      if (vivo.current) {
        setPerfil(antes);
        setError(t("riel.perfilFallo", { perfil: t(CLAVES[antes ?? "equilibrado"].nombre), motivo: mensaje(x) }));
      }
    } finally {
      ocupado.current = false;
      if (vivo.current) setGuardando(false);
    }
  };

  // Flechas: de una opción a la otra, como un grupo de radios.
  const flechas = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const ops = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const i = ops.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    ops[(i + d + ops.length) % ops.length]?.focus();
  };

  const actual: Perfil = perfil ?? "equilibrado";
  const Icono = ICONOS[actual];
  const nombre = t(CLAVES[actual].nombre);
  return (
    <div ref={caja} className="perfil-riel">
      <button
        ref={boton}
        type="button"
        className="perfil-btn"
        data-guia="perfil-riel"
        data-perfil={actual}
        aria-expanded={abierto}
        aria-haspopup="dialog"
        aria-label={t("riel.perfilAria", { perfil: nombre })}
        data-tip={abierto ? undefined : t("riel.perfilTip", { perfil: nombre })}
        onClick={abrir}
      >
        <Icono size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {abierto ? (
        <section ref={menu} className="vuelo perfil-menu" role="dialog" aria-label={t("riel.perfil")} tabIndex={-1}>
          <h2>{t("riel.perfil")}</h2>
          <div className="perfil-ops" role="radiogroup" aria-label={t("riel.perfil")} onKeyDown={flechas}>
            {PERFILES.map((id) => {
              const Ic = ICONOS[id];
              const elegido = id === actual;
              return (
                <button key={id} type="button" role="radio" aria-checked={elegido} className="perfil-op" data-perfil={id} disabled={guardando && !elegido} onClick={() => void elegir(id)}>
                  <Ic size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span className="perfil-op-t">
                    <b>{t(CLAVES[id].nombre)}</b>
                    <small>{t(CLAVES[id].que)}</small>
                  </span>
                  {elegido ? <IcOk size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
          {error ? (
            <p className="perfil-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="v-pie perfil-nota" role="status">
            {guardando ? t("riel.perfilGuardando") : t("riel.perfilNota")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
