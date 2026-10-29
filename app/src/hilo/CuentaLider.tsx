// La cuenta de Claude de un líder: un selector junto al modelo, sólo cuando hay más de una cuenta de Claude (y el líder es de esta máquina).
// Un líder nuevo nace con la que se usa primero (Ajustes > Cuentas > «Usar primero»); la persona puede elegir otra y esa elección es suya: Trama nunca
// pasa sola de una cuenta a otra, ni cuando se agota el cupo. Cambiarla en un líder que ya existe vale desde su próximo mensaje.
import { useCallback, useEffect, useMemo, useState } from "react";
import { fuente } from "../datos/fuente";
import { deProveedor, etiquetaCuenta, type ListaCuentas } from "../datos/cuentas";
import { t as tr } from "../i18n";
import { Selector, type Opcion } from "./Selector";

/** Las cuentas de Claude (la de siempre primero), o `[]` si hay una sola o no se sabe: sin dónde elegir no se muestra nada. */
export function cuentasDeClaude(l: ListaCuentas | null) {
  const c = deProveedor(l, "claude");
  return c.length > 1 ? c : [];
}

/** La lista liviana (sin preguntar los logins), al montar y al volver a la ventana. */
function useCuentasClaude(): ListaCuentas | null {
  const [lista, setLista] = useState<ListaCuentas | null>(null);
  const mirar = useCallback(() => {
    void fuente.listaCuentas(false).then(setLista, () => undefined);
  }, []);
  useEffect(() => {
    mirar();
    window.addEventListener("focus", mirar);
    return () => window.removeEventListener("focus", mirar);
  }, [mirar]);
  return lista;
}

/**
 * `valor`: el id de la cuenta con que corre (`"claude"` = la de siempre); `null` = sin elegir todavía (un líder nuevo: vale la preferida).
 * `alElegir` recibe el id elegido; quien llama decide si lo guarda para el primer mensaje o se lo manda al main.
 */
export function CuentaLider({ valor, alElegir, disabled, abierto }: { valor: string | null; alElegir: (id: string) => void; disabled?: boolean; abierto?: boolean }) {
  const lista = useCuentasClaude();
  const cuentas = cuentasDeClaude(lista);
  const opciones = useMemo<Opcion[]>(
    () =>
      cuentas.map((c) => ({
        id: c.id,
        nombre: etiquetaCuenta("claude", c.nombre, c.defecto, tr("cuentas.principal")),
        desc: c.logueado === false ? tr("cuenta.lider.sinLogin") : c.preferida ? tr("cuenta.lider.enUso") : tr("cuenta.lider.otra"),
      })),
    [cuentas],
  );
  if (!opciones.length) return null;
  const elegida = valor && opciones.some((o) => o.id === valor) ? valor : (cuentas.find((c) => c.preferida) ?? cuentas[0]).id;
  return <Selector etiqueta={tr("cuenta.lider.etiqueta")} opciones={opciones} valor={elegida} alElegir={alElegir} disabled={disabled} abierto={abierto} />;
}
