// El flujo de Compactar de un líder desde el panel de contexto: pregunta en una línea, manda `/compact`,
// mira si empezó a compactar (`useCompactando`), y al terminar vuelve a medir y dice de cuántos a cuántos tokens quedó.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lider } from "../datos/contrato";
import type { Desglose } from "../../electron/contexto-desglose";
import { fuente } from "../datos/fuente";
import { effortDe, MODELO_DEFAULT, modeloDe } from "./opciones";
import { useCompactando } from "./compactando";
import { ESPERA_COMPACTAR_S } from "./cambio-compactado";
import { mensaje } from "../puente";
import { locale, t } from "../i18n";

const miles = (n: number) => n.toLocaleString(locale());


export type FaseCompactar = "reposo" | "preguntando" | "enviando" | "esperando" | "compactando" | "midiendo";

/**
 * El flujo de Compactar del líder: pregunta en una línea, manda `/compact`, mira si empezó a compactar (`useCompactando`), y al terminar
 * vuelve a medir y dice de cuántos a cuántos tokens quedó. Un worker no recibe comandos: ahí sólo se explica por qué no.
 */
export function useCompactar(lider: Lider | null, d: Desglose, alRefrescar: () => void) {
  const [fase, setFase] = useState<FaseCompactar>("reposo");
  const [nota, setNota] = useState<{ ok: boolean; texto: string } | null>(null);
  const antes = useRef<{ usado: number | null; d: Desglose } | null>(null);
  const desde = useCompactando(lider?.id ?? null);
  const compactando = desde !== null;
  const vio = useRef(false);
  const puede = !!lider && lider.origen === "app" && !lider.ocupado && fase === "reposo";
  const porque = !lider ? t("ctxp.compactarWorker") : lider.origen !== "app" ? t("ctxp.compactarTerminal") : lider.ocupado && fase === "reposo" ? t("ctxp.compactarOcupado") : t("ctxp.compactarTip");

  const pedir = useCallback(() => {
    if (puede) {
      setNota(null);
      setFase("preguntando");
    }
  }, [puede]);
  const cancelar = useCallback(() => setFase("reposo"), []);
  const confirmar = useCallback(() => {
    if (!lider) return;
    const modelo = modeloDe(lider.modelo) ?? lider.modelo ?? MODELO_DEFAULT;
    antes.current = { usado: d.usado, d };
    vio.current = false;
    setFase("enviando");
    fuente.liderMandar(lider.id, { texto: "/compact", modelo, effort: effortDe(lider.effort, modelo) ?? lider.effort ?? "" }).then(
      () => setFase("esperando"),
      (e) => {
        setFase("reposo");
        setNota({ ok: false, texto: t("ctxp.compactarError", { motivo: mensaje(e) }) });
      },
    );
  }, [lider, d]);

  // Empezó a compactar → compactando; dejó de hacerlo → vuelve a medir.
  useEffect(() => {
    if (compactando) {
      vio.current = true;
      if (fase === "esperando") setFase("compactando");
    } else if (vio.current && (fase === "compactando" || fase === "esperando")) {
      vio.current = false;
      setFase("midiendo");
      alRefrescar();
    }
  }, [compactando, fase, alRefrescar]);
  // Nunca arrancó: no se queda esperando para siempre.
  useEffect(() => {
    if (fase !== "esperando") return;
    const x = setTimeout(() => {
      if (vio.current) return;
      setFase("reposo");
      setNota({ ok: false, texto: t("ctxp.compactarNada") });
    }, ESPERA_COMPACTAR_S * 1000);
    return () => clearTimeout(x);
  }, [fase]);
  // La medición nueva llegó: se dice el antes y el después.
  useEffect(() => {
    if (fase !== "midiendo" || !antes.current || d === antes.current.d) return;
    const a = antes.current.usado;
    setNota({ ok: true, texto: a !== null && d.usado !== null ? t("ctxp.compactado", { antes: miles(a), despues: miles(d.usado) }) : t("ctxp.compactadoSin") });
    antes.current = null;
    setFase("reposo");
  }, [fase, d]);

  return { fase, nota, puede, porque, pedir, cancelar, confirmar };
}
