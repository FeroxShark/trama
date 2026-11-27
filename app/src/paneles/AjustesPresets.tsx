// Ajustes > Modelos > «Presets de skills»: asigna qué preset de skills usa cada tipo de worker y permite editar el modo
// (`todo`, `apagar`, `solo`) y la lista de skills de cada preset. Vive en `~/.config/trama/presets.json`, aparte de
// `modelos.json`, por eso tiene sus propios botones «Guardar presets» y «Restaurar de fábrica».
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import {
  MODOS_PRESET,
  normalizarPresets,
  PRESETS_NOMBRES_FABRICA,
  presetsFabrica,
  skillPresetValida,
  type ConfigPresets,
  type ModoPreset,
} from "../../electron/presets-tipos";
import { fuentePaneles } from "../datos/paneles";
import { t, textoMain, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";

/** Los tipos de worker que se muestran en la grilla de asignación de presets. */
export const TIPOS_WORKER_PRESETS = [
  "mecanico",
  "lectura",
  "codigo-acotado",
  "codigo-multi",
  "debug",
  "frontend",
  "diseno",
  "default",
] as const;

export type TipoWorkerPreset = (typeof TIPOS_WORKER_PRESETS)[number];

/** Cambia el preset asignado a un tipo de worker sin mutar la config original. */
export function cambiarPresetTipo(cfg: ConfigPresets, tipo: string, preset: string): ConfigPresets {
  if (!(preset in cfg.presets) || cfg.por_tipo[tipo] === preset) return cfg;
  return {
    ...cfg,
    por_tipo: { ...cfg.por_tipo, [tipo]: preset },
  };
}

/** Cambia el modo (`todo`, `apagar` o `solo`) de un preset existente sin mutar la config original. */
export function cambiarModoPreset(cfg: ConfigPresets, nombre: string, modo: ModoPreset): ConfigPresets {
  const actual = cfg.presets[nombre];
  if (!actual || actual.modo === modo) return cfg;
  return {
    ...cfg,
    presets: {
      ...cfg.presets,
      [nombre]: { ...actual, modo },
    },
  };
}

/** Reemplaza la lista de skills válidas (sin duplicados) de un preset existente sin mutar la config original. */
export function cambiarSkillsPreset(cfg: ConfigPresets, nombre: string, skills: readonly string[]): ConfigPresets {
  const actual = cfg.presets[nombre];
  if (!actual) return cfg;
  const limpias = [...new Set(skills.filter(skillPresetValida))];
  if (limpias.length === actual.skills.length && limpias.every((s, i) => s === actual.skills[i])) return cfg;
  return {
    ...cfg,
    presets: {
      ...cfg.presets,
      [nombre]: { ...actual, skills: limpias },
    },
  };
}

/**
 * Parsea una lista de skills escrita por la persona (separadas por coma o salto de línea),
 * deduplicando y separando las que pasan `skillPresetValida` de las inválidas.
 */
export function parsearSkillsTexto(texto: string): { validas: string[]; invalidas: string[] } {
  const validas: string[] = [];
  const invalidas: string[] = [];
  const vistasValidas = new Set<string>();
  const vistasInvalidas = new Set<string>();
  for (const crudo of texto.split(/[\r\n,]+/)) {
    const item = crudo.trim();
    if (!item) continue;
    if (skillPresetValida(item)) {
      if (!vistasValidas.has(item)) {
        vistasValidas.add(item);
        validas.push(item);
      }
    } else if (!vistasInvalidas.has(item)) {
      vistasInvalidas.add(item);
      invalidas.push(item);
    }
  }
  return { validas, invalidas };
}

/** Devuelve una copia limpia de los presets de fábrica. */
export function restaurarPresetsFabrica(): ConfigPresets {
  return presetsFabrica();
}

/** Compara dos configuraciones de presets para saber si hay cambios sin guardar. */
export function presetsDistintos(a: ConfigPresets, b: ConfigPresets): boolean {
  const clavesA = Object.keys(a.presets);
  const clavesB = Object.keys(b.presets);
  if (clavesA.length !== clavesB.length) return true;
  for (const k of clavesA) {
    const pa = a.presets[k];
    const pb = b.presets[k];
    if (!pb || pa.modo !== pb.modo || pa.skills.length !== pb.skills.length) return true;
    for (let i = 0; i < pa.skills.length; i++) {
      if (pa.skills[i] !== pb.skills[i]) return true;
    }
  }
  const tiposA = Object.keys(a.por_tipo);
  const tiposB = Object.keys(b.por_tipo);
  if (tiposA.length !== tiposB.length) return true;
  for (const k of tiposA) {
    if (a.por_tipo[k] !== b.por_tipo[k]) return true;
  }
  return false;
}

const CLAVE_NOMBRE_FABRICA: Record<(typeof PRESETS_NOMBRES_FABRICA)[number], ClaveSola> = {
  minimo: "ajustes.mdlPresetsNombre.minimo",
  codigo: "ajustes.mdlPresetsNombre.codigo",
  diseno: "ajustes.mdlPresetsNombre.diseno",
  orquestador: "ajustes.mdlPresetsNombre.orquestador",
  todo: "ajustes.mdlPresetsNombre.todo",
};

const CLAVE_MODO: Record<ModoPreset, ClaveSola> = {
  todo: "ajustes.mdlPresetsModoTodo",
  apagar: "ajustes.mdlPresetsModoApagar",
  solo: "ajustes.mdlPresetsModoSolo",
};

function nombrePresetVisible(nombre: string): string {
  const clave = CLAVE_NOMBRE_FABRICA[nombre as keyof typeof CLAVE_NOMBRE_FABRICA];
  return clave ? t(clave) : nombre;
}

function ordenarNombresPresets(cfg: ConfigPresets): string[] {
  const todos = Object.keys(cfg.presets);
  const fabrica = PRESETS_NOMBRES_FABRICA.filter((n) => n in cfg.presets);
  const extras = todos.filter((n) => !(PRESETS_NOMBRES_FABRICA as readonly string[]).includes(n)).sort();
  return [...fabrica, ...extras];
}

export function AjustesPresets() {
  useIdioma();
  const baseId = useId();
  const [guardado, setGuardado] = useState<ConfigPresets | null>(null);
  const [borrador, setBorrador] = useState<ConfigPresets | null>(null);
  const [seleccionado, setSeleccionado] = useState<string>(PRESETS_NOMBRES_FABRICA[0]);
  const [textoSkills, setTextoSkills] = useState("");
  const [cargando, setCargando] = useState(true);
  const [fallaCarga, setFallaCarga] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setFallaCarga(null);
    try {
      const cfg =
        typeof fuentePaneles.presets === "function"
          ? normalizarPresets((await fuentePaneles.presets()).config)
          : presetsFabrica();
      if (!vivo.current) return;
      const nombres = ordenarNombresPresets(cfg);
      const primero = nombres[0] ?? PRESETS_NOMBRES_FABRICA[0];
      setGuardado(cfg);
      setBorrador(cfg);
      setSeleccionado(primero);
      setTextoSkills((cfg.presets[primero]?.skills ?? []).join("\n"));
      setGuardadoOk(false);
      setErrorGuardar(null);
    } catch (err) {
      if (!vivo.current) return;
      setFallaCarga(textoMain(mensaje(err)));
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const nombresPresets = useMemo(() => (borrador ? ordenarNombresPresets(borrador) : []), [borrador]);
  const presetActivo = borrador ? (borrador.presets[seleccionado] ? seleccionado : (nombresPresets[0] ?? "")) : "";
  const detallePreset = borrador && presetActivo ? borrador.presets[presetActivo] : null;
  const parseado = useMemo(() => parsearSkillsTexto(textoSkills), [textoSkills]);
  const hayInvalidas = detallePreset !== null && detallePreset.modo !== "todo" && parseado.invalidas.length > 0;
  const fabrica = useMemo(() => presetsFabrica(), []);
  const sucio = guardado !== null && borrador !== null && presetsDistintos(guardado, borrador);
  const esFabrica = borrador !== null && !presetsDistintos(borrador, fabrica) && !hayInvalidas;

  if (cargando) {
    return (
      <div className="mdl-presets" role="status">
        <span className="pn-nota">{t("ajustes.mdlPresetsCargando")}</span>
      </div>
    );
  }

  if (fallaCarga || !borrador) {
    return (
      <div className="mdl-presets">
        <div className="pn-falla">
          <span className="pn-error pn-falla-t" role="alert">
            {fallaCarga ?? t("ajustes.mdlPresetsCargando")}
          </span>
          <Boton onClick={() => void cargar()}>{t("ajustes.mdlPresetsReintentar")}</Boton>
        </div>
      </div>
    );
  }

  const seleccionarPreset = (nombre: string) => {
    setSeleccionado(nombre);
    setTextoSkills((borrador.presets[nombre]?.skills ?? []).join("\n"));
  };

  const cambiarTipo = (tipo: TipoWorkerPreset, preset: string) => {
    setBorrador((prev) => (prev ? cambiarPresetTipo(prev, tipo, preset) : prev));
    setGuardadoOk(false);
    setErrorGuardar(null);
  };

  const cambiarModo = (modo: ModoPreset) => {
    if (!presetActivo) return;
    setBorrador((prev) => (prev ? cambiarModoPreset(prev, presetActivo, modo) : prev));
    setGuardadoOk(false);
    setErrorGuardar(null);
  };

  const cambiarTextoSkills = (valor: string) => {
    setTextoSkills(valor);
    setGuardadoOk(false);
    setErrorGuardar(null);
    if (!presetActivo) return;
    const res = parsearSkillsTexto(valor);
    if (res.invalidas.length === 0) {
      setBorrador((prev) => (prev ? cambiarSkillsPreset(prev, presetActivo, res.validas) : prev));
    }
  };

  const restaurar = () => {
    const base = restaurarPresetsFabrica();
    const prox = base.presets[presetActivo] ? presetActivo : PRESETS_NOMBRES_FABRICA[0];
    setBorrador(base);
    setSeleccionado(prox);
    setTextoSkills((base.presets[prox]?.skills ?? []).join("\n"));
    setGuardadoOk(false);
    setErrorGuardar(null);
  };

  const guardar = async () => {
    if (guardando || !sucio || hayInvalidas) return;
    setGuardando(true);
    setGuardadoOk(false);
    setErrorGuardar(null);
    try {
      const res =
        typeof fuentePaneles.guardarPresets === "function"
          ? normalizarPresets((await fuentePaneles.guardarPresets(borrador)).config)
          : normalizarPresets(borrador);
      if (!vivo.current) return;
      const prox = res.presets[presetActivo] ? presetActivo : (ordenarNombresPresets(res)[0] ?? PRESETS_NOMBRES_FABRICA[0]);
      setGuardado(res);
      setBorrador(res);
      setSeleccionado(prox);
      setTextoSkills((res.presets[prox]?.skills ?? []).join("\n"));
      setGuardadoOk(true);
    } catch (err) {
      if (!vivo.current) return;
      setErrorGuardar(textoMain(mensaje(err)));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  const nombreSelVisible = nombrePresetVisible(presetActivo);
  const idSkills = `${baseId}-skills`;

  return (
    <div className="mdl-presets">
      <div className="mdl-presets-bloque">
        <div className="mdl-presets-sub">{t("ajustes.mdlPresetsPorTipo")}</div>
        <div className="mdl-presets-tipos">
          {TIPOS_WORKER_PRESETS.map((tipo) => {
            const labelTipo = t(`mdl.t.${tipo}` as ClaveSola);
            const idSel = `${baseId}-tipo-${tipo}`;
            const valor = borrador.por_tipo[tipo] ?? borrador.por_tipo.default ?? PRESETS_NOMBRES_FABRICA[1];
            return (
              <div key={tipo} className="mdl-presets-tipo">
                <label className="mdl-presets-tipo-nom" htmlFor={idSel}>
                  {labelTipo}
                </label>
                <select
                  id={idSel}
                  className="pn-campo mdl-presets-sel"
                  value={valor}
                  aria-label={t("ajustes.mdlPresetsTipoSel", { tipo: labelTipo })}
                  onChange={(e) => cambiarTipo(tipo, e.target.value)}
                >
                  {nombresPresets.map((n) => (
                    <option key={n} value={n}>
                      {nombrePresetVisible(n)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mdl-presets-bloque">
        <div className="mdl-presets-sub">{t("ajustes.mdlPresetsEditar")}</div>
        <div className="pn-chips" role="group" aria-label={t("ajustes.mdlPresetsElegir")}>
          {nombresPresets.map((nombre) => (
            <button
              key={nombre}
              type="button"
              className="pn-chip-f"
              aria-pressed={presetActivo === nombre}
              onClick={() => seleccionarPreset(nombre)}
            >
              {nombrePresetVisible(nombre)}
            </button>
          ))}
        </div>

        {detallePreset ? (
          <div className="mdl-presets-detalle">
            <div className="mdl-presets-campo">
              <span className="mdl-presets-etq">{t("ajustes.mdlPresetsModo")}</span>
              <div className="pn-chips" role="group" aria-label={t("ajustes.mdlPresetsModoDe", { preset: nombreSelVisible })}>
                {MODOS_PRESET.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="pn-chip-f"
                    aria-pressed={detallePreset.modo === m}
                    onClick={() => cambiarModo(m)}
                  >
                    {t(CLAVE_MODO[m])}
                  </button>
                ))}
              </div>
            </div>

            {detallePreset.modo === "todo" ? (
              <p className="pn-nota mdl-presets-nota">{t("ajustes.mdlPresetsModoTodoNota")}</p>
            ) : (
              <div className="mdl-presets-campo">
                <label className="mdl-presets-etq" htmlFor={idSkills}>
                  {t("ajustes.mdlPresetsSkills")}
                </label>
                <textarea
                  id={idSkills}
                  className="pn-campo mdl-presets-area"
                  rows={3}
                  spellCheck={false}
                  value={textoSkills}
                  placeholder={t("ajustes.mdlPresetsSkillsPlaceholder")}
                  aria-label={t("ajustes.mdlPresetsSkillsDe", { preset: nombreSelVisible })}
                  aria-invalid={hayInvalidas}
                  onChange={(e) => cambiarTextoSkills(e.target.value)}
                />
                {hayInvalidas ? (
                  <div className="pn-error mdl-presets-err" role="alert">
                    <AlertCircle size={14} aria-hidden="true" />
                    <span>{t("ajustes.mdlPresetsSkillsInvalidas", { lista: parseado.invalidas.join(", ") })}</span>
                  </div>
                ) : detallePreset.modo === "solo" && parseado.validas.length === 0 ? (
                  <p className="pn-nota mdl-presets-nota">{t("ajustes.mdlPresetsSkillsVacio")}</p>
                ) : (
                  <p className="pn-nota mdl-presets-nota">{t("ajustes.mdlPresetsSkillsAyuda")}</p>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="mdl-presets-acc">
        <div className="mdl-presets-est-wrap">
          {errorGuardar ? (
            <span className="mdl-presets-est" data-estado="error" role="alert">
              <AlertCircle size={14} aria-hidden="true" />
              <span>{errorGuardar}</span>
            </span>
          ) : guardando ? (
            <span className="mdl-presets-est" role="status">
              {t("ajustes.guardando")}
            </span>
          ) : guardadoOk && !sucio ? (
            <span className="mdl-presets-est" data-estado="ok" role="status">
              <Check size={14} aria-hidden="true" />
              <span>{t("ajustes.mdlPresetsGuardado")}</span>
            </span>
          ) : sucio ? (
            <span className="mdl-presets-est" data-estado="sucio" role="status">
              {t("ajustes.sinGuardar")}
            </span>
          ) : null}
        </div>
        <div className="mdl-presets-btns">
          <Boton onClick={restaurar} disabled={guardando || esFabrica}>
            {t("ajustes.mdlPresetsRestaurar")}
          </Boton>
          <Boton primario onClick={() => void guardar()} disabled={guardando || !sucio || hayInvalidas}>
            {guardando ? t("ajustes.guardando") : t("ajustes.mdlPresetsGuardar")}
          </Boton>
        </div>
      </div>
    </div>
  );
}
