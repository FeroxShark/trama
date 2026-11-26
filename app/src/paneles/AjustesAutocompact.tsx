// Ajustes > Modelos > «Contexto antes de compactar»: un tope de tokens por familia (Haiku, Sonnet, Opus) que `pa` pasa como `--autocompact`
// a los workers de Claude. Nativo = no se pasa nada. Se guarda en `autocompact.por_modelo` de modelos.json (ajustes-autocompact.ts) y
// trabaja sobre el borrador de AjustesModelos: nada se escribe hasta Guardar. Los líderes usan el mismo tope salvo que se apague
// «Igual que los workers»: entonces tienen el suyo (`autocompact_lider`). Abajo va «Compactar con nota del modelo».
import { useState } from "react";
import { t } from "../i18n";
import { Interruptor } from "../ui/componentes";
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
  separarLideres,
  type Familia,
  type Rol,
} from "./ajustes-autocompact";
import {
  NOTA_PCT_DEFECTO,
  NOTA_PCT_MAX,
  NOTA_PCT_MIN,
  NOTA_TAREA_PCT_DEFECTO,
  NOTA_TAREA_PCT_MAX,
  NOTA_TAREA_PCT_MIN,
  pctNotaDe,
  ponerNotaCompactar,
  ponerNotaCompactarPct,
  ponerNotaCompactarTarea,
  ponerNotaCompactarTareaPct,
} from "./ajustes-nota-compactar";

const NOMBRE: Record<Familia, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", gemini: "Gemini", codex: "ChatGPT" };

function Fila({ fam, b, cambiar, rol }: { fam: Familia; b: Borrador; cambiar: (b: Borrador) => void; rol: Rol }) {
  const valor = topeEfectivo(b, fam, rol);
  const preset = valor !== null && (COMPACTAR_PRESETS as readonly number[]).includes(valor);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(valor !== null && !preset ? kDeTope(valor) : "");
  const otro = valor !== null && !preset ? true : abierto;
  const r = topeDeK(texto);
  const nombre = rol === "lideres" ? t("ajustes.mdlCompactarLider", { modelo: NOMBRE[fam] }) : NOMBRE[fam];
  const elegir = (v: number | null) => {
    setAbierto(false);
    setTexto("");
    cambiar(ponerTope(b, fam, v, rol));
  };
  const escribir = (x: string) => {
    setTexto(x);
    const c = topeDeK(x);
    if (c.valor !== null) cambiar(ponerTope(b, fam, c.valor, rol));
  };
  return (
    <div className="mdl-compactar-fila" role="group" aria-label={t("ajustes.mdlCompactarDe", { modelo: nombre })}>
      <span className="mdl-compactar-nom">
        {NOMBRE[fam]}
        {esPredeterminado(b, fam, rol) && valor !== null ? <span className="pn-unidad"> · {t("ajustes.mdlCompactarPorDefecto")}</span> : null}
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

function NotaCompactarFilas({ b, cambiar }: { b: Borrador; cambiar: (b: Borrador) => void }) {
  const activa = b.notaCompactar ?? true;
  const pctStr = b.notaCompactarPct ?? String(NOTA_PCT_DEFECTO);
  const tareaOn = b.notaCompactarTarea ?? true;
  const tareaStr = b.notaCompactarTareaPct ?? String(NOTA_TAREA_PCT_DEFECTO);
  const pctRes = pctNotaDe(pctStr, NOTA_PCT_MIN, NOTA_PCT_MAX);
  const tareaRes = pctNotaDe(tareaStr, NOTA_TAREA_PCT_MIN, NOTA_TAREA_PCT_MAX);
  const pctVista = pctRes.valor ?? NOTA_PCT_DEFECTO;
  const tareaVista = tareaRes.valor ?? NOTA_TAREA_PCT_DEFECTO;

  return (
    <>
      <div className="mdl-compactar-tit mdl-compactar-igual">
        <span>{t("ajustes.mdlNotaActiva")}</span>
        <Interruptor activo={activa} alCambiar={(v) => cambiar(ponerNotaCompactar(b, v))} aria-label={t("ajustes.mdlNotaActiva")} />
      </div>
      <p className="pn-alt">{t("ajustes.mdlNotaActivaQue")}</p>

      {activa ? (
        <>
          <div className="mdl-compactar-fila">
            <span className="mdl-compactar-nom">{t("ajustes.mdlNotaPct", { n: pctVista })}</span>
            <div className="pn-campo-fila">
              <input
                className="pn-campo pn-campo-num"
                type="number"
                inputMode="numeric"
                min={NOTA_PCT_MIN}
                max={NOTA_PCT_MAX}
                step={5}
                value={pctStr}
                aria-label={t("ajustes.mdlNotaPctLabel")}
                aria-invalid={pctRes.error}
                onChange={(e) => cambiar(ponerNotaCompactarPct(b, e.target.value))}
              />
              <span className="pn-unidad">%</span>
            </div>
            {pctRes.error ? (
              <div className="bv-error pn-campo-error" role="alert">
                {t("ajustes.errNotaPctRango", { min: NOTA_PCT_MIN, max: NOTA_PCT_MAX })}
              </div>
            ) : null}
          </div>
          <p className="pn-alt">{t("ajustes.mdlNotaPctQue")}</p>

          <div className="mdl-compactar-tit mdl-compactar-igual">
            <span>{t("ajustes.mdlNotaTarea", { n: tareaVista })}</span>
            <Interruptor activo={tareaOn} alCambiar={(v) => cambiar(ponerNotaCompactarTarea(b, v))} aria-label={t("ajustes.mdlNotaTareaLabel")} />
          </div>
          {tareaOn ? (
            <div className="mdl-compactar-fila">
              <span className="mdl-compactar-nom">{t("ajustes.mdlNotaTareaLabel")}</span>
              <div className="pn-campo-fila">
                <input
                  className="pn-campo pn-campo-num"
                  type="number"
                  inputMode="numeric"
                  min={NOTA_TAREA_PCT_MIN}
                  max={NOTA_TAREA_PCT_MAX}
                  step={5}
                  value={tareaStr}
                  aria-label={t("ajustes.mdlNotaTareaLabel")}
                  aria-invalid={tareaRes.error}
                  onChange={(e) => cambiar(ponerNotaCompactarTareaPct(b, e.target.value))}
                />
                <span className="pn-unidad">%</span>
              </div>
              {tareaRes.error ? (
                <div className="bv-error pn-campo-error" role="alert">
                  {t("ajustes.errNotaPctRango", { min: NOTA_TAREA_PCT_MIN, max: NOTA_TAREA_PCT_MAX })}
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="pn-alt">{t("ajustes.mdlNotaTareaQue")}</p>
        </>
      ) : null}
      <p className="pn-alt">{t("ajustes.mdlNotaSinMotores")}</p>
    </>
  );
}

export function AutocompactFilas({ b, cambiar }: { b: Borrador; cambiar: (b: Borrador) => void }) {
  const igual = b.autocompactLider === null;
  return (
    <div className="mdl-compactar">
      <div className="mdl-compactar-tit">{t("ajustes.mdlCompactarWorkers")}</div>
      {AUTOCOMPACT_FAMILIAS.map((f) => (
        <Fila key={f} fam={f} b={b} cambiar={cambiar} rol="workers" />
      ))}
      <div className="mdl-compactar-tit mdl-compactar-igual">
        <span>{t("ajustes.mdlCompactarIgual")}</span>
        <Interruptor activo={igual} alCambiar={(v) => cambiar(separarLideres(b, !v))} aria-label={t("ajustes.mdlCompactarIgual")} />
      </div>
      {igual ? null : AUTOCOMPACT_FAMILIAS.map((f) => <Fila key={`l-${f}`} fam={f} b={b} cambiar={cambiar} rol="lideres" />)}
      <NotaCompactarFilas b={b} cambiar={cambiar} />
    </div>
  );
}
