// Ajustes > Plan y cupos: una tarjeta por suscripción (Claude, Google AI Pro, ChatGPT) con su logo, si está conectada, el plan y
// cada ventana con su barra y cuándo vuelve; abajo, lo que se escribe en `modelos.json` (guardar un % para mis sesiones y qué hace
// `pa` si un proveedor se queda sin cupo). Trabaja sobre el borrador de AjustesModelos (nada se escribe hasta Guardar). Los textos que
// cambian con el tiempo ("vuelve en 20 h") los escribe el reloj, no React.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, CalendarClock, Check, ChevronDown, Clock, Info, Minus, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { Boton, Chip, Interruptor, Tarjeta } from "../ui/componentes";
import { LogoCaja, type Proveedor } from "../ui/logos";
import type { GrupoCupo, SuscripcionCupo, Uso, VentanaCupo } from "../datos/contrato";
import { fuente, type CuentaEstado, type EstadoCuentas } from "../datos/fuente";
import { Selector } from "../hilo/Selector";
import { Logo } from "../hilo/Logos";
import { opencodeAgotadoDe } from "../hilo/agotados";
import { t, type ClaveSola } from "../i18n";
import { enOtros } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { Reloj } from "../barra/piezas";
import { cuandoFuturo, fechaCorta, pintorVuelve } from "../tiempo";
import { estadoVentana, resumenGrupo, resumenSusc } from "../barra/cuposVista";
import { nombreGrupo, queGrupo } from "../barra/cuposNombres";
import { textoEstado, textoSusc } from "../barra/cuposTextos";
import { carcasa } from "../carcasa";
import { cuentasDe, AgregarCuenta, CuentaFila, useCuentas } from "./CuentasVarias";
import type { PerfilCuenta, ProveedorCuenta } from "../datos/cuentas";
import type { FilaDato } from "./AjustesEditar";
import { avisosTope, GOOGLE_CODIGO, GOOGLE_LLENA } from "./cupos-aviso";
import { PERFILES, SIN_CUPO, TOPE_CLAUDE_DEFECTO, type Borrador, type Perfil, type SinCupo } from "./modelos-borrador";
import { reservaDePerfil, ritmoSemanal, type Ritmo } from "./cupos-ritmo";

const SIN_CUPO_CLAVES: Record<SinCupo, { nombre: ClaveSola; que: ClaveSola }> = {
  otro: { nombre: "cu.sinCupoOtro", que: "cu.sinCupoOtroQue" },
  esperar: { nombre: "cu.sinCupoEsperar", que: "cu.sinCupoEsperarQue" },
  fallar: { nombre: "cu.sinCupoFallar", que: "cu.sinCupoFallarQue" },
};

const PERFIL_CLAVES: Record<Perfil, { nombre: ClaveSola; que: ClaveSola }> = {
  equilibrado: { nombre: "cu.perfilEquilibrado", que: "cu.perfilEquilibradoQue" },
  ahorro: { nombre: "cu.perfilAhorro", que: "cu.perfilAhorroQue" },
  rendimiento: { nombre: "cu.perfilRendimiento", que: "cu.perfilRendimientoQue" },
};

const TOPE_FORMATO = /^\s*$|^\d{1,3}$/;
const topeMal = (v: string) => !TOPE_FORMATO.test(v) || (v.trim() !== "" && (Number(v) < 1 || Number(v) > 100));

type UsoClaude = Extract<Uso, { five_hour: unknown }>;
const conDatos = (u: Uso | null): u is UsoClaude => u !== null && "five_hour" in u;

/** "vuelve en 20 h · jue 01:01": lo relativo lo escribe el reloj compartido; la hora local exacta no cambia, va fija. Sin hora no se pinta nada. */
function Vuelve({ epoch }: { epoch: number | null }) {
  const pintor = useMemo(() => (epoch === null ? null : pintorVuelve(epoch)), [epoch]);
  return pintor && epoch !== null ? (
    <span className="cu-vuelve">
      <Reloj pintor={pintor} />
      <span className="cu-vuelve-abs"> · {cuandoFuturo(epoch)}</span>
    </span>
  ) : null;
}

const nombreVentana = (id: string) => (id === "5h" ? t("cu.v.5h") : id === "7d" ? t("cu.v.7d") : id);

const ICONO_NIVEL = { ok: Check, bajo: TriangleAlert, lleno: Ban, parcial: Ban, marcado: Clock, sin: Minus } as const;

/** Una ventana de cupo: nombre, barra, % usado y cuándo vuelve. Agotada: insignia y cuándo vuelve; que no rige: «no aplica ahora», sin 0 %. */
function Ventana({ v }: { v: VentanaCupo }) {
  const est = estadoVentana(v);
  const nombre = nombreVentana(v.id);
  return (
    <div className="cu-vent" data-estado={est} role="group" aria-label={nombre}>
      <span className="cu-vent-n">{nombre}</span>
      {est === "off" ? (
        <>
          <span className="cu-off" title={t("cu.w.noAplicaQue")}>{t("cu.w.noAplica")}</span>
          <span className="cu-nota">{t("cu.w.noAplicaQue")}</span>
        </>
      ) : est === "sin" ? (
        <span className="cu-sin">{t("uso.sinDatoCupo")}</span>
      ) : (
        <>
          <div className="ui-bar" data-tono={est === "lleno" ? "critico" : est === "bajo" ? "aviso" : undefined}>
            <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, (v.pct ?? 0) / 100))})` }} />
          </div>
          {est === "lleno" ? (
            <span className="cu-insignia" data-tono="critico">
              <Ban size={12} strokeWidth={2.4} aria-hidden="true" />
              {t("cu.w.agotada")}
            </span>
          ) : (
            <span className="cu-pct" data-estado={est}>
              {est === "bajo" ? <TriangleAlert size={12} strokeWidth={2.4} aria-hidden="true" /> : null}
              {t("cu.w.usado", { pct: Math.round(v.pct ?? 0) })}
            </span>
          )}
          <Vuelve epoch={v.vuelve} />
        </>
      )}
    </div>
  );
}

/**
 * Cómo va la semana contra el ritmo que la termina en ~100 %: icono y palabras (el color solo no alcanza con daltonismo rojo-verde).
 * Encima: los workers usan más modelos gratis; debajo: se aprovecha antes del reinicio. Sin dato no se pinta nada.
 */
function RitmoSemanal({ r }: { r: Ritmo }) {
  const Icono = r.nivel === "encima" ? TrendingUp : r.nivel === "debajo" ? TrendingDown : Minus;
  return (
    <div className="cu-ritmo" data-nivel={r.nivel} role="status">
      <Icono size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>{r.nivel === "al-ritmo" ? t("cu.ritmo.igual") : t(r.nivel === "encima" ? "cu.ritmo.encima" : "cu.ritmo.debajo", { pct: r.pct })}</span>
    </div>
  );
}

/** `reserva`: lo que se guarda de la semana para el líder (sólo la de Claude); con ventana semanal con dato, su ritmo va debajo. */
const Ventanas = ({ vs, reserva = 0 }: { vs: VentanaCupo[]; reserva?: number }) => (
  <>
    {vs.map((v) => {
      const r = v.id === "7d" && !v.deshabilitada ? ritmoSemanal(v.pct, v.vuelve, Date.now() / 1000, reserva) : null;
      return (
        <div key={v.id} className="cu-vent-con">
          <Ventana v={v} />
          {r ? <RitmoSemanal r={r} /> : null}
        </div>
      );
    })}
  </>
);

/** Una píldora con icono y texto (el color solo no alcanza con daltonismo rojo-verde). */
function Pildora({ nivel, children }: { nivel: keyof typeof ICONO_NIVEL; children: ReactNode }) {
  const Icono = ICONO_NIVEL[nivel];
  return (
    <span className="cu-pildora" data-nivel={nivel}>
      <Icono size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

function Grupo({ g }: { g: GrupoCupo }) {
  const r = resumenGrupo(g, Date.now() / 1000);
  const que = queGrupo(g);
  return (
    <div className="cu-grupo" data-estado={r.estado}>
      <div className="cu-grupo-cab">
        <div className="cu-grupo-id">
          <div className="cu-grupo-n">{nombreGrupo(g)}</div>
          {que ? <div className="cu-grupo-q">{que}</div> : null}
        </div>
        <Pildora nivel={r.estado}>{textoEstado(r)}</Pildora>
      </div>
      {r.estado === "marcado" ? <div className="cu-nota">{t("cu.w.marcaQue")}</div> : <Ventanas vs={g.ventanas} />}
      {g.hasta ? (
        <div className="cu-hasta">
          <CalendarClock size={13} strokeWidth={2} aria-hidden="true" />
          <span>{t("cu.hastaFecha", { d: fechaCorta(g.hasta) })}</span>
        </div>
      ) : null}
    </div>
  );
}

/** La línea de arriba de una tarjeta: «OK», «Queda poco», «Agotado hasta jue 01:01». */
function Resumen({ s }: { s: { ventanas?: VentanaCupo[]; grupos?: GrupoCupo[]; agotado?: number } }) {
  const r = resumenSusc(s, Date.now() / 1000);
  return (
    <div className="cu-res" data-nivel={r.nivel} role="status">
      <Pildora nivel={r.nivel}>{textoSusc(r, s.grupos)}</Pildora>
    </div>
  );
}

/** «Cómo funcionan estos límites»: un botón que despliega las particularidades del proveedor (se toca; no depende de pasar el mouse). */
function Ayuda({ lineas }: { lineas: ClaveSola[] }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="cu-ayuda" data-abierta={abierta ? "" : undefined}>
      <button type="button" className="cu-ayuda-b" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
        <Info size={13} strokeWidth={2} aria-hidden="true" />
        <span>{t("cu.ayuda")}</span>
        <ChevronDown className="cu-ayuda-f" size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {abierta ? (
        <ul className="cu-ayuda-l">
          {lineas.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Las ventanas de Claude (statusline) como ventanas de cupo. */
const ventanasClaude = (uso: UsoClaude): VentanaCupo[] => [
  { id: "5h", pct: uso.five_hour?.pct ?? null, vuelve: uso.five_hour?.resets_at ?? null },
  { id: "7d", pct: uso.seven_day?.pct ?? null, vuelve: uso.seven_day?.resets_at ?? null },
];

/** El chip de arriba de una tarjeta: conectada, sin conectar, sin instalar, o sin saber. */
function Estado({ c }: { c: CuentaEstado | undefined }) {
  if (!c) return <Chip>{t("comun.sinDato")}</Chip>;
  if (c.logueado) return <Chip tono="ok">{t("cu.conectado")}</Chip>;
  return <Chip tono="aviso">{t(c.instalado ? "cu.noConectado" : "cu.noInstalado")}</Chip>;
}

/** `estado` `null`: hay varias cuentas y cada una dice el suyo. */
function Cabecera({ id, nombre, estado }: { id: Proveedor; nombre: string; estado: CuentaEstado | undefined | null }) {
  return (
    <div className="cu-cab">
      <LogoCaja id={id} />
      <h4 className="cu-nombre">{nombre}</h4>
      {estado === null ? null : <Estado c={estado} />}
    </div>
  );
}

/** "Conectar": en el .exe abre la consola de login; en todos lados explica cómo se hace, sin prometer nada que no pasa solo. */
function Conectar({ id, c, como, alMirar }: { id: Proveedor; c: CuentaEstado | undefined; como: string; alMirar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  if (c?.logueado) return null;
  const puente = carcasa();
  return (
    <div className="cu-conectar">
      <Boton
        aria-expanded={abierto}
        onClick={() => {
          setAbierto((a) => !a);
          if (puente && id !== "chatgpt" && c?.instalado) void puente.conectar(id === "claude" ? "claude" : "gemini");
        }}
      >
        {t("cu.conectar")}
      </Boton>
      {abierto ? (
        <div className="cu-como" role="status">
          <span>{como}</span>
          <Boton onClick={alMirar}>{t("cu.volverAMirar")}</Boton>
        </div>
      ) : null}
    </div>
  );
}

/** El cupo de una cuenta agregada (la de siempre se pinta con lo de siempre): sus ventanas o sus grupos, o «sin dato». */
function CupoDe({ uso, proveedor, perfil }: { uso: Uso | null; proveedor: ProveedorCuenta; perfil: PerfilCuenta }) {
  const s = conDatos(uso) ? uso.suscripciones?.find((x) => (x.proveedor ?? x.id) === proveedor && (x.cuenta ?? x.id) === perfil.id) : undefined;
  if (s?.grupos?.length) return <>{s.grupos.map((g) => <Grupo key={g.id} g={g} />)}</>;
  if (s?.ventanas?.length) return <Ventanas vs={s.ventanas} />;
  return <div className="cu-sin">{t("uso.sinDatoCupo")}</div>;
}

/**
 * Las cuentas de un proveedor cuando hay más de una: una fila por cuenta con su nombre, su estado y su cupo (`deSiempre`: lo de
 * siempre para la principal). Con una sola, `null` y la tarjeta se ve como siempre.
 */
function ListaCuentas({ proveedor, perfiles, uso, deSiempre, alCambiar }: { proveedor: ProveedorCuenta; perfiles: PerfilCuenta[]; uso: Uso | null; deSiempre: ReactNode; alCambiar: () => void }) {
  if (perfiles.length < 2) return null;
  return (
    <div className="cu-cuentas">
      {perfiles.map((p) => (
        <CuentaFila key={p.id} perfil={p} alCambiar={alCambiar}>
          {p.defecto ? deSiempre : <CupoDe uso={uso} proveedor={proveedor} perfil={p} />}
        </CuentaFila>
      ))}
    </div>
  );
}

const planClaude = (plan: string | null) => (plan === "max" ? t("cu.planMax") : plan === "pro" ? t("cu.planPro") : "Claude");

/** Arriba de la categoría: el aviso de tope cruzado y las tres tarjetas de suscripción. */
export function CuposTarjetas({ b, uso, plan }: { b: Borrador; uso: Uso | null; plan: string | null }) {
  useIdioma();
  const [cuentas, setCuentas] = useState<EstadoCuentas | null>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);

  const mirar = useCallback(() => {
    void fuente.cuentas().then((c) => vivo.current && setCuentas(c), () => undefined);
  }, []);
  useEffect(() => {
    mirar();
    // Al volver a la ventana (se hizo el login en una terminal) se vuelve a mirar, sin reloj.
    window.addEventListener("focus", mirar);
    return () => window.removeEventListener("focus", mirar);
  }, [mirar]);

  const { lista, mirar: mirarCuentas } = useCuentas();
  const alCambiarCuentas = useCallback(() => {
    mirarCuentas();
    mirar();
  }, [mirarCuentas, mirar]);
  const pClaude = cuentasDe(lista, "claude");
  const pGoogle = cuentasDe(lista, "google");
  const pChatgpt = cuentasDe(lista, "chatgpt");

  const google: SuscripcionCupo | undefined = conDatos(uso) ? uso.suscripciones?.find((s) => s.id === "google") : undefined;
  const avisos = avisosTope(b, uso);
  const vClaude = conDatos(uso) ? ventanasClaude(uso) : null;
  const cupoClaude = vClaude ? <Ventanas vs={vClaude} reserva={reservaDePerfil(b.perfil)} /> : (
    <div className="cu-sin">{t("uso.sinDatoCupo")}</div>
  );
  const cupoGoogle = google?.grupos ? google.grupos.map((g) => <Grupo key={g.id} g={g} />) : google?.ventanas ? <Ventanas vs={google.ventanas} /> : <div className="cu-sin">{t("uso.sinDatoCupo")}</div>;

  return (
    <section className="cu-sec">
      {avisos.map((a) => (
        <div key={a.ventana} className="pn-aviso mdl-cruce cu-aviso" role="status">
          <div>
            {t("cu.avisoTope", { quien: t("cu.claude"), ventana: t(a.ventana === "5h" ? "cu.ventana5h" : "cu.ventanaSem"), pct: a.pct })}
            {a.vuelve !== null ? ", " : ""}
            <Vuelve epoch={a.vuelve} />
          </div>
          <div className="cu-aviso-q">{t("cu.avisoTopeQue", { tope: a.tope })}</div>
        </div>
      ))}

      <div className="cu-tarjetas">
        <div data-opc="cu.claude">
          <Tarjeta>
            <Cabecera id="claude" nombre={planClaude(plan)} estado={pClaude.length > 1 ? null : cuentas?.claude} />
            <div className="cu-cuerpo">
              {pClaude.length > 1 ? (
                <ListaCuentas proveedor="claude" perfiles={pClaude} uso={uso} deSiempre={cupoClaude} alCambiar={alCambiarCuentas} />
              ) : (
                <>
                  {vClaude ? <Resumen s={{ ventanas: vClaude }} /> : null}
                  {cupoClaude}
                  <Ayuda lineas={["cu.ayuda.claude1"]} />
                  <Conectar id="claude" c={cuentas?.claude} como={t("cu.comoClaude")} alMirar={mirar} />
                </>
              )}
              {lista ? <AgregarCuenta proveedor="claude" alCambiar={alCambiarCuentas} /> : null}
            </div>
          </Tarjeta>
        </div>

        <div data-opc="cu.google">
          <Tarjeta>
            <Cabecera id="google" nombre={t("cu.google")} estado={pGoogle.length > 1 ? null : cuentas?.agy} />
            <div className="cu-cuerpo">
              {pGoogle.length > 1 ? null : google ? <Resumen s={google} /> : null}
              {pGoogle.length > 1 ? <ListaCuentas proveedor="google" perfiles={pGoogle} uso={uso} deSiempre={cupoGoogle} alCambiar={alCambiarCuentas} /> : cupoGoogle}
              <Ayuda lineas={["cu.ayuda.google1", "cu.ayuda.google2", "cu.ayuda.google3", "cu.ayuda.google4", "cu.ayuda.google5", "cu.ayuda.google6"]} />
              {pGoogle.length > 1 ? null : <Conectar id="google" c={cuentas?.agy} como={t("cu.comoGoogle")} alMirar={mirar} />}
              {lista ? <AgregarCuenta proveedor="google" alCambiar={alCambiarCuentas} /> : null}
            </div>
          </Tarjeta>
        </div>

        <div data-opc="cu.chatgpt">
          <Tarjeta>
            <Cabecera id="chatgpt" nombre={t("cu.chatgpt")} estado={pChatgpt.length > 1 ? null : (cuentas?.codex ?? (cuentas ? { instalado: false, logueado: false, cuenta: null, error: null } : undefined))} />
            <div className="cu-cuerpo">
              {pChatgpt.length > 1 ? (
                <ListaCuentas proveedor="chatgpt" perfiles={pChatgpt} uso={uso} deSiempre={<div className="cu-sin">{t("cu.chatgptSinCupo")}</div>} alCambiar={alCambiarCuentas} />
              ) : (
                <>
                  <div className="cu-sin">{t("cu.chatgptSinCupo")}</div>
                  <Ayuda lineas={["cu.ayuda.chatgpt1"]} />
                  <Conectar id="chatgpt" c={cuentas?.codex} como={t(cuentas?.codex?.instalado ? "cu.comoCodex" : "cu.comoCodexInstalar")} alMirar={mirar} />
                </>
              )}
              {lista && pChatgpt.length > 0 ? <AgregarCuenta proveedor="chatgpt" alCambiar={alCambiarCuentas} /> : null}
            </div>
          </Tarjeta>
        </div>

        <div data-opc="cu.opencode">
          <TarjetaOpencode uso={uso} />
        </div>
      </div>
    </section>
  );
}

/** OpenCode: sus modelos gratis comparten UN cupo (no hay cuentas que rotar); acá se ve si está disponible o agotado y cuándo se renueva. */
function TarjetaOpencode({ uso }: { uso: Uso | null }) {
  const hasta = opencodeAgotadoDe(uso);
  return (
    <Tarjeta>
      <div className="cu-cab">
        <span className="cu-logo"><Logo empresa="opencode" /></span>
        <h4 className="cu-nombre">{t("cu.opencode")}</h4>
      </div>
      <div className="cu-cuerpo">
        <div className="cu-res" data-nivel={hasta ? "lleno" : "ok"} role="status">
          <Pildora nivel={hasta ? "lleno" : "ok"}>{hasta ? t("cu.opencode.agotado", { cuando: cuandoFuturo(hasta) }) : t("cu.opencode.libre")}</Pildora>
        </div>
        <div className="cu-nota">{t("cu.opencode.libreQue")}</div>
        <Ayuda lineas={["cu.opencode.pagos", "cu.opencode.mas"]} />
      </div>
    </Tarjeta>
  );
}

/** Lo que se escribe en `modelos.json`: guardar un % para mis sesiones y qué hace `pa` sin cupo. */
export function AjustesCupos({ Dato, b, cambiar }: { Dato: FilaDato; b: Borrador; cambiar: (b: Borrador) => void }) {
  useIdioma();
  const errTope5 = topeMal(b.tope5);
  const errTope7 = topeMal(b.tope7);
  const nuevo = (k: "tope5" | "tope7") => (ev: { target: { value: string } }) => cambiar({ ...b, [k]: ev.target.value });
  const campo = (k: "tope5" | "tope7", mal: boolean, etiqueta: ClaveSola) => (
    <div className="pn-campo-fila">
      <input
        className="pn-campo pn-campo-num"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={b[k]}
        placeholder={String(TOPE_CLAUDE_DEFECTO)}
        aria-label={t(etiqueta)}
        aria-invalid={mal}
        onChange={nuevo(k)}
      />
      <span className="pn-unidad">%</span>
    </div>
  );

  return (
    <section className="pn-sec pn-edita cu-avanzado">
      <h3 className="pn-h">{t("cu.avanzado")}</h3>
      <div className="cu-av-q">{t("cu.avanzadoQue")}</div>
      <Dato nombre="ajustes.cuposPerfil" que="ajustes.cuposPerfilQue">
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.cuposPerfil")}
            opciones={PERFILES.map((id) => ({ id, nombre: t(PERFIL_CLAVES[id].nombre), desc: t(PERFIL_CLAVES[id].que), ...(id === "equilibrado" ? { rec: true } : {}) }))}
            valor={b.perfil ?? "equilibrado"}
            alElegir={(id) => cambiar({ ...b, perfil: id as Perfil })}
            reserva={PERFILES.flatMap((id) => enOtros(PERFIL_CLAVES[id].nombre))}
          />
        </div>
      </Dato>
      <Dato nombre="ajustes.cuposGuardar" que="ajustes.cuposGuardarQue">
        <Interruptor activo={b.guardar} alCambiar={(v) => cambiar({ ...b, guardar: v })} aria-label={t("ajustes.cuposGuardar")} />
      </Dato>
      {b.guardar ? (
        <>
          <Dato nombre="ajustes.mdlTope5" que="ajustes.mdlTope5Que">
            {campo("tope5", errTope5, "ajustes.mdlTope5")}
            {errTope5 ? <div className="pn-error pn-campo-error">{t("ajustes.mdlTopeErr")}</div> : null}
          </Dato>
          <Dato nombre="ajustes.mdlTope7" que="ajustes.mdlTope7Que">
            {campo("tope7", errTope7, "ajustes.mdlTope7")}
            {errTope7 ? <div className="pn-error pn-campo-error">{t("ajustes.mdlTopeErr")}</div> : null}
          </Dato>
        </>
      ) : null}

      <Dato nombre="ajustes.cuposSinCupo" que="ajustes.cuposSinCupoQue">
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.cuposSinCupo")}
            opciones={SIN_CUPO.map((id) => ({ id, nombre: t(SIN_CUPO_CLAVES[id].nombre), desc: t(SIN_CUPO_CLAVES[id].que), ...(id === "otro" ? { rec: true } : {}) }))}
            valor={b.sin_cupo ?? "otro"}
            alElegir={(id) => cambiar({ ...b, sin_cupo: id as SinCupo })}
            reserva={SIN_CUPO.flatMap((id) => enOtros(SIN_CUPO_CLAVES[id].nombre))}
          />
        </div>
      </Dato>

      {/* Lo que pa ya hace con Google: valores fijos (no se editan), pero se ven acá junto a los ajustes que sí se editan. */}
      <Dato nombre="cu.topesGoogle" que="cu.topesQue">
        <div className="cu-topes">
          <div className="cu-tope">
            <span>{t("cu.saltoLlena")}</span>
            <Chip>{t("cu.saltoDesde", { pct: GOOGLE_LLENA })}</Chip>
          </div>
          <div className="cu-tope">
            <span>{t("cu.saltoCodigo")}</span>
            <Chip>{t("cu.saltoDesde", { pct: GOOGLE_CODIGO })}</Chip>
          </div>
        </div>
      </Dato>
    </section>
  );
}
