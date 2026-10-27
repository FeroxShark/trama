// Ajustes > Modelos > «Contexto antes de compactar»: un tope de tokens por familia (Haiku, Sonnet, Opus) que `pa` pasa como `--autocompact`
// a los workers de Claude. Nativo = no se pasa nada. Se guarda en `autocompact.por_modelo` de modelos.json (ajustes-autocompact.ts) y
// trabaja sobre el borrador de AjustesModelos: nada se escribe hasta Guardar.
import { useState } from "react";
import { t } from "../i18n";
import type { Borrador } from "./modelos-borrador";
import {
  AUTOCOMPACT_FAMILIAS,
  COMPACTAR_MAX_K,
  COMPACTAR_MIN_K,
  COMPACTAR_PRESETS,
  esPredeterminado,
  kDeTope,
  ponerTope,
  topeDeK,
  topeEfectivo,
  type Familia,
} from "./ajustes-autocompact";

const NOMBRE: Record<Familia, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

function Fila({ fam, b, cambiar }: { fam: Familia; b: Borrador; cambiar: (b: Borrador) => void }) {
  const valor = topeEfectivo(b, fam);
  const preset = valor !== null && (COMPACTAR_PRESETS as readonly number[]).includes(valor);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(valor !== null && !preset ? kDeTope(valor) : "");
  const otro = valor !== null && !preset ? true : abierto;
  const r = topeDeK(texto);
  const nombre = NOMBRE[fam];
  const elegir = (v: number | null) => {
    setAbierto(false);
    setTexto("");
    cambiar(ponerTope(b, fam, v));
  };
  const escribir = (x: string) => {
    setTexto(x);
    const c = topeDeK(x);
    if (c.valor !== null) cambiar(ponerTope(b, fam, c.valor));
  };
  return (
    <div className="mdl-compactar-fila" role="group" aria-label={t("ajustes.mdlCompactarDe", { modelo: nombre })}>
      <span className="mdl-compactar-nom">
        {nombre}
        {esPredeterminado(b, fam) && valor !== null ? <span className="pn-unidad"> · {t("ajustes.mdlCompactarPorDefecto")}</span> : null}
      </span>
      <div className="pn-chips">
        <button type="button" className="pn-chip-f" aria-pressed={valor === null} onClick={() => elegir(null)}>
          {t("ajustes.mdlCompactarNativo")}
        </button>
        {COMPACTAR_PRESETS.map((n) => (
          <button key={n} type="button" className="pn-chip-f" aria-pressed={valor === n} onClick={() => elegir(n)}>
            {kDeTope(n)} k
          </button>
        ))}
        <button type="button" className="pn-chip-f" aria-pressed={otro} onClick={() => setAbierto(true)}>
          {t("ajustes.mdlCompactarOtro")}
        </button>
      </div>
      {otro ? (
        <div className="pn-campo-fila">
          <input
            className="pn-campo pn-campo-num"
            type="number"
            inputMode="numeric"
            min={COMPACTAR_MIN_K}
            max={COMPACTAR_MAX_K}
            step={10}
            value={texto}
            placeholder={valor === null ? "300" : kDeTope(valor)}
            aria-label={t("ajustes.mdlCompactarOtroDe", { modelo: nombre })}
            aria-invalid={!!r.error}
            onChange={(e) => escribir(e.target.value)}
          />
          <span className="pn-unidad">k</span>
        </div>
      ) : null}
      {r.error && otro ? (
        <div className="bv-error pn-campo-error" role="alert">
          {t("ajustes.errCompactarRango", { min: COMPACTAR_MIN_K, max: COMPACTAR_MAX_K })}
        </div>
      ) : null}
    </div>
  );
}

export function AutocompactFilas({ b, cambiar }: { b: Borrador; cambiar: (b: Borrador) => void }) {
  return (
    <div className="mdl-compactar">
      {AUTOCOMPACT_FAMILIAS.map((f) => (
        <Fila key={f} fam={f} b={b} cambiar={cambiar} />
      ))}
    </div>
  );
}
