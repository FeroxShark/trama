// Ajustes > General > Compactación: a cuántos tokens Claude resume solo una conversación (`autoCompactWindow` de
// ~/.claude/settings.json). Es un borrador como el plan: se guarda con la barra de abajo (`Acciones`) por la misma vía que la red
// de seguridad (`guardarAjustes` → `red_seguridad`), y Cancelar vuelve a lo guardado.
import { useEffect, useRef, useState } from "react";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type Ajustes as Datos } from "../datos/paneles";
import { t } from "../i18n";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { IcCompactar, ICONO } from "../ui/iconos";
import { Acciones, type FilaDato } from "./AjustesEditar";
import { redDesde, redPara } from "./ajustes-compactar";
import { UmbralCompactar } from "./UmbralCompactar";

export function Compactar({ inicial, Dato }: { inicial: Datos; Dato: FilaDato }) {
  const [g, setG] = useState(inicial.red_seguridad);
  const [b, setB] = useState(() => (MODO.variante === "editando" ? "150000" : redDesde(inicial.red_seguridad)));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [invalido, setInvalido] = useState(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);

  const r = redPara(g, b);

  const cambiar = (nuevo: string) => {
    setB(nuevo);
    setError(null);
    setOk(false);
  };
  const guardar = async () => {
    if (!r.cambio) return;
    setGuardando(true);
    setError(null);
    try {
      const nuevo = await fuentePaneles.guardarAjustes(r.cambio);
      if (!vivo.current) return;
      if (nuevo.version !== VERSION) throw new Error(t("error.version", { que: t("panel.ajustes"), v: nuevo.version, conozco: VERSION }));
      setG(nuevo.red_seguridad);
      setB(redDesde(nuevo.red_seguridad));
      setOk(true);
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  return (
    <section className="pn-sec pn-edita">
      <h2 className="pn-h">{t("ajustes.compactacion")}</h2>
      <Dato nombre="ajustes.compactar" que="ajustes.compactarQue" icono={<IcCompactar {...ICONO} />}>
        <div className="pn-sel pn-abajo">
          <UmbralCompactar
            id="aj-umbral"
            valor={b === "" ? null : Number(b)}
            alCambiar={(c) => {
              setInvalido(c.error !== null);
              if (c.error === null) cambiar(c.valor === null ? redDesde(g) : String(c.valor));
              else setOk(false);
            }}
          />
        </div>
        {b === "" ? (
          <div className="pn-alt">
            <span>{t("ajustes.sinDefinir")}</span>
          </div>
        ) : null}
      </Dato>
      <Acciones id="compactar" sucio={r.sucio} valido={!invalido} guardando={guardando} ok={ok} error={error} alGuardar={guardar} alCancelar={() => {
          setInvalido(false);
          cambiar(redDesde(g));
        }} />
    </section>
  );
}
