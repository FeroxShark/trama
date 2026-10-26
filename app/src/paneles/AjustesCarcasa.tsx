// Ajustes > Trama para Windows: la versión, "Buscar actualizaciones" (buscando / al día / descargando % / Reiniciar para actualizar)
// y "Quitar restos de versiones anteriores": muestra qué se va a quitar y pide confirmar. Sólo existe dentro de la carcasa de
// Windows (`window.carcasa`, src/carcasa.ts). Nunca se tocan tus proyectos, el tablero, las sesiones ni tus cuentas; la distro de
// Ubuntu sólo se ofrece si la creó Trama y no tiene nada tuyo, y pide escribir su nombre. Detalle: docs/estado/windows-actualizar.md
import { useEffect, useRef, useState } from "react";
import { alCambiarActualizacion, carcasaActualiza as carcasa, comoError, esError, FIXTURE_CARCASA, type DistroResto, type EstadoActualizacion, type ItemResto, type PlanRestos } from "../carcasa";
import { MODO } from "../modo";
import { t } from "../i18n";
import type { FilaDato } from "./AjustesEditar";
import { marcar } from "./ajustes-nav";

type Restos = { paso: "mirando" } | { paso: "plan"; plan: PlanRestos } | { paso: "quitando"; plan: PlanRestos } | { paso: "hecho"; texto: string; mal: boolean } | { paso: "error"; texto: string };

const textoAct = (e: EstadoActualizacion | null, v: string): string => {
  if (!e) return "";
  switch (e.fase) {
    case "buscando":
      return t("carcasa.buscando");
    case "al-dia":
      return t("carcasa.alDia", { v });
    case "descargando":
      return t("carcasa.descargando", { v: e.version ?? "", p: e.progreso ?? 0 });
    case "lista":
      return t("carcasa.lista", { v: e.version ?? "" });
    case "error":
      return t("carcasa.errorAct", { m: e.mensaje ?? "" });
    default:
      return t("carcasa.inactiva");
  }
};

export function Carcasa({ Dato }: { Dato: FilaDato }) {
  const [version, setVersion] = useState("");
  const [act, setAct] = useState<EstadoActualizacion | null>(null);
  const [restos, setRestos] = useState<Restos | null>(null);
  const [nombre, setNombre] = useState("");
  const vivo = useRef(true);
  const sec = useRef<HTMLElement>(null);
  useEffect(() => () => void (vivo.current = false), []);

  useEffect(() => {
    if (!carcasa) return;
    void carcasa.version().then((x) => vivo.current && setVersion(x), () => {});
    void carcasa.actualizacion().then((x) => vivo.current && setAct(x), () => {});
    return alCambiarActualizacion((e) => setAct(e));
  }, []);

  useEffect(() => {
    marcar("actualizaciones", act?.fase === "lista" ? "aj.marca.actualizacion" : null);
    return () => marcar("actualizaciones", null);
  }, [act?.fase]);

  // Cuando sale algo de verdad (no un cambio de versión ya andando) el que mira lo ve en pantalla sin tener que scrollear.
  const mirar = async () => {
    const c = carcasa;
    if (!c) return;
    setRestos({ paso: "mirando" });
    setNombre("");
    const p = await c.restosPlan().catch(comoError);
    if (!vivo.current) return;
    setRestos(esError(p) ? { paso: "error", texto: p.error } : { paso: "plan", plan: p });
  };

  // Las capturas abren la sección con el plan o la distro a la vista.
  useEffect(() => {
    if (!FIXTURE_CARCASA) return;
    sec.current?.scrollIntoView({ block: "start" });
    if (MODO.variante === "carcasa-restos" || MODO.variante === "carcasa-distro") void mirar();
    if (MODO.variante === "carcasa-distro") setNombre("Ubuntu");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const c = carcasa;
  if (!c) return null;

  const buscar = () => void c.buscarActualizacion().catch(() => {});
  const ocupada = act?.fase === "buscando" || act?.fase === "descargando";

  const quitar = async (plan: PlanRestos, ids: string[]) => {
    setRestos({ paso: "quitando", plan });
    const r = await c.restosQuitar(ids).catch(comoError);
    if (!vivo.current) return;
    if (esError(r)) return setRestos({ paso: "error", texto: r.error });
    const bien = r.resultados.filter((x) => x.estado === "quitado").length;
    const mal = r.resultados.filter((x) => x.estado === "error").length;
    setRestos({ paso: "hecho", mal: mal > 0, texto: mal > 0 ? t("carcasa.restosHechoMal", { n: bien, m: mal }) : t("carcasa.restosHecho", { n: bien }) });
  };

  const quitarDistro = async (d: DistroResto) => {
    setRestos({ paso: "mirando" });
    const r = await c.restosQuitarDistro(nombre.trim()).catch(comoError);
    if (!vivo.current) return;
    if (esError(r)) return setRestos({ paso: "error", texto: r.error });
    const ok = r.resultados.some((x) => x.id === d.id && x.estado === "quitado");
    setRestos({ paso: "hecho", mal: !ok, texto: ok ? t("carcasa.distroHecho", { d: d.nombre }) : t("carcasa.distroNoQuitada", { d: d.nombre }) });
  };

  return (
    <section className="pn-sec pn-edita" ref={sec} data-carcasa>
      <div className="pn-estado">{t("carcasa.version", { v: version || "…" })}</div>

      <Dato nombre="carcasa.act" que="carcasa.actQue">
        <div className="pn-car-col">
          <div className="pn-acciones-btns">
            {act?.fase === "lista" ? (
              <button type="button" className="btn2" data-primario onClick={() => void c.reiniciarParaActualizar()}>
                {t("carcasa.reiniciar")}
              </button>
            ) : (
              <button type="button" className="btn2" disabled={ocupada || act?.fase === "inactiva"} onClick={buscar}>
                {t("carcasa.buscar")}
              </button>
            )}
          </div>
          <div className="pn-car-estado" role="status" aria-live="polite" data-fase={act?.fase}>
            {act?.fase === "descargando" ? <span className="pn-car-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={act.progreso ?? 0} style={{ ["--p" as string]: (act.progreso ?? 0) / 100 }} /> : null}
            {textoAct(act, version)}
          </div>
        </div>
      </Dato>

      <Dato nombre="carcasa.restos" que="carcasa.restosQue">
        <div className="pn-car-col">
          <div className="pn-acciones-btns">
            <button type="button" className="btn2" disabled={restos?.paso === "mirando" || restos?.paso === "quitando" || restos?.paso === "plan"} onClick={() => void mirar()}>
              {t("carcasa.restosBtn")}
            </button>
          </div>
        </div>
      </Dato>

      {restos ? (
        <div className="pn-car-restos" role="group" aria-label={t("carcasa.restos")}>
          {restos.paso === "mirando" ? <div className="pn-car-estado">{t("carcasa.restosMirando")}</div> : null}
          {restos.paso === "quitando" ? <div className="pn-car-estado">{t("carcasa.restosQuitando")}</div> : null}
          {restos.paso === "error" ? (
            <div className="pn-error" role="alert">
              {restos.texto}
            </div>
          ) : null}
          {restos.paso === "hecho" ? (
            <div className={restos.mal ? "pn-error" : "pn-ok"} role="status">
              {restos.texto}
            </div>
          ) : null}
          {restos.paso === "plan" ? <Plan plan={restos.plan} nombre={nombre} setNombre={setNombre} cancelar={() => setRestos(null)} quitar={(ids) => void quitar(restos.plan, ids)} quitarDistro={(d) => void quitarDistro(d)} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function Plan({ plan, nombre, setNombre, cancelar, quitar, quitarDistro }: { plan: PlanRestos; nombre: string; setNombre: (s: string) => void; cancelar: () => void; quitar: (ids: string[]) => void; quitarDistro: (d: DistroResto) => void }) {
  const aQuitar = plan.items.filter((i) => i.accion === "quitar");
  const ajenos = plan.items.filter((i) => i.accion === "ajeno");
  const d = plan.distro;
  if (!aQuitar.length && !ajenos.length && !d) {
    return (
      <>
        <div className="pn-car-estado">{t("carcasa.restosNada")}</div>
        <div className="pn-acciones-btns">
          <button type="button" className="btn2" onClick={cancelar}>
            {t("carcasa.cerrar")}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      {aQuitar.length ? (
        <>
          <div className="pn-nota">{t("carcasa.restosLista", { n: aQuitar.length })}</div>
          <Lista items={aQuitar} />
          <div className="pn-car-seguro">{t("carcasa.restosNoSeToca")}</div>
        </>
      ) : null}
      {ajenos.length ? (
        <>
          <div className="pn-nota">{t("carcasa.restosAjenos")}</div>
          <Lista items={ajenos} apagada />
        </>
      ) : null}
      {aQuitar.length ? (
        <div className="pn-acciones-btns">
          <button type="button" className="btn2" data-primario onClick={() => quitar(aQuitar.map((i) => i.id))}>
            {t("carcasa.restosConfirmar", { n: aQuitar.length })}
          </button>
          <button type="button" className="btn2" onClick={cancelar}>
            {t("carcasa.cancelar")}
          </button>
        </div>
      ) : (
        <div className="pn-acciones-btns">
          <button type="button" className="btn2" onClick={cancelar}>
            {t("carcasa.cerrar")}
          </button>
        </div>
      )}
      {d ? <Distro d={d} nombre={nombre} setNombre={setNombre} quitar={() => quitarDistro(d)} /> : null}
    </>
  );
}

function Lista({ items, apagada }: { items: ItemResto[]; apagada?: boolean }) {
  return (
    <ul className="pn-car-lista" data-apagada={apagada ? "" : undefined}>
      {items.map((i) => (
        <li key={i.id}>
          <span className="pn-car-que">{i.que}</span>
          <span className="pn-car-ruta">{i.ruta}</span>
        </li>
      ))}
    </ul>
  );
}

// La distro es lo único que no se recupera: segundo paso aparte, con lo que se pierde dicho y el nombre escrito.
function Distro({ d, nombre, setNombre, quitar }: { d: DistroResto; nombre: string; setNombre: (s: string) => void; quitar: () => void }) {
  if (!d.puede) {
    return (
      <div className="pn-car-distro">
        <div className="pn-nota">{t("carcasa.distroSeQueda", { d: d.nombre, m: d.motivo })}</div>
        {d.ajenos.length ? <div className="pn-car-ruta">{d.ajenos.join(" · ")}</div> : null}
      </div>
    );
  }
  const igual = nombre.trim() === d.nombre;
  return (
    <div className="pn-car-distro" data-peligro>
      <div className="pn-nom">{t("carcasa.distroTitulo", { d: d.nombre })}</div>
      <div className="pn-car-aviso">{t("carcasa.distroPierde", { p: d.pierde })}</div>
      <div className="pn-car-aviso">{t("carcasa.distroSinVuelta")}</div>
      <input
        className="pn-campo"
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={nombre}
        placeholder={t("carcasa.distroEscribi", { d: d.nombre })}
        aria-label={t("carcasa.distroEscribi", { d: d.nombre })}
        onChange={(ev) => setNombre(ev.target.value)}
      />
      <div className="pn-acciones-btns">
        <button type="button" className="btn2" data-peligro disabled={!igual} onClick={quitar}>
          {t("carcasa.distroBtn", { d: d.nombre })}
        </button>
      </div>
    </div>
  );
}
