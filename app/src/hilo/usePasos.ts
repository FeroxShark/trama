// Los pasos de un worker (la vista de worker): se piden al abrirlo, llegan por lotes (`pasos:cambio`) y se sueltan al cerrarlo.
// `undefined`: todavía leyendo; `null`: no se pudo leer (la vista de siempre); una vista con `hay: false`: sin transcript todavía.
import { useEffect, useState } from "react";
import { fuente } from "../datos/fuente";
import { aplicar, type VistaPasos } from "../datos/pasos";

type Estado = { id: string; vista: VistaPasos | null };

export function usePasos(id: string | null): VistaPasos | null | undefined {
  const [e, setE] = useState<Estado | null>(null);

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    // La vista que ya se tiene, para que un lote que llega se aplique sobre ella y no sobre un render viejo.
    let actual: VistaPasos | null = null;
    const poner = (vista: VistaPasos | null) => {
      actual = vista;
      if (vivo) setE({ id, vista });
    };
    const pedir = () =>
      fuente.pasosMirar(id).then(
        (v) => poner(v),
        () => poner(null),
      );
    const baja = fuente.alCambiarPasos((c) => {
      // Un lote antes de la primera lectura: la lectura que viene ya lo trae.
      if (!actual) return;
      const r = aplicar(actual, c);
      if (!r) return;
      if ("pedirDeNuevo" in r) void pedir();
      else if (r.vista !== actual) poner(r.vista);
    });
    void pedir();
    return () => {
      vivo = false;
      baja();
      fuente.pasosSoltar();
    };
  }, [id]);

  if (!id) return null;
  return e && e.id === id ? e.vista : undefined;
}
