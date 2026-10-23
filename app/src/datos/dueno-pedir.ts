// Pide al main el nombre del dueño de la máquina una vez, antes de pintar (src/main.tsx). Sin puente o sin respuesta: "el usuario".
import { main } from "../puente";
import { nombreValido, ponerDueno } from "./dueno";

/** Pide el nombre al main; si tarda más de `tope` ms (el motor reconectando) se sigue sin él. */
export async function pedirDueno(tope = 1500): Promise<void> {
  const d = main?.dueno;
  if (!d) return;
  const espera = new Promise<null>((ok) => setTimeout(() => ok(null), tope));
  ponerDueno(await Promise.race([d.nombre().then(nombreValido, () => null), espera]));
}
