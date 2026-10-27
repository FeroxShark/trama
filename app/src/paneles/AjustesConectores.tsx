// Ajustes > Conectores: los servidores MCP propios de Trama (Notion, un Gmail propio, lo que sea): nombre, tipo (programa por comando o servidor
// por URL) y sus variables. Se guardan en `~/.config/trama/mcp.json`; los valores secretos (tokens, cabeceras) van a `claves.env` y NUNCA vuelven
// a esta pantalla: sólo se ve si hay uno guardado. Le llegan a los líderes de Claude, DeepSeek Harness y OpenCode (no a los workers ni a Gemini).
// Al toque, sin la barra de Guardar; sólo desde la PC. Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { fuentePaneles, type EntradaMcp, type VistaServidorMcp } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { Cat } from "./AjustesNav";
import { PanelCargando } from "./PanelCargando";
import type { FilaDato } from "./AjustesEditar";
import { Estado } from "./AjustesDsh";

type Tipo = VistaServidorMcp["tipo"];
type VariableBorrador = { nombre: string; valor: string; hay: boolean };
type Borrador = { nombre: string; tipo: Tipo; comando: string; args: string; url: string; variables: VariableBorrador[]; nuevo: boolean };

const vacio = (): Borrador => ({ nombre: "", tipo: "http", comando: "", args: "", url: "", variables: [], nuevo: true });

const aBorrador = (s: VistaServidorMcp): Borrador => ({
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

const destino = (s: VistaServidorMcp) => (s.tipo === "stdio" ? [s.comando, ...(s.args ?? [])].join(" ") : (s.url ?? ""));

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
          <Plus size={14} strokeWidth={2} aria-hidden /> <Fijo k="conectores.varAgregar" />
        </Boton>
        <p className="ol-nota">{t("conectores.varNota")}</p>
      </fieldset>
      <div className="mcp-acciones">
        <Boton type="submit" primario disabled={ocupado || !b.nombre.trim()}>
          <Fijo k="conectores.guardar" />
        </Boton>
        <Boton onClick={alCancelar} disabled={ocupado}>
          <Fijo k="ajustes.cancelar" />
        </Boton>
      </div>
    </form>
  );
}

export function AjustesConectores({ Dato }: { Dato: FilaDato }) {
  const [lista, setLista] = useState<VistaServidorMcp[] | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [edita, setEdita] = useState<Borrador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    void fuentePaneles.listaMcp().then(
      (r) => vivo.current && setLista(r),
      (x) => vivo.current && setFalla(mensaje(x)),
    );
    return () => void (vivo.current = false);
  }, []);

  const correr = async (f: () => Promise<VistaServidorMcp[]>, alTerminar?: () => void) => {
    setOcupado(true);
    setError(null);
    try {
      const r = await f();
      if (!vivo.current) return;
      setLista(r);
      alTerminar?.();
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };

  if (falla)
    return (
      <Cat id="conectores">
        <div className="pn-aviso" data-error>{textoMain(falla)}</div>
      </Cat>
    );
  if (!lista)
    return (
      <Cat id="conectores">
        <PanelCargando />
      </Cat>
    );

  return (
    <Cat id="conectores">
      <section className="pn-sec pn-edita" data-mcp>
        <Fijo k="conectores.intro" bloque className="pn-nota pn-intro" />

        <Dato nombre="conectores.propios" que="conectores.propiosQue">
          {lista.length ? (
            <ul className="mcp-lista">
              {lista.map((s) => (
                <li key={s.nombre} className="mcp-fila" data-servidor={s.nombre}>
                  <div className="mcp-datos">
                    <strong>{s.nombre}</strong>
                    <span className="mcp-tipo">{t(s.tipo === "stdio" ? "conectores.tipoStdioCorto" : s.tipo === "sse" ? "conectores.tipoSse" : "conectores.tipoHttp")}</span>
                    <code className="mcp-destino">{destino(s)}</code>
                    {s.variables.length ? (
                      <span className="mcp-vars-estado">
                        {s.variables.map((v) => (
                          <Estado key={`${v.tipo}:${v.nombre}`} ok={v.hay} texto={`${v.nombre}: ${t(v.hay ? "conectores.guardada" : "conectores.faltaValor")}`} />
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <div className="mcp-acciones">
                    <Boton aria-label={t("conectores.editarDe", { n: s.nombre })} onClick={() => (setError(null), setEdita(aBorrador(s)))} disabled={ocupado}>
                      <Fijo k="conectores.editar" />
                    </Boton>
                    <Boton aria-label={t("conectores.quitarDe", { n: s.nombre })} onClick={() => void correr(() => fuentePaneles.quitarMcp(s.nombre))} disabled={ocupado}>
                      <Fijo k="conectores.quitar" />
                    </Boton>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ol-nota">{t("conectores.ninguno")}</p>
          )}
          {edita ? (
            <Formulario
              b={edita}
              cambiar={setEdita}
              ocupado={ocupado}
              alCancelar={() => (setEdita(null), setError(null))}
              alGuardar={() => void correr(() => fuentePaneles.guardarMcp(aEntrada(edita)), () => setEdita(null))}
            />
          ) : (
            <Boton onClick={() => (setError(null), setEdita(vacio()))} disabled={ocupado}>
              <Plus size={14} strokeWidth={2} aria-hidden /> <Fijo k="conectores.agregar" />
            </Boton>
          )}
          {error ? <div className="pn-error dsh-err" role="alert">{textoMain(error)}</div> : null}
        </Dato>

        <Dato nombre="conectores.motores" que="conectores.motoresQue">
          <ul className="mcp-motores">
            <li><Estado ok texto={t("conectores.mClaude")} /></li>
            <li><Estado ok texto={t("conectores.mDsh")} /></li>
            <li><Estado ok texto={t("conectores.mOpencode")} /></li>
            <li><Estado ok={false} texto={t("conectores.mGemini")} /></li>
            <li><Estado ok={false} texto={t("conectores.mWorkers")} /></li>
          </ul>
          <p className="ol-nota">{t("conectores.motoresNota")}</p>
        </Dato>

        <Dato nombre="conectores.claudeai" que="conectores.claudeaiQue">
          <a className="ui-btn mdl-enlace" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} strokeWidth={2} aria-hidden /> <Fijo k="conectores.claudeaiAbrir" />
          </a>
          <p className="ol-nota">{t("conectores.claudeaiNota")}</p>
        </Dato>
      </section>
    </Cat>
  );
}
