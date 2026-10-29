// `/mcp` de la caja de un líder: los conectores (servidores MCP) que ve, en filas con el ícono del servicio, su estado con punto y palabra, agrupadas
// en Conectados / Piden iniciar sesión / No conectan / Apagados en este proyecto, y los propios de Trama aparte. En `claude -p` el /mcp de Claude es
// una pantalla de la terminal y no hace nada: lo resuelve la app con `claude mcp list`. Los apagados para el proyecto vienen de `.claude.json` de la
// cuenta activa y se prenden y apagan con un interruptor (electron/mcp-apagados.ts). Ningún estado va sólo con color: siempre con su palabra.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Calendar, ChevronDown, CreditCard, Database, ExternalLink, FileText, Figma, Github, Globe, HardDrive, ListChecks, Mail, MessageSquare, RefreshCw, X, type LucideIcon } from "lucide-react";
import { fuentePaneles, type EstadoMcp } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { mensaje } from "../puente";
import { abrirAjustes } from "../paneles/ajustes-nav";
import { Interruptor } from "../ui/componentes";
import { esLocal, familiaDe } from "./modelos";
import { agrupar, claveIcono, inicial, URL_CONECTORES, type ClaveIcono, type Fila as FilaDato, type Origen } from "./mcp-vista";

type Estado = "ok" | "auth" | "falla" | "sin-configurar" | "desconocido" | "apagado" | "prendido";

const ICONOS: Record<ClaveIcono, LucideIcon> = {
  correo: Mail,
  calendario: Calendar,
  documentos: FileText,
  archivos: HardDrive,
  figma: Figma,
  codigo: Github,
  chat: MessageSquare,
  tareas: ListChecks,
  pagos: CreditCard,
  datos: Database,
  web: Globe,
};
const TEXTO = { ok: "mcp.ok", auth: "mcp.auth", falla: "mcp.falla", "sin-configurar": "mcp.sinConfigurar", desconocido: "mcp.desconocido", apagado: "mcp.apagado", prendido: "mcp.prendido" } as const;

const origenTexto = (o: Origen) => (o.tipo === "claudeai" ? t("mcp.oClaudeai") : o.tipo === "plugin" ? t("mcp.oPlugin", { n: o.de }) : t("mcp.oConfig"));

/** El estado: un punto y su palabra. */
function Marca({ estado, texto }: { estado: Estado; texto?: string }) {
  return (
    <span className="mcx-estado" data-estado={estado}>
      <i className="mcx-punto" aria-hidden="true" />
      {texto ?? t(TEXTO[estado])}
    </span>
  );
}

function Icono({ titulo }: { titulo: string }) {
  const c = claveIcono(titulo);
  const I = c ? ICONOS[c] : null;
  return (
    <span className="mcx-ico" aria-hidden="true">
      {I ? <I size={15} strokeWidth={1.9} /> : inicial(titulo)}
    </span>
  );
}

type Detalle = { etiqueta: string; valor: string; mono?: boolean };

/** Una fila: ícono, nombre con su origen, estado y, a la derecha, su acción. El detalle (tipo, dirección) se despliega sin cambiar de lugar nada más. */
function Fila({ titulo, origen, estado, texto, detalle, nota, accion }: { titulo: string; origen: string; estado: Estado; texto?: string; detalle: Detalle[]; nota?: string; accion?: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const cuerpo = (
    <>
      <Icono titulo={titulo} />
      <span className="mcx-txt">
        <span className="mcx-nombre">{titulo}</span>
        <span className="mcx-origen">{nota ? `${origen} · ${nota}` : origen}</span>
      </span>
      <Marca estado={estado} texto={texto} />
    </>
  );
  return (
    <li className="mcx-fila" data-estado={estado}>
      <div className="mcx-fila-cab">
        {detalle.length ? (
          <button type="button" className="mcx-main" aria-expanded={abierto} aria-controls={id} aria-label={t("mcp.verDetalle", { n: titulo })} onClick={() => setAbierto((v) => !v)}>
            {cuerpo}
            <ChevronDown className="mcx-chev" size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <div className="mcx-main">{cuerpo}</div>
        )}
        {accion}
      </div>
      {detalle.length && abierto ? (
        <dl className="mcx-det" id={id}>
          {detalle.map((d) => (
            <div key={d.etiqueta}>
              <dt>{d.etiqueta}</dt>
              <dd>{d.mono ? <code>{d.valor}</code> : d.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

function Grupo({ titulo, n, children }: { titulo: string; n: number; children: React.ReactNode }) {
  return (
    <section className="mcx-g" aria-label={`${titulo}: ${n}`}>
      <h4 className="mcx-g-t">
        {titulo}
        <span className="mcx-cuenta">{n}</span>
      </h4>
      <ul className="mcx-lista">{children}</ul>
    </section>
  );
}

const detalleDe = (f: FilaDato): Detalle[] => [
  ...(f.servidor?.tipo ? [{ etiqueta: t("mcp.dTipo"), valor: f.servidor.tipo }] : []),
  ...(f.servidor?.destino ? [{ etiqueta: t("mcp.dDireccion"), valor: f.servidor.destino, mono: true }] : []),
  ...(f.servidor?.detalle ? [{ etiqueta: t("mcp.dRespuesta"), valor: f.servidor.detalle }] : []),
];

export function PanelMcp({ modelo, alCerrar }: { modelo: string; alCerrar: () => void }) {
  const [e, setE] = useState<EstadoMcp | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  /** Los apagados para el proyecto al mirar, y cuáles de ésos se prendieron desde acá (siguen en su lugar hasta revisar de nuevo, para poder volver a apagarlos). */
  const [apagados, setApagados] = useState<string[]>([]);
  const [prendidos, setPrendidos] = useState<ReadonlySet<string>>(new Set());
  const [cambiando, setCambiando] = useState<ReadonlySet<string>>(new Set());
  const [errorApagados, setErrorApagados] = useState<string | null>(null);
  const vivo = useRef(true);
  const motor = familiaDe(modelo);
  const local = esLocal(modelo) || /^ollama:/.test(modelo);
  const conClaude = motor === "claude" && !local;
  const mirar = useCallback(
    (fresco: boolean) => {
      setE(null);
      setFalla(null);
      setErrorApagados(null);
      setPrendidos(new Set());
      fuentePaneles.estadoMcp(motor, local, fresco).then(
        (r) => vivo.current && setE(r),
        (x) => vivo.current && setFalla(mensaje(x)),
      );
      if (conClaude)
        fuentePaneles.apagadosMcp().then(
          (r) => vivo.current && setApagados(r),
          (x) => vivo.current && (setApagados([]), setErrorApagados(mensaje(x))),
        );
      else setApagados([]);
    },
    [motor, local, conClaude],
  );
  useEffect(() => {
    vivo.current = true;
    mirar(false);
    return () => void (vivo.current = false);
  }, [mirar]);

  /** El interruptor es optimista: cambia ya y vuelve atrás si no se pudo escribir. */
  const cambiar = (nombre: string, prender: boolean) => {
    const poner = (on: boolean) => setPrendidos((p) => new Set(on ? [...p, nombre] : [...p].filter((n) => n !== nombre)));
    poner(prender);
    setErrorApagados(null);
    setCambiando((c) => new Set([...c, nombre]));
    fuentePaneles.fijarApagadoMcp(nombre, !prender).then(
      () => vivo.current && setCambiando((c) => new Set([...c].filter((n) => n !== nombre))),
      (x) => {
        if (!vivo.current) return;
        poner(!prender);
        setCambiando((c) => new Set([...c].filter((n) => n !== nombre)));
        setErrorApagados(mensaje(x));
      },
    );
  };

  const g = e?.claude ? agrupar(e.claude.servidores, apagados) : null;
  const sinNada = !!g && !e?.claude?.error && !g.conectados.length && !g.auth.length && !g.fallan.length && !g.apagados.length;

  return (
    <section className="mcp-panel" aria-label={t("mcp.titulo")} data-mcp-panel>
      <header className="mcx-cab">
        <div className="mcx-cab-txt">
          <strong>{t("mcp.titulo")}</strong>
          <p className="mcx-ayuda">{t("mcp.ayuda")}</p>
        </div>
        <button type="button" className="mcx-cerrar" aria-label={t("mcp.cerrar")} onClick={alCerrar}>
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>
      {falla ? <div className="pn-error" role="alert">{textoMain(falla)}</div> : null}
      {errorApagados ? <div className="pn-error" role="alert">{t("mcp.errorApagados", { e: textoMain(errorApagados) })}</div> : null}
      {!e && !falla ? <p className="mcx-nota" role="status">{t("mcp.cargando")}</p> : null}
      {e ? (
        <div className="mcx-cuerpo">
          {e.claude?.error ? <div className="pn-error">{t("mcp.errorClaude", { e: e.claude.error })}</div> : null}
          {sinNada ? <p className="mcx-nota">{t("mcp.ninguno")}</p> : null}
          {g?.conectados.length ? (
            <Grupo titulo={t("mcp.gConectados")} n={g.conectados.length}>
              {g.conectados.map((f) => (
                <Fila key={f.nombre} titulo={f.titulo} origen={origenTexto(f.origen)} estado="ok" detalle={detalleDe(f)} />
              ))}
            </Grupo>
          ) : null}
          {g?.auth.length ? (
            <Grupo titulo={t("mcp.gAuth")} n={g.auth.length}>
              {g.auth.map((f) => (
                <Fila
                  key={f.nombre}
                  titulo={f.titulo}
                  origen={origenTexto(f.origen)}
                  estado="auth"
                  detalle={detalleDe(f)}
                  accion={
                    <a className="ui-btn mcx-login" href={URL_CONECTORES} target="_blank" rel="noopener noreferrer" aria-label={t("mcp.iniciarSesionTip", { n: f.titulo })}>
                      {t("mcp.iniciarSesion")}
                      <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                    </a>
                  }
                />
              ))}
            </Grupo>
          ) : null}
          {g?.fallan.length ? (
            <Grupo titulo={t("mcp.gFallan")} n={g.fallan.length}>
              {g.fallan.map((f) => (
                <Fila key={f.nombre} titulo={f.titulo} origen={origenTexto(f.origen)} estado={f.servidor!.estado} detalle={detalleDe(f)} />
              ))}
            </Grupo>
          ) : null}
          {g?.apagados.length ? (
            <Grupo titulo={t("mcp.gApagados")} n={g.apagados.length}>
              {g.apagados.map((f) => {
                const on = prendidos.has(f.nombre);
                return (
                  <Fila
                    key={f.nombre}
                    titulo={f.titulo}
                    origen={origenTexto(f.origen)}
                    estado={on ? "prendido" : "apagado"}
                    nota={on ? t("mcp.prendidoNota") : undefined}
                    detalle={detalleDe(f)}
                    accion={<Interruptor activo={on} disabled={cambiando.has(f.nombre)} aria-label={t(on ? "mcp.apagar" : "mcp.prender", { n: f.titulo })} alCambiar={(v) => cambiar(f.nombre, v)} />}
                  />
                );
              })}
            </Grupo>
          ) : null}
          {e.sinTrama === "local" ? <p className="mcx-nota">{t("mcp.sinLocal")}</p> : null}
          {e.sinTrama === "agy" ? <p className="mcx-nota">{t("mcp.sinAgy")}</p> : null}
          {e.trama.length ? (
            <Grupo titulo={t("mcp.trama")} n={e.trama.length}>
              {e.trama.map((s) => (
                <Fila
                  key={s.nombre}
                  titulo={s.nombre}
                  origen="Trama"
                  estado={s.pasa ? "ok" : "sin-configurar"}
                  texto={t(s.pasa ? "mcp.pasa" : "mcp.noPasa")}
                  detalle={[...(s.destino ? [{ etiqueta: t("mcp.dDireccion"), valor: s.destino, mono: true }] : [])]}
                />
              ))}
            </Grupo>
          ) : null}
        </div>
      ) : null}
      <footer className="mcx-pie">
        <button type="button" className="mcx-link" onClick={() => mirar(true)} disabled={!e && !falla}>
          <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
          {t("mcp.actualizar")}
        </button>
        <button type="button" className="mcx-link" onClick={() => (alCerrar(), abrirAjustes("conectores"))}>
          {t("mcp.ajustes")}
        </button>
      </footer>
    </section>
  );
}
