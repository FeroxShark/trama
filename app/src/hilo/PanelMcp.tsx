// `/mcp` de la caja de un líder: los servidores MCP que ve (los de Claude, con su estado, y los propios de trama) en un panel debajo de la
// caja. En `claude -p` el /mcp de Claude es una pantalla de la terminal y no hace nada: lo resuelve la app con `claude mcp list`. Cada estado
// va con ícono y palabra, no sólo con color.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, KeyRound, Minus, RefreshCw, X } from "lucide-react";
import { fuentePaneles, type EstadoMcp } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { mensaje } from "../puente";
import { abrirAjustes } from "../paneles/ajustes-nav";
import { Boton } from "../ui/componentes";
import { esLocal, familiaDe } from "./modelos";

type Estado = EstadoMcp["claude"] extends infer C ? (C extends { servidores: (infer S)[] } ? (S extends { estado: infer E } ? E : never) : never) : never;

const ICONO = { ok: Check, auth: KeyRound, falla: X, "sin-configurar": Minus, desconocido: Minus } as const;
const TEXTO = { ok: "mcp.ok", auth: "mcp.auth", falla: "mcp.falla", "sin-configurar": "mcp.sinConfigurar", desconocido: "mcp.desconocido" } as const;

function Marca({ estado }: { estado: Estado }) {
  const Icono = ICONO[estado];
  return (
    <span className="mcp-marca" data-estado={estado}>
      <Icono size={13} strokeWidth={2.2} aria-hidden="true" />
      {t(TEXTO[estado])}
    </span>
  );
}

export function PanelMcp({ modelo, alCerrar }: { modelo: string; alCerrar: () => void }) {
  const [e, setE] = useState<EstadoMcp | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const vivo = useRef(true);
  const motor = familiaDe(modelo);
  const local = esLocal(modelo) || /^ollama:/.test(modelo);
  const mirar = useCallback(
    (fresco: boolean) => {
      setE(null);
      setFalla(null);
      fuentePaneles.estadoMcp(motor, local, fresco).then(
        (r) => vivo.current && setE(r),
        (x) => vivo.current && setFalla(mensaje(x)),
      );
    },
    [motor, local],
  );
  useEffect(() => {
    vivo.current = true;
    mirar(false);
    return () => void (vivo.current = false);
  }, [mirar]);

  return (
    <section className="mcp-panel" aria-label={t("mcp.titulo")} data-mcp-panel>
      <header className="mcp-cab">
        <strong>{t("mcp.titulo")}</strong>
        <span className="mcp-cab-acc">
          <Boton aria-label={t("mcp.actualizar")} onClick={() => mirar(true)} disabled={!e && !falla}>
            <RefreshCw size={13} strokeWidth={2} aria-hidden="true" /> {t("mcp.actualizar")}
          </Boton>
          <Boton onClick={() => (alCerrar(), abrirAjustes("conectores"))}>{t("mcp.ajustes")}</Boton>
          <Boton aria-label={t("mcp.cerrar")} onClick={alCerrar}>
            <X size={13} strokeWidth={2} aria-hidden="true" />
          </Boton>
        </span>
      </header>
      {falla ? <div className="pn-error" role="alert">{textoMain(falla)}</div> : null}
      {!e && !falla ? <p className="mcp-nota" role="status">{t("mcp.cargando")}</p> : null}
      {e ? (
        <div role="status">
          {e.claude ? (
            <div className="mcp-grupo">
              <h4>{t("mcp.claude")}</h4>
              <p className="mcp-nota">{t("mcp.claudeNota")}</p>
              {e.claude.error ? <div className="pn-error">{t("mcp.errorClaude", { e: e.claude.error })}</div> : null}
              {!e.claude.error && !e.claude.servidores.length ? <p className="mcp-nota">{t("mcp.ninguno")}</p> : null}
              <ul className="mcp-items">
                {e.claude.servidores.map((s) => (
                  <li key={s.nombre} data-estado={s.estado}>
                    <span className="mcp-nombre">{s.nombre}</span>
                    <Marca estado={s.estado} />
                    {s.destino ? <code className="mcp-destino">{s.destino}</code> : null}
                  </li>
                ))}
              </ul>
              {e.claude.servidores.some((s) => s.estado === "auth") ? <p className="mcp-nota">{t("mcp.authNota")}</p> : null}
            </div>
          ) : null}
          <div className="mcp-grupo">
            <h4>{t("mcp.trama")}</h4>
            {e.sinTrama === "local" ? <p className="mcp-nota">{t("mcp.sinLocal")}</p> : null}
            {e.sinTrama === "agy" ? <p className="mcp-nota">{t("mcp.sinAgy")}</p> : null}
            {!e.trama.length ? <p className="mcp-nota">{t("mcp.ninguno")}</p> : null}
            <ul className="mcp-items">
              {e.trama.map((s) => (
                <li key={s.nombre} data-pasa={s.pasa ? "si" : "no"}>
                  <span className="mcp-nombre">{s.nombre}</span>
                  <span className="mcp-marca" data-estado={s.pasa ? "ok" : "sin-configurar"}>
                    {s.pasa ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : <Minus size={13} strokeWidth={2.2} aria-hidden="true" />}
                    {t(s.pasa ? "mcp.pasa" : "mcp.noPasa")}
                  </span>
                  <code className="mcp-destino">{s.destino}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
