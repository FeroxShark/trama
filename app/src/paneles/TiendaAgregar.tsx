// Ajustes > Conectores como tienda: el panel de «Agregar», con lo que de verdad se puede agregar en cada pestaña. Skills: explorar el catálogo o abrir
// la carpeta `~/.claude/skills`. Conectores: uno propio de Trama por URL o por comando (el formulario de siempre; los valores secretos van a
// `claves.env` y NO vuelven a esta pantalla). Plugins: otro catálogo de GitHub (`usuario/repo`). Hooks: no hay nada que agregar desde acá.
// Se guarda al toque, sin la barra de Guardar; sólo desde la PC. Los conectores propios le llegan a los líderes de Claude, DeepSeek Harness y OpenCode.
import { useState, type FormEvent } from "react";
import { ExternalLink, FolderOpen, Loader, Plus, Search, Trash2 } from "lucide-react";
import { fuente } from "../datos/fuente";
import { fuentePaneles, type EntradaMcp, type EstadoCatalogos, type VistaServidorMcp } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { Estado } from "./AjustesDsh";
import type { Pestana } from "./tienda-logica";

type Tipo = VistaServidorMcp["tipo"];
type VariableBorrador = { nombre: string; valor: string; hay: boolean };
export type Borrador = { nombre: string; tipo: Tipo; comando: string; args: string; url: string; variables: VariableBorrador[]; nuevo: boolean };

export const borradorVacio = (): Borrador => ({ nombre: "", tipo: "http", comando: "", args: "", url: "", variables: [], nuevo: true });

export const aBorrador = (s: VistaServidorMcp): Borrador => ({
  nombre: s.nombre,
  tipo: s.tipo,
  comando: s.comando ?? "",
  args: (s.args ?? []).join("\n"),
  url: s.url ?? "",
  variables: s.variables.map((v) => ({ nombre: v.nombre, valor: "", hay: v.hay })),
  nuevo: false,
});

/** Lo que se manda al main: un valor vacío conserva el guardado (`valor` ausente). */
export const aEntrada = (b: Borrador): EntradaMcp => {
  const tipoVar = b.tipo === "stdio" ? "env" : "cabecera";
  return {
    nombre: b.nombre.trim(),
    tipo: b.tipo,
    ...(b.tipo === "stdio" ? { comando: b.comando.trim(), args: b.args.split(/\r?\n/).map((a) => a.trim()).filter(Boolean) } : { url: b.url.trim() }),
    variables: b.variables
      .filter((v) => v.nombre.trim())
      .map((v) => ({ tipo: tipoVar, nombre: v.nombre.trim(), ...(v.valor.trim() ? { valor: v.valor.trim() } : {}) })),
  };
};

function Formulario({ b, cambiar, ocupado, alGuardar, alCancelar }: { b: Borrador; cambiar: (b: Borrador) => void; ocupado: boolean; alGuardar: () => void; alCancelar: () => void }) {
  const stdio = b.tipo === "stdio";
  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (!ocupado) alGuardar();
  };
  const ponerVar = (i: number, p: Partial<VariableBorrador>) => cambiar({ ...b, variables: b.variables.map((v, j) => (j === i ? { ...v, ...p } : v)) });
  return (
    <form className="mcp-form" onSubmit={enviar} data-mcp-form>
      <label className="mcp-campo">
        <span>{t("conectores.nombre")}</span>
        <input className="pn-campo" value={b.nombre} disabled={!b.nuevo} spellCheck={false} autoComplete="off" placeholder={t("conectores.nombrePh")} onChange={(ev) => cambiar({ ...b, nombre: ev.target.value })} />
      </label>
      <label className="mcp-campo">
        <span>{t("conectores.tipo")}</span>
        <select className="pn-campo" value={b.tipo} onChange={(ev) => cambiar({ ...b, tipo: ev.target.value as Tipo, variables: [] })}>
          <option value="http">{t("conectores.tipoHttp")}</option>
          <option value="sse">{t("conectores.tipoSse")}</option>
          <option value="stdio">{t("conectores.tipoStdio")}</option>
        </select>
      </label>
      {stdio ? (
        <>
          <label className="mcp-campo">
            <span>{t("conectores.comando")}</span>
            <input className="pn-campo" value={b.comando} spellCheck={false} autoComplete="off" placeholder="npx" onChange={(ev) => cambiar({ ...b, comando: ev.target.value })} />
          </label>
          <label className="mcp-campo">
            <span>{t("conectores.args")}</span>
            <textarea className="pn-campo" rows={3} value={b.args} spellCheck={false} placeholder={"-y\n@modelcontextprotocol/server-filesystem"} onChange={(ev) => cambiar({ ...b, args: ev.target.value })} />
          </label>
        </>
      ) : (
        <label className="mcp-campo">
          <span>{t("conectores.url")}</span>
          <input className="pn-campo" type="url" value={b.url} spellCheck={false} autoComplete="off" placeholder="https://mcp.example.com/mcp" onChange={(ev) => cambiar({ ...b, url: ev.target.value })} />
        </label>
      )}
      <fieldset className="mcp-vars">
        <legend>{t(stdio ? "conectores.varsEnv" : "conectores.varsCab")}</legend>
        {b.variables.map((v, i) => (
          <div className="mcp-var" key={i}>
            <input
              className="pn-campo"
              value={v.nombre}
              spellCheck={false}
              autoComplete="off"
              aria-label={t("conectores.varNombre")}
              placeholder={stdio ? "NOTION_TOKEN" : "Authorization"}
              onChange={(ev) => ponerVar(i, { nombre: ev.target.value, hay: false })}
            />
            <input
              className="pn-campo"
              type="password"
              value={v.valor}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label={t("conectores.varValor")}
              placeholder={v.hay ? t("conectores.varGuardadaPh") : stdio ? "secret_…" : "Bearer …"}
              onChange={(ev) => ponerVar(i, { valor: ev.target.value })}
            />
            <Boton aria-label={t("conectores.varQuitar")} onClick={() => cambiar({ ...b, variables: b.variables.filter((_, j) => j !== i) })}>
              <Trash2 size={14} strokeWidth={2} aria-hidden />
            </Boton>
          </div>
        ))}
        <Boton onClick={() => cambiar({ ...b, variables: [...b.variables, { nombre: "", valor: "", hay: false }] })}>
          <Plus size={14} strokeWidth={2} aria-hidden /> <span>{t("conectores.varAgregar")}</span>
        </Boton>
        <p className="ol-nota">{t("conectores.varNota")}</p>
      </fieldset>
      <div className="mcp-acciones">
        <Boton type="submit" primario disabled={ocupado || !b.nombre.trim()}>
          {ocupado ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : null} <span>{t("conectores.guardar")}</span>
        </Boton>
        <Boton onClick={alCancelar} disabled={ocupado}>
          {t("ajustes.cancelar")}
        </Boton>
      </div>
    </form>
  );
}

type Props = {
  pestana: Pestana;
  /** Un conector propio para editar (viene del detalle); sin él, el formulario es de uno nuevo. */
  editar: Borrador | null;
  /** Las cuentas de Claude con las que se puede instalar un plugin, y la elegida. */
  cuentas: string[];
  cuenta: string;
  alElegirCuenta: (id: string) => void;
  /** Ir a «Descubrir» de esta pestaña. */
  alExplorar: () => void;
  alCerrar: () => void;
  /** Se guardó un conector propio (la lista nueva) o se agregó un catálogo (el estado nuevo). */
  alCambiar: (c: { propios?: VistaServidorMcp[]; catalogos?: EstadoCatalogos }) => void;
};

export function PanelAgregar({ pestana, editar, cuentas, cuenta, alElegirCuenta, alExplorar, alCerrar, alCambiar }: Props) {
  const [b, setB] = useState<Borrador>(editar ?? borradorVacio());
  const [repo, setRepo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carpeta, setCarpeta] = useState<"abrio" | "no" | null>(null);

  const correr = async (f: () => Promise<void>) => {
    setOcupado(true);
    setError(null);
    try {
      await f();
    } catch (x) {
      setError(mensaje(x));
    } finally {
      setOcupado(false);
    }
  };
  const guardar = () =>
    void correr(async () => {
      const lista = await fuentePaneles.guardarMcp(aEntrada(b));
      alCambiar({ propios: lista });
      alCerrar();
    });
  const agregarRepo = (ev: FormEvent) => {
    ev.preventDefault();
    const r = repo.trim();
    if (!r || ocupado) return;
    void correr(async () => {
      const est = await fuentePaneles.agregarCatalogoPlugins(r, cuenta);
      alCambiar({ catalogos: est });
      setRepo("");
      alCerrar();
    });
  };
  const abrirCarpeta = async () => {
    setCarpeta((await fuente.carpetaAbrir("~/.claude/skills").catch(() => false)) ? "abrio" : "no");
  };

  return (
    <section className="ti-agregar" aria-label={t("tienda.agregarTit")} data-agregar={pestana}>
      {pestana === "skills" ? (
        <>
          <h4 className="ti-agregar-t">{t("tienda.agregarSkills")}</h4>
          <p className="ti-agregar-d">{t("tienda.agregarSkillsQue")}</p>
          <div className="mcp-acciones">
            <Boton primario onClick={alExplorar}>
              <Search size={14} strokeWidth={2} aria-hidden /> <span>{t("tienda.explorarSkills")}</span>
            </Boton>
            <Boton onClick={() => void abrirCarpeta()}>
              <FolderOpen size={14} strokeWidth={2} aria-hidden /> <span>{t("tienda.abrirCarpetaSkills")}</span>
            </Boton>
            <Boton onClick={alCerrar}>{t("descubrir.cerrar")}</Boton>
          </div>
          {carpeta === "no" ? <p className="ol-nota" role="status">{t("tienda.carpetaNo")}</p> : null}
        </>
      ) : null}

      {pestana === "mcp" ? (
        <>
          <h4 className="ti-agregar-t">{t(b.nuevo ? "tienda.agregarMcp" : "tienda.editarMcp", { n: b.nombre })}</h4>
          <p className="ti-agregar-d">{t("conectores.intro")}</p>
          <Formulario b={b} cambiar={setB} ocupado={ocupado} alGuardar={guardar} alCancelar={alCerrar} />
          <ul className="mcp-motores" aria-label={t("conectores.motores")}>
            <li><Estado ok texto={t("conectores.mClaude")} /></li>
            <li><Estado ok texto={t("conectores.mDsh")} /></li>
            <li><Estado ok texto={t("conectores.mOpencode")} /></li>
            <li><Estado ok={false} texto={t("conectores.mGemini")} /></li>
            <li><Estado ok={false} texto={t("conectores.mWorkers")} /></li>
          </ul>
          <p className="ol-nota">{t("conectores.motoresNota")}</p>
          <div className="mcp-acciones">
            <Boton onClick={alExplorar}>
              <Search size={14} strokeWidth={2} aria-hidden /> <span>{t("tienda.explorarMcp")}</span>
            </Boton>
            <a className="ui-btn mdl-enlace" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} strokeWidth={2} aria-hidden /> <span>{t("conectores.claudeaiAbrir")}</span>
            </a>
          </div>
          <p className="ol-nota">{t("conectores.claudeaiNota")}</p>
        </>
      ) : null}

      {pestana === "plugins" ? (
        <>
          <h4 className="ti-agregar-t">{t("tienda.agregarPlugins")}</h4>
          <p className="ti-agregar-d">{t("tienda.agregarPluginsQue")}</p>
          <form className="pl-otro" onSubmit={agregarRepo} data-plugins-otro>
            <label className="mcp-campo">
              <span>{t("plugins.otro")}</span>
              <input className="pn-campo" value={repo} spellCheck={false} autoComplete="off" placeholder="usuario/repo" disabled={ocupado} onChange={(ev) => setRepo(ev.target.value)} />
            </label>
            {cuentas.length ? (
              <label className="mcp-campo">
                <span>{t("plugins.cuenta")}</span>
                <select className="pn-campo" value={cuenta} disabled={ocupado} onChange={(ev) => alElegirCuenta(ev.target.value)}>
                  <option value="">{t("plugins.cuentaDeSiempre")}</option>
                  {cuentas.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <Boton type="submit" primario disabled={ocupado || !repo.trim()}>
              {ocupado ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <Plus size={14} strokeWidth={2} aria-hidden />} <span>{ocupado ? t("plugins.agregando") : t("plugins.agregarOtro")}</span>
            </Boton>
            <Boton onClick={alCerrar} disabled={ocupado}>{t("ajustes.cancelar")}</Boton>
          </form>
          <div className="mcp-acciones">
            <Boton onClick={alExplorar}>
              <Search size={14} strokeWidth={2} aria-hidden /> <span>{t("tienda.explorarPlugins")}</span>
            </Boton>
          </div>
        </>
      ) : null}

      {error ? <div className="pn-error dsh-err" role="alert">{textoMain(error)}</div> : null}
    </section>
  );
}
