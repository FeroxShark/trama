// La «barra lisa» de un cupo: una barra continua por límite, la cifra mediana con dígitos tabulares y cuándo vuelve. La comparten el riel
// (`compacta`: nombre corto, barrita y cifra; lo demás en el tooltip), el globito y Ajustes (`normal`). Neutra hasta el 80 %, ámbar con
// «queda poco» desde ahí y coral con «sin cupo» al 100 %: siempre con palabra o ícono, nunca sólo el color. El acento del tema no se usa
// (en `atardecer` es el mismo coral del «sin cupo»). Qué dice cada caso: barra-cupo-logica.ts.
import "./barra-cupo.css";
import { ariaBarra, vistaBarra } from "./barra-cupo-logica";
import { IcAtencion, IcSinCupo } from "./iconos";

export type VarianteBarra = "normal" | "compacta";

export function BarraCupo({
  nombre,
  pct,
  vuelve = null,
  variante = "normal",
  ahora,
}: {
  /** El nombre a la vista («5 h», «Semana», «sem»). */
  nombre: string;
  /** % usado; `null`: sin dato. */
  pct: number | null;
  /** Cuándo vuelve (epoch s); `null` o 0: no se sabe. */
  vuelve?: number | null;
  variante?: VarianteBarra;
  /** Epoch s (para las capturas y los tests); sin él, ahora. */
  ahora?: number;
}) {
  const v = vistaBarra({ pct, vuelve }, ahora);
  const frase = ariaBarra(nombre, v);
  const Icono = v.nivel === "sin" ? IcSinCupo : v.nivel === "poco" ? IcAtencion : null;
  const icono = Icono ? <Icono className="bcupo-ic" aria-hidden size="1em" strokeWidth={2.2} /> : null;
  const compacta = variante === "compacta";
  return (
    <div
      className="bcupo"
      data-variante={variante}
      data-nivel={v.nivel}
      data-sin-dato={v.sinDato || undefined}
      role="meter"
      aria-label={nombre}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v.relleno}
      aria-valuetext={frase}
      title={compacta ? frase : undefined}
    >
      <span className="bcupo-nombre" aria-hidden>
        {nombre}
        {compacta ? icono : null}
      </span>
      <span className="bcupo-cifra" aria-hidden>
        {v.cifra}
      </span>
      <span className="bcupo-pista" aria-hidden>
        <span className="bcupo-uso" style={{ transform: `scaleX(${v.relleno / 100})` }} />
      </span>
      {!compacta && (v.texto || v.vuelve) ? (
        <span className="bcupo-pie" aria-hidden>
          {v.texto ? (
            <span className="bcupo-estado">
              {icono}
              {v.texto}
            </span>
          ) : null}
          {v.vuelve ? <span className="bcupo-vuelve">{v.vuelve}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
