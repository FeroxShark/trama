// Ajustes: muestra con qué números corre todo y qué hace cada uno, en criollo.
// Se guardan al elegir el idioma, el tamaño de letra, las fuentes y los mensajes tiernos (preferencias.json) y los
// modelos con que los líderes lanzan workers (la tabla de routing de ~/CLAUDE.md). Con Guardar (y Cancelar que vuelve
// a lo guardado), el plan, la red de seguridad y el acceso desde el celular: AjustesEditar.tsx. El resumen de los
// workers es un número de `pa` y no se cambia desde acá.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { elegirApariencia } from "../apariencia";
import { VERSION } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { fuentePaneles, type Ajustes as Datos, type FilaRouting, type Rol, type Routing } from "../datos/paneles";
import { effortsOpciones, MODELOS_WORKER } from "../hilo/opciones";
import { Selector, type Opcion } from "../hilo/Selector";
import { MODO } from "../modo";
import { cambiarIdioma, esIdioma, idioma, locale, t, textoMain, type ClaveSola } from "../i18n";
import { abrirAtajos } from "./Atajos";
import { Celular, PlanYRed } from "./AjustesEditar";
import { AjustesModelos } from "./AjustesModelos";
import { ErrorCarga } from "./ErrorCarga";
import { useIdioma } from "../i18n/react";
import { enOtros, Fijo } from "../i18n/Fijo";
import { cambiarTiernos } from "../hilo/tierno";
import { useTiernos } from "../hilo/Tierno";
import { alCambiarAvisarEspera, avisarEspera, cambiarAvisarEspera } from "../espera";
import { mensaje } from "../puente";
import { alCambiarApariencia, apariencia, FUENTES, LETRA_DEF, LETRA_MAX, LETRA_MIN, MONOS, type Fuente } from "../tipografia";

/**
 * A cuántos tokens el jefe le pasa la posta a una sesión nueva, según el plan.
 * Fuente: `~/orquestador/hooks/aviso-contexto.sh` (max: 200000; si no: 120000).
 */
const RELEVO = { pro: 120_000, max: 200_000 } as const;

/**
 * A cuántos tokens `pa` hace que el worker resuma su conversación.
 * Fuente: `~/orquestador/bin/pa` (`AUTOCOMPACT="${PA_AUTOCOMPACT:-180000}"`).
 */
const RESUMEN_WORKERS = 180_000;

/** Las tres filas de worker de la tabla de routing de `~/CLAUDE.md`. */
const ROLES: Record<Rol, { para: ClaveSola; que: ClaveSola }> = {
  codigo: { para: "rol.codigo", que: "rol.codigoQue" },
  explorar: { para: "rol.explorar", que: "rol.explorarQue" },
  diseno: { para: "rol.diseno", que: "rol.disenoQue" },
};

/** Cada idioma con su nombre en ese idioma (así lo encuentra quien no lee el otro). */
const IDIOMAS: Opcion[] = [
  { id: "en", nombre: "English", desc: "" },
  { id: "es", nombre: "Español", desc: "" },
];

/** El id de "Lo decide el líder" en el selector (en el archivo, la columna Modelo dice `lo decide el líder`). */
const LIDER = "lider";
// Acá "default" confunde (cada fila tiene el suyo): sin la marca. El spread copia
// la descripción del idioma de ahora: se arma al pintar.
const SIN_MARCA = (o: Opcion): Opcion => ({ ...o, rec: false });

/** Los modelos de siempre, el de la tabla si es otro, y "Lo decide el líder". */
function opcionesModelo(actual: string | null): Opcion[] {
  const ops = MODELOS_WORKER.map(SIN_MARCA);
  if (actual && !ops.some((o) => o.id === actual)) ops.push({ id: actual, nombre: actual, desc: t("ajustes.deClaudeMd") });
  return [...ops, { id: LIDER, nombre: t("ajustes.liderDecide"), desc: t("ajustes.liderDecideQue") }];
}

const miles = (n: number) => n.toLocaleString(locale());

/** Cambia en el momento (sin reiniciar) y se guarda en preferencias.json. */
function elegirIdioma(id: string) {
  if (!esIdioma(id) || id === idioma()) return;
  cambiarIdioma(id);
  void fuente.guardarIdioma(id);
}

const LETRAS = Array.from({ length: LETRA_MAX - LETRA_MIN + 1 }, (_, i) => LETRA_MIN + i);

/** Cada fuente escrita en ella misma; la primera es la de la maqueta (default). */
const opcionesFuente = (fuentes: readonly Fuente[]): Opcion[] =>
  fuentes.map((f, i) => ({
    id: f.id,
    nombre: f.nombre ?? t("ajustes.fuenteSistema"),
    desc: f.nombre === null ? t("ajustes.fuenteSistemaQue") : "",
    rec: i === 0,
    fuente: f.pila,
  }));

/** Tamaño de letra y fuentes: se aplican al toque a toda la app y se guardan en preferencias.json. */
function Apariencia() {
  const a = useSyncExternalStore(alCambiarApariencia, apariencia);
  return (
    <>
      <Dato nombre="ajustes.letra" que="ajustes.letraQue">
        <div className="pn-letra" role="radiogroup" aria-label={t("ajustes.letra")}>
          {LETRAS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === a.letra}
              aria-label={t("ajustes.letraPx", { n })}
              data-def={n === LETRA_DEF ? "" : undefined}
              onClick={() => elegirApariencia({ letra: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </Dato>
      <Dato nombre="ajustes.fuente" que="ajustes.fuenteQue">
        <div className="pn-sel pn-abajo">
          <Selector
            etiqueta={t("ajustes.fuente")}
            opciones={opcionesFuente(FUENTES)}
            valor={a.fuente}
            alElegir={(fuente) => elegirApariencia({ fuente })}
            abierto={MODO.variante === "fuente"}
            reserva={enOtros("ajustes.fuenteSistema")}
          />
        </div>
      </Dato>
      <Dato nombre="ajustes.mono" que="ajustes.monoQue">
        <div className="pn-sel pn-abajo">
          <Selector
            etiqueta={t("ajustes.mono")}
            opciones={opcionesFuente(MONOS)}
            valor={a.mono}
            alElegir={(mono) => elegirApariencia({ mono })}
            abierto={MODO.variante === "mono"}
            reserva={enOtros("ajustes.fuenteSistema")}
          />
        </div>
      </Dato>
    </>
  );
}

/** La notificación de "te espera": igual, al toque y a preferencias.json. */
function elegirAvisarEspera(id: string) {
  const si = id === "si";
  cambiarAvisarEspera(si);
  fuente.guardarAvisarEspera(si);
}

/** Los mensajes tiernos (B17): igual, al toque y a preferencias.json. */
function elegirTiernos(id: string) {
  const si = id === "si";
  cambiarTiernos(si);
  fuente.guardarTiernos(si);
}

/**
 * Una fila de Ajustes. El nombre va en un renglón (cortado con "…" y entero en el
 * tooltip) y la explicación reserva el alto del idioma más largo: cambiar de
 * idioma no mueve ninguna fila (B21).
 */
function Dato({ nombre, que, children }: { nombre: ClaveSola; que: ClaveSola; children: ReactNode }) {
  return (
    <div className="pn-dato">
      <div>
        <div className="pn-nom" data-tip={t(nombre)}>
          {t(nombre)}
        </div>
        <Fijo k={que} bloque className="pn-que" />
      </div>
      <div className="pn-val">{children}</div>
    </div>
  );
}

const Tokens = ({ n }: { n: number }) => (
  <>
    <b>{miles(n)}</b> {t("comun.tokens")}
  </>
);

export function Ajustes() {
  useIdioma();
  const [a, setA] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tiernos = useTiernos();
  const avisar = useSyncExternalStore(alCambiarAvisarEspera, avisarEspera);
  const [intento, setIntento] = useState(0);
  // Guardar Modelos y proveedores puede cambiar las filas de ~/CLAUDE.md: la sección de abajo se lee de nuevo.
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let vivo = true;
    fuentePaneles.ajustes().then(
      (r) => {
        if (!vivo) return;
        if (r.version !== VERSION) setError(t("error.version", { que: t("panel.ajustes"), v: r.version, conozco: VERSION }));
        else setA(r);
      },
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [intento]);

  const refrescarRouting = async () => {
    const r = await fuentePaneles.ajustes().catch(() => null);
    if (r && r.version === VERSION) {
      setA(r);
      setRev((n) => n + 1);
    }
  };

  // El idioma, la letra y las fuentes van siempre, aunque los datos no hayan llegado o hayan fallado.
  const app = (
    <section className="pn-sec">
      <h2 className="pn-h">{t("ajustes.app")}</h2>
      <Dato nombre="ajustes.idioma" que="ajustes.idiomaQue">
        <div className="pn-sel">
          <Selector etiqueta={t("ajustes.idioma")} opciones={IDIOMAS} valor={idioma()} alElegir={elegirIdioma} reserva={[]} />
        </div>
      </Dato>
      <Apariencia />
      <Dato nombre="ajustes.tiernos" que="ajustes.tiernosQue">
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.tiernos")}
            opciones={[
              { id: "si", nombre: t("ajustes.tiernosSi"), desc: "" },
              { id: "no", nombre: t("ajustes.tiernosNo"), desc: "" },
            ]}
            valor={tiernos ? "si" : "no"}
            alElegir={elegirTiernos}
            reserva={[...enOtros("ajustes.tiernosSi"), ...enOtros("ajustes.tiernosNo")]}
          />
        </div>
      </Dato>
      <Dato nombre="ajustes.avisarEspera" que="ajustes.avisarEsperaQue">
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.avisarEspera")}
            opciones={[
              { id: "si", nombre: t("ajustes.tiernosSi"), desc: "" },
              { id: "no", nombre: t("ajustes.tiernosNo"), desc: "" },
            ]}
            valor={avisar ? "si" : "no"}
            alElegir={elegirAvisarEspera}
            reserva={[...enOtros("ajustes.tiernosSi"), ...enOtros("ajustes.tiernosNo")]}
          />
        </div>
      </Dato>
      <Dato nombre="ajustes.atajos" que="ajustes.atajosQue">
        <button type="button" className="btn2" onClick={abrirAtajos}>
          <Fijo k="ajustes.atajosVer" />
        </button>
      </Dato>
    </section>
  );

  // Mismo lugar en el árbol con o sin datos: el selector no se remonta cuando llegan.
  return (
    <>
      {a ? <Fijo k="ajustes.nota" bloque className="pn-nota" /> : null}

      {app}

      {error ? (
        <ErrorCarga
          error={error}
          alReintentar={() => {
            setError(null);
            setIntento((n) => n + 1);
          }}
        />
      ) : !a ? (
        <div className="pn-aviso">{t("ajustes.leyendo")}</div>
      ) : (
        <Numeros a={a} rev={rev} />
      )}
      <AjustesModelos Dato={Dato} alGuardar={() => void refrescarRouting()} />
      <Celular Dato={Dato} />
    </>
  );
}

function Numeros({ a, rev }: { a: Datos; rev: number }) {
  return (
    <>
      <PlanYRed
        inicial={a}
        Dato={Dato}
        largas={(plan) => (
          <>
            <Dato nombre="ajustes.relevo" que="ajustes.relevoQue">
              {plan ? <Tokens n={RELEVO[plan]} /> : null}
              <div className="pn-alt">
                <span data-on={plan === "pro" ? "" : undefined}>pro {miles(RELEVO.pro)}</span>
                <span data-on={plan === "max" ? "" : undefined}>max {miles(RELEVO.max)}</span>
              </div>
            </Dato>
            <Dato nombre="ajustes.resumen" que="ajustes.resumenQue">
              <Tokens n={RESUMEN_WORKERS} />
            </Dato>
          </>
        )}
      />

      <Modelos key={rev} inicial={a.routing} />
    </>
  );
}

/**
 * Los modelos de los workers: con qué lanzan los líderes a sus workers (no el
 * modelo del líder). Cada elección se guarda en el momento en `~/CLAUDE.md`
 * (sólo esa fila, dentro de los marcadores `trama:routing`); si el main no
 * pudo, vuelve lo que había y el error queda en línea.
 */
function Modelos({ inicial }: { inicial: Routing }) {
  const [r, setR] = useState(inicial);
  const [error, setError] = useState<string | null>("error" in inicial ? inicial.error : null);
  const [guardando, setGuardando] = useState(false);
  // Los cambios se mandan de a uno y en orden: el último que llega manda.
  const cola = useRef(Promise.resolve());

  const elegir = (f: FilaRouting, modelo: string | null, effort: string | null) => {
    if ("error" in r) return;
    const antes = r;
    const nota = modelo === null ? "—" : effort === f.effort ? f.nota : (effort ?? "");
    setR({ ...r, filas: r.filas.map((x) => (x.rol === f.rol ? { ...x, modelo, effort, nota } : x)) });
    setError(null);
    setGuardando(true);
    cola.current = cola.current.then(async () => {
      const nuevo = await fuentePaneles.guardarRouting([{ rol: f.rol, modelo, effort }]);
      setGuardando(false);
      if (nuevo.version !== VERSION) setError(t("error.version", { que: "CLAUDE.md", v: nuevo.version, conozco: VERSION }));
      else if ("error" in nuevo) {
        setR(antes);
        setError(nuevo.error);
      } else setR(nuevo);
    });
  };

  return (
    <section className="pn-sec">
      <h2 className="pn-h">{t("ajustes.modelos")}</h2>
      <Fijo k="ajustes.modelosIntro" bloque className="pn-nota pn-intro" />
      {"error" in r ? null : (
        <div className="pn-modelos" aria-busy={guardando}>
          {r.filas.map((f, i) => (
            <Dato key={f.rol} nombre={ROLES[f.rol].para} que={ROLES[f.rol].que}>
              <div className="pn-sel">
                <Selector
                  etiqueta={t("ajustes.selModelo", { rol: t(ROLES[f.rol].para) })}
                  opciones={opcionesModelo(f.modelo)}
                  valor={f.modelo ?? LIDER}
                  alElegir={(m) => (m === LIDER ? elegir(f, null, null) : elegir(f, m, f.effort ?? "high"))}
                  chip={<span className="chip" />}
                  reserva={enOtros("ajustes.liderDecide")}
                  abierto={MODO.variante === "modelo" && i === 0}
                />
                {f.modelo === null ? (
                  <span className="pn-falta">{t("ajustes.sinDefault")}</span>
                ) : (
                  <Selector
                    etiqueta={t("ajustes.selEsfuerzo", { rol: t(ROLES[f.rol].para) })}
                    opciones={effortsOpciones(f.modelo).map(SIN_MARCA)}
                    valor={f.effort ?? ""}
                    alElegir={(e) => elegir(f, f.modelo, e)}
                    reserva={[]}
                  />
                )}
              </div>
              {f.modelo !== null && f.nota && f.nota !== f.effort ? (
                <div className="pn-alt">
                  <span>{f.nota}</span>
                </div>
              ) : null}
            </Dato>
          ))}
        </div>
      )}
      {error ? <div className="pn-error pn-routing-error" role="alert">{textoMain(error)}</div> : null}
    </section>
  );
}
