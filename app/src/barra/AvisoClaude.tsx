// El aviso de Claude Code nuevo, al pie de la barra: un puntito y "Claude Code
// 2.1.300 available". El clic abre un globito con instalada → nueva, Actualizar
// (`claude update` en el main, sin shell; el progreso y el resultado acá mismo),
// el link al CHANGELOG (navegador) y Dismiss (no avisa más de esa versión). Lo
// chequea el main (electron/actualizacion.ts) al abrir y cada 6 h. Actualizado,
// dice qué falta: trama no se reinicia, los líderes nuevos ya usan la nueva y los
// abiertos siguen con la vieja hasta relanzarse (Reiniciar líderes inactivos).
// El mismo globito sirve para Antigravity CLI (`cual="agy"`, Actualizar abre una terminal con paru): sin changelog ni
// líderes que reiniciar, y sin `agy` instalado el main no avisa nada.
// Y para una Trama nueva (`cual="trama"`, electron/actualizacion-trama.ts): las notas del release en vez del changelog, "Ahora no" en
// vez de Ocultar, y Actualizar (git + instalador, en el main) deshabilitado y explicado si el checkout tiene cambios sin commitear.
// Actualizar reinicia el motor: con líderes trabajando o workers vivos ofrece "Actualizar cuando terminen" (espera y actualiza solo)
// o "Actualizar ya" (con confirmación que dice qué se corta). El avance (esperando, instalando, instalada) lo lleva el main y
// sobrevive al reinicio del motor; instalada, ofrece reiniciar la ventana con un toque.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { fuente, SIN_OCUPAR, type AvisoClaude as Aviso, type EstadoActTrama, type OcupacionTrama } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { enOtros, Fijo, Reserva } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";

/** Qué pasa con Actualizar. */
type Fase =
  | { tipo: "nada" }
  | { tipo: "actualizando" }
  | { tipo: "hecho"; version: string; abiertos: number }
  | { tipo: "error"; texto: string }
  | { tipo: "esperando" }
  | { tipo: "instalada"; version: string }
  | { tipo: "reiniciando"; version: string }
  | { tipo: "reiniciado"; version: string; reiniciados: number; ocupados: number };

/** Los textos de cada uno (las claves literales: `t` las comprueba contra el diccionario). */
const K = {
  claude: { disponible: "claude.disponible", titulo: "claude.titulo", nota: "claude.nota", fallo: "claude.fallo", hecho: "claude.hecho", descartar: "claude.descartar" },
  agy: { disponible: "agy.disponible", titulo: "agy.titulo", nota: "agy.nota", fallo: "agy.fallo", hecho: "agy.hecho", descartar: "agy.descartar" },
  trama: { disponible: "trama.disponible", titulo: "trama.titulo", nota: "trama.nota", fallo: "trama.fallo", hecho: "trama.hecho", descartar: "trama.descartar" },
} as const;

/** El primer renglón de un error, recortado (el entero va en el tooltip). */
const corto = (s: string) => {
  const l = s.trim().split("\n")[0] ?? "";
  return l.length > 90 ? `${l.slice(0, 89)}…` : l;
};

/** Cuánto trabajo hay, en palabras ("2 líderes trabajando, 1 worker vivo"). */
const queHay = (o: OcupacionTrama) =>
  [
    o.lideres > 0 ? t(o.lideres === 1 ? "trama.lider1" : "trama.lideres", { n: o.lideres }) : null,
    o.workers > 0 ? t(o.workers === 1 ? "trama.worker1" : "trama.workers", { n: o.workers }) : null,
    o.otras > 0 ? t("trama.integracion") : null,
  ]
    .filter(Boolean)
    .join(", ");
const hayTrabajo = (o: OcupacionTrama) => o.lideres + o.workers + o.otras > 0;
/** Cada cuánto se mira qué hay ocupado mientras el globito está abierto (ms). */
const MIRAR_MS = 3000;
/** Cada cuánto se le pregunta al motor en qué anda Actualizar mientras diga "instalando" (ms). */
const PREGUNTAR_MS = 30_000;

/** Lo que se ve en una captura `claude-actualizado`: ya actualizado, con dos líderes abiertos. */
const faseInicial = (): Fase => (MODO.captura === "claude-actualizado" ? { tipo: "hecho", version: "2.1.300", abiertos: 2 } : { tipo: "nada" });

export const AvisoClaude = memo(function AvisoClaude({ cual = "claude" }: { cual?: "claude" | "agy" | "trama" }) {
  useIdioma();
  const agy = cual === "agy";
  const trama = cual === "trama";
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [abierto, setAbierto] = useState(MODO.captura === "claude-abierto" || MODO.captura === "claude-actualizado" || (trama && (MODO.captura === "trama-abierto" || MODO.captura === "trama-sucio")));
  const [fase, setFase] = useState<Fase>(faseInicial);
  // Sólo Trama: en qué anda Actualizar (lo lleva el main), qué cortaría hoy, y si se está confirmando "Actualizar ya".
  const [act, setAct] = useState<EstadoActTrama>({ fase: "nada" });
  const [ocup, setOcup] = useState<OcupacionTrama>(SIN_OCUPAR);
  const [confirmando, setConfirmando] = useState(false);
  const faseEf: Fase = !trama
    ? fase
    : act.fase === "esperando"
      ? { tipo: "esperando" }
      : act.fase === "instalando"
        ? { tipo: "actualizando" }
        : act.fase === "hecho"
          ? { tipo: "instalada", version: act.version }
          : act.fase === "error"
            ? { tipo: "error", texto: act.error }
            : fase;
  // Actualizado, el main ya no avisa (null): el globito sigue con lo último hasta cerrarlo.
  const visto = useRef<Aviso | null>(null);
  const enFase = useRef(faseEf.tipo !== "nada");
  enFase.current = faseEf.tipo !== "nada";
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    void (trama ? fuente.avisoTrama() : agy ? fuente.avisoAgy() : fuente.avisoClaude()).then((a) => vivo && setAviso(a));
    const soltar = (trama ? fuente.alCambiarAvisoTrama : agy ? fuente.alCambiarAvisoAgy : fuente.alCambiarAvisoClaude)((a) => {
      setAviso(a);
      if (!a && !enFase.current) setAbierto(false);
    });
    return () => {
      vivo = false;
      soltar();
    };
  }, [agy, trama]);

  useEffect(() => {
    if (!trama) return;
    let vivo = true;
    void fuente.estadoActTrama().then((e) => vivo && setAct(e));
    const soltar = fuente.alCambiarActTrama((e) => {
      setAct(e);
      // Que termine la instalación se avisa solo: el globito se abre.
      if (e.fase === "hecho") setAbierto(true);
    });
    return () => {
      vivo = false;
      soltar();
    };
  }, [trama]);
  // Abierto (o esperando): qué hay ocupado, cada tanto.
  const mirando = trama && (abierto || act.fase === "esperando");
  useEffect(() => {
    if (!mirando) return;
    let vivo = true;
    const mirar = () => void fuente.ocupacionTrama().then((o) => vivo && setOcup(o));
    mirar();
    const id = setInterval(mirar, MIRAR_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [mirando]);
  // Al abrir el aviso se pregunta en qué anda Actualizar, y mientras diga "instalando" cada tanto: el motor cierra un instalador
  // muerto sólo cuando le preguntan, así que sin esto el globito quedaba en "Actualizando…" para siempre.
  const instalando = trama && act.fase === "instalando";
  useEffect(() => {
    if (!trama || !abierto) return;
    let vivo = true;
    void fuente.estadoActTrama().then((e) => vivo && setAct(e));
    return () => {
      vivo = false;
    };
  }, [abierto, trama]);
  useEffect(() => {
    if (!instalando) return;
    const id = setInterval(() => void fuente.estadoActTrama().then(setAct), PREGUNTAR_MS);
    return () => clearInterval(id);
  }, [instalando]);

  // Abierto: Esc (antes que la barra se entere), Tab que no se sale y un clic afuera lo cierran; el foco vuelve al botón.
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

  if (aviso) visto.current = aviso;
  // Instalada la nueva ya no hay aviso (la instalada es la última): el globito sigue con la versión que quedó.
  const nueva = trama && act.fase !== "nada" && act.fase !== "error" ? act.version : null;
  const a = aviso ?? (faseEf.tipo !== "nada" ? (visto.current ?? (nueva ? { instalada: nueva, ultima: nueva } : null)) : null);
  // Cerrado tras actualizar (sin aviso nuevo): se va del pie, salvo que haya que reiniciar la ventana.
  if (!a || (!aviso && !abierto && faseEf.tipo !== "instalada")) return null;

  const pedirTrama = (modo: "ya" | "esperar") => {
    setConfirmando(false);
    setFase({ tipo: "actualizando" });
    void fuente.actualizarTrama(modo).then((r) => {
      setFase(r.ok ? { tipo: "nada" } : { tipo: "error", texto: r.error });
      if (r.ok) void fuente.estadoActTrama().then(setAct);
    });
  };
  const reiniciarVentana = () => {
    fuente.limpiarTrama();
    fuente.reiniciarVentana();
  };
  const actualizar = () => {
    if (trama) return pedirTrama("ya");
    setFase({ tipo: "actualizando" });
    void (agy ? fuente.actualizarAgy() : fuente.actualizarClaude()).then((r) =>
      setFase(r.ok ? { tipo: "hecho", version: r.version, abiertos: r.abiertos } : { tipo: "error", texto: r.error }),
    );
  };
  const reiniciar = (version: string) => {
    setFase({ tipo: "reiniciando", version });
    void fuente.reiniciarLideres().then((r) => setFase({ tipo: "reiniciado", version, ...r }));
  };

  return (
    <div className="avc" data-cual={cual} ref={caja}>
      <button ref={boton} type="button" className="avc-b" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        <span className="avc-p" aria-hidden="true" />
        {faseEf.tipo === "instalada" ? t("trama.instalada", { v: faseEf.version }) : t(K[cual].disponible, { v: a.ultima })}
      </button>
      {abierto ? (
        <div ref={globo} className="avc-g" role="dialog" aria-label={t(K[cual].titulo)} tabIndex={-1}>
          <div className="avc-t">{t(K[cual].titulo)}</div>
          <div className="avc-v">
            <span>{a.instalada}</span>
            <span aria-hidden="true">→</span>
            <b>{a.ultima}</b>
          </div>
          {faseEf.tipo === "instalada" ? (
            <div className="avc-n avc-ok" role="status">
              {t("trama.hecho", { v: faseEf.version })}
            </div>
          ) : faseEf.tipo === "esperando" ? (
            <div className="avc-n" role="status">
              {t("trama.esperando", { que: queHay(ocup) || "…" })}
            </div>
          ) : faseEf.tipo === "actualizando" && trama ? (
            <div className="avc-n" role="status">
              {t("trama.instalando")}
            </div>
          ) : faseEf.tipo === "nada" || faseEf.tipo === "actualizando" ? (
            <div className="avc-n">
              {confirmando
                ? t("trama.confirmaYa", { que: queHay(ocup) })
                : trama && !a.sucio && hayTrabajo(ocup)
                  ? t("trama.ocupado", { que: queHay(ocup) })
                  : t(trama && a.sucio ? "trama.sucio" : K[cual].nota)}
            </div>
          ) : faseEf.tipo === "error" ? (
            <div className="avc-n avc-e" data-tip={faseEf.texto} role="alert">
              {t(K[cual].fallo, { e: corto(faseEf.texto) })}
            </div>
          ) : faseEf.tipo === "hecho" || faseEf.tipo === "reiniciando" || faseEf.tipo === "reiniciado" ? (
            <div className="avc-n avc-ok" role="status">
              {t(K[cual].hecho, { v: faseEf.version })}
              {faseEf.tipo === "hecho" && faseEf.abiertos > 0 ? (
                <> {t(faseEf.abiertos === 1 ? "claude.abierto" : "claude.abiertos", { n: faseEf.abiertos })}</>
              ) : null}
              {faseEf.tipo === "reiniciado" ? (
                <>
                  {" "}
                  {t("claude.reiniciados", { n: faseEf.reiniciados })}
                  {faseEf.ocupados > 0 ? <> {t("claude.ocupados", { n: faseEf.ocupados })}</> : null}
                </>
              ) : null}
            </div>
          ) : null}
          <div className="avc-a">
            {faseEf.tipo === "instalada" ? (
              <button type="button" className="avc-u" onClick={reiniciarVentana}>
                {t("trama.reiniciarVentana")}
              </button>
            ) : faseEf.tipo === "esperando" ? (
              <button type="button" className="avc-u" onClick={() => void fuente.cancelarEsperaTrama()}>
                {t("trama.cancelarEspera")}
              </button>
            ) : trama && confirmando ? (
              <>
                <button type="button" className="avc-u" onClick={() => pedirTrama("ya")}>
                  {t("trama.confirmar")}
                </button>
                <button type="button" className="avc-l" onClick={() => setConfirmando(false)}>
                  {t("trama.volver")}
                </button>
              </>
            ) : trama && faseEf.tipo === "nada" && !a.sucio && hayTrabajo(ocup) ? (
              <>
                <button type="button" className="avc-u" onClick={() => pedirTrama("esperar")}>
                  {t("trama.esperar")}
                </button>
                <button type="button" className="avc-l" onClick={() => setConfirmando(true)}>
                  {t("trama.ya")}
                </button>
              </>
            ) : faseEf.tipo === "hecho" || faseEf.tipo === "reiniciando" ? (
              faseEf.tipo === "reiniciando" || faseEf.abiertos > 0 ? (
                <button type="button" className="avc-u" disabled={faseEf.tipo === "reiniciando"} onClick={() => reiniciar(faseEf.version)}>
                  <Fijo k="claude.reiniciar" />
                </button>
              ) : null
            ) : faseEf.tipo === "reiniciado" ? null : (
              <button type="button" className="avc-u" disabled={faseEf.tipo === "actualizando" || (trama && a.sucio === true)} onClick={actualizar}>
                <Reserva
                  texto={t(faseEf.tipo === "actualizando" ? "claude.actualizando" : "claude.actualizar")}
                  reserva={[...enOtros("claude.actualizar"), ...enOtros("claude.actualizando"), t(faseEf.tipo === "actualizando" ? "claude.actualizar" : "claude.actualizando")]}
                />
              </button>
            )}
            <span className="esp" />
            {trama ? (
              // Un enlace de verdad no sirve acá (es un botón de la fila): lo abre el main (trama:notas) o, en el navegador, otra pestaña.
              a.notas ? (
                <button type="button" className="avc-l" onClick={() => fuente.abrirNotasTrama(a.notas ?? "")}>
                  {t("trama.notas")}
                </button>
              ) : null
            ) : agy ? null : (
              <button type="button" className="avc-l" onClick={() => fuente.abrirChangelog()}>
                {t("claude.changelog")}
              </button>
            )}
            {aviso ? (
              <button type="button" className="avc-d" onClick={() => (trama ? fuente.descartarAvisoTrama() : agy ? fuente.descartarAvisoAgy() : fuente.descartarAvisoClaude())}>
                {t(K[cual].descartar)}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
