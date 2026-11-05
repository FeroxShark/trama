// Ajustes > Conectores > Descubrir: skills de `anthropics/skills` y conectores del registro MCP oficial para buscar, ordenar por fecha e instalar
// (electron/descubrir.ts). El catálogo se baja sólo al abrir sin una copia de hoy o con «Actualizar». Instalar siempre abre una confirmación que
// dice qué pasa (qué archivos y si traen scripts; a qué dominio van tus datos); un conector que es un paquete NO se instala: se muestra su comando
// y su enlace para que la persona decida. Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Loader, Plus, RefreshCw, Search, Terminal } from "lucide-react";
import { fuentePaneles, type CatalogoDescubrir, type Previa } from "../datos/paneles";
import { locale, t, textoMain } from "../i18n";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { Estado } from "./AjustesDsh";
import { FilaAjuste, GrupoAjustes } from "./AjustesPiezas";
import { PanelCargando } from "./PanelCargando";
import {
  accionDe,
  buscarDescubrir,
  delTipo,
  fechaCorta,
  nombreVisible,
  ordenarDescubrir,
  ORDENES_DESCUBRIR,
  tamanoCorto,
  TIPOS_DESCUBRIR,
  VISIBLES_DESCUBRIR,
  yaEsta,
  type FiltroTipo,
  type ItemDescubrir,
  type OrdenDescubrir,
} from "./descubrir-vista";

/** Qué está pasando con un item: viendo la previa, esperando el sí o instalando. */
type Abierto = { id: string; previa: Previa | null; error: string | null; instalando: boolean };

function Etiquetas({ i }: { i: ItemDescubrir }) {
  const f = fechaCorta(i.fecha, locale());
  return (
    <>
      <span className="cn-origen" data-origen-descubrir>
        {t(i.tipo === "skill" ? "descubrir.tipoSkill" : "descubrir.tipoMcp")} · {t("descubrir.origen", { o: i.origen })}
        {i.tipo === "mcp" && i.version ? ` · ${t("descubrir.version", { v: i.version })}` : ""}
      </span>
      <span className="cn-origen" data-fecha-descubrir>
        {f ? t("descubrir.fecha", { f }) : t("descubrir.fechaSin")}
      </span>
      <span className="cn-desc">{i.descripcion ?? t("descubrir.sinDesc")}</span>
      <span className="ds-marcas">
        {i.tipo === "skill" ? <span className="cn-origen">{t("descubrir.archivos", { n: i.archivos })}</span> : null}
        {i.tipo === "skill" && i.scripts ? (
          <span className="ds-marca" data-aviso>
            <AlertTriangle size={13} strokeWidth={2.2} aria-hidden /> {t("descubrir.scripts")}
          </span>
        ) : null}
        {i.tipo === "mcp" && i.remoto ? <span className="cn-origen">{i.remoto.seguro ? t("descubrir.remotoDe", { d: i.remoto.dominio }) : t("descubrir.sinHttps")}</span> : null}
        {i.tipo === "mcp" && !i.remoto && i.paquete ? <span className="cn-origen">{t("descubrir.enPc")}</span> : null}
        {i.tipo === "mcp" && !i.remoto && !i.paquete ? <span className="cn-origen">{t("descubrir.sinForma")}</span> : null}
        {i.tipo === "mcp" && i.cabeceras.length ? <span className="cn-origen">{t("descubrir.pideCab", { c: i.cabeceras.join(", ") })}</span> : null}
      </span>
    </>
  );
}

function Confirmacion({ i, a, alConfirmar, alCerrar }: { i: ItemDescubrir; a: Abierto; alConfirmar: () => void; alCerrar: () => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  // El foco pasa al panel para que el teclado y el lector de pantalla lo encuentren.
  useEffect(() => raiz.current?.focus(), []);
  const accion = accionDe(i);
  const p = a.previa;
  return (
    <div className="ds-confirma" ref={raiz} tabIndex={-1} role="group" aria-label={nombreVisible(i)} data-confirma-descubrir={i.id}>
      {accion === "paquete" && i.tipo === "mcp" && i.paquete ? (
        <>
          <strong className="ds-confirma-tit">{t("descubrir.paqueteTit")}</strong>
          <p className="ds-texto">{t("descubrir.paqueteQue")}</p>
          <span className="cn-origen">{t("descubrir.comando")}</span>
          <code className="ds-comando" data-comando-descubrir>{i.paquete.comando}</code>
          <div className="ds-acciones">
            {i.paquete.enlace || i.enlace ? (
              <a className="ui-btn mdl-enlace" href={(i.paquete.enlace ?? i.enlace)!} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} strokeWidth={2} aria-hidden /> <span>{t(i.paquete.enlace ? "descubrir.verPaquete" : "descubrir.verMas")}</span>
              </a>
            ) : null}
            <Boton onClick={alCerrar}>{t("descubrir.cerrar")}</Boton>
          </div>
        </>
      ) : !p ? (
        <p className="ds-texto" role="status">
          {a.error ? null : <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" />} {a.error ? textoMain(a.error) : t("descubrir.previa")}
          {a.error ? (
            <>
              {" "}
              <Boton onClick={alCerrar}>{t("descubrir.cerrar")}</Boton>
            </>
          ) : null}
        </p>
      ) : p.tipo === "skill" ? (
        <>
          <strong className="ds-confirma-tit">{t("descubrir.confirmaSkill", { n: p.nombre })}</strong>
          <p className="ds-texto">{t("descubrir.confirmaSkillQue", { a: p.archivos.length, tam: tamanoCorto(p.total), d: p.destino })}</p>
          {p.scripts.length ? (
            <p className="ds-texto ds-alerta" role="alert" data-scripts-descubrir>
              <AlertTriangle size={14} strokeWidth={2.2} aria-hidden /> <span>{t("descubrir.confirmaScripts", { l: p.scripts.join(", ") })}</span>
            </p>
          ) : (
            <p className="ds-texto">{t("descubrir.confirmaSinScripts")}</p>
          )}
          <details className="ds-archivos">
            <summary>{t("descubrir.archivosDe", { n: p.archivos.length })}</summary>
            <ul>
              {p.archivos.map((f) => (
                <li key={f.ruta}>
                  <code>{f.ruta}</code> <span className="cn-origen">{tamanoCorto(f.tam)}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <>
          <strong className="ds-confirma-tit">{t("descubrir.confirmaMcp", { n: nombreVisible(i) })}</strong>
          <p className="ds-texto">{t("descubrir.confirmaMcpQue", { u: p.url, d: p.dominio })}</p>
          <p className="ds-texto">{p.cabeceras.length ? t("descubrir.confirmaMcpCab", { c: p.cabeceras.join(", ") }) : t("descubrir.confirmaMcpSin")}</p>
        </>
      )}
      {a.error && p ? <div className="pn-error dsh-err" role="alert">{textoMain(a.error)}</div> : null}
      {p ? (
        <div className="ds-acciones">
          <Boton primario onClick={alConfirmar} disabled={a.instalando}>
            {a.instalando ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : null} <span>{a.instalando ? t(i.tipo === "skill" ? "descubrir.instalando" : "descubrir.agregando") : t(i.tipo === "skill" ? "descubrir.instalar" : "descubrir.agregar")}</span>
          </Boton>
          <Boton onClick={alCerrar} disabled={a.instalando}>
            {t("ajustes.cancelar")}
          </Boton>
        </div>
      ) : null}
    </div>
  );
}

function Fila({ i, a, bloqueado, alAbrir, alConfirmar, alCerrar }: { i: ItemDescubrir; a: Abierto | null; bloqueado: boolean; alAbrir: (i: ItemDescubrir) => void; alConfirmar: () => void; alCerrar: () => void }) {
  const accion = accionDe(i);
  const esta = yaEsta(i);
  const nombre = nombreVisible(i);
  const abierta = a?.id === i.id ? a : null;
  const skill = i.tipo === "skill";
  return (
    <FilaAjuste
      className="cn-fila"
      titulo={nombre}
      ayuda={<Etiquetas i={i} />}
      control={
        <span className="cn-ctrl">
          {accion === "ninguna" ? (
            <Estado ok={false} texto={t("descubrir.noAgregable")} />
          ) : accion === "paquete" ? null : (
            <Estado ok={esta} texto={t(skill ? (esta ? "descubrir.instalada" : "descubrir.noInstalada") : esta ? "descubrir.agregado" : "descubrir.noAgregado")} />
          )}
          {accion !== "ninguna" && !(accion !== "paquete" && esta) ? (
            <Boton
              onClick={() => alAbrir(i)}
              disabled={bloqueado || !!abierta}
              aria-label={t(accion === "paquete" ? "descubrir.verComandoDe" : skill ? "descubrir.instalarDe" : "descubrir.agregarDe", { n: nombre })}
              aria-expanded={!!abierta}
            >
              {accion === "paquete" ? <Terminal size={14} strokeWidth={2} aria-hidden /> : skill ? <Download size={14} strokeWidth={2} aria-hidden /> : <Plus size={14} strokeWidth={2} aria-hidden />}{" "}
              <span>{t(accion === "paquete" ? "descubrir.verComando" : skill ? "descubrir.instalar" : "descubrir.agregar")}</span>
            </Boton>
          ) : null}
        </span>
      }
    >
      {abierta ? <Confirmacion i={i} a={abierta} alConfirmar={alConfirmar} alCerrar={alCerrar} /> : null}
    </FilaAjuste>
  );
}

/** `alCambiar` avisa que se instaló algo, para que el inventario y los conectores propios de arriba y abajo se vuelvan a leer. */
export function Descubrir({ alCambiar }: { alCambiar: () => void }) {
  const [cat, setCat] = useState<CatalogoDescubrir | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<FiltroTipo>("todo");
  const [orden, setOrden] = useState<OrdenDescubrir>("reciente");
  const [todos, setTodos] = useState(false);
  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const vivo = useRef(true);
  const raiz = useRef<HTMLDivElement>(null);

  // Captura `ajustes` con HILOS_VARIANTE=descubrir…: la sección a la vista una vez cargada.
  useEffect(() => {
    if (cat && MODO.variante?.startsWith("descubrir")) raiz.current?.scrollIntoView({ block: "start" });
  }, [cat]);

  // Al abrir: la copia de hoy, o bajarla si no hay. Nunca por sondeo.
  useEffect(() => {
    vivo.current = true;
    void fuentePaneles.catalogoDescubrir(false).then(
      (r) => vivo.current && setCat(r),
      (x) => vivo.current && setFalla(mensaje(x)),
    );
    return () => void (vivo.current = false);
  }, []);

  const actualizar = async () => {
    setActualizando(true);
    setHecho(null);
    try {
      const r = await fuentePaneles.catalogoDescubrir(true);
      if (vivo.current) setCat(r);
    } catch (x) {
      if (vivo.current) setFalla(mensaje(x));
    } finally {
      if (vivo.current) setActualizando(false);
    }
  };

  const abrir = (i: ItemDescubrir) => {
    setHecho(null);
    const accion = accionDe(i);
    setAbierto({ id: i.id, previa: null, error: null, instalando: false });
    if (accion === "paquete") return;
    void fuentePaneles.previaDescubrir(i.id).then(
      (previa) => vivo.current && setAbierto((a) => (a?.id === i.id ? { ...a, previa, error: null } : a)),
      (x) => vivo.current && setAbierto((a) => (a?.id === i.id ? { ...a, error: mensaje(x) } : a)),
    );
  };

  const confirmar = async () => {
    if (!abierto?.previa) return;
    const { id, previa } = abierto;
    setAbierto({ ...abierto, instalando: true, error: null });
    try {
      const r = await fuentePaneles.instalarDescubrir(id, previa.tipo === "skill" ? previa.huella : undefined);
      if (!vivo.current) return;
      setHecho(r.tipo === "skill" ? t("descubrir.okSkill", { n: r.nombre, c: r.carpeta, a: r.archivos }) : t("descubrir.okMcp", { n: r.nombre }));
      setAbierto(null);
      void fuentePaneles.catalogoDescubrir(false).then((c) => vivo.current && setCat(c), () => {});
      alCambiar();
    } catch (x) {
      if (vivo.current) setAbierto((a) => (a?.id === id ? { ...a, instalando: false, error: mensaje(x) } : a));
    }
  };

  if (falla) return <div className="pn-aviso" data-error>{textoMain(falla)}</div>;
  if (!cat) return <PanelCargando />;

  const items: ItemDescubrir[] = [...cat.skills, ...cat.mcp];
  const visibles = ordenarDescubrir(buscarDescubrir(delTipo(items, tipo), busca), orden);
  const buscando = busca.trim() !== "" || tipo !== "todo";
  const ver = buscando || todos ? visibles : visibles.slice(0, VISIBLES_DESCUBRIR);
  const cuando = cat.actualizado ? new Date(cat.actualizado).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="cn-inv ds-raiz" data-descubrir ref={raiz}>
      <p className="pn-nota pn-intro">{t("descubrir.intro")}</p>
      <p className="ol-nota" data-nota-skills>{t("descubrir.notaSkills")}</p>
      <p className="ol-nota">{t("descubrir.notaMcp")}</p>
      <div className="cn-barra">
        <label className="cn-buscar">
          <Search size={14} strokeWidth={2} aria-hidden />
          <input className="pn-campo" type="search" value={busca} spellCheck={false} autoComplete="off" placeholder={t("descubrir.buscar")} aria-label={t("descubrir.buscar")} onChange={(ev) => setBusca(ev.target.value)} />
        </label>
        <Boton onClick={() => void actualizar()} disabled={actualizando} aria-label={t("descubrir.actualizar")}>
          {actualizando ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <RefreshCw size={14} strokeWidth={2} aria-hidden />} <span>{t("descubrir.actualizar")}</span>
        </Boton>
      </div>
      <div className="cn-barra pl-filtros">
        <label className="pl-filtro">
          <span>{t("descubrir.tipo")}</span>
          <select className="pn-campo" value={tipo} onChange={(ev) => setTipo(ev.target.value as FiltroTipo)}>
            {TIPOS_DESCUBRIR.map((k) => (
              <option key={k} value={k}>{t(`descubrir.tipo.${k}`)}</option>
            ))}
          </select>
        </label>
        <label className="pl-filtro">
          <span>{t("descubrir.orden")}</span>
          <select className="pn-campo" value={orden} onChange={(ev) => setOrden(ev.target.value as OrdenDescubrir)}>
            {ORDENES_DESCUBRIR.map((k) => (
              <option key={k} value={k}>{t(`descubrir.orden.${k}`)}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="ol-nota" role="status">
        {actualizando ? t("descubrir.actualizando") : cuando ? `${t("descubrir.bajado", { f: cuando })} · ${t("descubrir.cuenta", { n: visibles.length, total: items.length })}` : t("descubrir.nuncaBajado")}
      </p>
      {cat.errores.skills ? <div className="pn-error dsh-err" role="alert">{t("descubrir.fallaSkills", { m: textoMain(cat.errores.skills) })}</div> : null}
      {cat.errores.mcp ? <div className="pn-error dsh-err" role="alert">{t("descubrir.fallaMcp", { m: textoMain(cat.errores.mcp) })}</div> : null}
      {hecho ? <div className="pn-aviso ds-hecho" role="status" data-hecho-descubrir>{hecho}</div> : null}
      <GrupoAjustes className="cn-grupo">
        {!items.length ? <p className="ol-nota cn-vacio">{t("descubrir.vacio")}</p> : null}
        {items.length && !visibles.length ? <p className="ol-nota cn-vacio">{t("descubrir.sinResultados")}</p> : null}
        {ver.map((i) => (
          <Fila key={i.id} i={i} a={abierto} bloqueado={abierto?.instalando === true} alAbrir={abrir} alConfirmar={() => void confirmar()} alCerrar={() => setAbierto(null)} />
        ))}
        {!buscando && visibles.length > VISIBLES_DESCUBRIR ? (
          <div className="cn-mas">
            <Boton onClick={() => setTodos((v) => !v)} aria-expanded={todos}>
              {todos ? t("conectores.verMenos") : t("conectores.verTodos", { n: visibles.length })}
            </Boton>
          </div>
        ) : null}
      </GrupoAjustes>
    </div>
  );
}
