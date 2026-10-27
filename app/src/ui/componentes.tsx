// Los componentes base del estándar visual (ui.css, tokens de tokens.css): botón, interruptor, chip, tarjeta, fila de ajustes con
// ícono, barra de cupo e insignia de modelo. Sin lógica propia: reciben todo por props y los textos ya traducidos.
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tono = "ok" | "aviso" | "critico";

export function Boton({ primario, ancho, className, ...r }: ButtonHTMLAttributes<HTMLButtonElement> & { primario?: boolean; ancho?: boolean }) {
  return <button type="button" {...r} className={`ui-btn ${className ?? ""}`} data-primario={primario || undefined} data-ancho={ancho || undefined} />;
}

/** Interruptor 40×24; la etiqueta la pone quien lo usa (`aria-label` o `aria-labelledby`). */
export function Interruptor({ activo, alCambiar, ...r }: { activo: boolean; alCambiar: (v: boolean) => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role">) {
  return <button type="button" {...r} role="switch" aria-checked={activo} className="ui-sw" onClick={() => alCambiar(!activo)} />;
}

export function Chip({ tono, children }: { tono?: Tono; children: ReactNode }) {
  return (
    <span className="ui-chip" data-tono={tono}>
      {children}
    </span>
  );
}

export function Tarjeta({ titulo, children }: { titulo?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-card">
      {titulo ? <h3 className="ui-card-t">{titulo}</h3> : null}
      {children}
    </section>
  );
}

/** Fila de 48 px de una tarjeta: ícono opcional, título con su detalle a la izquierda y el control a la derecha. */
export function FilaAjuste({ icono, titulo, detalle, children }: { icono?: ReactNode; titulo: ReactNode; detalle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-fila">
      {icono ? <span className="ui-fila-ico">{icono}</span> : null}
      <div className="ui-fila-txt">
        <div className="ui-fila-t">{titulo}</div>
        {detalle ? <div className="ui-fila-d">{detalle}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Barra de cupo de 4 px: `fraccion` de 0 a 1; desde 0,7 avisa y desde 0,9 es crítica (las mismas reglas que `nivel` del contexto). */
export function BarraCupo({ fraccion }: { fraccion: number }) {
  const f = Math.min(1, Math.max(0, fraccion));
  return (
    <div className="ui-bar" data-tono={f >= 0.9 ? "critico" : f >= 0.7 ? "aviso" : undefined}>
      <i style={{ transform: `scaleX(${f})` }} />
    </div>
  );
}

/**
 * Indicador chico del esfuerzo: una barrita por nivel de `niveles`, llenas las primeras `lleno` (el último nivel, max, las llena todas); el último nivel (max) lleva el acento.
 * Con `palabra`, el nivel escrito al lado (para que no dependa sólo del dibujo). Las barritas son decorativas (`aria-hidden`).
 */
export function Esfuerzo({ nivel, niveles, lleno, palabra }: { nivel: string; niveles: readonly string[]; lleno: number; palabra?: boolean }) {
  if (niveles.length < 2) return null;
  return (
    <>
      <span className="ui-esf" data-tope={lleno === niveles.length && niveles.length > 3 ? "" : undefined} aria-hidden>
        {niveles.map((n, k) => (
          <i key={n} data-on={k < lleno ? "" : undefined} style={{ height: `${0.25 + (k * 0.375) / (niveles.length - 1)}rem` }} />
        ))}
      </span>
      {palabra ? <span className="ui-esf-p">{nivel}</span> : null}
    </>
  );
}
