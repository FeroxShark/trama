// El control chico de una fila de la barra de cupos cuando su proveedor tiene varias cuentas: «En uso» (la que usan los líderes y
// workers nuevos) o «Usar primero», la misma acción que Ajustes > Plan y cupos (`cuentas preferir`). Nunca cambia de cuenta sola: sólo al tocar.
// La lista se lee rápida (sin verificar el login, la barra se repinta sola): al abrir, al volver a la ventana y después de elegir.
import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Boton } from "../ui/componentes";
import { fuente } from "../datos/fuente";
import type { ListaCuentas, PerfilCuenta, ResultadoCuenta } from "../datos/cuentas";
import { t, textoMain } from "../i18n";

/** La lista de cuentas para la barra; `releer` la vuelve a pedir (después de elegir). Sin `cuentas` instalado, `null`. */
export function useCuentasBarra(): [ListaCuentas | null, () => void] {
  const [lista, setLista] = useState<ListaCuentas | null>(null);
  const releer = useCallback(() => {
    void fuente.listaCuentas(false).then(setLista, () => setLista(null));
  }, []);
  useEffect(() => {
    releer();
    window.addEventListener("focus", releer);
    return () => window.removeEventListener("focus", releer);
  }, [releer]);
  return [lista, releer];
}

/** Una cuenta en uso (texto e ícono, no sólo color) o el botón «Usar primero» con su nombre. `alCambiar`: vuelve a leer la lista. */
export function ElegirCuenta({ perfil, alCambiar }: { perfil: PerfilCuenta; alCambiar: () => void }) {
  const [ocupada, setOcupada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usar = async () => {
    setOcupada(true);
    setError(null);
    const r = await fuente.preferirCuenta(perfil.id).catch((): ResultadoCuenta => ({ ok: false, error: "main.cuentasFallo" }));
    setOcupada(false);
    if (!r.ok) setError(textoMain(r.error));
    alCambiar();
  };

  if (perfil.preferida)
    return (
      <span className="g-acc-uso" data-tip={t("cu.enUsoQue")}>
        <Check size={11} strokeWidth={2.4} aria-hidden="true" />
        {t("cu.enUso")}
      </span>
    );
  return (
    <>
      <Boton
        className="g-acc-btn"
        disabled={ocupada}
        aria-label={t("cu.usarPrimeroDe", { nombre: perfil.nombre })}
        data-tip={t("cu.usarPrimeroQue")}
        onClick={() => void usar()}
      >
        {t("cu.usarPrimero")}
      </Boton>
      {error ? (
        <span className="g-acc-err" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
