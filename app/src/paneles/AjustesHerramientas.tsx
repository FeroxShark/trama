import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Sparkles,
  Box,
  Terminal,
  Bot,
  CheckCircle2,
  ShieldCheck,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Trash2,
  Download,
  Plus,
  Loader2,
  X,
} from "lucide-react";
import { fuentePaneles } from "../datos/paneles";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import type { FilaDato } from "./AjustesEditar";

export type TipoItem = "mcp" | "skill" | "herramienta" | "lider";

export interface ItemCatalogo {
  id: string;
  nombre: string;
  tipo: TipoItem;
  descripcion: string;
  instalado: boolean;
  activo: boolean;
  origen: string;
  categoria?: string;
  autor?: string;
  comando?: string;
  ruta?: string;
  repoUrl?: string;
  paquete?: string;
}

interface DatosCatalogo {
  instalados: ItemCatalogo[];
  descubrir: ItemCatalogo[];
}

export function AjustesHerramientas({ Dato: _Dato }: { Dato?: FilaDato }) {
  useIdioma();
  const [datos, setDatos] = useState<DatosCatalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [vista, setVista] = useState<"instalados" | "descubrir">("instalados");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoItem>("todos");

  // Estado de acción en curso (id de item que se está instalando/desinstalando)
  const [accionando, setAccionando] = useState<string | null>(null);
  const [avisoExito, setAvisoExito] = useState<string | null>(null);

  // Formulario manual
  const [mostrarManual, setMostrarManual] = useState(false);
  const [manualTipo, setManualTipo] = useState<"mcp" | "skill">("mcp");
  const [manualNombre, setManualNombre] = useState("");
  const [manualComando, setManualComando] = useState("");
  const [manualDesc, setManualDesc] = useState("");

  const cargar = (silencioso = false) => {
    if (!silencioso) setCargando(true);
    fuentePaneles.herramientas
      .catalogo()
      .then((cat) => {
        setDatos(cat);
        setError(null);
      })
      .catch((e) => {
        setError(mensaje(e));
      })
      .finally(() => {
        if (!silencioso) setCargando(false);
      });
  };

  useEffect(() => {
    cargar();
  }, []);

  const notificar = (msg: string) => {
    setAvisoExito(msg);
    setTimeout(() => setAvisoExito(null), 4000);
  };

  const handleAlternar = async (item: ItemCatalogo) => {
    setAccionando(item.id);
    try {
      const res = await fuentePaneles.herramientas.alternar(item.id, item.tipo, !item.activo);
      if (res && !res.ok) throw new Error(res.error || "No se pudo cambiar el estado.");
      notificar(`${item.nombre} ahora está ${!item.activo ? "activo" : "pausado"}.`);
      cargar(true);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setAccionando(null);
    }
  };

  const handleAbrir = async (item: ItemCatalogo) => {
    try {
      await fuentePaneles.herramientas.abrir(item.id, item.tipo, item.ruta);
    } catch (err) {
      setError(mensaje(err));
    }
  };

  const handleDesinstalar = async (item: ItemCatalogo) => {
    if (!window.confirm(`¿Seguro que querés desinstalar ${item.nombre}?`)) return;
    setAccionando(item.id);
    try {
      const res = await fuentePaneles.herramientas.desinstalar(item.id, item.tipo);
      if (res && !res.ok) throw new Error(res.error || "No se pudo desinstalar.");
      notificar(`${item.nombre} fue desinstalado.`);
      cargar();
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setAccionando(null);
    }
  };

  const handleInstalar = async (item: ItemCatalogo) => {
    setAccionando(item.id);
    try {
      const res = await fuentePaneles.herramientas.instalar(item);
      if (res && !res.ok) throw new Error(res.error || "Error durante la instalación.");
      notificar(`¡${item.nombre} se instaló correctamente!`);
      cargar();
      setVista("instalados");
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setAccionando(null);
    }
  };

  const handleCrearManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualNombre.trim() || !manualComando.trim()) return;

    setAccionando("manual");
    try {
      const id = `${manualTipo}:${manualNombre.trim().toLowerCase().replace(/\s+/g, "-")}`;
      const item: any = {
        id,
        nombre: manualNombre.trim(),
        tipo: manualTipo,
        descripcion: manualDesc.trim() || undefined,
        ...(manualTipo === "mcp"
          ? manualComando.trim().startsWith("http")
            ? { url: manualComando.trim() }
            : manualComando.trim().startsWith("@") || !manualComando.includes(" ")
            ? { paquete: manualComando.trim() }
            : { comando: manualComando.trim() }
          : manualComando.trim().startsWith("http") || manualComando.trim().includes("github.com")
          ? { repoUrl: manualComando.trim() }
          : { descripcion: manualComando.trim() }),
      };

      const res = await fuentePaneles.herramientas.instalar(item);
      if (res && !res.ok) throw new Error(res.error || "No se pudo instalar.");
      notificar(`¡${manualNombre} se agregó e instaló correctamente!`);
      setManualNombre("");
      setManualComando("");
      setManualDesc("");
      setMostrarManual(false);
      cargar();
      setVista("instalados");
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setAccionando(null);
    }
  };

  const listaActual = useMemo(() => {
    if (!datos) return [];
    return vista === "instalados" ? datos.instalados : datos.descubrir;
  }, [datos, vista]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return listaActual.filter((item) => {
      if (filtroTipo !== "todos" && item.tipo !== filtroTipo) return false;
      if (!q) return true;
      return (
        item.nombre.toLowerCase().includes(q) ||
        item.descripcion.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.comando && item.comando.toLowerCase().includes(q)) ||
        (item.categoria && item.categoria.toLowerCase().includes(q)) ||
        (item.origen && item.origen.toLowerCase().includes(q))
      );
    });
  }, [listaActual, busqueda, filtroTipo]);

  const iconoTipo = (tipo: TipoItem) => {
    switch (tipo) {
      case "mcp":
        return <Box size={14} className="icono-mcp" />;
      case "skill":
        return <Sparkles size={14} className="icono-skill" />;
      case "herramienta":
        return <Terminal size={14} className="icono-tool" />;
      case "lider":
        return <Bot size={14} className="icono-lider" />;
    }
  };

  const etiquetaTipo = (tipo: TipoItem) => {
    switch (tipo) {
      case "mcp":
        return "MCP";
      case "skill":
        return "Skill";
      case "herramienta":
        return "Herramienta CLI";
      case "lider":
        return "Líder";
    }
  };

  return (
    <section className="pn-sec" data-herramientas>
      <div className="pn-herramientas-cab">
        <div>
          <h2 className="pn-h">Herramientas, Skills y MCPs</h2>
          <p className="pn-intro">
            Gestión interactiva e inspección de servidores MCP, habilidades de Claude y Gemini, y herramientas del sistema.
          </p>
        </div>
      </div>

      {avisoExito ? <div className="pn-aviso-exito">{avisoExito}</div> : null}

      {/* Buscador reactivo */}
      <div className="pn-catalogo-buscar">
        <Search size={16} className="pn-catalogo-buscar-icono" />
        <input
          type="search"
          value={busqueda}
          placeholder="Buscar por nombre, descripción, tag, paquete o comando..."
          onChange={(e) => setBusqueda(e.target.value)}
          className="pn-catalogo-input"
          aria-label="Buscar herramientas"
        />
        {busqueda ? (
          <button type="button" className="pn-catalogo-limpiar" onClick={() => setBusqueda("")}>
            ×
          </button>
        ) : null}
      </div>

      {/* Selector de Vistas y botón de instalación manual */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="pn-catalogo-tabs">
          <button
            type="button"
            className="pn-catalogo-tab"
            data-activo={vista === "instalados" ? "" : undefined}
            onClick={() => setVista("instalados")}
          >
            <CheckCircle2 size={14} />
            Instaladas ({datos?.instalados.length ?? 0})
          </button>
          <button
            type="button"
            className="pn-catalogo-tab"
            data-activo={vista === "descubrir" ? "" : undefined}
            onClick={() => setVista("descubrir")}
          >
            <Sparkles size={14} />
            Descubrir ({datos?.descubrir.length ?? 0})
          </button>
        </div>

        <button
          type="button"
          className="pn-btn-manual"
          onClick={() => setMostrarManual(!mostrarManual)}
        >
          {mostrarManual ? <X size={14} /> : <Plus size={14} />}
          {mostrarManual ? "Cerrar" : "Instalar manual"}
        </button>
      </div>

      {/* Formulario de instalación manual */}
      {mostrarManual ? (
        <form onSubmit={handleCrearManual} className="pn-panel-manual">
          <div className="pn-panel-manual-cab">
            <span className="pn-panel-manual-titulo">Agregar MCP o Skill personalizado</span>
          </div>
          <div className="pn-panel-manual-campos">
            <select
              value={manualTipo}
              onChange={(e) => setManualTipo(e.target.value as any)}
              className="pn-panel-manual-select"
            >
              <option value="mcp">Servidor MCP</option>
              <option value="skill">Skill</option>
            </select>
            <input
              type="text"
              placeholder="Nombre / ID (ej: postgres, mi-skill)"
              value={manualNombre}
              onChange={(e) => setManualNombre(e.target.value)}
              className="pn-panel-manual-input"
              required
            />
            <input
              type="text"
              placeholder={
                manualTipo === "mcp"
                  ? "Comando, paquete npm o URL (ej: npx @modelcontextprotocol/...)"
                  : "URL Git de la skill o descripción técnica"
              }
              value={manualComando}
              onChange={(e) => setManualComando(e.target.value)}
              className="pn-panel-manual-input"
              required
            />
            <button
              type="submit"
              className="pn-btn-accion pn-btn-primario"
              disabled={accionando === "manual"}
            >
              {accionando === "manual" ? <Loader2 size={12} className="pn-spin" /> : <Plus size={12} />}
              Instalar
            </button>
          </div>
        </form>
      ) : null}

      {/* Filtros rápidos por tipo */}
      <div className="pn-catalogo-filtros">
        {(["todos", "mcp", "skill", "herramienta", "lider"] as const).map((tipo) => (
          <button
            key={tipo}
            type="button"
            className="pn-chip-filtro"
            data-activo={filtroTipo === tipo ? "" : undefined}
            onClick={() => setFiltroTipo(tipo)}
          >
            {tipo === "todos" ? "Todos" : etiquetaTipo(tipo)}
          </button>
        ))}
      </div>

      {/* Contenido principal */}
      {cargando ? (
        <div className="pn-aviso">Escaneando herramientas y skills instaladas...</div>
      ) : error ? (
        <div className="pn-error" role="alert">
          {error}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="pn-aviso">
          {busqueda ? `No se encontraron elementos para "${busqueda}".` : "No hay elementos en esta sección."}
        </div>
      ) : (
        <div className="pn-catalogo-grilla">
          {filtrados.map((item) => (
            <div key={`${item.tipo}-${item.id}`} className="pn-catalogo-tarjeta" data-instalado={item.instalado ? "" : undefined}>
              <div className="pn-catalogo-tarjeta-cab">
                <div className="pn-catalogo-badge" data-tipo={item.tipo}>
                  {iconoTipo(item.tipo)}
                  <span>{etiquetaTipo(item.tipo)}</span>
                </div>
                {item.categoria ? <span className="pn-catalogo-categoria">{item.categoria}</span> : null}
                <span className="pn-catalogo-origen" data-tip={item.origen}>
                  {item.origen}
                </span>
              </div>

              <div className="pn-catalogo-titulo-fila">
                <h3 className="pn-catalogo-titulo">{item.nombre}</h3>
                {item.activo ? (
                  <span className="pn-tag-activo" title="Activo y configurado">
                    <ShieldCheck size={12} /> Activo
                  </span>
                ) : item.instalado ? (
                  <span className="pn-tag-instalado">Pausado</span>
                ) : (
                  <span className="pn-tag-disponible">Disponible</span>
                )}
              </div>

              <p className="pn-catalogo-desc">{item.descripcion || "Sin descripción proporcionada."}</p>

              {item.comando ? (
                <div className="pn-catalogo-comando">
                  <code>{item.comando}</code>
                </div>
              ) : null}

              {item.autor ? <div className="pn-catalogo-autor">Por {item.autor}</div> : null}

              {/* Botones de acción interactiva */}
              <div className="pn-catalogo-acciones">
                {vista === "instalados" ? (
                  <>
                    <button
                      type="button"
                      className="pn-btn-accion"
                      onClick={() => handleAbrir(item)}
                      title="Abrir carpeta o archivo de configuración"
                    >
                      <FolderOpen size={12} />
                      Ubicación
                    </button>
                    {item.tipo === "mcp" || item.tipo === "skill" ? (
                      <button
                        type="button"
                        className="pn-btn-accion"
                        data-activo={item.activo ? "" : undefined}
                        onClick={() => handleAlternar(item)}
                        disabled={accionando === item.id}
                        title={item.activo ? "Pausar herramienta" : "Activar herramienta"}
                      >
                        {item.activo ? <Pause size={12} /> : <Play size={12} />}
                        {item.activo ? "Pausar" : "Activar"}
                      </button>
                    ) : null}
                    {item.tipo === "mcp" || item.tipo === "skill" ? (
                      <button
                        type="button"
                        className="pn-btn-accion pn-btn-peligro"
                        onClick={() => handleDesinstalar(item)}
                        disabled={accionando === item.id}
                        title="Desinstalar herramienta o skill"
                      >
                        <Trash2 size={12} />
                        Desinstalar
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="pn-btn-accion pn-btn-primario"
                      onClick={() => handleInstalar(item)}
                      disabled={accionando === item.id}
                    >
                      {accionando === item.id ? (
                        <Loader2 size={12} className="pn-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      {accionando === item.id ? "Instalando..." : "Instalar"}
                    </button>
                    {item.repoUrl ? (
                      <a
                        href={item.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="pn-btn-accion"
                        title="Ver repositorio o documentación oficial"
                      >
                        <ExternalLink size={12} />
                        Docs
                      </a>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
