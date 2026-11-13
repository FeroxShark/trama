import {
  CLAVE_ACOPLE,
  abrir,
  acopleDeFabrica,
  alternarPlegado,
  cerrar,
  leerAcople,
  mover,
  redimensionar,
  zonaDe,
  type Acople,
} from "./acople-logica";

export type ParamsInicialAcople = {
  captura: string | null;
  variante: string | null;
  datosFijos: boolean;
  consumo: boolean;
  vueltaAbierta: boolean | undefined;
  ancho: number;
  storage: (clave: string) => string | null;
};

export function acopleInicialBarra(p: ParamsInicialAcople): Acople {
  if (p.datosFijos) {
    let a = acopleDeFabrica();
    if (p.captura === "acople-app-movido") a = mover(a, "contexto", "izq");
    else if (p.captura === "acople-cupo") {
      a = alternarPlegado(a, "cupo");
      if (p.variante === "abajo") a = mover(a, "cupo", "abajo");
    } else if (p.captura === "oculta") a = cerrar(a, "chats");
    if (p.variante?.endsWith("-angosta") || p.variante?.endsWith("-300")) a = redimensionar(a, "izq", p.ancho);
    if (!p.consumo) {
      a = cerrar(a, "contexto");
      a = cerrar(a, "cupo");
    }
    return a;
  }

  const tieneAcople = p.storage(CLAVE_ACOPLE) !== null;
  let a = leerAcople(p.storage);
  if (!tieneAcople) {
    a = p.consumo ? abrir(a, "contexto") : cerrar(a, "contexto");
  }
  if (p.vueltaAbierta !== undefined) {
    a = p.vueltaAbierta ? abrir(a, "chats") : cerrar(a, "chats");
  }
  return a;
}

export function chatsAbiertoEn(a: Acople): boolean {
  return zonaDe(a, "chats") !== null;
}

export function contextoAbiertoEn(a: Acople): boolean {
  return zonaDe(a, "contexto") !== null;
}
