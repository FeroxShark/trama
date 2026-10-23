// El aviso de Claude Code nuevo, al pie de la barra: un puntito y "Claude Code
// 2.1.300 available". El clic abre un globito con instalada → nueva, Actualizar
// (`claude update` en el main, sin shell; el progreso y el resultado acá mismo),
// el link al CHANGELOG (navegador) y Dismiss (no avisa más de esa versión). Lo
// chequea el main (electron/actualizacion.ts) al abrir y cada 6 h. Actualizado,
// dice qué falta: trama no se reinicia, los líderes nuevos ya usan la nueva y los
// abiertos siguen con la vieja hasta relanzarse (Reiniciar líderes inactivos).
// El mismo globito sirve para Antigravity CLI (`cual="agy"`, Actualizar abre una terminal con paru): sin changelog ni
// líderes que reiniciar, y sin `agy` instalado el main no avisa nada.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { fuente, type AvisoClaude as Aviso } from "../datos/fuente";
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
  | { tipo: "reiniciando"; version: string }
  | { tipo: "reiniciado"; version: string; reiniciados: number; ocupados: number };

/** Los textos de cada uno (las claves literales: `t` las comprueba contra el diccionario). */
const K = {
  claude: { disponible: "claude.disponible", titulo: "claude.titulo", nota: "claude.nota", fallo: "claude.fallo", hecho: "claude.hecho", descartar: "claude.descartar" },
  agy: { disponible: "agy.disponible", titulo: "agy.titulo", nota: "agy.nota", fallo: "agy.fallo", hecho: "agy.hecho", descartar: "agy.descartar" },
} as const;

/** El primer renglón de un error, recortado (el entero va en el tooltip). */
const corto = (s: string) => {
  const l = s.trim().split("\n")[0] ?? "";
  return l.length > 90 ? `${l.slice(0, 89)}…` : l;
};

/** Lo que se ve en una captura `claude-actualizado`: ya actualizado, con dos líderes abiertos. */
const faseInicial = (): Fase => (MODO.captura === "claude-actualizado" ? { tipo: "hecho", version: "2.1.300", abiertos: 2 } : { tipo: "nada" });

export const AvisoClaude = memo(function AvisoClaude({ cual = "claude" }: { cual?: "claude" | "agy" }) {
  useIdioma();
  const agy = cual === "agy";
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [abierto, setAbierto] = useState(MODO.captura === "claude-abierto" || MODO.captura === "claude-actualizado");
  const [fase, setFase] = useState<Fase>(faseInicial);
  // Actualizado, el main ya no avisa (null): el globito sigue con lo último hasta cerrarlo.
  const visto = useRef<Aviso | null>(null);
  const enFase = useRef(fase.tipo !== "nada");
  enFase.current = fase.tipo !== "nada";
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    void (agy ? fuente.avisoAgy() : fuente.avisoClaude()).then((a) => vivo && setAviso(a));
    const soltar = (agy ? fuente.alCambiarAvisoAgy : fuente.alCambiarAvisoClaude)((a) => {
      setAviso(a);
      if (!a && !enFase.current) setAbierto(false);
    });
    return () => {
      vivo = false;
      soltar();
    };
  }, [agy]);

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
  const a = aviso ?? (fase.tipo !== "nada" ? visto.current : null);
  // Cerrado tras actualizar (sin aviso nuevo): se va del pie.
  if (!a || (!aviso && !abierto)) return null;

  const actualizar = () => {
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
        {t(K[cual].disponible, { v: a.ultima })}
      </button>
      {abierto ? (
        <div ref={globo} className="avc-g" role="dialog" aria-label={t(K[cual].titulo)} tabIndex={-1}>
          <div className="avc-t">{t(K[cual].titulo)}</div>
          <div className="avc-v">
            <span>{a.instalada}</span>
            <span aria-hidden="true">→</span>
            <b>{a.ultima}</b>
          </div>
          {fase.tipo === "nada" || fase.tipo === "actualizando" ? (
            <div className="avc-n">{t(K[cual].nota)}</div>
          ) : fase.tipo === "error" ? (
            <div className="avc-n avc-e" data-tip={fase.texto} role="alert">
              {t(K[cual].fallo, { e: corto(fase.texto) })}
            </div>
          ) : (
            <div className="avc-n avc-ok" role="status">
              {t(K[cual].hecho, { v: fase.version })}
              {fase.tipo === "hecho" && fase.abiertos > 0 ? (
                <> {t(fase.abiertos === 1 ? "claude.abierto" : "claude.abiertos", { n: fase.abiertos })}</>
              ) : null}
              {fase.tipo === "reiniciado" ? (
                <>
                  {" "}
                  {t("claude.reiniciados", { n: fase.reiniciados })}
                  {fase.ocupados > 0 ? <> {t("claude.ocupados", { n: fase.ocupados })}</> : null}
                </>
              ) : null}
            </div>
          )}
          <div className="avc-a">
            {fase.tipo === "hecho" || fase.tipo === "reiniciando" ? (
              fase.tipo === "reiniciando" || fase.abiertos > 0 ? (
                <button type="button" className="avc-u" disabled={fase.tipo === "reiniciando"} onClick={() => reiniciar(fase.version)}>
                  <Fijo k="claude.reiniciar" />
                </button>
              ) : null
            ) : fase.tipo === "reiniciado" ? null : (
              <button type="button" className="avc-u" disabled={fase.tipo === "actualizando"} onClick={actualizar}>
                <Reserva
                  texto={t(fase.tipo === "actualizando" ? "claude.actualizando" : "claude.actualizar")}
                  reserva={[...enOtros("claude.actualizar"), ...enOtros("claude.actualizando"), t(fase.tipo === "actualizando" ? "claude.actualizar" : "claude.actualizando")]}
                />
              </button>
            )}
            <span className="esp" />
            {agy ? null : (
              <button type="button" className="avc-l" onClick={() => fuente.abrirChangelog()}>
                {t("claude.changelog")}
              </button>
            )}
            {aviso ? (
              <button type="button" className="avc-d" onClick={() => (agy ? fuente.descartarAvisoAgy() : fuente.descartarAvisoClaude())}>
                {t(K[cual].descartar)}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
