// Ajustes > Conectores como tienda: de dónde salen los datos. Cada fuente se pide sólo cuando se la necesita (el catálogo de Descubrir puede bajar
// de internet, así que nunca antes de abrirlo) y falla por separado: un error de una no tira a las demás. El uso de 30 días llega aparte del
// inventario y se suma cuando el registro contesta. Nada de sondeo: se vuelve a leer al pedirlo o después de instalar, prender o quitar algo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { claveSkill as claveDe, usosDeHistorial, DIAS_USOS } from "../../electron/usos-historial";
import { fuentePaneles, type CatalogoDescubrir, type EstadoCatalogos, type Historial, type Inventario, type VistaServidorMcp } from "../datos/paneles";
import { mensaje } from "../puente";
import { usosPorConector } from "./conectores-vista";
import type { Pestana, Vista } from "./tienda-logica";

/** Una fuente que se pide la primera vez que está `activa` y se puede volver a leer. `poner` guarda lo que devolvió una acción (instalar, prender…). */
function useFuente<T>(leer: () => Promise<T>, activa: boolean) {
  const [datos, setDatos] = useState<T | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const vivo = useRef(true);
  const pedida = useRef(false);
  const ultima = useRef(leer);
  ultima.current = leer;
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);
  const cargar = useCallback(() => {
    pedida.current = true;
    setCargando(true);
    setFalla(null);
    void ultima.current().then(
      (r) => vivo.current && (setDatos(r), setCargando(false)),
      (x) => vivo.current && (setFalla(mensaje(x)), setCargando(false)),
    );
  }, []);
  useEffect(() => {
    if (activa && !pedida.current) cargar();
  }, [activa, cargar]);
  return { datos, falla, cargando, cargar, poner: setDatos };
}

export function useTiendaDatos(pestana: Pestana, vista: Vista) {
  const inv = useFuente<Inventario>(() => fuentePaneles.inventarioConectores(), true);
  const propios = useFuente<VistaServidorMcp[]>(() => fuentePaneles.listaMcp(), true);
  const catalogos = useFuente<EstadoCatalogos>(() => fuentePaneles.catalogosPlugins(), pestana === "plugins");
  const descubrir = useFuente<CatalogoDescubrir>(() => fuentePaneles.catalogoDescubrir(false), vista === "descubrir" && (pestana === "skills" || pestana === "mcp"));

  // El uso de los últimos 30 días llega aparte: la lista se ve de entrada y el uso se suma cuando el registro contesta.
  const [historial, setHistorial] = useState<Historial | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    void fuentePaneles.historial(DIAS_USOS).then(
      (h) => vivo && setHistorial(h),
      () => vivo && setHistorial({ version: 1, error: "no se pudo leer" }),
    );
    return () => void (vivo = false);
  }, []);
  const usos = useMemo(() => {
    if (!inv.datos || !historial) return null;
    const skills = inv.datos.items.filter((c) => c.tipo === "skill").map((c) => ({ clave: claveDe(c), nombre: c.nombre, origen: c.origen, de: c.de }));
    return usosDeHistorial(historial, skills);
  }, [inv.datos, historial]);
  const uso = useMemo(() => (inv.datos && historial !== undefined ? usosPorConector(inv.datos.items, usos) : null), [inv.datos, historial, usos]);
  // «Hoy» es el último día del registro (el main lo calcula con su reloj): sin fecha suelta en la interfaz.
  const hoy = historial && "hasta" in historial ? historial.hasta : null;

  return { inv, propios, catalogos, descubrir, uso, usos, hoy, usoCargando: historial === undefined };
}
