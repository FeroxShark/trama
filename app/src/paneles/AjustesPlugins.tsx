// Ajustes > Conectores > Catálogos de plugins: instalar skills y plugins de Claude Code sin la terminal. Los catálogos oficiales de Anthropic
// (`anthropics/skills` y `anthropics/claude-plugins-official`) se ofrecen siempre; se puede agregar otro por `usuario/repo` de GitHub. Cada plugin
// lleva su botón Instalar o Quitar (lo corre el `claude` de la cuenta elegida: electron/plugins-claude.ts) y al terminar se vuelve a leer el
// inventario de arriba. Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Loader, Plus, Trash2 } from "lucide-react";
import { fuentePaneles, type Catalogo, type EstadoCatalogos, type PluginCatalogo } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { Estado } from "./AjustesDsh";
import { FilaAjuste, GrupoAjustes } from "./AjustesPiezas";
import { PanelCargando } from "./PanelCargando";
import { buscarPlugins } from "./conectores-vista";

/** Cuántos plugins se ven de entrada en cada catálogo si no se busca nada (el oficial trae más de trescientos). */
const VISIBLES = 6;

const nombreCatalogo = (c: Catalogo) => (c.repo === "anthropics/skills" ? t("plugins.catSkills") : c.repo === "anthropics/claude-plugins-official" ? t("plugins.catOficial") : c.id);
const queCatalogo = (c: Catalogo) => (c.repo === "anthropics/skills" ? t("plugins.catSkillsQue") : c.repo === "anthropics/claude-plugins-official" ? t("plugins.catOficialQue") : "");

type Ocupado = { clave: string; texto: string } | null;

function FilaPlugin({ c, p, ocupado, alAccionar }: { c: Catalogo; p: PluginCatalogo; ocupado: Ocupado; alAccionar: (c: Catalogo, p: PluginCatalogo) => void }) {
  const mio = ocupado?.clave === `${p.nombre}@${c.id}`;
  return (
    <FilaAjuste
      className="cn-fila"
      titulo={p.nombre}
      ayuda={
        <>
          {p.categoria ? <span className="cn-origen">{p.categoria}</span> : null}
          {p.descripcion ? <span className="cn-desc">{p.descripcion}</span> : null}
        </>
      }
      control={
        <span className="cn-ctrl">
          <Estado ok={p.instalado} texto={t(p.instalado ? "plugins.instalado" : "plugins.noInstalado")} />
          <Boton onClick={() => alAccionar(c, p)} disabled={ocupado !== null} aria-label={t(p.instalado ? "plugins.quitarDe" : "plugins.instalarDe", { n: p.nombre })}>
            {mio ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : p.instalado ? <Trash2 size={14} strokeWidth={2} aria-hidden /> : <Download size={14} strokeWidth={2} aria-hidden />}{" "}
            <span>{mio ? ocupado?.texto : t(p.instalado ? "plugins.quitar" : "plugins.instalar")}</span>
          </Boton>
        </span>
      }
    />
  );
}

function BloqueCatalogo({ c, buscando, plugins, ocupado, alAgregar, alAccionar }: { c: Catalogo; buscando: boolean; plugins: PluginCatalogo[]; ocupado: Ocupado; alAgregar: (c: Catalogo) => void; alAccionar: (c: Catalogo, p: PluginCatalogo) => void }) {
  const [todos, setTodos] = useState(false);
  const ver = buscando || todos ? plugins : plugins.slice(0, VISIBLES);
  const mio = ocupado?.clave === `catalogo:${c.repo}`;
  return (
    <GrupoAjustes titulo={`${nombreCatalogo(c)}${c.agregado ? ` · ${c.plugins.length}` : ""}`} subtitulo={[queCatalogo(c), c.repo || c.id].filter(Boolean).join(" · ")} className="cn-grupo" >
      {!c.agregado ? (
        <FilaAjuste
          className="cn-fila"
          titulo={t("plugins.sinAgregar")}
          ayuda={<span className="cn-desc">{t("plugins.sinAgregarAyuda")}</span>}
          control={
            <Boton primario onClick={() => alAgregar(c)} disabled={ocupado !== null} aria-label={t("plugins.agregarDe", { n: nombreCatalogo(c) })}>
              {mio ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <Plus size={14} strokeWidth={2} aria-hidden />} <span>{mio ? ocupado?.texto : t("plugins.agregar")}</span>
            </Boton>
          }
        />
      ) : null}
      {c.agregado && !plugins.length ? <p className="ol-nota cn-vacio">{buscando ? t("conectores.sinResultados") : t("plugins.sinPlugins")}</p> : null}
      {ver.map((p) => (
        <FilaPlugin key={p.nombre} c={c} p={p} ocupado={ocupado} alAccionar={alAccionar} />
      ))}
      {!buscando && plugins.length > VISIBLES ? (
        <div className="cn-mas">
          <Boton onClick={() => setTodos((v) => !v)} aria-expanded={todos}>
            {todos ? t("conectores.verMenos") : t("conectores.verTodos", { n: plugins.length })}
          </Boton>
        </div>
      ) : null}
    </GrupoAjustes>
  );
}

export function CatalogosPlugins({ alCambiar }: { alCambiar: () => void }) {
  const [est, setEst] = useState<EstadoCatalogos | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [busca, setBusca] = useState("");
  const [repo, setRepo] = useState("");
  const [cuenta, setCuenta] = useState("");
  const vivo = useRef(true);
  const raiz = useRef<HTMLDivElement>(null);

  // Captura `ajustes` con HILOS_VARIANTE=plugins: los catálogos a la vista una vez cargados.
  useEffect(() => {
    if (est && MODO.variante?.startsWith("plugins")) raiz.current?.scrollIntoView({ block: "start" });
  }, [est]);

  useEffect(() => {
    vivo.current = true;
    void fuentePaneles.catalogosPlugins().then(
      (r) => vivo.current && setEst(r),
      (x) => vivo.current && setFalla(mensaje(x)),
    );
    return () => void (vivo.current = false);
  }, []);

  /** Corre una acción de `claude plugin …`, muestra el estado nuevo y avisa para que se vuelva a leer el inventario. */
  const correr = async (clave: string, texto: string, accion: () => Promise<EstadoCatalogos>) => {
    setOcupado({ clave, texto });
    setError(null);
    try {
      const r = await accion();
      if (vivo.current) setEst(r);
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
    } finally {
      if (vivo.current) setOcupado(null);
      alCambiar();
    }
  };

  const agregar = (c: Catalogo) => void correr(`catalogo:${c.repo}`, t("plugins.agregando"), () => fuentePaneles.agregarCatalogoPlugins(c.repo, cuenta));
  const accionar = (c: Catalogo, p: PluginCatalogo) =>
    void correr(`${p.nombre}@${c.id}`, t(p.instalado ? "plugins.quitando" : "plugins.instalando"), () => (p.instalado ? fuentePaneles.quitarPlugin(p.nombre, c.id, cuenta) : fuentePaneles.instalarPlugin(p.nombre, c.id, cuenta)));
  const agregarOtro = (ev: FormEvent) => {
    ev.preventDefault();
    const r = repo.trim();
    if (!r || ocupado) return;
    void correr(`catalogo:${r}`, t("plugins.agregando"), async () => {
      const x = await fuentePaneles.agregarCatalogoPlugins(r, cuenta);
      if (vivo.current) setRepo("");
      return x;
    });
  };

  if (falla) return <div className="pn-aviso" data-error>{textoMain(falla)}</div>;
  if (!est) return <PanelCargando />;

  const buscando = busca.trim() !== "";
  return (
    <div className="cn-inv" data-plugins-catalogo ref={raiz}>
      <p className="pn-nota pn-intro">{t("plugins.intro")}</p>
      <p className="pn-nota pn-intro" data-nota-claudeai>{t("plugins.notaClaudeai")}</p>
      <div className="cn-barra">
        <input className="pn-campo cn-buscar" type="search" value={busca} spellCheck={false} autoComplete="off" placeholder={t("plugins.buscar")} aria-label={t("plugins.buscar")} onChange={(ev) => setBusca(ev.target.value)} />
        {est.cuentas.length ? (
          <label className="pl-cuenta">
            <span>{t("plugins.cuenta")}</span>
            <select className="pn-campo" value={cuenta} disabled={ocupado !== null} onChange={(ev) => setCuenta(ev.target.value)}>
              <option value="">{t("plugins.cuentaDeSiempre")}</option>
              {est.cuentas.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {ocupado ? <p className="ol-nota" role="status">{ocupado.texto}</p> : null}
      {error ? <div className="pn-error dsh-err" role="alert">{textoMain(error)}</div> : null}
      {est.catalogos.map((c) => (
        <BloqueCatalogo key={c.repo || c.id} c={c} buscando={buscando} plugins={buscarPlugins(c.plugins, busca)} ocupado={ocupado} alAgregar={agregar} alAccionar={accionar} />
      ))}
      <form className="pl-otro" onSubmit={agregarOtro} data-plugins-otro>
        <label className="mcp-campo">
          <span>{t("plugins.otro")}</span>
          <input className="pn-campo" value={repo} spellCheck={false} autoComplete="off" placeholder="usuario/repo" disabled={ocupado !== null} onChange={(ev) => setRepo(ev.target.value)} />
        </label>
        <Boton type="submit" disabled={ocupado !== null || !repo.trim()}>
          <Plus size={14} strokeWidth={2} aria-hidden /> <span>{t("plugins.agregarOtro")}</span>
        </Boton>
      </form>
    </div>
  );
}
