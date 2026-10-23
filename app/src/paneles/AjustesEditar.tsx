// Lo que Ajustes deja cambiar con Guardar (a diferencia del idioma o la letra, que se guardan al elegir): el plan, la red
// de seguridad y el acceso desde el celular. Cada bloque trabaja sobre un borrador (ajustes-borrador.ts): nada se escribe
// hasta Guardar, Cancelar vuelve a lo guardado y lo que no vale se dice en línea antes de mandar. El main vuelve a
// validar con las mismas reglas (electron/valida-ajustes.ts) y, si algo falla, el borrador queda como estaba.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { PUERTO_MAX, PUERTO_MIN, RED_MAX, RED_MIN, type Plan } from "../../electron/valida-ajustes";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type Ajustes as Datos, type EstadoRemoto } from "../datos/paneles";
import { Selector, type Opcion } from "../hilo/Selector";
import { locale, t, textoError, textoMain, type Clave, type ClaveSola } from "../i18n";
import { enOtros, Fijo } from "../i18n/Fijo";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { agregarDispositivo, numDesde, numPara, quitarDispositivo, remotoDesde, remotoPara, type BorradorNum, type BorradorRemoto } from "./ajustes-borrador";

/** Las partes de una fila de Ajustes (la misma de Ajustes.tsx, que la pasa para no repetirla). */
export type FilaDato = (p: { nombre: ClaveSola; que: ClaveSola; children: ReactNode }) => ReactNode;

/**
 * El motivo de una validación: la clave que devuelve valida-ajustes.ts, traducida. Los topes que mencionan van como
 * `{min}` y `{max}` (los de la red o los del puerto, según el campo).
 */
const motivo = (clave: string, min: number, max: number) =>
  (t as (k: Clave, v: { min: string; max: string }) => string)(clave as Clave, { min: min.toLocaleString(locale()), max: max.toLocaleString(locale()) });

/** Para las capturas: `editando` deja cambios sin guardar; `editando-mal` los deja sin que valgan. */
const EDITANDO = MODO.variante === "editando";
const EDITANDO_MAL = MODO.variante === "editando-mal";

/** Guardar y Cancelar de un bloque; Guardar sólo cuando hay algo distinto y todo vale. */
export function Acciones({
  sucio,
  valido,
  guardando,
  ok,
  error,
  alGuardar,
  alCancelar,
}: {
  sucio: boolean;
  valido: boolean;
  guardando: boolean;
  ok: boolean;
  error: string | null;
  alGuardar: () => void;
  alCancelar: () => void;
}) {
  return (
    <div className="pn-acciones">
      <div className="pn-acciones-btns">
        <button type="button" className="btn2" data-primario disabled={!sucio || !valido || guardando} onClick={alGuardar}>
          {guardando ? t("ajustes.guardando") : t("ajustes.guardar")}
        </button>
        <button type="button" className="btn2" disabled={!sucio || guardando} onClick={alCancelar}>
          {t("ajustes.cancelar")}
        </button>
        {ok && !sucio ? (
          <span className="pn-ok" role="status">
            {t("ajustes.guardadoOk")}
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="pn-error" role="alert">
          {textoMain(error)}
        </div>
      ) : null}
    </div>
  );
}

const PLANES: Opcion[] = [
  { id: "pro", nombre: "pro", desc: "" },
  { id: "max", nombre: "max", desc: "" },
];

/**
 * El plan y la red de seguridad. Guardar manda sólo lo que cambió; lo que vuelve es Ajustes como quedó (con el plan que
 * dice `pa` de verdad, no el que se creía), y de ahí sale lo guardado.
 */
export function PlanYRed({
  inicial,
  Dato,
  largas,
}: {
  inicial: Datos;
  Dato: FilaDato;
  /** Las filas de "conversaciones largas" que van antes de la red; el relevo se muestra según el plan del borrador. */
  largas: (plan: Plan | null) => ReactNode;
}) {
  const [g, setG] = useState(inicial);
  const [b, setB] = useState<BorradorNum>(() => {
    const base = numDesde(inicial);
    if (EDITANDO) return { plan: "pro", red: "350000" };
    if (EDITANDO_MAL) return { plan: "pro", red: "50" };
    return base;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);

  const r = numPara(g, b);
  const valido = r.error === null;

  const cambiar = (nuevo: BorradorNum) => {
    setB(nuevo);
    setError(null);
    setOk(false);
  };
  const guardar = async () => {
    if (!valido || !r.sucio) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await fuentePaneles.guardarAjustes(r.cambio);
      if (!vivo.current) return;
      if (nuevo.version !== VERSION) throw new Error(t("error.version", { que: t("panel.ajustes"), v: nuevo.version, conozco: VERSION }));
      setG(nuevo);
      setB(numDesde(nuevo));
      setOk(true);
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  const redId = "ajustes-red";
  return (
    <>
      <section className="pn-sec">
        <h2 className="pn-h">{t("ajustes.plan")}</h2>
        <Dato nombre="ajustes.planSus" que="ajustes.planQue">
          {g.plan && b.plan ? (
            <div className="pn-sel">
              <Selector
                etiqueta={t("ajustes.planSus")}
                opciones={PLANES.map((o) => ({ ...o, desc: t(o.id === "pro" ? "ajustes.planProQue" : "ajustes.planMaxQue") }))}
                valor={b.plan}
                alElegir={(plan) => cambiar({ ...b, plan: plan === "pro" ? "pro" : "max" })}
                reserva={[]}
              />
            </div>
          ) : (
            <span className="pn-falta">{g.plan_error ? textoError(g.plan_error) : t("comun.sinDato")}</span>
          )}
        </Dato>
      </section>

      <section className="pn-sec pn-edita">
        <h2 className="pn-h">{t("ajustes.largas")}</h2>
        {largas(b.plan)}
        <Dato nombre="ajustes.red" que="ajustes.redQue">
          <div className="pn-campo-fila">
            <input
              id={redId}
              className="pn-campo pn-campo-num"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={b.red}
              placeholder={t("ajustes.sinDefinir")}
              aria-label={t("ajustes.red")}
              aria-invalid={!valido}
              aria-describedby={valido ? undefined : `${redId}-e`}
              onChange={(e) => cambiar({ ...b, red: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void guardar();
              }}
            />
            <span className="pn-unidad">{t("ajustes.redUnidad")}</span>
          </div>
          {r.error ? (
            <div className="pn-error pn-campo-error" id={`${redId}-e`}>
              {motivo(r.error, RED_MIN, RED_MAX)}
            </div>
          ) : null}
        </Dato>
        <Acciones sucio={r.sucio} valido={valido} guardando={guardando} ok={ok} error={error} alGuardar={() => void guardar()} alCancelar={() => cambiar(numDesde(g))} />
      </section>
    </>
  );
}

const ESTADOS: Opcion[] = [
  { id: "on", nombre: "", desc: "" },
  { id: "off", nombre: "", desc: "" },
];

/**
 * El acceso desde el celular: prendido o apagado, el puerto y los dispositivos que entran. Sólo en la PC (por la tailnet
 * `editable` viene en falso y la sección no se ve). Dónde se escucha no se elige acá: siempre y sólo las direcciones de
 * Tailscale, y un nombre que parezca una dirección no se acepta como dispositivo.
 */
export function Celular({ Dato }: { Dato: FilaDato }) {
  const [e, setE] = useState<EstadoRemoto | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [b, setB] = useState<BorradorRemoto | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const vivo = useRef(true);
  const sec = useRef<HTMLElement>(null);
  const nuevoRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => void (vivo.current = false), []);

  useEffect(() => {
    fuentePaneles.remoto().then(
      (r) => {
        if (!vivo.current) return;
        setE(r);
        if (r.editable) {
          const base = remotoDesde(r);
          if (EDITANDO) setB({ ...base, dispositivos: [...base.dispositivos, "mi-tablet"] });
          else if (EDITANDO_MAL) setB({ ...base, puerto: "80", nuevo: "192.168.0.7" });
          else setB(base);
        }
      },
      (x) => vivo.current && setFalla(mensaje(x)),
    );
  }, []);

  // Las capturas del celular abren el panel mostrando esta sección.
  const visible = e?.editable === true && b !== null;
  useEffect(() => {
    if (visible && (MODO.variante === "celular" || EDITANDO || EDITANDO_MAL)) sec.current?.scrollIntoView({ block: "start" });
  }, [visible]);

  if (falla) return <div className="pn-aviso" data-error>{textoMain(falla)}</div>;
  if (!e || !e.editable || !b) return null;

  const r = remotoPara(e, b);
  const valido = r.config !== null;
  const cambiar = (nuevo: BorradorRemoto) => {
    setB(nuevo);
    setError(null);
    setOk(false);
  };
  const agregar = () => {
    if (!b.nuevo.trim()) return;
    const a = agregarDispositivo(b);
    cambiar(a.borrador);
    if (!a.error) nuevoRef.current?.focus();
  };
  const guardar = async () => {
    if (!r.config || !r.sucio) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await fuentePaneles.guardarRemoto(r.config);
      if (!vivo.current) return;
      if (nuevo.version !== VERSION) throw new Error(t("error.version", { que: t("ajustes.celular"), v: nuevo.version, conozco: VERSION }));
      setE(nuevo);
      if (nuevo.editable) setB(remotoDesde(nuevo));
      setOk(true);
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };
  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    agregar();
  };

  // Lo que se dice de dónde escucha es lo guardado y andando, no el borrador.
  const escucha = e.escuchando[0];
  const estado = !e.activo ? t("ajustes.celApagado") : escucha ? t("ajustes.celEscucha", { url: escucha }) : t("ajustes.celSinEscuchar");
  // Un nombre a medio escribir que no vale se señala con el error del campo, no con el general.
  const errNuevo = b.nuevo.trim() && r.errores.nuevo !== "ajustes.errDispPendiente" ? r.errores.nuevo : null;
  const errPuerto = r.errores.puerto ?? null;
  const pendiente = b.nuevo.trim() && !errNuevo;
  const opciones = ESTADOS.map((o) => ({ ...o, nombre: t(o.id === "on" ? "ajustes.celOn" : "ajustes.celOff"), desc: t("ajustes.celAccesoQue") }));

  return (
    <section className="pn-sec pn-edita" ref={sec} data-celular>
      <h2 className="pn-h">{t("ajustes.celular")}</h2>
      <Fijo k="ajustes.celularIntro" bloque className="pn-nota pn-intro" />
      <div className="pn-estado" data-escucha={e.activo && escucha ? "" : undefined}>
        {estado}
      </div>

      <Dato nombre="ajustes.celAcceso" que="ajustes.celAccesoQue">
        <div className="pn-sel">
          <Selector etiqueta={t("ajustes.celAcceso")} opciones={opciones} valor={b.activo ? "on" : "off"} alElegir={(id) => cambiar({ ...b, activo: id === "on" })} reserva={[...enOtros("ajustes.celOn"), ...enOtros("ajustes.celOff")]} />
        </div>
      </Dato>

      <Dato nombre="ajustes.celPuerto" que="ajustes.celPuertoQue">
        <input
          className="pn-campo pn-campo-num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={b.puerto}
          aria-label={t("ajustes.celPuerto")}
          aria-invalid={errPuerto !== null}
          onChange={(ev) => cambiar({ ...b, puerto: ev.target.value })}
        />
        {errPuerto ? <div className="pn-error pn-campo-error">{motivo(errPuerto, PUERTO_MIN, PUERTO_MAX)}</div> : null}
      </Dato>

      <Dato nombre="ajustes.celDisp" que="ajustes.celDispQue">
        <ul className="pn-disp" aria-label={t("ajustes.celDisp")}>
          {b.dispositivos.length ? (
            b.dispositivos.map((d) => (
              <li key={d}>
                <span className="pn-disp-nom">{d}</span>
                <button type="button" className="pn-quitar" aria-label={t("ajustes.celQuitar", { nombre: d })} data-tip={t("ajustes.celQuitar", { nombre: d })} onClick={() => cambiar(quitarDispositivo(b, d))}>
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))
          ) : (
            <li className="pn-falta">
              <Fijo k="ajustes.celNinguno" />
            </li>
          )}
        </ul>
        <form className="pn-nuevo" onSubmit={enviar}>
          <input
            ref={nuevoRef}
            className="pn-campo"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={b.nuevo}
            placeholder={t("ajustes.celDispNuevo")}
            aria-label={t("ajustes.celDispNuevo")}
            aria-invalid={errNuevo !== null}
            onChange={(ev) => cambiar({ ...b, nuevo: ev.target.value })}
          />
          <button type="submit" className="btn2" disabled={!pendiente}>
            <Plus size={14} aria-hidden />
            <Fijo k="ajustes.celAgregar" />
          </button>
        </form>
        {errNuevo ? <div className="pn-error pn-campo-error">{motivo(errNuevo, 0, 0)}</div> : null}
      </Dato>

      <Acciones
        sucio={r.sucio}
        valido={valido}
        guardando={guardando}
        ok={ok}
        error={error ?? (r.errores.general ? motivo(r.errores.general, 0, 0) : r.errores.nuevo === "ajustes.errDispPendiente" ? motivo(r.errores.nuevo, 0, 0) : null)}
        alGuardar={() => void guardar()}
        alCancelar={() => cambiar(remotoDesde(e))}
      />
    </section>
  );
}
