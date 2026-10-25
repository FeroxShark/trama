import { useEffect, useMemo, useState } from "react";
import { Search, Wrench, Sparkles, Box, Terminal, Bot, CheckCircle2, ShieldCheck, ExternalLink } from "lucide-react";
import { fuentePaneles } from "../datos/paneles";
import { t } from "../i18n";
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
}

interface DatosCatalogo {
  instalados: ItemCatalogo[];
  descubrir: ItemCatalogo[];
}

export function AjustesHerramientas({ Dato }: { Dato?: FilaDato }) {
  useIdioma();
  const [datos, setDatos] = useState<DatosCatalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [vista, setVista] = useState<"instalados" | "descubrir">("instalados");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoItem>("todos");

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fuentePaneles.herramientas
      .catalogo()
      .then((cat) => {
        if (!vivo) return;
        setDatos(cat);
        setError(null);
      })
      .catch((e) => {
        if (vivo) setError(mensaje(e));
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

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
            Gestión e inspección en vivo de servidores MCP, habilidades cognitivas instaladas y herramientas del sistema.
          </p>
        </div>
      </div>

      {/* Buscador reactivo */}
      <div className="pn-catalogo-buscar">
        <Search size={16} className="pn-catalogo-buscar-icono" />
        <input
          type="search"
          value={busqueda}
          placeholder="Buscar por nombre, descripción, tag o comando..."
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

      {/* Selector de Vistas: Instaladas vs Descubrir */}
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
                  <span className="pn-tag-instalado">Instalado</span>
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
