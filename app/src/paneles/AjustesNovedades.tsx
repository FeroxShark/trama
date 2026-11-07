// Ajustes > Actualizaciones > Novedades: qué trajo cada versión de Trama (CHANGELOG.md del build), la más nueva arriba y cada una
// plegable (`<details>`: entra con teclado y lector de pantalla sin código extra). La de ahora viene abierta y dice «instalada» con
// palabra. Lee por `fuente.novedades()` (ventana y celular); sin historial en esta instalación, lo dice. Aparte del aviso del pie
// (`AvisoNovedades.tsx`), que cierra con «Listo»: esto no se cierra ni se borra nunca.
import { useEffect, useState } from "react";
import { fuente } from "../datos/fuente";
import { parsearCambios, versionNormal, type Entrada } from "../../electron/novedades-cambios";
import { t } from "../i18n";
import { Vinetas } from "../ui/Vinetas";
import type { FilaDato } from "./AjustesEditar";
import "./novedades-ajustes.css";

export function Novedades({ Dato }: { Dato: FilaDato }) {
  const [lista, setLista] = useState<{ entradas: Entrada[]; actual: string | null } | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuente.novedades().then((n) => vivo && setLista({ entradas: parsearCambios(n.texto), actual: versionNormal(n.actual) }));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <section className="pn-sec nov-sec">
      <Dato nombre="nov.titulo" que="nov.tituloQue">
        {lista && lista.entradas.length > 0 ? t(lista.entradas.length === 1 ? "nov.versiones1" : "nov.versiones", { n: lista.entradas.length }) : null}
      </Dato>
      {lista === null ? null : lista.entradas.length === 0 ? (
        <div className="nov-vacio" role="status">
          {t("nov.vacio")}
        </div>
      ) : (
        <div className="nov-lista" role="list" aria-label={t("nov.titulo")}>
          {lista.entradas.map((e, i) => (
            <details key={e.version} className="nov-ver" role="listitem" open={i === 0}>
              <summary>
                <span className="nov-v">v{e.version}</span>
                {e.version === lista.actual ? <span className="nov-ahora">{t("nov.instalada")}</span> : null}
                <span className="nov-n">{t(e.items.length === 1 ? "nov.cambio1" : "nov.cambios", { n: e.items.length })}</span>
              </summary>
              <Vinetas items={e.items} />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
