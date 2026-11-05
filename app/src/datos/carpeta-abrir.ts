// Pedir abrir una carpeta (`fuente.carpetaAbrir`): tres respuestas que la página no puede confundir. «abierta»;
// «no-carpeta» (el main contestó que no es una carpeta de esta máquina); y «app» (el pedido no llegó: el canal
// no está en el main que corre, típico de una ventana con la página nueva y el proceso viejo). Un rechazo va al
// log con `registrar` y NO se toma por «no es una carpeta».
export type ResultadoCarpeta = "abierta" | "no-carpeta" | "app";

export async function resultadoCarpeta(pedir: () => Promise<boolean>, registrar: (e: unknown) => void): Promise<ResultadoCarpeta> {
  try {
    return (await pedir()) ? "abierta" : "no-carpeta";
  } catch (e) {
    registrar(e);
    return "app";
  }
}
