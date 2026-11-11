// El avance de la instalación de Trama, en un solo componente (lo usan el cartel de la barra y Ajustes > Actualizaciones): el paso en
// palabras («Compilando · paso 2 de 4»), cuánto lleva y, si un paso pasa de 3 minutos sin una línea nueva en el log, el aviso con
// «Ver registro». La barra se mueve sola mientras ningún paso sepa su porcentaje; nunca va sin el texto al lado (la animación sola no
// dice nada). Con `prefers-reduced-motion` queda quieta, llena hasta el paso en que va. La cuenta está en `avance-logica.ts`.
import { useEffect, useState } from "react";
import { fuente, INSTANTE_CAPTURA, type EstadoActTrama } from "../datos/fuente";
import { t } from "../i18n";
import { avance, textoPaso } from "./avance-logica";
import { IcAtencion, ICONO } from "./iconos";

type Instalando = Extract<EstadoActTrama, { fase: "instalando" }>;

/** El reloj de la interfaz: el `ahora` de la cuenta, cada segundo (sólo mientras hay algo que contar). */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activo]);
  return ahora;
}

/** `texto` reemplaza el «Compilando · paso 2 de 4» (la carcasa de Windows no tiene esos 4 pasos: dice «Descargando la v0.2… 42%»). */
export function Avance({ estado, porcentaje, texto: propio }: { estado: Instalando; porcentaje?: number; texto?: string }) {
  // Una captura fija el momento (el reloj no corre): así el tiempo y lo lento salen siempre iguales.
  const fijo = INSTANTE_CAPTURA;
  const reloj = useAhora(fijo === undefined);
  const a = avance({ paso: estado.paso, desde: estado.desde, ultimaLinea: estado.ultima, porcentaje, ahora: fijo ?? reloj });
  const texto = propio ?? textoPaso(a, (k, v) => t(k as "avance.paso", v as never));
  return (
    <div className="avz" data-lento={a.lento || undefined}>
      <div
        className="avz-b"
        role="progressbar"
        aria-label={texto}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={a.porcentaje === null ? undefined : Math.round(a.porcentaje * 100)}
        aria-valuetext={a.tiempo ? `${texto}. ${t("avance.lleva", { tiempo: a.tiempo })}` : texto}
        data-solo={a.porcentaje === null || undefined}
        style={{ "--pasos": a.n / a.total, "--p": a.porcentaje ?? 0 } as React.CSSProperties}
      >
        <i />
      </div>
      <div className="avz-f">
        <span className="avz-t" role="status">
          {texto}
        </span>
        {a.tiempo ? <span className="avz-r">{t("avance.lleva", { tiempo: a.tiempo })}</span> : null}
      </div>
      {a.lento ? (
        <div className="avz-l" role="status">
          <IcAtencion {...ICONO} aria-hidden="true" />
          <span>{t("avance.lento")}</span>
          {estado.registro ? (
            <button type="button" className="avz-v" onClick={() => void fuente.archivoAbrir(estado.registro ?? "")}>
              {t("avance.verRegistro")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
