// Ajustes > Modelos y proveedores: qué modelo usan el líder y cada tipo de worker (Claude, Gemini o uno local por Ollama),
// los modelos locales y los límites de Gemini. Es el archivo `~/.config/trama/modelos.json` que también lee `pa`. Trabaja
// sobre un borrador (modelos-borrador.ts): nada se escribe hasta Guardar, y sin archivo se muestra lo que corre hoy y no se
// crea nada hasta que se guarda un cambio. Los modelos locales se detectan preguntándole a Ollama (`/api/tags`); acá no se
// carga ninguno. Sólo se edita desde la PC (por la tailnet el main rechaza guardar).
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { VERSION, type Uso } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { fuentePaneles, type Bajada, type EstadoModelos, type Sondeo } from "../datos/paneles";
import { defDe } from "../hilo/modelos";
import { effortsOpciones } from "../hilo/opciones";
import { Selector, type Opcion } from "../hilo/Selector";
import { t, textoMain, type ClaveSola } from "../i18n";
import { enOtros, Fijo } from "../i18n/Fijo";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { Acciones, type FilaDato } from "./AjustesEditar";
import {
  agregarLocal,
  borradorDe,
  configDe,
  cruces,
  cupoDe,
  defaultsEn,
  efectivoBorrador,
  elegirEffortLider,
  elegirEffortWorker,
  elegirLider,
  elegirWorker,
  liderEfectivo,
  modelosPara,
  nombreModeloValido,
  porcentaje,
  quitarLocal,
  SIN_CLAUDE,
  sucio,
  textoEleccion,
  TIPOS,
  TOPE_CLAUDE_DEFECTO,
  todoEn,
  URL_OLLAMA,
  type Borrador,
  type Eleccion,
  type Modelo,
  type Proveedor,
  type SinClaude,
  type Tipo,
} from "./modelos-borrador";
import { esClaude, urlOllama } from "../../electron/modelos-tipos";

/** Para las capturas: `mdl` (con archivo), `mdl-agregar` (con el panel de otra dirección abierto), `mdl-lider` (el selector del líder abierto), `mdl-bajando` (un modelo a mitad de bajada), `mdl-sinollama` (Ollama no anda), `mdl-tope` (el aviso de un tope cruzado) y `sinmdl` (sin archivo). */
const VARIANTE = MODO.variante ?? "";
const ES_CAPTURA = VARIANTE.startsWith("mdl") || VARIANTE === "sinmdl";

const GRUPO: Record<Proveedor, string | undefined> = { anthropic: "Anthropic", google: "Google", ollama: "Ollama", otro: undefined };

const sinMarca = (o: Opcion): Opcion => ({ ...o, rec: false });

/** La descripción de un modelo, en el idioma de ahora. */
function descDe(m: Modelo): string {
  if (m.desc === "argon") return t("mdl.desc.argon");
  if (m.desc === "flash") return t("mdl.desc.flash");
  if (m.desc === "agy") return t("mdl.desc.agy");
  if (m.desc === "local") return t("mdl.desc.local");
  if (m.desc === "otro") return t("mdl.desc.otro");
  const d = defDe(m.id);
  return d ? t(d.desc) : "";
}

/** Las opciones de un selector de modelo, con "Como hoy" delante cuando se puede dejar sin elegir. */
function opcionesDe(modelos: Modelo[], comoHoy: boolean, conAuto = false): Opcion[] {
  const ops = modelos.map((m): Opcion => ({ id: m.id, nombre: m.nombre, desc: descDe(m), grupo: GRUPO[m.proveedor] }));
  const cab: Opcion[] = [];
  if (comoHoy) cab.push({ id: "", nombre: t("ajustes.mdlComoHoy"), desc: t("ajustes.mdlComoHoyQue") });
  if (conAuto) cab.push({ id: "auto", nombre: t("ajustes.mdlAuto"), desc: t("ajustes.mdlAutoQue") });
  return [...cab, ...ops];
}

const SIN_CLAUDE_CLAVES: Record<SinClaude, { nombre: ClaveSola; que: ClaveSola }> = {
  claude: { nombre: "ajustes.mdlSinClaudeClaude", que: "ajustes.mdlSinClaudeClaudeQue" },
  esperar: { nombre: "ajustes.mdlSinClaudeEsperar", que: "ajustes.mdlSinClaudeEsperarQue" },
  fallar: { nombre: "ajustes.mdlSinClaudeFallar", que: "ajustes.mdlSinClaudeFallarQue" },
};

const TOPE_FORMATO = /^\s*$|^\d{1,3}$/;
const topeMal = (v: string) => !TOPE_FORMATO.test(v) || (v.trim() !== "" && (Number(v) < 1 || Number(v) > 100));

/** Lo que dice Ollama mientras baja, en palabras de todos los días (el texto crudo es de Ollama, en inglés). */
function textoBajada(b: Bajada): string {
  const pct = porcentaje(b);
  if (pct !== null) return t("ajustes.mdlBajarPct", { pct });
  return /verif|writing|removing|success/i.test(b.texto) ? t("ajustes.mdlBajarVerif") : t("ajustes.mdlBajarPrep");
}

const gb = (n: number | null) => (n === null ? "" : `${(n / 1e9).toFixed(1)} GB`);

type Estado = Sondeo | "comprobando";

/** El modelo de una fila y, si es de Claude, su esfuerzo. */
function EleccionSel({
  etiqueta,
  modelos,
  valor,
  comoHoy,
  conAuto,
  alModelo,
  alEffort,
  abierto,
}: {
  etiqueta: string;
  modelos: Modelo[];
  valor: Eleccion | undefined;
  comoHoy: boolean;
  conAuto?: boolean;
  alModelo: (id: string) => void;
  alEffort: (e: string) => void;
  abierto?: boolean;
}) {
  const ops = opcionesDe(modelos, comoHoy, conAuto);
  const claude = valor && esClaude(valor.modelo);
  return (
    <div className="pn-sel">
      <Selector etiqueta={t("ajustes.mdlSelModelo", { que: etiqueta })} opciones={ops} valor={valor?.modelo ?? ""} alElegir={alModelo} reserva={[]} abierto={abierto} />
      {claude ? (
        <Selector
          etiqueta={t("ajustes.mdlSelEsfuerzo", { que: etiqueta })}
          opciones={effortsOpciones(valor.modelo).map(sinMarca)}
          valor={valor.effort ?? ""}
          alElegir={alEffort}
          reserva={[]}
        />
      ) : null}
    </div>
  );
}

export function AjustesModelos({ Dato, alGuardar }: { Dato: FilaDato; alGuardar?: () => void }) {
  const [e, setE] = useState<EstadoModelos | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [b, setB] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const [ag, setAg] = useState<{ url: string; sondeo: Estado | null } | null>(null);
  const [ollama, setOllama] = useState<Estado>("comprobando");
  const [bajando, setBajando] = useState<Record<string, Bajada>>({});
  const [bajar, setBajar] = useState("");
  const [errBajar, setErrBajar] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const vivo = useRef(true);
  const sondeados = useRef(new Set<string>());
  const sec = useRef<HTMLElement>(null);
  useEffect(() => () => void (vivo.current = false), []);

  useEffect(() => {
    fuentePaneles.modelos().then(
      (r) => {
        if (!vivo.current) return;
        if (r.version !== VERSION) return setFalla(t("error.version", { que: t("ajustes.mdlTitulo"), v: r.version, conozco: VERSION }));
        setE(r);
        setB(borradorDe(r));
        if (VARIANTE === "mdl-agregar") void detectar(URL_OLLAMA);
      },
      (x) => vivo.current && setFalla(mensaje(x)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mira si el Ollama de esta computadora contesta y qué modelos tiene: no carga nada. */
  async function mirarOllama() {
    setOllama("comprobando");
    const s = await fuentePaneles.sondearOllama(URL_OLLAMA).catch((x): Sondeo => ({ ok: false, motivo: mensaje(x) }));
    if (vivo.current) setOllama(s);
  }
  useEffect(() => {
    void mirarOllama();
    void fuentePaneles.bajadas().then((l) => vivo.current && setBajando(Object.fromEntries(l.filter((x) => x.estado === "bajando").map((x) => [x.modelo, x]))));
    const off = fuentePaneles.alBajar((x) => {
      if (!vivo.current) return;
      setBajando((a) => {
        const { [x.modelo]: _, ...resto } = a;
        return x.estado === "bajando" ? { ...resto, [x.modelo]: x } : resto;
      });
      if (x.estado === "listo") {
        setListo(x.modelo);
        void mirarOllama();
      } else if (x.estado === "error") setErrBajar(t("ajustes.mdlBajarFallo", { nombre: x.modelo, motivo: textoMain(x.motivo ?? "") }));
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void fuente.uso().then((u) => vivo.current && setUso(u), () => {});
    return fuente.alCambiarUso((u) => vivo.current && setUso(u));
  }, []);

  /** Pregunta a Ollama qué tiene: no carga nada. */
  async function detectar(url: string) {
    setAg({ url, sondeo: "comprobando" });
    const s = await fuentePaneles.sondearOllama(url).catch((x): Sondeo => ({ ok: false, motivo: mensaje(x) }));
    if (vivo.current) setAg((a) => (a && a.url === url ? { url, sondeo: s } : a));
  }

  // Cada dirección de los locales se comprueba una vez: responde o no.
  const urls = useMemo(() => (b ? [...new Set(b.locales.map((l) => l.url))].sort() : []), [b]);
  const clave = urls.join("|");
  useEffect(() => {
    for (const url of urls) {
      if (sondeados.current.has(url)) continue;
      sondeados.current.add(url);
      setEstados((x) => ({ ...x, [url]: "comprobando" }));
      void fuentePaneles
        .sondearOllama(url)
        .catch((x): Sondeo => ({ ok: false, motivo: mensaje(x) }))
        .then((s) => vivo.current && setEstados((x) => ({ ...x, [url]: s })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const visible = e !== null && b !== null;
  useEffect(() => {
    if (!visible || !ES_CAPTURA) return;
    // Captura: `mdl-agregar` deja a la vista los locales y su panel; el resto, la cabecera de la sección.
    const mira = sec.current?.querySelector(VARIANTE === "mdl-agregar" ? ".mdl-panel" : VARIANTE === "mdl-bajando" || VARIANTE === "mdl-sinollama" ? ".mdl-ollama" : VARIANTE === "mdl-tope" ? ".mdl-cruce" : "x:not(x)");
    if (mira) mira.scrollIntoView({ block: "center" });
    else sec.current?.scrollIntoView({ block: "start" });
  }, [visible]);

  if (falla) return <div className="pn-aviso" data-error>{textoMain(falla)}</div>;
  if (!e || !b) return null;

  const cambiar = (nuevo: Borrador) => {
    setB(nuevo);
    setError(null);
    setOk(false);
    setSync(null);
  };
  const config = configDe(b);
  const hayCambio = sucio(e, b);
  const errCupo = cupoDe(b.cupo) === "mal";
  const errTope5 = topeMal(b.tope5);
  const errTope7 = topeMal(b.tope7);
  const pasados = cruces(b, uso && "five_hour" in uso ? uso : null);
  const instaladosOl = typeof ollama === "object" && ollama.ok ? ollama.modelos : null;
  const bajandoLista = Object.values(bajando);
  const valido = config !== null;
  const locales = b.locales;
  const modelos = modelosPara(locales, [b.lider?.modelo ?? "", ...TIPOS.map((x) => b.workers[x]?.modelo ?? "")], e.agy ?? true);

  const guardar = async () => {
    if (!config || !hayCambio) return;
    setGuardando(true);
    setError(null);
    setSync(null);
    try {
      const nuevo = await fuentePaneles.guardarModelos(config);
      if (!vivo.current) return;
      if (nuevo.version !== VERSION) throw new Error(t("error.version", { que: t("ajustes.mdlTitulo"), v: nuevo.version, conozco: VERSION }));
      setE(nuevo);
      setB(borradorDe(nuevo));
      setSync(nuevo.sync_error ?? null);
      setOk(true);
      alGuardar?.();
    } catch (x) {
      if (vivo.current) setError(mensaje(x));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  // Con lo guardado a la vista, `pa` dice con qué corre cada cosa; si no, se calcula del borrador.
  const deLider = (): Eleccion => (!hayCambio && e.efectivo?.lider) || liderEfectivo(b);
  const soloGemini = e.solo_gemini === true;
  const deTipo = (tipo: Tipo): Eleccion => (!hayCambio && e.efectivo?.workers[tipo]) || efectivoBorrador(b, tipo, soloGemini);

  const abrirAgregar = () => {
    if (ag) return setAg(null);
    void detectar(URL_OLLAMA);
  };
  const enviarUrl = (ev: FormEvent) => {
    ev.preventDefault();
    if (ag && urlOllama(ag.url)) void detectar(ag.url);
  };
  const empezarBajada = async (ev: FormEvent) => {
    ev.preventDefault();
    const nombre = bajar.trim();
    if (!nombreModeloValido(nombre)) return;
    setErrBajar(null);
    setListo(null);
    try {
      const x = await fuentePaneles.bajarModelo(URL_OLLAMA, nombre);
      if (!vivo.current) return;
      setBajando((a) => ({ ...a, [x.modelo]: x }));
      setBajar("");
    } catch (x) {
      if (vivo.current) setErrBajar(mensaje(x));
    }
  };
  const urlValida = ag ? urlOllama(ag.url) !== null : true;
  const instalados = ag && typeof ag.sondeo === "object" && ag.sondeo && ag.sondeo.ok ? ag.sondeo.modelos : null;
  const motivoNo = ag && typeof ag.sondeo === "object" && ag.sondeo && !ag.sondeo.ok ? ag.sondeo.motivo : null;

  if (e.error)
    return (
      <section className="pn-sec" ref={sec} data-modelos>
        <h2 className="pn-h">{t("ajustes.mdlTitulo")}</h2>
        <div className="pn-error" role="alert">
          {textoMain(e.error)}
        </div>
      </section>
    );

  return (
    <section className="pn-sec pn-edita" ref={sec} data-modelos>
      <h2 className="pn-h">{t("ajustes.mdlTitulo")}</h2>
      <Fijo k="ajustes.mdlIntro" bloque className="pn-nota pn-intro" />
      {!e.existe ? <Fijo k="ajustes.mdlSinArchivo" bloque className="pn-nota pn-intro" /> : null}

      <Dato nombre="ajustes.mdlLider" que="ajustes.mdlLiderQue">
        <EleccionSel
          etiqueta={t("ajustes.mdlLider")}
          modelos={modelos}
          valor={b.lider}
          comoHoy
          alModelo={(id) => cambiar(elegirLider(b, id))}
          alEffort={(x) => cambiar(elegirEffortLider(b, x))}
          abierto={VARIANTE === "mdl-lider"}
        />
        {!b.lider ? (
          <div className="pn-alt">
            <span>{t("ajustes.mdlEfectivo", { modelo: textoEleccion(deLider(), locales) })}</span>
          </div>
        ) : null}
      </Dato>

      <Dato nombre="ajustes.mdlTodo" que="ajustes.mdlTodoQue">
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.mdlSelTodo")}
            opciones={[{ id: "", nombre: t("ajustes.mdlTodoElegir"), desc: "" }, ...opcionesDe(modelos, false)]}
            valor=""
            alElegir={(id) => cambiar(todoEn(b, id))}
            reserva={enOtros("ajustes.mdlTodoElegir")}
          />
        </div>
      </Dato>

      <h3 className="pn-sub-h">{t("ajustes.mdlWorkers")}</h3>
      <Fijo k={soloGemini ? "ajustes.mdlRecomendadosGeminiQue" : "ajustes.mdlRecomendadosQue"} bloque className="pn-nota pn-intro" />
      <div className="mdl-recomendados">
        <button type="button" className="btn2" onClick={() => cambiar(defaultsEn(b, soloGemini))}>
          <Fijo k="ajustes.mdlRecomendados" />
        </button>
      </div>
      {TIPOS.map((tipo) => {
        const nombre = `mdl.t.${tipo}` as ClaveSola;
        const eleccion = b.workers[tipo];
        const valorFila = eleccion ?? (b.reparto === "auto" ? { modelo: "auto" } : undefined);
        return (
          <Dato key={tipo} nombre={nombre} que={`mdl.t.${tipo}Que` as ClaveSola}>
            <EleccionSel
              etiqueta={t(nombre)}
              modelos={modelos}
              valor={valorFila}
              comoHoy
              conAuto
              alModelo={(id) => cambiar(elegirWorker(b, tipo, id))}
              alEffort={(x) => cambiar(elegirEffortWorker(b, tipo, x))}
            />
            {!eleccion && b.reparto === "auto" ? (
              <div className="pn-alt" data-reparto>
                <span>{e.efectivo?.workers[tipo] && !hayCambio ? t("ajustes.mdlRepartoHoy", { modelo: textoEleccion(e.efectivo.workers[tipo], locales) }) : t("ajustes.mdlRepartoDecide")}</span>
              </div>
            ) : !eleccion ? (
              <div className="pn-alt">
                <span>{t("ajustes.mdlEfectivo", { modelo: textoEleccion(deTipo(tipo), locales) })}</span>
              </div>
            ) : null}
          </Dato>
        );
      })}

      <h3 className="pn-sub-h">{t("ajustes.mdlLocales")}</h3>
      <div className="mdl-ollama" data-estado={typeof ollama === "object" ? (ollama.ok ? "ok" : "no") : "..."}>
        <div className="mdl-ollama-cab">
          <span className="mdl-ollama-t">{ollama === "comprobando" ? t("ajustes.mdlComprobando") : instaladosOl ? t("ajustes.mdlOllamaAnda") : t("ajustes.mdlOllamaNoAnda")}</span>
          <button type="button" className="btn2" onClick={() => void mirarOllama()} disabled={ollama === "comprobando"}>
            <Fijo k="ajustes.mdlOllamaMirar" />
          </button>
        </div>
        <Fijo k="ajustes.mdlOllamaQue" bloque className="pn-nota" />
        {typeof ollama === "object" && !ollama.ok ? (
          <div className="mdl-ollama-instalar">
            <a className="btn2 mdl-enlace" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">
              <Fijo k="ajustes.mdlOllamaInstalar" />
            </a>
            <Fijo k="ajustes.mdlOllamaInstalarQue" bloque className="pn-nota" />
          </div>
        ) : null}
      </div>

      {instaladosOl ? (
        <>
          <Dato nombre="ajustes.mdlInstalados" que="ajustes.mdlInstaladosQue">
            {instaladosOl.length ? (
              <ul className="pn-disp mdl-instalados" aria-label={t("ajustes.mdlInstalados")}>
                {instaladosOl.map((m) => {
                  const ya = locales.some((l) => l.id === `ollama:${m.nombre}`);
                  return (
                    <li key={m.nombre}>
                      <span className="mdl-local-nom">
                        <span className="pn-disp-nom">{m.nombre}</span>
                        <span className="mdl-url">{gb(m.bytes)}</span>
                      </span>
                      {ya ? (
                        <span className="mdl-estado" data-estado="ok">{t("ajustes.mdlEnUso")}</span>
                      ) : (
                        <button type="button" className="btn2" aria-label={t("ajustes.mdlUsarModelo", { nombre: m.nombre })} data-recien={listo === m.nombre ? "" : undefined} onClick={() => cambiar(agregarLocal(b, URL_OLLAMA, m.nombre))}>
                          <Fijo k="ajustes.mdlUsar" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="pn-nota">{t("ajustes.mdlNingunoInstalado")}</div>
            )}
          </Dato>

          <Dato nombre="ajustes.mdlBajar" que="ajustes.mdlBajarQue">
            <form className="pn-nuevo" onSubmit={(ev) => void empezarBajada(ev)}>
              <input
                className="pn-campo"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={bajar}
                placeholder="llama3.2:3b"
                aria-label={t("ajustes.mdlBajarCampo")}
                aria-invalid={bajar.trim() !== "" && !nombreModeloValido(bajar)}
                onChange={(ev) => {
                  setBajar(ev.target.value);
                  setErrBajar(null);
                }}
              />
              <button type="submit" className="btn2" disabled={!nombreModeloValido(bajar)}>
                <Fijo k="ajustes.mdlBajarBtn" />
              </button>
            </form>
            {bajar.trim() !== "" && !nombreModeloValido(bajar) ? <div className="pn-error pn-campo-error">{t("ajustes.mdlBajarNombreMal")}</div> : null}
            {bajandoLista.map((x) => {
              const pct = porcentaje(x);
              return (
                <div key={x.modelo} className="mdl-baja" role="status">
                  <div className="mdl-baja-fila">
                    <span className="mdl-baja-nom">{t("ajustes.mdlBajando", { nombre: x.modelo })}</span>
                    <span className="mdl-estado">{textoBajada(x)}</span>
                    <button type="button" className="btn2" aria-label={t("ajustes.mdlBajarCancelarModelo", { nombre: x.modelo })} onClick={() => void fuentePaneles.cancelarBajada(x.url, x.modelo)}>
                      <Fijo k="ajustes.mdlBajarCancelar" />
                    </button>
                  </div>
                  <div className="mdl-barra" role="progressbar" aria-label={t("ajustes.mdlBajando", { nombre: x.modelo })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
                    <div className="mdl-barra-r" data-indef={pct === null ? "" : undefined} style={pct === null ? undefined : { transform: `scaleX(${pct / 100})` }} />
                  </div>
                </div>
              );
            })}
            {listo && !bajando[listo] && !errBajar ? <div className="pn-nota" role="status">{t("ajustes.mdlBajarListo", { nombre: listo })}</div> : null}
            {errBajar ? <div className="pn-error pn-campo-error" role="alert">{textoMain(errBajar)}</div> : null}
          </Dato>
        </>
      ) : null}

      <Dato nombre="ajustes.mdlLocalesAgregados" que="ajustes.mdlLocalesQue">
        <ul className="pn-disp mdl-locales" aria-label={t("ajustes.mdlLocales")}>
          {locales.length ? (
            locales.map((l) => {
              const s = estados[l.url];
              const responde = typeof s === "object" && s.ok;
              const texto = s === undefined || s === "comprobando" ? t("ajustes.mdlComprobando") : responde ? t("ajustes.mdlResponde") : t("ajustes.mdlNoResponde");
              return (
                <li key={l.id}>
                  <span className="mdl-local-nom">
                    <span className="pn-disp-nom">{l.nombre}</span>
                    <span className="mdl-url">{l.url}</span>
                  </span>
                  <span className="mdl-estado" data-estado={responde ? "ok" : typeof s === "object" ? "no" : "..."} data-tip={typeof s === "object" && !s.ok ? textoMain(s.motivo) : undefined}>
                    {texto}
                  </span>
                  <button type="button" className="pn-quitar" aria-label={t("ajustes.mdlQuitarLocal", { nombre: l.nombre })} data-tip={t("ajustes.mdlQuitarLocal", { nombre: l.nombre })} onClick={() => cambiar(quitarLocal(b, l.id))}>
                    <X size={14} aria-hidden />
                  </button>
                </li>
              );
            })
          ) : (
            <li className="pn-falta">
              <Fijo k="ajustes.mdlNingunLocal" />
            </li>
          )}
        </ul>
        <button type="button" className="btn2 mdl-agregar-btn" aria-expanded={ag !== null} onClick={abrirAgregar}>
          {ag ? null : <Plus size={14} aria-hidden />}
          {ag ? t("ajustes.mdlCerrarAgregar") : t("ajustes.mdlAgregarLocal")}
        </button>
      </Dato>

      {ag ? (
        <div className="mdl-panel" role="group" aria-label={t("ajustes.mdlAgregarLocal")}>
          <form className="pn-nuevo" onSubmit={enviarUrl}>
            <input
              className="pn-campo"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={ag.url}
              aria-label={t("ajustes.mdlUrl")}
              aria-invalid={!urlValida}
              onChange={(ev) => setAg({ url: ev.target.value, sondeo: null })}
            />
            <button type="submit" className="btn2" disabled={!urlValida || ag.sondeo === "comprobando"}>
              {ag.sondeo === "comprobando" ? t("ajustes.mdlDetectando") : t("ajustes.mdlDetectar")}
            </button>
          </form>
          {!urlValida ? <div className="pn-error pn-campo-error">{t("ajustes.mdlUrlMal")}</div> : null}
          {motivoNo ? <div className="pn-error pn-campo-error" role="alert">{textoMain(motivoNo)}</div> : null}
          {instalados ? (
            instalados.length ? (
              <ul className="pn-disp mdl-instalados" aria-label={t("ajustes.mdlInstalados")}>
                {instalados.map((m) => {
                  const ya = locales.some((l) => l.id === `ollama:${m.nombre}`);
                  return (
                    <li key={m.nombre}>
                      <span className="mdl-local-nom">
                        <span className="pn-disp-nom">{m.nombre}</span>
                        <span className="mdl-url">{gb(m.bytes)}</span>
                      </span>
                      <button type="button" className="btn2" disabled={ya} aria-label={t("ajustes.mdlAgregar", { nombre: m.nombre })} onClick={() => cambiar(agregarLocal(b, ag.url, m.nombre))}>
                        {ya ? t("ajustes.mdlYaAgregado") : <Plus size={14} aria-hidden />}
                        {ya ? null : <Fijo k="ajustes.celAgregar" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="pn-nota">{t("ajustes.mdlNingunoInstalado")}</div>
            )
          ) : null}
        </div>
      ) : null}

      <h3 className="pn-sub-h">{t("ajustes.mdlClaude")}</h3>
      <Dato nombre="ajustes.mdlTope5" que="ajustes.mdlTope5Que">
        <div className="pn-campo-fila">
          <input
            className="pn-campo pn-campo-num"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={b.tope5}
            placeholder={String(TOPE_CLAUDE_DEFECTO)}
            aria-label={t("ajustes.mdlTope5")}
            aria-invalid={errTope5}
            onChange={(ev) => cambiar({ ...b, tope5: ev.target.value })}
          />
          <span className="pn-unidad">%</span>
        </div>
        {errTope5 ? <div className="pn-error pn-campo-error">{t("ajustes.mdlTopeErr")}</div> : null}
      </Dato>
      <Dato nombre="ajustes.mdlTope7" que="ajustes.mdlTope7Que">
        <div className="pn-campo-fila">
          <input
            className="pn-campo pn-campo-num"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={b.tope7}
            placeholder={String(TOPE_CLAUDE_DEFECTO)}
            aria-label={t("ajustes.mdlTope7")}
            aria-invalid={errTope7}
            onChange={(ev) => cambiar({ ...b, tope7: ev.target.value })}
          />
          <span className="pn-unidad">%</span>
        </div>
        {errTope7 ? <div className="pn-error pn-campo-error">{t("ajustes.mdlTopeErr")}</div> : null}
      </Dato>
      {pasados.map((c) => (
        <div key={c.ventana} className="pn-aviso mdl-cruce" role="status">
          {t(c.ventana === "5h" ? "ajustes.mdlTopeCruce5" : "ajustes.mdlTopeCruce7", { pct: c.pct, tope: c.tope })}
        </div>
      ))}

      <h3 className="pn-sub-h">Gemini</h3>
      <Dato nombre="ajustes.mdlCupo" que="ajustes.mdlCupoQue">
        <div className="pn-campo-fila">
          <input
            className="pn-campo pn-campo-num"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={b.cupo}
            placeholder={t("ajustes.mdlCupoSin")}
            aria-label={t("ajustes.mdlCupo")}
            aria-invalid={errCupo}
            onChange={(ev) => cambiar({ ...b, cupo: ev.target.value })}
          />
          <span className="pn-unidad">%</span>
        </div>
        {errCupo ? <div className="pn-error pn-campo-error">{t("ajustes.mdlCupoErr")}</div> : null}
      </Dato>
      <Dato nombre="ajustes.mdlSinClaude" que="ajustes.mdlSinClaudeQue">
        <div className="pn-sel">
          <Selector
            etiqueta={t("ajustes.mdlSinClaude")}
            opciones={SIN_CLAUDE.map((id) => ({ id, nombre: t(SIN_CLAUDE_CLAVES[id].nombre), desc: t(SIN_CLAUDE_CLAVES[id].que), ...(id === "claude" ? { rec: true } : {}) }))}
            valor={b.sin_claude ?? "claude"}
            alElegir={(id) => cambiar({ ...b, sin_claude: id as SinClaude })}
            reserva={SIN_CLAUDE.flatMap((id) => enOtros(SIN_CLAUDE_CLAVES[id].nombre))}
          />
        </div>
      </Dato>

      <Acciones id="modelos" sucio={hayCambio} valido={valido} guardando={guardando} ok={ok} error={error} alGuardar={guardar} alCancelar={() => cambiar(borradorDe(e))} />
      {sync ? (
        <div className="pn-error" role="status">
          {t("ajustes.mdlSyncError", { e: textoMain(sync) })}
        </div>
      ) : null}
    </section>
  );
}
