// Ajustes > OpenCode > NVIDIA NIM (gratis): los modelos gratis de build.nvidia.com corren por el programa `opencode` (`pa -m opencode:nvidia/<modelo>`).
// Acá: la clave (NVIDIA_API_KEY, de escritura: se guarda en claves.env por `claveDsh` y no vuelve nunca), «Probar» (una llamada mínima), cómo sacarla
// gratis y qué modelos ofrece el reparto (`nvidia_modelos` de modelos.json). Todo se aplica al toque; guardar es sólo de la PC. Cada estado se dice
// con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type EstadoDsh, type EstadoNim, type PruebaNim } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { mensaje } from "../puente";
import { Boton, Interruptor } from "../ui/componentes";
import { CampoClave, Estado } from "./AjustesDsh";
import type { FilaDato } from "./AjustesEditar";
import { PanelCargando } from "./PanelCargando";
import { ID_NIM, listaNim, URL_NVIDIA } from "./nvidia-lista";

type Probado = "probando" | PruebaNim | null;

function ResultadoNim({ p }: { p: Probado }) {
  if (p === null) return null;
  if (p === "probando") return <span className="mdl-estado" role="status">{t("ajustes.dshProbando")}</span>;
  return p.ok ? (
    <span role="status">
      <Estado ok texto={t("ajustes.nimProbadoOk", { modelo: p.modelo })} />
    </span>
  ) : (
    <span role="status" className="dsh-fallo">
      <Estado ok={false} texto={t("ajustes.dshProbadoNo")} />
      <span className="dsh-motivo">{textoMain(p.motivo)}</span>
    </span>
  );
}

export function AjustesNvidia({ Dato }: { Dato: FilaDato }) {
  const [dsh, setDsh] = useState<EstadoDsh | null>(null);
  const [nim, setNim] = useState<EstadoNim | null>(null);
  const [vistos, setVistos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<Probado>(null);
  const [nuevo, setNuevo] = useState("");
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    void fuentePaneles.estadoDsh().then((r) => vivo.current && r.version === VERSION && setDsh(r), () => {});
    void fuentePaneles.estadoNvidia().then((r) => vivo.current && r.version === VERSION && setNim(r), (x) => vivo.current && setErr(mensaje(x)));
    return () => void (vivo.current = false);
  }, []);

  const guardarClave = async (valor: string | null): Promise<boolean> => {
    setOcupado(true);
    setErr(null);
    try {
      const r = await fuentePaneles.claveDsh("NVIDIA_API_KEY", valor);
      if (vivo.current && r.version === VERSION) setDsh(r);
      if (vivo.current) setNim((n) => (n ? { ...n, hayClave: r.claves.NVIDIA_API_KEY } : n));
      setPrueba(null); // la prueba de antes era con la clave de antes
      return true;
    } catch (x) {
      if (vivo.current) setErr(mensaje(x));
      return false;
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };
  const probar = async () => {
    setPrueba("probando");
    const r = await fuentePaneles.probarNvidia().catch((x): PruebaNim => ({ ok: false, motivo: mensaje(x) }));
    if (vivo.current) setPrueba(r);
  };
  const guardarModelos = async (lista: string[]): Promise<boolean> => {
    setOcupado(true);
    setErr(null);
    try {
      const r = await fuentePaneles.guardarModelosNvidia(lista);
      if (vivo.current && r.version === VERSION) setNim(r);
      return true;
    } catch (x) {
      if (vivo.current) setErr(mensaje(x));
      return false;
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };
  const alternar = (id: string, prender: boolean) => {
    if (!nim) return;
    void guardarModelos(prender ? [...nim.modelos, id] : nim.modelos.filter((m) => m !== id));
  };
  const quitar = (id: string) => {
    if (!nim) return;
    setVistos((v) => v.filter((m) => m !== id));
    void guardarModelos(nim.modelos.filter((m) => m !== id));
  };
  const agregar = async (ev: FormEvent) => {
    ev.preventDefault();
    const id = nuevo.trim();
    if (!nim || !id || ocupado) return;
    if (!ID_NIM.test(id)) return setErr(t("ajustes.nimIdMalo"));
    if (nim.modelos.includes(id)) return setNuevo("");
    setVistos((v) => [...v, id]);
    if (await guardarModelos([...nim.modelos, id])) setNuevo("");
  };

  const ids = nim ? listaNim(nim, vistos) : [];
  return (
    <section className="pn-sec pn-edita" data-dsh data-nim>
      <Dato nombre="ajustes.nimClave" que="ajustes.nimClaveQue">
        {dsh && nim ? (
          <>
            <CampoClave
              nombre="NVIDIA_API_KEY"
              que={t("ajustes.nimClave")}
              hay={dsh.claves.NVIDIA_API_KEY}
              ocupado={ocupado}
              alGuardar={(v) => guardarClave(v)}
              alBorrar={() => void guardarClave(null)}
            />
            <div className="dsh-fila">
              <Boton aria-label={t("ajustes.dshProbarDe", { que: t("ajustes.nimClave") })} onClick={() => void probar()} disabled={prueba === "probando"}>
                {prueba === "probando" ? t("ajustes.dshProbando") : <Fijo k="ajustes.dshProbar" />}
              </Boton>
              <ResultadoNim p={prueba} />
            </div>
          </>
        ) : (
          <PanelCargando />
        )}
      </Dato>
      <div className="oc-notas" data-nim-ayuda>
        <p className="ol-nota">
          {t("ajustes.nimAyuda1")}{" "}
          <a className="wk-aa-enlace" href={URL_NVIDIA} target="_blank" rel="noopener noreferrer" data-tip={t("ajustes.nimEnlaceTip")}>
            build.nvidia.com
          </a>{" "}
          {t("ajustes.nimAyuda2")}
        </p>
        <p className="ol-nota">{t("ajustes.nimPrototipos")}</p>
        <p className="ol-nota">{t("ajustes.dshClaveNota")}</p>
      </div>

      <Dato nombre="ajustes.nimModelos" que="ajustes.nimModelosQue">
        {nim ? (
          <>
            <ul className="nim-lista" aria-label={t("ajustes.nimModelos")}>
              {ids.map((id) => {
                const prendido = nim.modelos.includes(id);
                return (
                  <li key={id} className="nim-fila" data-id={id} data-off={prendido ? undefined : ""}>
                    <Interruptor activo={prendido} disabled={ocupado} aria-label={t("ajustes.nimPermitir", { modelo: id })} alCambiar={(v) => alternar(id, v)} />
                    <span className="nim-id">{id}</span>
                    {id === nim.base ? <span className="nim-marca">{t("ajustes.nimBase")}</span> : null}
                    <Estado ok={prendido} texto={prendido ? t("ajustes.nimOfrecido") : t("ajustes.nimApagado")} />
                    {id !== nim.base ? (
                      <Boton aria-label={t("ajustes.nimQuitarDe", { modelo: id })} onClick={() => quitar(id)} disabled={ocupado}>
                        <X size={14} aria-hidden />
                        <Fijo k="ajustes.nimQuitar" />
                      </Boton>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <form className="pn-nuevo dsh-form" onSubmit={(ev) => void agregar(ev)}>
              <input
                className="pn-campo"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={nuevo}
                placeholder={t("ajustes.nimAgregarPh")}
                aria-label={t("ajustes.nimAgregarCampo")}
                onChange={(ev) => setNuevo(ev.target.value)}
              />
              <Boton type="submit" disabled={!nuevo.trim() || ocupado}>
                <Fijo k="ajustes.nimAgregar" />
              </Boton>
            </form>
          </>
        ) : err ? null : (
          <PanelCargando />
        )}
      </Dato>
      {nim ? (
        <div className="oc-notas">
          <p className="ol-nota">{t("ajustes.nimTope", { n: nim.tope })}</p>
          {nim.modelos.length === 0 ? <p className="ol-nota" role="status">{t("ajustes.nimNinguno")}</p> : null}
          {!nim.hayClave ? <p className="ol-nota" role="status">{t("ajustes.nimSinClaveNota")}</p> : null}
        </div>
      ) : null}
      {err ? <div className="pn-error dsh-err" role="alert">{textoMain(err)}</div> : null}
    </section>
  );
}
