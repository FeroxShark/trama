// Ajustes > DeepSeek Harness: lo que hace falta para que un líder corra con `dsh` (modelos gratis de OpenCode, DeepSeek u Ollama local).
// Si el programa está instalado (y cuál versión) con «Instalar» (`npm i -g @deepseek-ai/dsh`, o el comando para copiar), las API keys
// de OpenCode y de DeepSeek (de escritura: se guardan en `claves.env` y NO vuelven: acá sólo se ve si hay una) y «Probar» de cada
// proveedor (`GET /models` con la key guardada). Todo se aplica al toque, sin la barra de Guardar. Sólo desde la PC: por la tailnet
// el main rechaza instalar, guardar una key y probar. Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type EstadoDsh, type NombreClave, type ProveedorDshUi, type Prueba } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { Cat } from "./AjustesNav";
import { PanelCargando } from "./PanelCargando";
import type { FilaDato } from "./AjustesEditar";
import { Comando } from "./AjustesLocales";
import { URL_OLLAMA } from "./modelos-borrador";

/** Un estado con su ícono y su palabra (un tilde o una cruz): no depende del color. */
function Estado({ ok, texto, tip }: { ok: boolean; texto: string; tip?: string }) {
  const Icono = ok ? Check : X;
  return (
    <span className="mdl-estado dsh-estado" data-estado={ok ? "ok" : "no"} data-tip={tip}>
      <Icono size={14} strokeWidth={2.2} aria-hidden />
      {texto}
    </span>
  );
}

type Probando = "probando" | Prueba | null;

/** El resultado de una prueba: cuántos modelos contestó el proveedor, o por qué falló. */
function Resultado({ p }: { p: Probando }) {
  if (p === null) return null;
  if (p === "probando") return <span className="mdl-estado" role="status">{t("ajustes.dshProbando")}</span>;
  return p.ok ? (
    <span role="status"><Estado ok texto={t("ajustes.dshProbadoOk", { n: p.modelos })} /></span>
  ) : (
    <span role="status" className="dsh-fallo">
      <Estado ok={false} texto={t("ajustes.dshProbadoNo")} />
      <span className="dsh-motivo">{textoMain(p.motivo)}</span>
    </span>
  );
}

/** El campo de una API key: sin key, el campo y «Guardar clave»; con key, «Clave guardada» con Reemplazar y Borrar. El valor nunca vuelve del main. */
function CampoClave({
  nombre,
  que,
  hay,
  alGuardar,
  alBorrar,
  ocupado,
}: {
  nombre: NombreClave;
  que: string;
  hay: boolean;
  alGuardar: (valor: string) => Promise<boolean>;
  alBorrar: () => void;
  ocupado: boolean;
}) {
  const [valor, setValor] = useState("");
  const [cambiando, setCambiando] = useState(false);
  const mostrar = !hay || cambiando;
  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!valor.trim() || ocupado) return;
    if (await alGuardar(valor.trim())) {
      setValor("");
      setCambiando(false);
    }
  };
  return (
    <div className="dsh-clave" data-clave={nombre}>
      {hay ? <Estado ok texto={t("ajustes.dshGuardada")} /> : <Estado ok={false} texto={t("ajustes.dshSinClave")} />}
      {mostrar ? (
        <form className="pn-nuevo dsh-form" onSubmit={(ev) => void enviar(ev)}>
          <input
            className="pn-campo"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={valor}
            placeholder={t("ajustes.dshClavePh")}
            aria-label={t("ajustes.dshClaveCampo", { que })}
            onChange={(ev) => setValor(ev.target.value)}
          />
          <Boton type="submit" disabled={!valor.trim() || ocupado}>
            <Fijo k="ajustes.dshGuardar" />
          </Boton>
          {cambiando ? (
            <Boton onClick={() => (setCambiando(false), setValor(""))}>
              <Fijo k="ajustes.cancelar" />
            </Boton>
          ) : null}
        </form>
      ) : (
        <>
          <Boton onClick={() => setCambiando(true)} disabled={ocupado}>
            <Fijo k="ajustes.dshReemplazar" />
          </Boton>
          <Boton aria-label={t("ajustes.dshBorrarDe", { que })} onClick={alBorrar} disabled={ocupado}>
            <Fijo k="ajustes.dshBorrar" />
          </Boton>
        </>
      )}
    </div>
  );
}

export function AjustesDsh({ Dato }: { Dato: FilaDato }) {
  const [e, setE] = useState<EstadoDsh | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [instalando, setInstalando] = useState(false);
  const [errInstalar, setErrInstalar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [errClave, setErrClave] = useState<string | null>(null);
  const [pruebas, setPruebas] = useState<Partial<Record<ProveedorDshUi, Probando>>>({});
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);

  const recibir = (r: EstadoDsh) => {
    if (!vivo.current) return;
    if (r.version !== VERSION) return setFalla(t("error.version", { que: t("aj.cat.dsh"), v: r.version, conozco: VERSION }));
    setE(r);
  };
  const mirar = () => fuentePaneles.estadoDsh().then(recibir, (x) => vivo.current && setFalla(mensaje(x)));
  useEffect(() => {
    void mirar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const instalar = async () => {
    setInstalando(true);
    setErrInstalar(null);
    try {
      recibir(await fuentePaneles.instalarDsh());
    } catch (x) {
      if (vivo.current) setErrInstalar(mensaje(x));
    } finally {
      if (vivo.current) setInstalando(false);
    }
  };
  const guardarClave = async (nombre: NombreClave, valor: string | null): Promise<boolean> => {
    setOcupado(true);
    setErrClave(null);
    try {
      recibir(await fuentePaneles.claveDsh(nombre, valor));
      // La prueba de antes era con la key de antes.
      setPruebas((p) => ({ ...p, [nombre === "OPENCODE_API_KEY" ? "opencode" : "deepseek"]: null }));
      return true;
    } catch (x) {
      if (vivo.current) setErrClave(mensaje(x));
      return false;
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };
  const probar = async (p: ProveedorDshUi) => {
    setPruebas((a) => ({ ...a, [p]: "probando" }));
    const r = await fuentePaneles.probarDsh(p, p === "ollama" ? URL_OLLAMA : undefined).catch((x): Prueba => ({ ok: false, motivo: mensaje(x) }));
    if (vivo.current) setPruebas((a) => ({ ...a, [p]: r }));
  };

  if (falla)
    return (
      <Cat id="dsh">
        <div className="pn-aviso" data-error>{textoMain(falla)}</div>
      </Cat>
    );
  if (!e)
    return (
      <Cat id="dsh">
        <PanelCargando />
      </Cat>
    );

  const botonProbar = (p: ProveedorDshUi, que: string) => (
    <Boton aria-label={t("ajustes.dshProbarDe", { que })} onClick={() => void probar(p)} disabled={pruebas[p] === "probando"}>
      {pruebas[p] === "probando" ? t("ajustes.dshProbando") : <Fijo k="ajustes.dshProbar" />}
    </Boton>
  );

  return (
    <Cat id="dsh">
      <section className="pn-sec pn-edita" data-dsh>
        <Fijo k="ajustes.dshIntro" bloque className="pn-nota pn-intro" />

        <Dato nombre="ajustes.dshPrograma" que="ajustes.dshProgramaQue">
          <div className="dsh-fila">
            {e.instalado ? <Estado ok texto={e.versionDsh ? t("ajustes.dshInstaladoV", { v: e.versionDsh }) : t("ajustes.dshInstalado")} /> : <Estado ok={false} texto={t("ajustes.dshNoInstalado")} />}
            {!e.instalado && e.hayNpm ? (
              <Boton primario onClick={() => void instalar()} disabled={instalando}>
                {instalando ? t("ajustes.dshInstalando") : <Fijo k="ajustes.dshInstalar" />}
              </Boton>
            ) : null}
            <Boton onClick={() => void mirar()} disabled={instalando}>
              <Fijo k="ajustes.dshMirar" />
            </Boton>
          </div>
          {!e.instalado ? (
            <>
              <p className="ol-nota">{t("ajustes.dshInstalarPie")}</p>
              <Comando texto={e.comando} etiqueta={t("ajustes.dshInstalar")} />
            </>
          ) : null}
          {errInstalar ? <div className="pn-error dsh-err" role="alert">{textoMain(errInstalar)}</div> : null}
        </Dato>

        <Dato nombre="ajustes.dshOpencode" que="ajustes.dshOpencodeQue">
          <CampoClave
            nombre="OPENCODE_API_KEY"
            que={t("ajustes.dshOpencode")}
            hay={e.claves.OPENCODE_API_KEY}
            ocupado={ocupado}
            alGuardar={(v) => guardarClave("OPENCODE_API_KEY", v)}
            alBorrar={() => void guardarClave("OPENCODE_API_KEY", null)}
          />
          <div className="dsh-fila">
            {botonProbar("opencode", t("ajustes.dshOpencode"))}
            <Resultado p={pruebas.opencode ?? null} />
          </div>
          <p className="ol-nota">{t("ajustes.dshClaveNota")}</p>
        </Dato>

        <Dato nombre="ajustes.dshDeepseek" que="ajustes.dshDeepseekQue">
          <CampoClave
            nombre="DEEPSEEK_API_KEY"
            que={t("ajustes.dshDeepseek")}
            hay={e.claves.DEEPSEEK_API_KEY}
            ocupado={ocupado}
            alGuardar={(v) => guardarClave("DEEPSEEK_API_KEY", v)}
            alBorrar={() => void guardarClave("DEEPSEEK_API_KEY", null)}
          />
          <div className="dsh-fila">
            {botonProbar("deepseek", t("ajustes.dshDeepseek"))}
            <Resultado p={pruebas.deepseek ?? null} />
          </div>
          <p className="ol-nota">{t("ajustes.dshClaveNota")}</p>
        </Dato>

        <Dato nombre="ajustes.dshOllama" que="ajustes.dshOllamaQue">
          <div className="dsh-fila">
            {botonProbar("ollama", t("ajustes.dshOllama"))}
            <Resultado p={pruebas.ollama ?? null} />
          </div>
        </Dato>

        {errClave ? <div className="pn-error dsh-err" role="alert">{textoMain(errClave)}</div> : null}
      </section>
    </Cat>
  );
}
