// Ajustes > Conectores, armado como la página «Customize» de claude.ai: pestañas (Skills, Conectores MCP, Plugins, Hooks), un segmentado
// «Tuyos | Descubrir», buscador, filtro por categoría, orden y «Agregar», y debajo tarjetas en grilla (TiendaTarjetas.tsx). Tocar una tarjeta abre su
// detalle (TiendaDetalle.tsx); «Descubrir» se reparte en secciones y categorías (TiendaDescubrir.tsx). La lógica pura (armar, buscar, ordenar, secciones)
// vive en tienda-logica.ts y los datos en tienda-datos.ts. Todo sale de las fuentes que ya había: el inventario de Claude Code, los conectores propios de
// Trama, los catálogos de plugins y el catálogo de Descubrir; lo que una fuente no trae dice «sin dato». Se guarda al toque, sin la barra de Guardar;
// sólo desde la PC. Los valores secretos de un conector propio van a `claves.env` y NUNCA vuelven a esta pantalla.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, Plus, RefreshCw, Search, Loader } from "lucide-react";
import { DIAS_USOS } from "../../electron/usos-historial";
import { fuentePaneles, type Catalogo } from "../datos/paneles";
import { locale, t, textoMain, type ClaveSola } from "../i18n";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import "./tienda.css";
import { Cat } from "./AjustesNav";
import { ComoFunciona } from "./ComoFunciona";
import { PanelCargando } from "./PanelCargando";
import { aBorrador, PanelAgregar, type Borrador } from "./TiendaAgregar";
import { SeccionesDescubrir } from "./TiendaDescubrir";
import { DetalleTienda, type AccionesDetalle } from "./TiendaDetalle";
import { ICONO, Rejilla, TarjetaTienda } from "./TiendaTarjetas";
import { useTiendaDatos } from "./tienda-datos";
import {
  buscarTarjetas,
  categoriasDeTarjetas,
  conteoTuyos,
  filtrarCategoria,
  listaDeSeccion,
  ordenarTarjetas,
  ordenesDe,
  PESTANAS,
  seccionesDescubrir,
  tarjetasDescubrirMcp,
  tarjetasDescubrirPlugins,
  tarjetasDescubrirSkills,
  tarjetasTuyos,
  VISTAS,
  type Orden,
  type Pestana,
  type SeccionId,
  type Tarjeta,
  type Vista,
} from "./tienda-logica";

/** Cuántas tarjetas se dibujan de entrada en una lista plana (el registro MCP trae cientos y hay quien tiene más de trescientas skills). */
const PAGINA = 24;

const TEXTO_ORDEN: Record<Orden, ClaveSola> = {
  origen: "tienda.o.origen",
  mas: "conectores.ordenMas",
  menos: "conectores.ordenMenos",
  ultimo: "conectores.ordenUltimo",
  instalados: "plugins.orden.instalados",
  recientes: "plugins.orden.recientes",
  nombre: "plugins.orden.nombre",
};

const nombreCatalogo = (c: Catalogo) => (c.repo === "anthropics/skills" ? t("plugins.catSkills") : c.repo === "anthropics/claude-plugins-official" ? t("plugins.catOficial") : c.id);

/** Qué abre cada variante de captura (`HILOS_VARIANTE`) para que la foto caiga en lo que se quiere ver. */
function deVariante(v: string | null): { pestana: Pestana; vista: Vista; orden?: Orden; agregar?: boolean; detalle?: boolean; categoria?: boolean } {
  switch (v) {
    case "mcp-uso":
      return { pestana: "skills", vista: "tuyos", orden: "mas" };
    case "mcp-muchas":
      return { pestana: "skills", vista: "tuyos" };
    case "plugins":
    case "plugins-vacio":
    case "tienda-plugins":
      return { pestana: "plugins", vista: "descubrir" };
    case "tienda-plugins-tuyos":
      return { pestana: "plugins", vista: "tuyos" };
    case "tienda-detalle":
      return { pestana: "plugins", vista: "descubrir", detalle: true };
    case "tienda-categoria":
      return { pestana: "plugins", vista: "descubrir", categoria: true };
    case "tienda-agregar":
      return { pestana: "mcp", vista: "tuyos", agregar: true };
    case "descubrir":
    case "descubrir-vacio":
      return { pestana: "skills", vista: "descubrir" };
    case "descubrir-falla":
    case "tienda-mcp":
      return { pestana: "mcp", vista: "descubrir" };
    case "tienda-hooks":
      return { pestana: "hooks", vista: "tuyos" };
    default:
      return v?.startsWith("mcp") ? { pestana: "mcp", vista: "tuyos" } : { pestana: "skills", vista: "tuyos" };
  }
}

export function AjustesConectores() {
  const arranque = useRef(deVariante(MODO.variante)).current;
  const [pestana, setPestana] = useState<Pestana>(arranque.pestana);
  const [vista, setVista] = useState<Vista>(arranque.vista);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>(arranque.orden ?? ordenesDe(arranque.pestana, arranque.vista)[0] ?? "nombre");
  const [seccion, setSeccion] = useState<SeccionId | null>(null);
  const [visibles, setVisibles] = useState(PAGINA);
  const [detalle, setDetalle] = useState<{ clave: string; confirmar: boolean } | null>(null);
  const [agregar, setAgregar] = useState<{ editar: Borrador | null } | null>(arranque.agregar ? { editar: null } : null);
  const [cuenta, setCuenta] = useState("");
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const vivo = useRef(true);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);

  const d = useTiendaDatos(pestana, vista);
  const { inv, propios, catalogos, descubrir } = d;

  // ---- Las tarjetas --------------------------------------------------------------------------------------------------------------------------
  const todos = inv.datos?.items ?? [];
  const tuyos = useMemo(
    () => tarjetasTuyos(pestana, todos, d.uso, { propios: propios.datos ?? [], catalogos: catalogos.datos?.catalogos }),
    [pestana, inv.datos, d.uso, propios.datos, catalogos.datos],
  );
  const deDescubrir = useMemo(() => {
    if (vista !== "descubrir") return [];
    if (pestana === "skills") return tarjetasDescubrirSkills(descubrir.datos?.skills ?? []);
    if (pestana === "mcp") return tarjetasDescubrirMcp(descubrir.datos?.mcp ?? []);
    if (pestana === "plugins") return tarjetasDescubrirPlugins(catalogos.datos?.catalogos ?? []);
    return [];
  }, [vista, pestana, descubrir.datos, catalogos.datos]);
  const base = vista === "tuyos" ? tuyos : deDescubrir;
  const conteos = useMemo(() => conteoTuyos(todos, propios.datos ?? []), [inv.datos, propios.datos]);

  const ordenes = ordenesDe(pestana, vista);
  const ordenActual = ordenes.includes(orden) ? orden : (ordenes[0] ?? "nombre");
  const categorias = useMemo(() => categoriasDeTarjetas(base), [base]);
  const catActual = categoria !== null && categorias.some((c) => c.nombre === categoria) ? categoria : null;
  const buscando = busca.trim() !== "";
  const hayEstructura = vista === "descubrir" && !buscando && catActual === null && seccion === null && seccionesDescubrir(base).secciones.length > 0;
  const lista = useMemo(() => {
    const delOrden = seccion && vista === "descubrir" ? listaDeSeccion(base, seccion) : ordenarTarjetas(base, ordenActual);
    return filtrarCategoria(buscarTarjetas(delOrden, busca), catActual);
  }, [base, busca, catActual, ordenActual, seccion, vista]);
  const vivas = (clave: string) => base.find((x) => x.clave === clave) ?? null;
  const abierta = detalle ? vivas(detalle.clave) : null;
  const conectorDe = (x: Tarjeta) => (x.fuente.tipo === "conector" ? (todos.find((c) => c.id === (x.fuente as { id: string }).id) ?? null) : null);
  const propioDe = (x: Tarjeta) => (x.fuente.tipo === "propio" ? ((propios.datos ?? []).find((s) => s.nombre === (x.fuente as { nombre: string }).nombre) ?? null) : null);

  // Captura `tienda-detalle` / `tienda-categoria`: abre lo que se quiere ver en cuanto hay datos.
  const hecho = useRef(false);
  useEffect(() => {
    if (hecho.current || (!arranque.detalle && !arranque.categoria) || !deDescubrir.length) return;
    hecho.current = true;
    if (arranque.detalle) setDetalle({ clave: deDescubrir[0]!.clave, confirmar: false });
    if (arranque.categoria) setCategoria(categoriasDeTarjetas(deDescubrir)[0]?.nombre ?? null);
  }, [deDescubrir]);

  // ---- Moverse ---------------------------------------------------------------------------------------------------------------------------------
  const reiniciar = (p: Pestana, v: Vista) => {
    setPestana(p);
    setVista(v);
    setCategoria(null);
    setSeccion(null);
    setVisibles(PAGINA);
    setOrden(ordenesDe(p, v)[0] ?? "nombre");
    setAgregar(null);
    setDetalle(null);
    setError(null);
    setAviso(null);
  };
  const flechas = (ev: KeyboardEvent<HTMLDivElement>) => {
    const i = PESTANAS.indexOf(pestana);
    const n = ev.key === "ArrowRight" ? i + 1 : ev.key === "ArrowLeft" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? PESTANAS.length - 1 : null;
    if (n === null) return;
    ev.preventDefault();
    const nueva = PESTANAS[(n + PESTANAS.length) % PESTANAS.length]!;
    reiniciar(nueva, nueva === "hooks" ? "tuyos" : vista);
    requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`[data-pestana-btn="${nueva}"]`)?.focus());
  };

  // ---- Acciones --------------------------------------------------------------------------------------------------------------------------------
  /** Corre una acción de escritura: marca lo que está en curso, dice el error en palabras y lo vuelve a lanzar para quien necesite saber que falló. */
  const correr = async (clave: string, f: () => Promise<void>) => {
    setEnCurso(clave);
    setError(null);
    setAviso(null);
    try {
      await f();
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
      throw x;
    } finally {
      if (vivo.current) setEnCurso(null);
    }
  };
  const conmutar = (x: Tarjeta, v: boolean) =>
    correr(x.clave, async () => {
      if (x.fuente.tipo !== "conector") return;
      const r = await fuentePaneles.alternarConector(x.fuente.id, v);
      if (vivo.current) inv.poner(r);
    });
  const instalarPlugin = (x: Tarjeta) =>
    correr(x.clave, async () => {
      if (x.fuente.tipo !== "plugin") return;
      const r = await fuentePaneles.instalarPlugin(x.fuente.plugin, x.fuente.catalogo, cuenta);
      if (!vivo.current) return;
      catalogos.poner(r);
      inv.cargar();
    });
  const quitarPlugin = (plugin: string, catalogo: string) =>
    correr(`${plugin}@${catalogo}`, async () => {
      const r = await fuentePaneles.quitarPlugin(plugin, catalogo, cuenta);
      if (!vivo.current) return;
      catalogos.poner(r);
      inv.cargar();
    });
  const quitarPropio = (nombre: string) =>
    correr(`propio|${nombre}`, async () => {
      const r = await fuentePaneles.quitarMcp(nombre);
      if (vivo.current) propios.poner(r);
    });
  const alInstalado = (texto: string) => {
    setAviso(texto);
    descubrir.cargar();
    inv.cargar();
    propios.cargar();
  };
  const acciones: AccionesDetalle = {
    bloqueado: enCurso !== null,
    error,
    conmutar,
    instalarPlugin,
    quitarPlugin,
    quitarPropio,
    editarPropio: (nombre) => {
      const s = (propios.datos ?? []).find((x) => x.nombre === nombre);
      if (!s) return;
      setDetalle(null);
      setAgregar({ editar: aBorrador(s) });
    },
    alInstalado,
  };
  const anadir = (x: Tarjeta) => {
    if (x.fuente.tipo === "plugin") void instalarPlugin(x).catch(() => {});
    else setDetalle({ clave: x.clave, confirmar: x.accion !== "comando" });
  };
  const actualizar = async () => {
    setError(null);
    if (vista === "descubrir" && (pestana === "skills" || pestana === "mcp")) {
      setActualizando(true);
      try {
        descubrir.poner(await fuentePaneles.catalogoDescubrir(true));
      } catch (x) {
        if (vivo.current) setError(mensaje(x));
      } finally {
        if (vivo.current) setActualizando(false);
      }
      return;
    }
    inv.cargar();
    propios.cargar();
    catalogos.cargar();
  };

  const dibujar = (x: Tarjeta) => (
    <TarjetaTienda key={x.clave} x={x} hoy={d.hoy} enCurso={enCurso === x.clave} bloqueado={enCurso !== null} alAbrir={(y) => setDetalle({ clave: y.clave, confirmar: false })} alAnadir={anadir} alConmutar={(y, v) => void conmutar(y, v).catch(() => {})} />
  );

  // ---- Lo que se dice arriba de las tarjetas ---------------------------------------------------------------------------------------------------
  const cargandoVista = vista === "tuyos" ? false : pestana === "plugins" ? catalogos.datos === null && !catalogos.falla : pestana === "hooks" ? false : descubrir.datos === null && !descubrir.falla;
  const falla = inv.falla ?? (vista === "descubrir" ? (pestana === "plugins" ? catalogos.falla : descubrir.falla) : null);
  const usoOrden = vista === "tuyos" && (ordenActual === "mas" || ordenActual === "menos" || ordenActual === "ultimo");
  const cuando = descubrir.datos?.actualizado ? new Date(descubrir.datos.actualizado).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const estado = actualizando
    ? t("descubrir.actualizando")
    : usoOrden
      ? d.usoCargando
        ? t("conectores.usoCargando")
        : d.usos
          ? t("conectores.usoNota", { dias: DIAS_USOS, n: d.usos.sesiones })
          : t("conectores.usoNoHay")
      : vista === "descubrir" && (pestana === "skills" || pestana === "mcp")
        ? cuando
          ? t("descubrir.bajado", { f: cuando })
          : t("descubrir.nuncaBajado")
        : null;
  const noAgregados = vista === "descubrir" && pestana === "plugins" ? (catalogos.datos?.catalogos ?? []).filter((c) => !c.agregado) : [];
  const avisosDescubrir = vista === "descubrir" && (pestana === "skills" || pestana === "mcp") ? [descubrir.datos?.errores.skills && pestana === "skills" ? t("descubrir.fallaSkills", { m: textoMain(descubrir.datos.errores.skills) }) : null, descubrir.datos?.errores.mcp && pestana === "mcp" ? t("descubrir.fallaMcp", { m: textoMain(descubrir.datos.errores.mcp) }) : null].filter(Boolean) : [];
  const ver = lista.slice(0, visibles);
  const sinNada = !cargandoVista && !falla && base.length === 0;

  return (
    <Cat id="conectores">
      <div className="ti-raiz" data-opc="conectores.tienda" data-tienda ref={raiz}>
        <div className="ti-pestanas" role="tablist" aria-label={t("tienda.pestanas")} onKeyDown={flechas}>
          {PESTANAS.map((p) => {
            const Icono = ICONO[p];
            return (
              <button
                key={p}
                type="button"
                role="tab"
                id={`ti-tab-${p}`}
                aria-selected={p === pestana}
                aria-controls="ti-panel"
                tabIndex={p === pestana ? 0 : -1}
                className="ti-pestana"
                data-pestana-btn={p}
                data-guia={p === "plugins" ? "plugins-catalogo" : undefined}
                onClick={() => reiniciar(p, p === "hooks" ? "tuyos" : vista)}
              >
                <Icono size={15} strokeWidth={2} aria-hidden />
                <span>{t(`tienda.t.${p}`)}</span>
                <span className="ti-pestana-n">{inv.datos ? conteos[p] : ""}</span>
              </button>
            );
          })}
        </div>
        <ComoFunciona className="ti-que" key={pestana}>
          <p>{t(`tienda.q.${pestana}`)}</p>
        </ComoFunciona>

        <div className="ti-barra">
          {pestana !== "hooks" ? (
            <div className="ti-seg" role="group" aria-label={t("tienda.vistaAria")} data-guia="descubrir">
              {VISTAS.map((v) => (
                <button key={v} type="button" className="ti-seg-op" aria-pressed={v === vista} data-vista-btn={v} onClick={() => reiniciar(pestana, v)}>
                  {t(`tienda.v.${v}`)}
                </button>
              ))}
            </div>
          ) : null}
          <label className="ti-buscar">
            <Search size={14} strokeWidth={2} aria-hidden />
            <input
              className="pn-campo"
              type="search"
              value={busca}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("tienda.buscar")}
              aria-label={t("tienda.buscar")}
              onChange={(ev) => {
                setBusca(ev.target.value);
                setVisibles(PAGINA);
              }}
            />
          </label>
          {categorias.length ? (
            <label className="ti-campo">
              <span className="ti-campo-t">{t("plugins.categoria")}</span>
              <select
                className="pn-campo"
                value={catActual ?? ""}
                onChange={(ev) => {
                  setCategoria(ev.target.value || null);
                  setVisibles(PAGINA);
                }}
              >
                <option value="">{t("plugins.categoriaTodas")}</option>
                {categorias.map((c) => (
                  <option key={c.nombre} value={c.nombre}>{`${c.nombre} (${c.n})`}</option>
                ))}
              </select>
            </label>
          ) : null}
          {ordenes.length > 1 && !seccion ? (
            <label className="ti-campo" data-guia="conectores-orden">
              <span className="ti-campo-t">{t("conectores.ordenar")}</span>
              <select className="pn-campo" value={ordenActual} onChange={(ev) => (setOrden(ev.target.value as Orden), setVisibles(PAGINA))}>
                {ordenes.map((o) => (
                  <option key={o} value={o}>{t(TEXTO_ORDEN[o])}</option>
                ))}
              </select>
            </label>
          ) : null}
          <Boton className="ti-act" onClick={() => void actualizar()} disabled={actualizando} aria-label={t(vista === "descubrir" && pestana !== "plugins" ? "descubrir.actualizar" : "conectores.actualizar")} title={t(vista === "descubrir" && pestana !== "plugins" ? "descubrir.actualizar" : "conectores.actualizar")}>
            {actualizando ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <RefreshCw size={16} strokeWidth={2} aria-hidden />}
          </Boton>
          {pestana !== "hooks" ? (
            <Boton primario className="ti-agregar-btn" onClick={() => setAgregar((a) => (a ? null : { editar: null }))} aria-expanded={agregar !== null} aria-controls="ti-agregar-panel" data-agregar-btn>
              <Plus size={14} strokeWidth={2.4} aria-hidden /> <span>{t("tienda.agregar")}</span>
            </Boton>
          ) : null}
        </div>

        {agregar && pestana !== "hooks" ? (
          <div id="ti-agregar-panel">
            <PanelAgregar
              key={agregar.editar?.nombre ?? "nuevo"}
              pestana={pestana}
              editar={agregar.editar}
              cuentas={catalogos.datos?.cuentas ?? []}
              cuenta={cuenta}
              alElegirCuenta={setCuenta}
              alExplorar={() => reiniciar(pestana, "descubrir")}
              alCerrar={() => setAgregar(null)}
              alCambiar={(c) => {
                if (c.propios) propios.poner(c.propios);
                if (c.catalogos) {
                  catalogos.poner(c.catalogos);
                  inv.cargar();
                }
              }}
            />
          </div>
        ) : null}

        <div id="ti-panel" role="tabpanel" aria-labelledby={`ti-tab-${pestana}`} className="ti-panel" aria-busy={cargandoVista || undefined}>
          {estado ? <p className="ti-estado" role="status">{estado}</p> : null}
          {avisosDescubrir.map((m) => (
            <div key={m} className="pn-error dsh-err" role="alert">{m}</div>
          ))}
          {error ? <div className="pn-error dsh-err" role="alert">{textoMain(error)}</div> : null}
          {aviso ? <div className="pn-aviso ds-hecho" role="status" data-hecho-descubrir>{aviso}</div> : null}
          {noAgregados.map((c) => (
            <div key={c.id + c.repo} className="ti-sin-agregar" data-catalogo-sin-agregar={c.repo}>
              <div className="ti-sin-agregar-txt">
                <strong>{nombreCatalogo(c)}</strong>
                <span>{t("plugins.sinAgregarAyuda")}</span>
              </div>
              <Boton
                primario
                disabled={enCurso !== null}
                aria-label={t("plugins.agregarDe", { n: nombreCatalogo(c) })}
                onClick={() =>
                  void correr(`catalogo:${c.repo}`, async () => {
                    const r = await fuentePaneles.agregarCatalogoPlugins(c.repo, cuenta);
                    if (vivo.current) catalogos.poner(r);
                  }).catch(() => {})
                }
              >
                {enCurso === `catalogo:${c.repo}` ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <Plus size={14} strokeWidth={2.4} aria-hidden />} <span>{enCurso === `catalogo:${c.repo}` ? t("plugins.agregando") : t("plugins.agregar")}</span>
              </Boton>
            </div>
          ))}

          {falla ? (
            <div className="pn-aviso" data-error>{textoMain(falla)}</div>
          ) : !inv.datos || cargandoVista ? (
            <PanelCargando />
          ) : sinNada ? (
            <div className="ti-vacio" data-vacio>
              <p>{t(vista === "tuyos" ? `tienda.vacio.${pestana}` : pestana === "plugins" ? "plugins.sinPlugins" : "descubrir.vacio")}</p>
              {vista === "tuyos" && pestana !== "hooks" ? (
                <Boton onClick={() => reiniciar(pestana, "descubrir")}>
                  <Search size={14} strokeWidth={2} aria-hidden /> <span>{t("tienda.irADescubrir")}</span>
                </Boton>
              ) : null}
            </div>
          ) : hayEstructura ? (
            <SeccionesDescubrir
              tarjetas={base}
              dibujar={dibujar}
              alVerTodo={(id) => (setSeccion(id), setVisibles(PAGINA))}
              alCategoria={(c) => (setCategoria(c), setVisibles(PAGINA))}
            />
          ) : (
            <section className="ti-plana" data-plana>
              {seccion || catActual !== null ? (
                <div className="ti-plana-cab">
                  <Boton onClick={() => (setSeccion(null), setCategoria(null))}>
                    <ChevronLeft size={14} strokeWidth={2.2} aria-hidden /> <span>{t("tienda.volver")}</span>
                  </Boton>
                  <h3 className="ti-sec-t">{seccion ? t(`tienda.sec.${seccion}`) : catActual}</h3>
                </div>
              ) : null}
              <p className="ti-estado" role="status">{t("conectores.cuenta", { n: lista.length, total: base.length })}</p>
              {lista.length ? (
                <>
                  <Rejilla etiqueta={t(`tienda.t.${pestana}`)}>{ver.map(dibujar)}</Rejilla>
                  {lista.length > ver.length ? (
                    <div className="ti-mas">
                      <Boton onClick={() => setVisibles((n) => n + PAGINA)}>{t("tienda.verMas", { n: Math.min(PAGINA, lista.length - ver.length), resto: lista.length - ver.length })}</Boton>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="ol-nota ti-sin-res">{t("conectores.sinResultados")}</p>
              )}
            </section>
          )}
        </div>
      </div>

      {abierta ? (
        <DetalleTienda key={abierta.clave} x={abierta} conector={conectorDe(abierta)} propio={propioDe(abierta)} hoy={d.hoy} confirmar={detalle?.confirmar ?? false} acciones={acciones} alCerrar={() => setDetalle(null)} />
      ) : null}
    </Cat>
  );
}
