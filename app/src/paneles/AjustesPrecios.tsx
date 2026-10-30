// Precios de API para el costo equivalente de Estadísticas (precios.ts): los públicos de Anthropic, editables aquí. Lo que el
// usuario cambia se guarda en esta ventana (precios-guardados.ts); no toca modelos.json ni el reparto, así que no entra en el
// "Guardar" de Modelos. Un precio nuevo se pone a mano (0 = gratis); un modelo sin precio no suma al costo.
import { useEffect, useState } from "react";
import { Boton } from "../ui/componentes";
import { t } from "../i18n";
import { Cat } from "./AjustesNav";
import { PRECIOS_PUBLICOS, precioValido, tablaEfectiva, type Precio, type Tabla } from "./precios";
import { cambiarPrecio, guardarCambios, leerCambios } from "./precios-guardados";
import "./ajustes-precios.css";

const CAMPOS = ["entrada", "salida", "cacheLeido", "cacheEscrito"] as const;
type Campo = (typeof CAMPOS)[number];
/** Id de modelo como lo escribe `pa` / el transcript (sin espacios). */
const ID_VALIDO = /^[\w][\w.:/-]{0,120}$/;
const CERO: Precio = { entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0 };

export function AjustesPrecios() {
  const [cambios, setCambios] = useState<Tabla>(() => leerCambios());
  const [nuevo, setNuevo] = useState("");
  const tabla = tablaEfectiva(cambios);

  const poner = (modelo: string, campo: Campo, valor: number) => {
    const base = tabla[modelo] ?? CERO;
    setCambios(cambiarPrecio(cambios, modelo, { ...base, [campo]: valor }));
  };
  const agregar = () => {
    const id = nuevo.trim();
    if (!ID_VALIDO.test(id)) return;
    if (!(id in tabla)) setCambios(cambiarPrecio(cambios, id, CERO));
    setNuevo("");
  };
  const restaurarTodos = () => {
    guardarCambios({});
    setCambios({});
  };

  return (
    <Cat id="modelos" orden={4}>
      <section className="pn-sec ajp" aria-labelledby="ajp-titulo">
        <h2 className="pn-h" id="ajp-titulo">
          {t("ajustes.precios")}
        </h2>
        <div className="pn-nota">{t("ajustes.preciosIntro")}</div>

        <div className="ajp-tabla-caja">
          <table className="ajp-tabla">
            <thead>
              <tr>
                <th scope="col">{t("ajustes.precioModelo")}</th>
                {CAMPOS.map((c) => (
                  <th scope="col" key={c}>
                    {t(ETIQUETA[c])}
                  </th>
                ))}
                <th scope="col">
                  <span className="pn-h-sub">{t("ajustes.precioEstado")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(tabla).map((modelo) => {
                const cambiado = Object.hasOwn(cambios, modelo);
                const publico = Object.hasOwn(PRECIOS_PUBLICOS, modelo);
                return (
                  <tr key={modelo} data-cambiado={cambiado ? "" : undefined}>
                    <th scope="row" className="ajp-modelo">
                      {modelo}
                    </th>
                    {CAMPOS.map((c) => (
                      <td key={c}>
                        <CampoPrecio valor={tabla[modelo][c]} nombre={`${modelo} · ${t(ETIQUETA[c])}`} alCambiar={(x) => poner(modelo, c, x)} />
                      </td>
                    ))}
                    <td className="ajp-estado">
                      <span>{cambiado ? t("ajustes.precioCambiado") : publico ? t("ajustes.precioPublico") : t("ajustes.precioAgregado")}</span>
                      {cambiado ? (
                        <Boton onClick={() => setCambios(cambiarPrecio(cambios, modelo, null))} aria-label={`${modelo}: ${publico ? t("ajustes.precioVolver") : t("ajustes.precioQuitar")}`}>
                          {publico ? t("ajustes.precioVolver") : t("ajustes.precioQuitar")}
                        </Boton>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <form
          className="ajp-agregar"
          onSubmit={(ev) => {
            ev.preventDefault();
            agregar();
          }}
        >
          <input
            className="pn-campo"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("ajustes.precioIdEjemplo")}
            aria-label={t("ajustes.precioIdAgregar")}
            value={nuevo}
            aria-invalid={nuevo.trim() !== "" && !ID_VALIDO.test(nuevo.trim()) ? true : undefined}
            onChange={(ev) => setNuevo(ev.target.value)}
          />
          <Boton type="submit" disabled={!ID_VALIDO.test(nuevo.trim())}>
            {t("ajustes.precioAgregar")}
          </Boton>
          {Object.keys(cambios).length ? (
            <Boton onClick={restaurarTodos}>{t("ajustes.precioRestaurar")}</Boton>
          ) : null}
        </form>
      </section>
    </Cat>
  );
}

/** Un número de la tabla. Lo válido se guarda al tipear; lo que no sirve queda marcado (con texto) sin tocar el precio. */
function CampoPrecio({ valor, nombre, alCambiar }: { valor: number; nombre: string; alCambiar: (x: number) => void }) {
  const [texto, setTexto] = useState(String(valor));
  const [mal, setMal] = useState(false);
  // Si el precio cambia por fuera (volver al público), el campo lo muestra; si sólo es el mismo número tipeado, no se pisa.
  useEffect(() => {
    setTexto((prev) => (prev.trim() !== "" && Number(prev) === valor ? prev : String(valor)));
    setMal(false);
  }, [valor]);

  return (
    <div className="ajp-campo">
      <input
        className="pn-campo"
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        aria-label={nombre}
        aria-invalid={mal ? true : undefined}
        value={texto}
        onChange={(ev) => {
          const crudo = ev.target.value;
          setTexto(crudo);
          const n = crudo.trim() === "" ? null : precioValido(Number(crudo));
          setMal(n === null);
          if (n !== null) alCambiar(n);
        }}
      />
      {mal ? <span className="ajp-mal">{t("ajustes.precioMal")}</span> : null}
    </div>
  );
}

const ETIQUETA: Record<Campo, "ajustes.precioEntrada" | "ajustes.precioSalida" | "ajustes.precioLeido" | "ajustes.precioEscrito"> = {
  entrada: "ajustes.precioEntrada",
  salida: "ajustes.precioSalida",
  cacheLeido: "ajustes.precioLeido",
  cacheEscrito: "ajustes.precioEscrito",
};
