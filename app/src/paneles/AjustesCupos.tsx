// Ajustes > Plan y cupos: Claude en una sola tarjeta con un renglón por cuenta (CuentaCupo.tsx); las demás suscripciones (Google AI Pro, OpenCode, ChatGPT,
// NVIDIA NIM) en una tarjeta chica con su estado y su cupo en una línea, que se abre para ver cada ventana, el plan y conectarla, y que con varias cuentas
// pasa a ser una tela como la de Claude. Abajo, lo que se escribe en `modelos.json` (guardar un % para mis sesiones y qué hace `pa` si un proveedor se
// queda sin cupo). Trabaja sobre el borrador de AjustesModelos (nada se escribe hasta Guardar). Los textos que cambian con el tiempo ("vuelve en 20 h") los
// escribe el reloj, no React.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Ban, CalendarClock, Check, ChevronDown, Clock, Info, Minus, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { Boton, Chip } from "../ui/componentes";
import { LogoCaja, type Proveedor } from "../ui/logos";
import type { GrupoCupo, SuscripcionCupo, Uso, VentanaCupo } from "../datos/contrato";
import { fuente, type CuentaEstado, type EstadoCuentas } from "../datos/fuente";
import { Selector } from "../hilo/Selector";
import { goAgotadosHasta } from "../hilo/agotados";
import { fuentePaneles, type EstadoNim, type EstadoOpencodeUi, type VistaPlanGo } from "../datos/paneles";
import { pedirModelos } from "../datos/modelos-config";
import { aplicarModelos } from "../hilo/opciones";
import { nombreOpencode } from "../hilo/modelos";
import { mensaje } from "../puente";
import { t, textoMain, type ClaveSola } from "../i18n";
import { enOtros } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { Reloj } from "../barra/piezas";
import { cuandoFuturo, fechaCorta, pintorVuelve } from "../tiempo";
import { resumenGrupo, resumenSusc, type ResumenSusc } from "../barra/cuposVista";
import { nombreGrupo, nombreGrupoCorto, queGrupo } from "../barra/cuposNombres";
import { textoEstado, textoSusc } from "../barra/cuposTextos";
import { carcasa } from "../carcasa";
import { cuentasDe, AgregarCuenta, useCuentas } from "./CuentasVarias";
import { parteCuenta, suscripcionDe, type PerfilCuenta, type PlanCuentaClaude, type ProveedorCuenta } from "../datos/cuentas";
import { EVENTO_PLAN_CLAUDE, esPlanClaude, planDeCuenta } from "./plan-claude";
import type { FilaDato } from "./AjustesEditar";
import { avisosTope } from "./cupos-aviso";
import { cambiado, fabricaDe, poner, restaurar, topeDe, TOPE_MAX, TOPE_MIN, type IdTope } from "./cupos-topes";
import { GrupoAjustes, FilaAjuste } from "./AjustesPiezas";
import { irA, pendienteDeMostrar, suscribir } from "./ajustes-nav";
import { FilaCuenta, FilaFija, LimiteCupo, LineaHallazgo, LineaNota, nombreVentanaMin } from "./CuentaCupo";
import { esEnUso, estadoCuenta, hallazgo, ventanasDeSusc, type FilaResumen } from "./cupos-tejido";
import { PERFILES, SIN_CUPO, type Borrador, type Perfil, type SinCupo } from "./modelos-borrador";
import { reservaDePerfil, ritmoSemanal, type Ritmo } from "./cupos-ritmo";

const SIN_CUPO_CLAVES: Record<SinCupo, { nombre: ClaveSola; que: ClaveSola }> = {
  otro: { nombre: "cu.sinCupoOtro", que: "cu.sinCupoOtroQue" },
  esperar: { nombre: "cu.sinCupoEsperar", que: "cu.sinCupoEsperarQue" },
  fallar: { nombre: "cu.sinCupoFallar", que: "cu.sinCupoFallarQue" },
};

const PERFIL_CLAVES: Record<Perfil, { nombre: ClaveSola; que: ClaveSola }> = {
  equilibrado: { nombre: "cu.perfilEquilibrado", que: "cu.perfilEquilibradoQue" },
  ahorro: { nombre: "cu.perfilAhorro", que: "cu.perfilAhorroQue" },
  agresivo: { nombre: "cu.perfilAgresivo", que: "cu.perfilAgresivoQue" },
  rendimiento: { nombre: "cu.perfilRendimiento", que: "cu.perfilRendimientoQue" },
};

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

const nombreVentana = (id: string) => (id === "5h" ? t("cu.v.5h") : id === "7d" ? t("cu.v.7d") : id === "1m" ? t("cu.v.1m") : id);

const ICONO_NIVEL = { ok: Check, bajo: TriangleAlert, lleno: Ban, parcial: Ban, marcado: Clock, sin: Minus } as const;

/** Una ventana de cupo como barra lisa (`BarraCupo`): nombre, % usado, la barra y cuándo vuelve; agotada, «sin cupo» en palabras; que no rige, «no aplica ahora». */
const Ventana = ({ v }: { v: VentanaCupo }) => <LimiteCupo v={v} nombre={nombreVentana(v.id)} />;

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

/** Una explicación larga plegada: un botón que la despliega (se toca; no depende de pasar el mouse). `titulo`: «Cómo funciona», «Cómo funcionan estos límites». */
function Plegable({ titulo, children }: { titulo: string; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="cu-ayuda" data-abierta={abierta ? "" : undefined}>
      <button type="button" className="cu-ayuda-b" aria-expanded={abierta} onClick={() => setAbierta((a) => !a)}>
        <Info size={13} strokeWidth={2} aria-hidden="true" />
        <span>{titulo}</span>
        <ChevronDown className="cu-ayuda-f" size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {abierta ? children : null}
    </div>
  );
}

/** «Cómo funcionan estos límites»: lo particular de cada proveedor, plegado. */
function Ayuda({ lineas, antes }: { lineas: ClaveSola[]; antes?: ReactNode }) {
  return (
    <Plegable titulo={t("cu.ayuda")}>
      <ul className="cu-ayuda-l">
        {antes ? <li>{antes}</li> : null}
        {lineas.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
    </Plegable>
  );
}

/** Las ventanas de Claude (statusline) como ventanas de cupo. */
const ventanasClaude = (uso: UsoClaude): VentanaCupo[] => [
  { id: "5h", pct: uso.five_hour?.pct ?? null, vuelve: uso.five_hour?.resets_at ?? null },
  { id: "7d", pct: uso.seven_day?.pct ?? null, vuelve: uso.seven_day?.resets_at ?? null },
];

type EstadoProv = { texto: string; tono?: "ok" | "aviso" };

/** Qué dice una suscripción de sí misma: conectada, sin conectar, sin instalar, o sin saber. */
function estadoProv(c: CuentaEstado | undefined): EstadoProv {
  if (!c) return { texto: t("comun.sinDato") };
  if (c.logueado) return { texto: t("cu.conectado"), tono: "ok" };
  return { texto: t(c.instalado ? "cu.noConectado" : "cu.noInstalado"), tono: "aviso" };
}

/** Arriba de una tarjeta chica: logo, nombre y estado; debajo, su cupo en una línea. Toda ella es el botón que abre el detalle. */
function Cabecera({ id, nombre, estado, resumen, abierta, alTocar }: { id: Proveedor; nombre: string; estado: EstadoProv | null; resumen: ReactNode; abierta: boolean; alTocar: () => void }) {
  return (
    <h4 className="cu-chica-t">
      <button type="button" className="cu-chica-b" aria-expanded={abierta} onClick={alTocar}>
        <span className="cu-chica-cab">
          <LogoCaja id={id} />
          <span className="cu-chica-n">{nombre}</span>
          {estado ? (
            <span className="cu-chica-est" data-tono={estado.tono}>
              {estado.texto}
            </span>
          ) : null}
        </span>
        <span className="cu-chica-res">
          <span>{resumen}</span>
          <ChevronDown className="cu-chica-f" size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      </button>
    </h4>
  );
}

/**
 * Una suscripción en chico: nombre, estado y su cupo en una línea; al tocarla se abre a todo el ancho con el detalle (ventanas, plan, conectar). `abreCon`: las
 * filas de adentro que busca el buscador de Ajustes: con ese salto se abre sola, en el mismo render, para que el salto las encuentre a la vista.
 */
function Chica({ id, opc, nombre, estado, resumen, abreCon = [], children }: { id: Proveedor; opc: string; nombre: string; estado: EstadoProv | null; resumen: ReactNode; abreCon?: string[]; children: ReactNode }) {
  const salto = useSyncExternalStore(suscribir, pendienteDeMostrar);
  const [tocada, setTocada] = useState(false);
  const [saltoCerrado, setSaltoCerrado] = useState<number | null>(null);
  const pedida = !!salto && abreCon.includes(salto.opc) && salto.n !== saltoCerrado;
  const abierta = tocada || pedida;
  const alTocar = () => {
    if (abierta && salto) setSaltoCerrado(salto.n);
    setTocada(!abierta);
  };
  return (
    <div className="cu-chica" data-opc={opc} data-abierta={abierta ? "" : undefined}>
      <Cabecera id={id} nombre={nombre} estado={estado} resumen={resumen} abierta={abierta} alTocar={alTocar} />
      {abierta ? <div className="cu-cuerpo">{children}</div> : null}
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
          if (puente && (id === "claude" || id === "google") && c?.instalado) void puente.conectar(id === "claude" ? "claude" : "gemini");
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

const suscDeCuenta = (uso: Uso | null, proveedor: ProveedorCuenta, perfil: PerfilCuenta) => (conDatos(uso) ? uso.suscripciones?.find((x) => (x.proveedor ?? x.id) === proveedor && (x.cuenta ?? x.id) === perfil.id) : undefined);

/** Lo que dice el renglón de cada cuenta (`deCuenta`: de dónde salen sus ventanas). */
function filasDeProveedor(perfiles: PerfilCuenta[], deCuenta: (p: PerfilCuenta) => { ventanas: VentanaCupo[]; agotado: number | undefined }): (FilaResumen & { perfil: PerfilCuenta; ventanas: VentanaCupo[] })[] {
  const ahora = Date.now() / 1000;
  const fabrica = [t("cu.claude"), t("cu.google"), t("cu.chatgpt"), t("cu.opencode")];
  const solo = perfiles.length === 1;
  return perfiles.map((p) => {
    const { ventanas, agotado } = deCuenta(p);
    return {
      perfil: p,
      id: p.id,
      nombre: parteCuenta(p.proveedor, p.nombre, p.defecto, solo ? t("cu.tj.tuCuenta") : t("cu.cuentaPrincipal"), fabrica),
      enUso: esEnUso(p, perfiles),
      estado: estadoCuenta(ventanas, agotado, p.logueado, ahora),
      ventanas,
    };
  });
}

/**
 * Una suscripción en una sola tarjeta con un renglón por cuenta: cabecera (logo, nombre, cuántas cuentas, estado), el aviso si a la de uso se le acaba, la tela y
 * el pie (`pie`: ayuda y conectar otra). `sinLista`: el comando `cuentas` no está y hay una sola cuenta, que no se puede tocar. `detalle`: lo que no entra en un
 * renglón (cada grupo, el plan), plegado.
 */
function Tela({ id, nombre, estado, perfiles, deCuenta, sinLista, notas, pie, detalle, alCambiar, extraDe }: {
  id: Proveedor;
  nombre: string;
  estado: EstadoProv | null;
  perfiles: PerfilCuenta[];
  deCuenta: (p: PerfilCuenta) => { ventanas: VentanaCupo[]; agotado: number | undefined };
  sinLista?: { ventanas: VentanaCupo[] };
  notas?: ReactNode;
  pie: ReactNode;
  detalle?: ReactNode;
  alCambiar: () => void;
  /** Lo que va bajo el renglón de cada cuenta (el plan de las de Claude). */
  extraDe?: (p: PerfilCuenta) => ReactNode;
}) {
  const filas = filasDeProveedor(perfiles, deCuenta);
  const varias = filas.length > 1;
  const h = hallazgo(filas);
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="cu-prov-sec">
      <div className="cu-prov">
        <LogoCaja id={id} />
        <h4 className="cu-prov-n">{nombre}</h4>
        {varias ? <small>{t("cu.tj.cuentas", { n: filas.length })}</small> : null}
        {estado ? (
          <span className="cu-conec" data-tono={estado.tono}>
            {estado.texto}
          </span>
        ) : null}
      </div>
      {notas}
      {h ? <LineaHallazgo h={h} /> : null}
      <ul className="cu-tela">
        {sinLista && !filas.length ? (
          <FilaFija nombre={t("cu.tj.tuCuenta")} estado={estadoCuenta(sinLista.ventanas, undefined, null, Date.now() / 1000)} ventanas={sinLista.ventanas} />
        ) : (
          filas.map((f) => <FilaCuenta key={f.id} perfil={f.perfil} nombre={f.nombre} enUso={f.enUso} solo={!varias} estado={f.estado} ventanas={f.ventanas} alCambiar={alCambiar} extra={extraDe?.(f.perfil)} />)
        )}
      </ul>
      <div className="cu-pie">
        {pie}
        {detalle ? (
          <div className="cu-ayuda" data-abierta={abierto ? "" : undefined}>
            <button type="button" className="cu-ayuda-b" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
              <span>{t("cu.tj.verDetalle")}</span>
              <ChevronDown className="cu-ayuda-f" size={12} strokeWidth={2} aria-hidden="true" />
            </button>
            {abierto ? <div className="cu-cuerpo cu-detalle">{detalle}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * El plan de una cuenta de Claude, bajo su renglón: Pro | Max. La de siempre lo guarda como `pa --plan` (el mismo campo de «Plan de la cuenta de
 * siempre»; los dos se avisan por `EVENTO_PLAN_CLAUDE`); una agregada, con `cuentas plan` (si no eligió, vale el de la de siempre y lo dice). El elegido
 * lleva tilde además del color. Los workers usan el plan de la cuenta en uso.
 */
function PlanClaudeCuenta({ perfil, planDeSiempre, alCambiar }: { perfil: PerfilCuenta; planDeSiempre: string | null; alCambiar: () => void }) {
  useIdioma();
  const [siempre, setSiempre] = useState(planDeSiempre);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);
  useEffect(() => setSiempre(planDeSiempre), [planDeSiempre]);
  useEffect(() => {
    const leer = (e: Event) => {
      const p = (e as CustomEvent<string>).detail;
      if (esPlanClaude(p)) setSiempre(p);
    };
    window.addEventListener(EVENTO_PLAN_CLAUDE, leer);
    return () => window.removeEventListener(EVENTO_PLAN_CLAUDE, leer);
  }, []);
  const { plan, propio } = planDeCuenta(perfil, siempre);
  if (!plan && perfil.defecto) return null;
  const elegir = async (p: PlanCuentaClaude) => {
    if (guardando || (propio && p === plan)) return;
    setGuardando(true);
    setError(null);
    try {
      if (perfil.defecto) {
        const nuevo = await fuentePaneles.guardarAjustes({ plan: p });
        if (!vivo.current) return;
        if (!esPlanClaude(nuevo.plan)) throw new Error(t("comun.sinDato"));
        window.dispatchEvent(new CustomEvent(EVENTO_PLAN_CLAUDE, { detail: nuevo.plan }));
      } else {
        const r = await fuente.planCuenta(perfil.id, p).catch(() => ({ ok: false as const, error: "main.cuentasFallo" }));
        if (!vivo.current) return;
        if (!r.ok) throw new Error(textoMain(r.error));
        alCambiar();
      }
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };
  return (
    <div className="cu-plan-cta" data-cuenta-plan={perfil.id}>
      <span className="cu-plan-cta-n" title={t("cu.planCuentaQue")}>{t("cu.planCuenta")}</span>
      <div className="pn-letra oc-plan" role="radiogroup" aria-label={t("cu.planCuentaGrupo", { nombre: perfil.nombre })}>
        {(["pro", "max"] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={propio && p === plan} data-plan-id={p} disabled={guardando} onClick={() => void elegir(p)}>
            {propio && p === plan ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
            {p === "pro" ? "Pro" : "Max"}
          </button>
        ))}
      </div>
      {!propio && plan ? <span className="cu-nota">{t("cu.planCuentaHereda", { plan: plan === "pro" ? "Pro" : "Max" })}</span> : null}
      {error ? <span className="pn-error" role="alert">{error}</span> : null}
    </div>
  );
}

/** Si alguna cuenta está conectada, la suscripción lo está (cada renglón dice lo suyo); si no, lo que diga el proveedor. */
const estadoVarias = (perfiles: PerfilCuenta[], c: CuentaEstado | undefined): EstadoProv => (perfiles.length > 1 && perfiles.some((p) => p.logueado) ? { texto: t("cu.conectado"), tono: "ok" } : estadoProv(c));

/**
 * Una suscripción en una línea: "Gemini 6 %, Hydrogen 88 %" o "5 h 24 %, semana 9 %"; sin nada que decir, `null`. Los grupos que la frase de arriba
 * ya nombra como agotados (`r`) no se repiten acá: sólo sale lo que todavía tiene cupo.
 */
function cupoEnUnaLinea(s: SuscripcionCupo | undefined, r: ResumenSusc | null): string | null {
  if (!s) return null;
  const ahora = Date.now() / 1000;
  const nombrado = (id: string) => r?.nivel === "lleno" || (r?.nivel === "parcial" && r.agotados.some((a) => a.id === id));
  const partes = s.grupos?.length
    ? s.grupos.flatMap((g) => {
        const rg = resumenGrupo(g, ahora);
        const n = nombreGrupoCorto(g);
        if (rg.estado === "lleno" || rg.estado === "marcado") return nombrado(g.id) ? [] : [t("cu.tj.resGrupoSin", { nombre: n })];
        if (rg.pct !== null) return [t("cu.tj.resVentana", { ventana: n, pct: Math.round(rg.pct) })];
        return rg.pedidos !== undefined ? [`${n}: ${t("cu.tj.pedidos", { n: rg.pedidos.toLocaleString() })}`] : [];
      })
    : (s.ventanas ?? []).flatMap((v) => {
        if (v.pct !== null) return [t("cu.tj.resVentana", { ventana: nombreVentanaMin(v.id), pct: Math.round(v.pct) })];
        return v.pedidos !== undefined ? [t("cu.tj.pedidos", { n: v.pedidos.toLocaleString() })] : [];
      });
  return partes.length ? partes.join(", ") : null;
}

/**
 * Lo que va en la línea de una tarjeta chica, en una sola línea separada con « · »: lo agotado primero (con ícono y en palabras), después el cupo
 * que queda y el plan. Lo agotado no se repite en el cupo, y un «sin datos» no sale junto a un «agotado».
 */
function ResumenChica({ s, plan, sinDatos }: { s: SuscripcionCupo | undefined; plan?: string; sinDatos: string }) {
  const r = s ? resumenSusc(s, Date.now() / 1000) : null;
  const agotado = r !== null && (r.nivel === "lleno" || r.nivel === "parcial");
  const cupo = cupoEnUnaLinea(s, r);
  // Lo que sigue a lo agotado, en texto: el cupo que queda y el plan.
  const resto: string[] = [];
  if (cupo) resto.push(cupo);
  else if (!agotado && !plan) resto.push(sinDatos);
  if (plan) resto.push(t("cu.tj.resPlan", { plan }));
  // El « ·» va pegado a lo agotado, dentro de su tramo: así una línea que se parte no deja el separador al principio de la siguiente.
  return (
    <>
      {agotado ? (
        <span className="cu-chica-sin">
          <Ban size={12} strokeWidth={2.2} aria-hidden="true" />
          {textoSusc(r, s?.grupos)}
          {resto.length ? "\u00a0·" : null}
        </span>
      ) : null}
      {resto.map((p, i) => (
        <Fragment key={i}>
          {i === 0 ? (agotado ? " " : null) : "\u00a0· "}
          {p}
        </Fragment>
      ))}
    </>
  );
}

const planClaude = (plan: string | null) => (plan === "max" ? t("cu.planMax") : plan === "pro" ? t("cu.planPro") : "Claude");

/** Arriba de la categoría: el aviso de tope cruzado y las tarjetas de suscripción. */
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

  // El plan de la cuenta de siempre: el que trajo Ajustes, y el que se acaba de elegir en su renglón (sin esperar a que Ajustes lo relea).
  const [planSiempre, setPlanSiempre] = useState(plan);
  useEffect(() => setPlanSiempre(plan), [plan]);
  useEffect(() => {
    const leer = (e: Event) => {
      const p = (e as CustomEvent<string>).detail;
      if (esPlanClaude(p)) setPlanSiempre(p);
    };
    window.addEventListener(EVENTO_PLAN_CLAUDE, leer);
    return () => window.removeEventListener(EVENTO_PLAN_CLAUDE, leer);
  }, []);
  const { lista, mirar: mirarCuentas } = useCuentas();
  const alCambiarCuentas = useCallback(() => {
    mirarCuentas();
    mirar();
  }, [mirarCuentas, mirar]);
  const pClaude = cuentasDe(lista, "claude");
  const pGoogle = cuentasDe(lista, "google");
  const pChatgpt = cuentasDe(lista, "chatgpt");

  const google: SuscripcionCupo | undefined = uso && !("error" in uso) ? suscripcionDe(uso.suscripciones, "google") : undefined;
  const chatgpt: SuscripcionCupo | undefined = uso && !("error" in uso) ? suscripcionDe(uso.suscripciones, "chatgpt") : undefined;
  const avisos = avisosTope(b, uso);
  const vClaude = conDatos(uso) ? ventanasClaude(uso) : [];
  const cupoGoogle = google?.grupos?.length ? google.grupos.map((g) => <Grupo key={g.id} g={g} />) : google?.ventanas?.length ? <Ventanas vs={google.ventanas} /> : <div className="cu-sin">{t("uso.sinDatoCupo")}</div>;

  // El ritmo de la semana es de la cuenta en uso: va en la ayuda, junto a cómo funcionan los límites.
  const enUsoClaude = pClaude.find((p) => esEnUso(p, pClaude));
  const claudeDe = (p: PerfilCuenta) => (p.defecto ? { ventanas: vClaude, agotado: undefined } : ventanasDeSusc(suscDeCuenta(uso, "claude", p)));
  const semanaUso = (enUsoClaude ? claudeDe(enUsoClaude).ventanas : vClaude).find((v) => v.id === "7d");
  const ritmo = semanaUso ? ritmoSemanal(semanaUso.pct, semanaUso.vuelve, Date.now() / 1000, reservaDePerfil(b.perfil)) : null;

  const detalleDe = (proveedor: ProveedorCuenta, perfiles: PerfilCuenta[], deSiempre: ReactNode, extra?: (p: PerfilCuenta) => ReactNode) => (
    <>
      {perfiles.map((p) => (
        <div key={p.id} className="cu-det-cuenta">
          <div className="cu-det-n">{p.nombre}</div>
          {p.defecto ? (
            deSiempre
          ) : (
            <>
              <CupoDe uso={uso} proveedor={proveedor} perfil={p} />
              {extra?.(p)}
            </>
          )}
        </div>
      ))}
    </>
  );

  return (
    <section className="cu-sec">
      <div className="cu-tarjetas">
        <div data-opc="cu.claude" data-ancho="">
          <Tela
            id="claude"
            nombre={planClaude(enUsoClaude ? planDeCuenta(enUsoClaude, planSiempre).plan : planSiempre)}
            extraDe={lista ? (p) => <PlanClaudeCuenta perfil={p} planDeSiempre={planSiempre} alCambiar={alCambiarCuentas} /> : undefined}
            estado={estadoVarias(pClaude, cuentas?.claude)}
            perfiles={pClaude}
            deCuenta={claudeDe}
            sinLista={{ ventanas: vClaude }}
            alCambiar={alCambiarCuentas}
            notas={avisos.map((a) => (
              <LineaNota key={a.ventana} nivel="poco" icono={<TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />}>
                <b>{t("cu.avisoTope", { quien: t("cu.claude"), ventana: t(a.ventana === "5h" ? "cu.ventana5h" : "cu.ventanaSem"), pct: a.pct })}</b>
                {a.vuelve !== null ? ", " : ". "}
                <Vuelve epoch={a.vuelve} />
                {a.vuelve !== null ? ". " : ""}
                {t("cu.avisoTopeQue", { tope: a.tope })}
              </LineaNota>
            ))}
            pie={
              <>
                <Ayuda lineas={["cu.ayuda.claude1"]} antes={ritmo ? <RitmoSemanal r={ritmo} /> : null} />
                {pClaude.length > 1 ? null : <Conectar id="claude" c={cuentas?.claude} como={t("cu.comoClaude")} alMirar={mirar} />}
                {lista ? <AgregarCuenta proveedor="claude" alCambiar={alCambiarCuentas} /> : null}
              </>
            }
          />
        </div>

        {pGoogle.length > 1 ? (
          <div data-opc="cu.google" data-ancho="">
            <Tela
              id="google"
              nombre={t("cu.google")}
              estado={estadoVarias(pGoogle, cuentas?.agy)}
              perfiles={pGoogle}
              deCuenta={(p) => ventanasDeSusc(suscDeCuenta(uso, "google", p))}
              alCambiar={alCambiarCuentas}
              pie={
                <>
                  <Ayuda lineas={AYUDA_GOOGLE} />
                  {lista ? <AgregarCuenta proveedor="google" alCambiar={alCambiarCuentas} /> : null}
                </>
              }
              detalle={detalleDe("google", pGoogle, cupoGoogle)}
            />
          </div>
        ) : (
          <Chica id="google" opc="cu.google" nombre={t("cu.google")} estado={estadoProv(cuentas?.agy)} resumen={<ResumenChica s={google} sinDatos={t("cu.tj.sinDatos")} />}>
            {cupoGoogle}
            <Ayuda lineas={AYUDA_GOOGLE} />
            <Conectar id="google" c={cuentas?.agy} como={t("cu.comoGoogle")} alMirar={mirar} />
            {lista ? <AgregarCuenta proveedor="google" alCambiar={alCambiarCuentas} /> : null}
          </Chica>
        )}

        <TarjetaOpencode uso={uso} perfiles={cuentasDe(lista, "opencode")} lista={!!lista} alCambiar={alCambiarCuentas} detalleDe={detalleDe} />

        {pChatgpt.length > 1 ? (
          <div data-opc="cu.chatgpt" data-ancho="">
            <Tela
              id="chatgpt"
              nombre={t("cu.chatgpt")}
              estado={estadoVarias(pChatgpt, cuentas?.codex)}
              perfiles={pChatgpt}
              deCuenta={(p) => ventanasDeSusc(suscDeCuenta(uso, "chatgpt", p))}
              alCambiar={alCambiarCuentas}
              pie={
                <>
                  <Ayuda lineas={["cu.ayuda.chatgpt1"]} />
                  {lista ? <AgregarCuenta proveedor="chatgpt" alCambiar={alCambiarCuentas} /> : null}
                </>
              }
            />
          </div>
        ) : (
          <Chica
            id="chatgpt"
            opc="cu.chatgpt"
            nombre={t("cu.chatgpt")}
            estado={estadoProv(cuentas?.codex ?? (cuentas ? { instalado: false, logueado: false, cuenta: null, error: null } : undefined))}
            resumen={<ResumenChica s={chatgpt} sinDatos={t("cu.tj.sinDatos")} />}
          >
            {chatgpt?.ventanas?.length ? <Ventanas vs={chatgpt.ventanas} /> : <div className="cu-sin">{t("cu.chatgptSinCupo")}</div>}
            <Ayuda lineas={["cu.ayuda.chatgpt1"]} />
            <Conectar id="chatgpt" c={cuentas?.codex} como={t(cuentas?.codex?.instalado ? "cu.comoCodex" : "cu.comoCodexInstalar")} alMirar={mirar} />
            {lista && pChatgpt.length > 0 ? <AgregarCuenta proveedor="chatgpt" alCambiar={alCambiarCuentas} /> : null}
          </Chica>
        )}

        <TarjetaNvidia uso={uso} />
      </div>
    </section>
  );
}

const AYUDA_GOOGLE: ClaveSola[] = ["cu.ayuda.google1", "cu.ayuda.google2", "cu.ayuda.google3", "cu.ayuda.google4", "cu.ayuda.google5", "cu.ayuda.google6"];

type PlanOc = VistaPlanGo["plan"];
const PLANES_OC: readonly { id: PlanOc; nombre: ClaveSola }[] = [
  { id: "gratis", nombre: "ajustes.ocPlanGratis" },
  { id: "go", nombre: "ajustes.ocPlanGo" },
  { id: "go-plus", nombre: "ajustes.ocPlanGoPlus" },
];

/** El evento (en `window`) con que Ajustes > OpenCode se entera de que cambió el plan (los modelos que se ofrecen cambian con él). */
export const EVENTO_PLAN_OPENCODE = "trama:opencode-plan";

const nombrePlanOc = (p: PlanOc) => (p === "go" ? t("ajustes.ocPlanGo") : p === "go-plus" ? t("ajustes.ocPlanGoPlus") : t("ajustes.ocPlanGratis"));

/**
 * El plan de una cuenta de OpenCode: lo que dice (el plan, y si es «detectado» —`opencode models` de esa cuenta— o elegido a mano) y, plegado como
 * respaldo, el selector manual (el elegido, con tilde y negrita además del color). `detectado`: lo que detectó Trama; Go Plus no se distingue de Go,
 * así que un Go detectado vale para un Go Plus elegido. `opc`: la fila que encuentra el buscador de Ajustes (sólo la de la cuenta de siempre).
 * `nota`: lo que dice el plan, plegado en «Cómo funciona» (la de siempre lo lleva en el pliegue de los límites).
 */
function PlanOpencode({ plan, detectado, guardando, deshabilitado, error, nota, opc, alElegir }: { plan: PlanOc; detectado?: PlanOc | null; guardando: boolean; deshabilitado?: boolean; error: string | null; nota?: string; opc?: string; alElegir: (p: PlanOc) => void }) {
  const coincide = !!detectado && (detectado === plan || (detectado === "go" && plan === "go-plus"));
  return (
    <div className="cu-oc-plan" data-opc={opc}>
      <div className="cu-grupo-n">{t("ajustes.ocPlan")}</div>
      <div className="cu-oc-plan-actual" data-plan={plan} data-origen={coincide ? "detectado" : "manual"}>
        <strong>{nombrePlanOc(plan)}</strong>
        <span className="cu-oc-plan-origen" title={t(coincide ? "ajustes.ocPlanDetectadoQue" : "ajustes.ocPlanManualQue")}>
          {coincide ? <Check size={12} strokeWidth={2.4} aria-hidden="true" /> : null}
          {t(coincide ? "ajustes.ocPlanDetectado" : "ajustes.ocPlanManual")}
        </span>
        {guardando ? <span className="mdl-estado" role="status">{t("ajustes.ocPlanGuardando")}</span> : null}
      </div>
      <details className="cu-oc-plan-mano">
        <summary>{t("ajustes.ocPlanCambiar")}</summary>
        <div className="pn-letra oc-plan" role="radiogroup" aria-label={t("ajustes.ocPlanGrupo")} data-plan={plan}>
          {PLANES_OC.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === plan} data-plan-id={p.id} disabled={guardando || deshabilitado} onClick={() => p.id !== plan && alElegir(p.id)}>
              {p.id === plan ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
              {t(p.nombre)}
            </button>
          ))}
        </div>
      </details>
      {nota ? (
        <Plegable titulo={t("cu.comoFunciona")}>
          <p className="cu-ayuda-l">{nota}</p>
        </Plegable>
      ) : null}
      {error ? <div className="pn-error dsh-err" role="alert">{textoMain(error)}</div> : null}
    </div>
  );
}

/** El uso de una cuenta de OpenCode (el mismo de la barra): el resumen si dice algo y un bloque por grupo. */
function UsoOpencode({ s }: { s: SuscripcionCupo | undefined }) {
  return (
    <>
      {/* Con sólo los gratis (sin tope publicado) el resumen no tiene nada que agregar: lo dice el grupo, con los pedidos contados. */}
      {s && resumenSusc(s, Date.now() / 1000).nivel !== "sin" ? <Resumen s={s} /> : null}
      {s?.grupos?.length ? s.grupos.map((g) => <Grupo key={g.id} g={g} />) : <div className="cu-sin">{t("uso.sinDatoCupo")}</div>}
    </>
  );
}

/** El plan de una cuenta AGREGADA de OpenCode: se guarda con `cuentas plan` (el de la de siempre va en modelos.json). */
function PlanCuentaOpencode({ perfil, alCambiar }: { perfil: PerfilCuenta; alCambiar: () => void }) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = perfil.plan ?? "gratis";
  const elegir = async (p: PlanOc) => {
    setGuardando(true);
    setError(null);
    const r = await fuente.planCuenta(perfil.id, p).catch(() => ({ ok: false as const, error: "main.cuentasFallo" }));
    setGuardando(false);
    if (!r.ok) setError(r.error);
    alCambiar();
  };
  // Lo detectado manda: si `opencode models` de esa cuenta dice otro plan (Go y Go Plus se tratan igual), se guarda solo, una vez por cuenta y por lectura.
  const intentado = useRef<string | null>(null);
  const det = perfil.planDetectado;
  useEffect(() => {
    if (!det || det === plan || (det === "go" && plan === "go-plus") || intentado.current === `${det}>${plan}`) return;
    intentado.current = `${det}>${plan}`;
    void elegir(det);
  }, [det, plan]);
  return <PlanOpencode plan={plan} detectado={det} guardando={guardando} error={error} nota={plan === "gratis" ? t("ajustes.ocPlanNotaGratis") : t("cu.opencode.planCuenta")} alElegir={(p) => void elegir(p)} />;
}

/**
 * OpenCode, la cuenta como las demás: su estado (instalado, conectado), el uso que contó Trama (el mismo de la barra: los gratis comparten un cupo
 * y, con Go, cada modelo contra su tope), el plan (Gratis / Go / Go Plus: Go está APAGADO hasta elegirlo; se aplica al toque, sin la barra de
 * Guardar) y, con Go, la tabla de topes por modelo (motor/opencode/go-topes.json, con su fecha y su URL de origen). Con varias cuentas (CLI
 * `cuentas`, proveedor opencode: cada una con su carpeta de login), una fila por cuenta con su plan y su uso, como Claude o Google. El programa y la
 * clave de API siguen en Ajustes > OpenCode.
 */
function TarjetaOpencode({ uso, perfiles, lista, alCambiar, detalleDe }: { uso: Uso | null; perfiles: PerfilCuenta[]; lista: boolean; alCambiar: () => void; detalleDe: (proveedor: ProveedorCuenta, perfiles: PerfilCuenta[], deSiempre: ReactNode, extra?: (p: PerfilCuenta) => ReactNode) => ReactNode }) {
  useIdioma();
  const [e, setE] = useState<EstadoOpencodeUi | null>(null);
  const [v, setV] = useState<VistaPlanGo | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errPlan, setErrPlan] = useState<string | null>(null);
  const vivo = useRef(true);
  const mirar = useCallback(() => {
    void fuentePaneles.estadoOpencode().then((r) => vivo.current && setE(r), () => undefined);
    void fuentePaneles.planOpencode().then((r) => vivo.current && setV(r), () => undefined);
  }, []);
  useEffect(() => {
    vivo.current = true;
    mirar();
    return () => void (vivo.current = false);
  }, [mirar]);

  const elegirPlan = async (plan: PlanOc) => {
    if (guardando || plan === v?.plan) return;
    setGuardando(true);
    setErrPlan(null);
    try {
      const r = await fuentePaneles.guardarPlanOpencode(plan);
      if (vivo.current) setV(r);
      window.dispatchEvent(new Event(EVENTO_PLAN_OPENCODE));
      // Los modelos que se ofrecen cambian con el plan: el estado y los selectores se piden de nuevo.
      mirar();
      void pedirModelos(5000).then((m) => m && aplicarModelos(m));
    } catch (x) {
      if (vivo.current) setErrPlan(mensaje(x));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  const s = conDatos(uso) ? uso.suscripciones?.find((x) => x.id === "opencode") : undefined;
  const plan = v?.plan ?? e?.plan ?? "gratis";
  // El plan de la cuenta de siempre, detectado (`opencode models`): si difiere del guardado se aplica solo, una vez por lectura.
  const detSiempre = perfiles.find((p) => p.defecto)?.planDetectado ?? null;
  const intentado = useRef<string | null>(null);
  useEffect(() => {
    if (!v || !detSiempre || detSiempre === v.plan || (detSiempre === "go" && v.plan === "go-plus") || intentado.current === `${detSiempre}>${v.plan}`) return;
    intentado.current = `${detSiempre}>${v.plan}`;
    void elegirPlan(detSiempre);
  }, [detSiempre, v?.plan]);
  const go = plan !== "gratis";
  const varias = perfiles.length > 1;
  const algunGo = go || perfiles.some((p) => !p.defecto && p.plan && p.plan !== "gratis");
  const estado: CuentaEstado | undefined = e ? { instalado: e.instalado, logueado: e.logueado === true, cuenta: null, error: null } : undefined;
  const agotados = goAgotadosHasta(uso);
  const deSiempre = (
    <>
      <UsoOpencode s={s} />
      <PlanOpencode
        plan={plan}
        detectado={detSiempre}
        opc="ajustes.ocPlan"
        guardando={guardando}
        deshabilitado={!v}
        error={errPlan}
        alElegir={(p) => void elegirPlan(p)}
      />
      {go && v?.precio != null ? <div className="cu-nota">{t("cu.opencodeGo.precio", { usd: v.precio })}</div> : null}
    </>
  );
  const tablaGo =
    algunGo && v ? (
      <div data-opc="cu.opencodeGo">
        {v.modelos.length ? (
          <table className="cu-go" aria-label={t("cu.opencodeGo.topes")}>
            <thead>
              <tr>
                <th scope="col">{t("cu.opencodeGo.modelo")}</th>
                <th scope="col">{t("cu.opencodeGo.pedidos")}</th>
                <th scope="col">{t("cu.opencodeGo.usd")}</th>
                <th scope="col">{t("cu.opencodeGo.estado")}</th>
              </tr>
            </thead>
            <tbody>
              {v.modelos.map((m) => {
                const hasta = agotados.get(`opencode:${m.id}`.toLowerCase()) ?? null;
                return (
                  <tr key={m.id} data-agotado={hasta ? "" : undefined}>
                    <th scope="row">{m.nombre || nombreOpencode(m.id)}</th>
                    <td>{m.pedidos5h === null ? "—" : t("cu.opencodeGo.pedidosN", { n: m.pedidos5h.toLocaleString() })}</td>
                    <td>{m.usdMes === null ? "—" : t("cu.opencodeGo.usdN", { n: m.usdMes.toLocaleString() })}</td>
                    <td>
                      <Pildora nivel={hasta ? "lleno" : "ok"}>{hasta ? t("cu.opencodeGo.agotado", { cuando: cuandoFuturo(hasta) }) : t("cu.opencodeGo.libre")}</Pildora>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="cu-sin">{t("cu.opencodeGo.sinTabla")}</div>
        )}
        {varias ? <div className="cu-nota">{t("cu.opencodeGo.topesDe", { plan: nombrePlanOc(go ? plan : "go") })}</div> : null}
        {v.fuente ? (
          <div className="cu-nota">
            {v.origen === "cache" ? t("cu.opencodeGo.fuente", { fuente: v.fuente, fecha: v.fecha ?? "—" }) : t("cu.opencodeGo.respaldo", { fecha: v.fecha ?? "—" })}
          </div>
        ) : null}
      </div>
    ) : null;
  // Lo que dice el plan (con Go, cuántos modelos se ofrecen) va con el resto de la explicación, plegado.
  const notaPlan = go ? t("ajustes.ocPlanNotaGo", { n: e?.go ?? v?.modelos.length ?? 0 }) : t("ajustes.ocPlanNotaGratis");
  const ayuda = <Ayuda antes={notaPlan} lineas={["cu.opencode.libreQue", "cu.opencode.contados", "cu.opencode.pagos", "cu.opencode.cuentas", "cu.opencode.mas"]} />;
  const otra = lista ? <AgregarCuenta proveedor="opencode" alCambiar={alCambiar} /> : null;
  if (varias)
    return (
      <div data-opc="cu.opencode" data-ancho="">
        <Tela
          id="opencode"
          nombre={t("cu.opencode")}
          estado={estadoVarias(perfiles, estado)}
          perfiles={perfiles}
          deCuenta={(p) => ventanasDeSusc(suscDeCuenta(uso, "opencode", p))}
          alCambiar={alCambiar}
          pie={
            <>
              {ayuda}
              {otra}
            </>
          }
          detalle={
            <>
              {detalleDe("opencode", perfiles, deSiempre, (p) => (
                <PlanCuentaOpencode perfil={p} alCambiar={alCambiar} />
              ))}
              {tablaGo}
            </>
          }
        />
      </div>
    );
  return (
    <Chica
      id="opencode"
      opc="cu.opencode"
      nombre={go ? `${t("cu.opencode")} ${nombrePlanOc(plan)}` : t("cu.opencode")}
      estado={estado ? estadoProv(estado) : null}
      abreCon={["ajustes.ocPlan", "cu.opencodeGo"]}
      resumen={<ResumenChica s={s} plan={nombrePlanOc(plan)} sinDatos={t("cu.tj.sinDatos")} />}
    >
      {deSiempre}
      {tablaGo}
      {ayuda}
      <Conectar id="opencode" c={estado} como={t(e && !e.instalado ? "cu.comoOpencodeInstalar" : "cu.comoOpencode")} alMirar={mirar} />
      {otra}
    </Chica>
  );
}

/**
 * NVIDIA NIM (gratis, con clave propia): el uso que contó Trama (el mismo de la barra: pedidos del último minuto del modelo más cargado contra el tope por
 * modelo) y si hay clave. Sin cupo diario: el límite es por minuto, y un 429 sólo enfría a ese modelo unos minutos. La clave, la prueba y los modelos que
 * se ofrecen están en Ajustes > OpenCode.
 */
function TarjetaNvidia({ uso }: { uso: Uso | null }) {
  useIdioma();
  const [e, setE] = useState<EstadoNim | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuentePaneles.estadoNvidia().then((r) => vivo && setE(r), () => undefined);
    return () => void (vivo = false);
  }, []);
  const s = conDatos(uso) ? uso.suscripciones?.find((x) => x.id === "nvidia-nim") : undefined;
  const estado: EstadoProv | null = e ? (e.hayClave ? { texto: t("cu.nvidia.conClave"), tono: "ok" } : { texto: t("cu.nvidia.sinClave") }) : null;
  return (
    <Chica id="nvidia" opc="cu.nvidia" nombre={t("cu.nvidia")} estado={estado} resumen={e && !e.hayClave ? t("cu.tj.sinClaveCorto") : <ResumenChica s={s} sinDatos={t("cu.tj.sinUsoCorto")} />}>
      {s?.grupos?.length ? s.grupos.map((g) => <Grupo key={g.id} g={g} />) : e && !e.hayClave ? null : <div className="cu-sin">{t("cu.nvidia.sinUso")}</div>}
      {e && !e.hayClave ? (
        <Boton className="cu-poner-clave" primario onClick={() => irA("opencode", "ajustes.nimClave", true)}>
          {t("cu.nvidia.ponerClave")}
        </Boton>
      ) : null}
      <Ayuda lineas={["cu.nvidia.libreQue", "cu.nvidia.contados", "cu.nvidia.mas"]} antes={e && !e.hayClave && !s?.grupos?.length ? t("cu.nvidia.sinClaveQue") : null} />
    </Chica>
  );
}

/** Una fila de «Dónde pa deja de usar…»: deslizador con el % usado, «De fábrica» o el botón para volver a él, y la frase corta. */
function FilaTope({ b, cambiar, id, titulo, ayuda, detalle }: { b: Borrador; cambiar: (b: Borrador) => void; id: IdTope; titulo: string; ayuda?: ReactNode; detalle?: ReactNode }) {
  const v = topeDe(b, id);
  const fab = fabricaDe(id);
  const otro = cambiado(b, id);
  return (
    <FilaAjuste
      opc={`cu.tope.${id}`}
      titulo={titulo}
      ayuda={ayuda ?? t("cu.topeFila", { pct: v })}
      detalle={detalle}
      control={
        <>
          <input
            type="range"
            className="cu-tope-rango"
            min={TOPE_MIN}
            max={TOPE_MAX}
            step={1}
            value={Math.max(TOPE_MIN, v)}
            aria-label={t("cu.topeAria", { quien: titulo })}
            aria-valuetext={t("cu.topeValor", { pct: v })}
            onChange={(ev) => cambiar(poner(b, id, Number(ev.target.value)))}
          />
          <output className="cu-tope-valor">{t("cu.topeValor", { pct: v })}</output>
          {otro ? (
            <Boton onClick={() => cambiar(restaurar(b, id))} aria-label={t("cu.topeVolverAria", { quien: titulo, pct: fab })}>
              {t("cu.topeVolver", { pct: fab })}
            </Boton>
          ) : (
            <Chip tono="ok">{t("cu.topeFabrica")}</Chip>
          )}
        </>
      }
    />
  );
}

/** Los proveedores con cupo que se ven en Plan y cupos, y los grupos de Google que reparto conoce hoy (sin dato de Google: ninguno). */
function filasDeUso(uso: Uso | null) {
  const subs = uso && !("error" in uso) ? (uso.suscripciones ?? []) : [];
  const google = suscripcionDe(subs, "google");
  const grupos = google?.grupos?.length ? google.grupos.map((g) => ({ id: `google:${g.id}`, nombre: nombreGrupo(g) })) : google ? [{ id: "google", nombre: t("cu.google") }] : [];
  return { grupos, chatgpt: !!suscripcionDe(subs, "chatgpt") };
}

/** Lo que se escribe en `modelos.json`: dónde deja pa de usar cada proveedor, qué hace sin cupo y cómo reparte. */
export function AjustesCupos({ Dato, b, cambiar, uso }: { Dato: FilaDato; b: Borrador; cambiar: (b: Borrador) => void; uso: Uso | null }) {
  useIdioma();
  const { grupos, chatgpt } = filasDeUso(uso);
  const reserva = reservaDePerfil(b.perfil);

  // Plegado de entrada: el buscador de Ajustes lo abre solo cuando salta a una fila de adentro (en el mismo render, para que el salto la encuentre).
  const salto = useSyncExternalStore(suscribir, pendienteDeMostrar);
  const [tocado, setTocado] = useState(false);
  const [saltoCerrado, setSaltoCerrado] = useState<number | null>(null);
  const pedido = !!salto && esDeAvanzado(salto.opc) && salto.n !== saltoCerrado;
  const abierto = tocado || pedido;
  const alTocar = () => {
    if (abierto && salto) setSaltoCerrado(salto.n);
    setTocado(!abierto);
  };

  return (
    <section className="pn-sec pn-edita cu-avanzado" data-abierta={abierto ? "" : undefined}>
      <h3 className="pn-h cu-av-h">
        <button type="button" className="cu-av-b" aria-expanded={abierto} onClick={alTocar}>
          <span>{t("cu.avanzado")}</span>
          <ChevronDown className="cu-av-f" size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </h3>
      {abierto ? <AvanzadoCuerpo Dato={Dato} b={b} cambiar={cambiar} grupos={grupos} chatgpt={chatgpt} reserva={reserva} /> : null}
    </section>
  );
}

/** Lo que el buscador de Ajustes encuentra dentro de «Avanzado» (perfil, topes y qué hacer sin cupo). */
const esDeAvanzado = (opc: string) => opc === "ajustes.cuposPerfil" || opc === "ajustes.cuposSinCupo" || opc === "cu.topes" || opc.startsWith("cu.tope.");

function AvanzadoCuerpo({ Dato, b, cambiar, grupos, chatgpt, reserva }: { Dato: FilaDato; b: Borrador; cambiar: (b: Borrador) => void; grupos: { id: string; nombre: string }[]; chatgpt: boolean; reserva: number }) {
  return (
    <>
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

      <div data-opc="cu.topes" className="cu-topes">
        <GrupoAjustes titulo={t("cu.topes")} subtitulo={t("cu.topesSub")}>
          <FilaTope b={b} cambiar={cambiar} id="claude:5h" titulo={t("cu.topeClaude5h")} />
          <FilaTope
            b={b}
            cambiar={cambiar}
            id="claude:7d"
            titulo={t("cu.topeClaudeSem")}
            ayuda={reserva ? t("cu.topeClaudeReserva", { pct: topeDe(b, "claude:7d"), reserva: Math.round(reserva * 100) }) : undefined}
          />
          {grupos.map((g) => (
            <FilaTope key={g.id} b={b} cambiar={cambiar} id={g.id} titulo={`${t("cu.google")} · ${g.nombre}`} />
          ))}
          {chatgpt ? <FilaTope b={b} cambiar={cambiar} id="openai" titulo={t("cu.chatgpt")} /> : null}
          <FilaAjuste opc="cu.tope.opencode" titulo={t("cu.opencode")} ayuda={t("cu.topeOpencode")} control={<Chip>{t("cu.topeAuto")}</Chip>} />
        </GrupoAjustes>
        <details className="cu-topes-porque">
          <summary>{t("cu.topesPorqueTit")}</summary>
          <p>{t("cu.topesPorque")}</p>
        </details>
        {grupos.length ? (
          <details className="cu-topes-adv">
            <summary>{t("cu.topesAdv")}</summary>
            <GrupoAjustes>
              <FilaTope b={b} cambiar={cambiar} id="google:codigo" titulo={t("cu.topeCodigo")} ayuda={t("cu.topeCodigoFila", { pct: topeDe(b, "google:codigo") })} />
            </GrupoAjustes>
            <p className="cu-topes-nota">{t("cu.topeCodigoQue")}</p>
          </details>
        ) : null}
      </div>

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
    </>
  );
}
