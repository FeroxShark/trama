// Ajustes > Plan y cupos, la tela: una sola tarjeta por proveedor con un renglón por cuenta y, en cada uno, dos carriles de hilos (5 h y semana) pegados y
// alineados con los de las otras cuentas. Cada hilo prendido es uso. El estado va en palabras bajo el nombre, nunca sólo en color. «Usar» cambia la
// cuenta sólo cuando la persona lo toca: Trama no rota sola.
import { Check, CircleX, Clock, TriangleAlert, Unplug, X } from "lucide-react";
import type { ReactNode } from "react";
import type { VentanaCupo } from "../datos/contrato";
import type { PerfilCuenta } from "../datos/cuentas";
import { columnas } from "../barra/cuposVista";
import { t } from "../i18n";
import { cuandoFuturoCorto } from "../tiempo";
import { AvisosCuenta, Nombre, useAccionesCuenta } from "./CuentasVarias";
import { HILOS, hilosPrendidos, nivelCarril, type EstadoCuenta, type Hallazgo } from "./cupos-tejido";
import "./cupos-tela.css";

const nombreCarril = (id: string) => (id === "5h" ? t("cu.tj.5h") : id === "7d" ? t("cu.tj.7d") : id === "1m" ? t("cu.tj.1m") : id);

/** Los hilos de un carril (el número lo dice el renglón: esto es sólo para el ojo). */
export function Hilos({ pct, nivel, total = HILOS }: { pct: number | null; nivel: string; /** Cuántos hilos: la barra, que es angosta, usa menos. */ total?: number }) {
  const on = hilosPrendidos(pct, total);
  return (
    <span className="cu-hilos" data-nivel={nivel} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-on={i < on ? "" : undefined} data-tope={i === on - 1 ? "" : undefined} />
      ))}
    </span>
  );
}

/** Un carril: nombre, hilos, cifra y cuándo vuelve, en cuatro celdas de la grilla de `.cu-par`. Sin porcentaje, la cuenta de pedidos o «sin dato». */
function Carril({ v }: { v: VentanaCupo }) {
  const nivel = nivelCarril(v);
  const hay = nivel !== "off" && nivel !== "nada";
  const nota =
    nivel === "off"
      ? t("cu.w.noAplicaCorto")
      : v.pedidos !== undefined && v.tope
        ? t("cu.w.pedidosDe", { n: v.pedidos.toLocaleString(), tope: v.tope.toLocaleString() })
        : v.pedidos !== undefined
          ? t("cu.tj.pedidos", { n: v.pedidos.toLocaleString() })
          : !hay
            ? t("comun.sinDato")
            : null;
  return (
    <>
      <span className="cu-l">{nombreCarril(v.id)}</span>
      <Hilos pct={hay ? v.pct : null} nivel={nivel} />
      <span className="cu-n" data-nivel={nivel}>
        {hay ? (
          <>
            {Math.round(v.pct ?? 0)}
            <small> %</small>
          </>
        ) : (
          "—"
        )}
      </span>
      <span className="cu-v">{hay && v.vuelve !== null ? t("cu.w.vuelve", { cuando: cuandoFuturoCorto(v.vuelve) }) : hay ? null : nota}</span>
    </>
  );
}

/** Los dos carriles de una cuenta, juntos: son una sola pieza. */
export function Carriles({ ventanas }: { ventanas: VentanaCupo[] }) {
  const [a, b] = columnas(ventanas);
  if (!a && !b) return <div className="cu-par-sin">{t("uso.sinDatoCupo")}</div>;
  return (
    <div className="cu-par">
      {a ? <Carril v={a} /> : null}
      {b ? <Carril v={b} /> : null}
    </div>
  );
}

export const nombreVentanaMin = (id: string) => (id === "7d" ? t("cu.tj.semanaMin") : id === "5h" ? t("cu.tj.5hMin") : nombreCarril(id));

/** El estado en palabras, con ícono cuando pide atención. */
function Estado({ e }: { e: EstadoCuenta }) {
  switch (e.nivel) {
    case "ok":
      return <small className="cu-est">{t("cu.tj.conLugar")}</small>;
    case "sindato":
      return <small className="cu-est">{t("cu.st.sin")}</small>;
    case "desconectada":
      return (
        <small className="cu-est" data-nivel="poco">
          <Unplug size={12} strokeWidth={2} aria-hidden="true" />
          {t("cu.noConectado")}
        </small>
      );
    case "marcada":
      return (
        <small className="cu-est" data-nivel="sin">
          <Clock size={12} strokeWidth={2} aria-hidden="true" />
          {t("cu.tj.marcada")}
        </small>
      );
    case "poco":
      return (
        <small className="cu-est" data-nivel="poco">
          <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />
          {t("cu.tj.pocoV", { ventana: nombreVentanaMin(e.ventana) })}
        </small>
      );
    case "sin":
      return (
        <small className="cu-est" data-nivel="sin">
          <CircleX size={12} strokeWidth={2} aria-hidden="true" />
          {e.ventana === "5h" ? t("cu.tj.sin5h") : e.ventana === "7d" ? t("cu.tj.sin7d") : t("cu.tj.sin")}
        </small>
      );
  }
}

/** El renglón de una cuenta que no se puede elegir ni tocar: el comando `cuentas` no está y sólo se sabe su cupo. */
export function FilaFija({ nombre, estado, ventanas }: { nombre: string; estado: EstadoCuenta; ventanas: VentanaCupo[] }) {
  return (
    <li className="cu-fila" data-solo="">
      <div className="cu-nom">
        <b className="cu-nom-t">{nombre}</b>
        <Estado e={estado} />
      </div>
      <Carriles ventanas={ventanas} />
    </li>
  );
}

/**
 * El renglón de una cuenta: nombre editable y estado, sus dos carriles y, con más de una cuenta, «En uso» (con tilde) o «Usar». `solo`: es la única, no hay
 * nada que elegir y los carriles ganan el ancho. Quitar aparece al pasar o enfocar el renglón (la de siempre no se quita).
 */
export function FilaCuenta({ perfil, nombre, enUso, solo, estado, ventanas, alCambiar }: { perfil: PerfilCuenta; nombre: string; enUso: boolean; solo: boolean; estado: EstadoCuenta; ventanas: VentanaCupo[]; alCambiar: () => void }) {
  const acc = useAccionesCuenta(perfil, alCambiar);
  return (
    <li className="cu-renglon" data-cuenta={perfil.id}>
      <div className="cu-fila" data-uso={enUso && !solo ? "" : undefined} data-solo={solo ? "" : undefined}>
        <div className="cu-nom">
          <span className="cu-nom-fila">
            <Nombre perfil={perfil} texto={nombre} alGuardar={acc.renombrar} />
            {perfil.defecto ? null : (
              <button type="button" className="cu-quitar" aria-label={t("cu.tj.quitarDe", { nombre: perfil.nombre })} data-tip={t("cu.tj.quitarDe", { nombre: perfil.nombre })} aria-expanded={acc.quitando} disabled={acc.ocupada !== null} onClick={() => acc.setQuitando((q) => !q)}>
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </span>
          <Estado e={estado} />
        </div>
        <Carriles ventanas={ventanas} />
        {solo && perfil.logueado !== false ? null : (
          <div className="cu-accion">
            {perfil.logueado === false ? (
              <button type="button" className="cu-usar" data-angosto="" disabled={acc.ocupada !== null} onClick={acc.conectar}>
                {t("cu.conectar")}
              </button>
            ) : enUso ? (
              <span className="cu-en-uso" data-tip={t("cu.enUsoQue")}>
                <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                {t("cu.enUso")}
              </span>
            ) : (
              <button type="button" className="cu-usar" aria-label={t("cu.usarPrimeroDe", { nombre })} data-tip={t("cu.usarPrimeroQue")} disabled={acc.ocupada !== null} onClick={acc.usar}>
                {t("cu.usarPrimero")}
              </button>
            )}
          </div>
        )}
      </div>
      <AvisosCuenta perfil={perfil} acc={acc} />
    </li>
  );
}

/** «A Personal le queda poco esta semana. Trabajo tiene lugar. Trama no cambia de cuenta sola: elegís vos.» */
export function LineaHallazgo({ h }: { h: Hallazgo }) {
  const clave = h.nivel === "poco" ? (h.ventana === "7d" ? "cu.tj.hPoco7d" : "cu.tj.hPoco5h") : h.ventana === "7d" ? "cu.tj.hSin7d" : "cu.tj.hSin5h";
  // El nombre de la otra cuenta va en negrita adentro de la frase: el orden de las palabras lo decide cada idioma.
  const [antes, despues] = t("cu.tj.hOtra", { nombre: "\0" }).split("\0");
  return (
    <p className="cu-hallazgo" data-nivel={h.nivel} role="status">
      {h.nivel === "poco" ? <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" /> : <CircleX size={15} strokeWidth={2} aria-hidden="true" />}
      <span>
        <b>{t(clave, { nombre: h.nombre })}</b>{" "}
        {h.otra ? (
          <>
            {antes}
            <strong>{h.otra}</strong>
            {despues}{" "}
          </>
        ) : null}
        {t("cu.tj.hSola")}
      </span>
    </p>
  );
}

/** Una línea calma arriba de la tela, en el mismo lugar y con la misma forma que el hallazgo. */
export function LineaNota({ icono, nivel, children }: { icono: ReactNode; nivel?: "poco" | "sin"; children: ReactNode }) {
  return (
    <p className="cu-hallazgo" data-nivel={nivel} role="status">
      {icono}
      <span>{children}</span>
    </p>
  );
}
