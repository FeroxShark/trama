// Lo que Ajustes deja cambiar con Guardar (a diferencia del idioma o la letra, que se guardan al elegir): el plan y cuándo
// compacta Claude. Cada bloque trabaja sobre un borrador (ajustes-borrador.ts): nada se escribe hasta Guardar (una sola barra
// fija abajo, ajustes-barra.ts), Cancelar vuelve a lo guardado y lo que no vale se dice en línea antes de mandar. El main vuelve
// a validar con las mismas reglas (electron/valida-ajustes.ts) y, si algo falla, el borrador queda como estaba.
// El acceso desde el celular no tiene Guardar: cada cambio se manda al tocarlo (`Celular`).
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Cat } from "./AjustesNav";
import { PanelCargando } from "./PanelCargando";
import { declarar } from "./ajustes-nav";
import { Plus, X } from "lucide-react";
import { type Aplicando, detalleAcceso, EstadoEscucha, PasosCelular } from "./CelularGuia";
import { PUERTO_MAX, PUERTO_MIN } from "../../electron/valida-ajustes";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type Ajustes as Datos, type EstadoRemoto } from "../datos/paneles";
import { Selector, type Opcion } from "../hilo/Selector";
import { locale, t, textoError, textoMain, type Clave, type ClaveSola } from "../i18n";
import { enOtros, Fijo } from "../i18n/Fijo";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { cancelarTodo, guardarTodo, publicar, resumen, suscribir } from "./ajustes-barra";
import { agregarDispositivo, alternarAcceso, numDesde, numPara, quitarAplicando, remotoDesde, remotoPara, type BorradorNum, type BorradorRemoto } from "./ajustes-borrador";

/** Las partes de una fila de Ajustes (la misma de Ajustes.tsx, que la pasa para no repetirla). */
export type FilaDato = (p: { nombre: ClaveSola; que: ClaveSola; icono?: ReactNode; children: ReactNode }) => ReactNode;

/**
 * El motivo de una validación: la clave que devuelve valida-ajustes.ts, traducida. Los topes que mencionan van como
 * `{min}` y `{max}` (los de la red o los del puerto, según el campo).
 */
export const motivo = (clave: string, min: number, max: number) =>
  (t as (k: Clave, v: { min: string; max: string }) => string)(clave as Clave, { min: min.toLocaleString(locale()), max: max.toLocaleString(locale()) });

/** Para las capturas: `editando` deja cambios sin guardar; `editando-mal` los deja sin que valgan. */
const EDITANDO = MODO.variante === "editando";
const EDITANDO_MAL = MODO.variante === "editando-mal";
/** `prendiendo`: el acceso apagado y el motor todavía contestando a un prender (la captura de "Prendiendo…"). */
const PRENDIENDO = MODO.variante === "prendiendo";

/**
 * Un bloque editable le cuenta su estado a la barra de Guardar (ajustes-barra.ts); no pinta nada. Guardar y Cancelar son
 * de la barra, que los aplica a todos los bloques con cambios.
 */
export function Acciones({
  id,
  sucio,
  valido,
  guardando,
  ok,
  error,
  alGuardar,
  alCancelar,
}: {
  id: string;
  sucio: boolean;
  valido: boolean;
  guardando: boolean;
  ok: boolean;
  error: string | null;
  alGuardar: () => void | Promise<void>;
  alCancelar: () => void;
}) {
  useEffect(() => {
    publicar(id, { sucio, valido, guardando, ok, error, guardar: alGuardar, cancelar: alCancelar });
  });
  useEffect(() => () => publicar(id, null), [id]);
  return null;
}

/** La barra fija de abajo: dice si hay cambios sin guardar y guarda o cancela todos los bloques de una vez. */
export function BarraGuardar() {
  const r = useSyncExternalStore(suscribir, resumen);
  const estado = r.guardando ? t("ajustes.guardando") : r.sucio ? t("ajustes.sinGuardar") : r.ok ? t("ajustes.guardadoOk") : t("ajustes.sinCambios");
  return (
    <div className="pn-barra" data-sucio={r.sucio ? "" : undefined} role="group" aria-label={t("ajustes.barra")}>
      {r.error ? (
        <div className="pn-error pn-barra-error" role="alert">
          {textoMain(r.error)}
        </div>
      ) : null}
      <div className="pn-barra-fila">
        <span className="pn-barra-estado" role="status">
          {estado}
        </span>
        <button type="button" className="btn2" disabled={!r.sucio || r.guardando} onClick={cancelarTodo}>
          {t("ajustes.cancelar")}
        </button>
        <button type="button" className="btn2" data-primario disabled={!r.puedeGuardar} onClick={() => void guardarTodo()}>
          {r.guardando ? t("ajustes.guardando") : t("ajustes.guardar")}
        </button>
      </div>
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
}: {
  inicial: Datos;
  Dato: FilaDato;
}) {
  const [g, setG] = useState(inicial);
  const [b, setB] = useState<BorradorNum>(() => {
    const base = numDesde(inicial);
    if (EDITANDO) return { plan: "pro", red: base.red };
    return base;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);

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
        <Acciones id="plan" sucio={r.sucio} valido={valido} guardando={guardando} ok={ok} error={error} alGuardar={guardar} alCancelar={() => cambiar(numDesde(g))} />
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
 * `editable` viene en falso y la sección no se ve; sin Tailscale en la PC se explica cómo instalarlo). Dónde se escucha no se elige acá: siempre y sólo las direcciones de
 * Tailscale, y un nombre que parezca una dirección no se acepta como dispositivo.
 * Sin Guardar: prender, apagar, agregar, quitar y el puerto (al salir de su campo o con Enter) se mandan al motor en el momento.
 * Mientras contesta, el estado dice lo que se hace; lo que devuelve (dónde escucha y quién entró) es lo que se muestra.
 */
export function Celular({ Dato }: { Dato: FilaDato }) {
  const [e, setE] = useState<EstadoRemoto | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [b, setB] = useState<BorradorRemoto | null>(null);
  const [aplicando, setAplicando] = useState<Aplicando | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  // Cada cambio lleva su número: la respuesta de uno viejo no pisa lo que ya se cambió después.
  const ultimo = useRef(0);
  const sec = useRef<HTMLElement>(null);
  const nuevoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);
  // Quién entró y si escucha cambia sin que Ajustes se entere: se vuelve a mirar al volver a la ventana (sin reloj).
  // Sólo se toma lo que informa el motor; el borrador no se toca.
  useEffect(() => {
    const alFoco = () => {
      if (document.visibilityState === "hidden") return;
      fuentePaneles.remoto().then(
        (r) => vivo.current && r.editable && setE((antes) => (antes?.editable ? { ...antes, escuchando: r.escuchando, accesos: r.accesos } : antes)),
        () => {},
      );
    };
    window.addEventListener("focus", alFoco);
    return () => window.removeEventListener("focus", alFoco);
  }, []);

  useEffect(() => {
    fuentePaneles.remoto().then(
      (r) => {
        if (!vivo.current) return;
        setE(r);
        if (r.editable) {
          const base = remotoDesde(r);
          if (EDITANDO_MAL) setB({ ...base, puerto: "80", nuevo: "192.168.0.7" });
          else if (PRENDIENDO) {
            setB({ ...base, activo: true });
            setAplicando("prender");
          } else setB(base);
        }
      },
      (x) => vivo.current && setFalla(mensaje(x)),
    );
  }, []);

  // Las capturas del celular abren el panel mostrando esta sección.
  const sinTs = e?.editable === false ? e.sinTailscale : undefined;
  const visible = (e?.editable === true && b !== null) || sinTs !== undefined;
  // La categoría Celular existe sólo si esta sección se ve (o si falló y hay que decirlo).
  useEffect(() => {
    declarar("celular", visible || falla !== null);
    return () => declarar("celular", false);
  }, [visible, falla]);
  useEffect(() => {
    if (visible && (MODO.variante === "celular" || EDITANDO || EDITANDO_MAL)) sec.current?.scrollIntoView({ block: "start" });
  }, [visible]);

  if (falla) return <Cat id="celular"><div className="pn-aviso" data-error>{textoMain(falla)}</div></Cat>;
  if (!e && !falla) return <Cat id="celular"><PanelCargando /></Cat>;
  // En la PC pero sin Tailscale: no hay qué prender; se explica cómo instalarlo (volver a abrir Ajustes lo detecta).
  if (sinTs) {
    const como = sinTs === "win32" ? "ajustes.celSinTsWin" : sinTs === "linux" ? "ajustes.celSinTsLinux" : "ajustes.celSinTsOtro";
    return (
      <Cat id="celular">
        <section className="pn-sec" ref={sec} data-celular data-sin-tailscale>
          <Fijo k="ajustes.celSinTsT" bloque className="pn-nota pn-intro" />
          <Fijo k={como} bloque className="pn-nota" />
          <Fijo k="ajustes.celSinTsFin" bloque className="pn-nota" />
        </section>
      </Cat>
    );
  }
  if (!e || !e.editable || !b) return null;

  // Lo que se muestra: lo escrito en los campos (con el motivo de lo que no vale) sobre lo que ya está guardado.
  const r = remotoPara(e, b);
  const cambiar = (nuevo: BorradorRemoto) => {
    setB(nuevo);
    setError(null);
  };
  /**
   * Manda `nuevo` al motor ya, sin Guardar, y se queda con lo que devuelve (dónde escucha y quién entró). El nombre a medio
   * escribir no va: se agrega con Agregar o al prender. Lo que no vale no se manda: queda en su campo, con su motivo.
   * Si el motor falla, el borrador vuelve a lo guardado y el error se dice en palabras.
   */
  const aplicar = async (nuevo: BorradorRemoto, que: Aplicando) => {
    const v = remotoPara(e, { ...nuevo, nuevo: "" });
    if (!v.config) {
      // Prender sin dispositivos no mueve el interruptor: el motivo va arriba. Lo demás (un puerto a medias) queda en su campo.
      if (v.errores.general) setError(motivo(v.errores.general, 0, 0));
      else setB(nuevo);
      return;
    }
    setB(nuevo);
    setError(null);
    if (!v.sucio) return;
    const mio = ++ultimo.current;
    setAplicando(que);
    try {
      const n = await fuentePaneles.guardarRemoto(v.config);
      if (!vivo.current || mio !== ultimo.current) return;
      if (n.version !== VERSION) throw new Error(t("error.version", { que: t("ajustes.celular"), v: n.version, conozco: VERSION }));
      setE(n);
      if (n.editable) setB((antes) => ({ ...remotoDesde(n), nuevo: antes?.nuevo ?? "" }));
    } catch (x) {
      if (!vivo.current || mio !== ultimo.current) return;
      setError(t("ajustes.celNoAplico", { error: mensaje(x) }));
      setB((antes) => ({ ...remotoDesde(e), nuevo: antes?.nuevo ?? "" }));
    } finally {
      if (vivo.current && mio === ultimo.current) setAplicando(null);
    }
  };
  const alternar = (on: boolean) => {
    // Prender con un nombre escrito lo agrega antes; si ese nombre no vale, su motivo queda en el campo y no se prende.
    const { borrador, error: mal } = alternarAcceso(b, on);
    if (mal) return;
    void aplicar(borrador, on ? "prender" : "apagar");
  };
  const quitar = (nombre: string) => void aplicar(quitarAplicando(b, nombre), "cambiar");
  const agregar = () => {
    if (!b.nuevo.trim()) return;
    const a = agregarDispositivo(b);
    // Si no vale, el motivo ya está en su campo.
    if (a.error) return;
    void aplicar(a.borrador, "cambiar").then(() => nuevoRef.current?.focus());
  };
  // El puerto se manda al salir de su campo o con Enter, no mientras se escribe (pasaría por puertos a medias).
  const aplicarPuerto = () => void aplicar(b, "cambiar");
  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    agregar();
  };

  // Lo que se dice de dónde escucha es lo guardado y andando, no el borrador.
  const escucha = e.escuchando[0];
  const visto = new Map(e.accesos.map((a) => [a.nombre, a]));
  // Un nombre a medio escribir que no vale se señala con el error del campo, no con el general.
  const errNuevo = b.nuevo.trim() && r.errores.nuevo !== "ajustes.errDispPendiente" ? r.errores.nuevo : null;
  const errPuerto = r.errores.puerto ?? null;
  const pendiente = b.nuevo.trim() && !errNuevo;
  const opciones = ESTADOS.map((o) => ({ ...o, nombre: t(o.id === "on" ? "ajustes.celOn" : "ajustes.celOff"), desc: t("ajustes.celAccesoQue") }));

  return (
    <Cat id="celular">
    <section className="pn-sec pn-edita" ref={sec} data-celular>
      <EstadoEscucha activo={e.activo} url={escucha} aplicando={aplicando} />
      <div data-opc="ajustes.celGuia">
        <PasosCelular url={e.activo ? escucha : undefined} />
      </div>
      <Fijo k="ajustes.celularIntro" bloque className="pn-nota pn-intro" />

      <Dato nombre="ajustes.celAcceso" que="ajustes.celAccesoQue">
        <div className="pn-sel">
          <Selector etiqueta={t("ajustes.celAcceso")} opciones={opciones} valor={b.activo ? "on" : "off"} alElegir={(id) => alternar(id === "on")} reserva={[...enOtros("ajustes.celOn"), ...enOtros("ajustes.celOff")]} />
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
          onBlur={aplicarPuerto}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") aplicarPuerto();
          }}
        />
        {errPuerto ? <div className="pn-error pn-campo-error">{motivo(errPuerto, PUERTO_MIN, PUERTO_MAX)}</div> : null}
      </Dato>

      <Dato nombre="ajustes.celDisp" que="ajustes.celDispQue">
        <ul className="pn-disp" aria-label={t("ajustes.celDisp")}>
          {b.dispositivos.length ? (
            b.dispositivos.map((d) => (
              <li key={d} className="cel-disp">
                <div className="cel-disp-txt">
                  <div className="pn-disp-nom">{d}</div>
                  <div className="cel-disp-sub">{detalleAcceso(visto.get(d))}</div>
                </div>
                <button type="button" className="pn-quitar cel-quitar" aria-label={t("ajustes.celQuitar", { nombre: d })} data-tip={t("ajustes.celQuitar", { nombre: d })} onClick={() => quitar(d)}>
                  <X size={14} aria-hidden />
                  {t("ajustes.celQuitarAcceso")}
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

      {error ? <div className="pn-error" role="alert">{error}</div> : null}
    </section>
    </Cat>
  );
}
