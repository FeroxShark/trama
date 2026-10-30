// Los avisos en línea del chat de un líder (B12): juntarlos sin repetir. Sin
// JSX ni imports de valores: lo prueba `tests/avisos.test.ts`.
//
// Un mismo problema suele llegar por varios lados: el límite de uso viene como
// `rate_limit_event` rechazado, como un `assistant` con `error: "rate_limit"` y
// como `result` con `is_error` (el mismo texto), y el `fin` del turno trae el
// error del `result` otra vez. Se ve una sola vez.
import type { AvisoLider } from "../datos/contrato";

/** `oculto`: no se pinta, pero su texto cuenta para no repetirlo (el error de límite tapado por el aviso de límite). */
export type AvisoVisto = AvisoLider & { oculto?: boolean };

const textoDe = (a: AvisoVisto) => (a.clase === "error" ? a.texto : a.clase === "salio" ? a.texto : null);
const rechazo = (a: AvisoVisto) => a.clase === "limite" && a.rechazado;
const deLimite = (a: AvisoVisto) => a.clase === "error" && a.codigo === "rate_limit";

/** Suma un aviso a los del turno, sin repetir lo que ya se dijo. Devuelve el mismo arreglo si no cambia nada. */
export function sumarAviso(avisos: AvisoVisto[], a: AvisoLider): AvisoVisto[] {
  switch (a.clase) {
    case "reintento":
      // Sólo el último intento: "reintenta (3/10)" reemplaza al (2/10).
      return [...avisos.filter((x) => x.clase !== "reintento"), a];
    case "limite": {
      // Uno por ventana (5 h, semana): el nuevo pisa al anterior. Rechazado, tapa el error de límite.
      const otros = avisos
        .filter((x) => !(x.clase === "limite" && x.ventana === a.ventana))
        .map((x) => (a.rechazado && deLimite(x) && !x.oculto ? { ...x, oculto: true } : x));
      return [...otros, a];
    }
    case "cuenta":
      // Una por turno: la de ahora (con la cuenta de antes) reemplaza a la que hubiera.
      return [...avisos.filter((x) => x.clase !== "cuenta"), a];
    case "error":
      if (avisos.some((x) => textoDe(x) === a.texto)) return avisos;
      return [...avisos, deLimite(a) && avisos.some(rechazo) ? { ...a, oculto: true } : a];
    case "salio":
      // El stderr que ya se vio como error no se repite: queda sólo "salió con código N".
      return [...avisos, a.texto && avisos.some((x) => textoDe(x) === a.texto) ? { ...a, texto: null } : a];
    default:
      return [...avisos, a];
  }
}

/** Llegó una respuesta (o terminó bien): el "reintentando" ya no corre. */
export const sinReintento = (avisos: AvisoVisto[]) =>
  avisos.some((x) => x.clase === "reintento") ? avisos.filter((x) => x.clase !== "reintento") : avisos;
