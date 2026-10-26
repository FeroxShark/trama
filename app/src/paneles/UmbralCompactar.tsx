// El campo del tope de compactación, compartido por Ajustes > General y la Bienvenida: un número en miles de tokens
// (rango y paso de ajustes-compactar.ts), atajos de uso común y "Sin tope". Guarda el mismo valor (`red_seguridad`) en ambos lados.
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { kDe, PASO_K, PRESETS_K, RED_MAX_K, RED_MIN_K, TOPE_DEFECTO, umbralDeK } from "./ajustes-compactar";
import { RED_MAX } from "../../electron/valida-ajustes";

export type CambioUmbral = { valor: number | null; error: string | null };

export function UmbralCompactar({ id, valor, alCambiar, disabled }: { id: string; valor: number | null; alCambiar: (c: CambioUmbral) => void; disabled?: boolean }) {
  const [texto, setTexto] = useState(valor === null ? "" : kDe(valor));
  // Si de afuera cambia el valor (Cancelar, guardado), el campo lo sigue; mientras se escribe algo inválido no se pisa.
  useEffect(() => {
    if (valor !== null && umbralDeK(texto).valor !== valor) setTexto(kDe(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  const r = umbralDeK(texto);
  const poner = (x: string) => {
    setTexto(x);
    alCambiar(umbralDeK(x));
  };
  const sinTope = valor === RED_MAX;
  return (
    <div className="pn-umbral">
      <div className="pn-campo-fila">
        <input
          id={id}
          className="pn-campo pn-campo-num"
          type="number"
          inputMode="numeric"
          min={RED_MIN_K}
          max={RED_MAX_K}
          step={PASO_K}
          value={texto}
          placeholder={String(TOPE_DEFECTO / 1000)}
          disabled={disabled}
          aria-invalid={!!r.error}
          aria-describedby={r.error ? `${id}-e` : undefined}
          onChange={(e) => poner(e.target.value)}
        />
        <span className="pn-unidad">{t("ajustes.umbralUnidad")}</span>
      </div>
      <div className="pn-chips" role="group" aria-label={t("ajustes.umbralAtajos")}>
        {PRESETS_K.map((k) => (
          <button key={k} type="button" className="pn-chip-f" aria-pressed={valor === k * 1000} disabled={disabled} onClick={() => poner(String(k))}>
            {k} k
          </button>
        ))}
        <button type="button" className="pn-chip-f" aria-pressed={sinTope} disabled={disabled} onClick={() => poner(String(RED_MAX_K))}>
          {t("ajustes.compactarSinTope")}
        </button>
      </div>
      {r.error ? (
        <div className="bv-error pn-campo-error" id={`${id}-e`} role="alert">
          {r.error === "ajustes.errRedNumero" ? t("ajustes.errRedNumero") : t("ajustes.errUmbralRango", { min: RED_MIN_K, max: RED_MAX_K })}
        </div>
      ) : null}
    </div>
  );
}
