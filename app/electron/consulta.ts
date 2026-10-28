// La query con que carga el frontend (la ventana, y quien entra por red): los modos y lo de
// preferencias.json. La arma main.ts para la ventana y motor.ts para el celular.
import os from "node:os";
import path from "node:path";
import { ESTADO } from "./estado.js";
import { identidadDe, type Identidad } from "./identidad.js";
import { leerMaquinas, SOLA } from "./maquinas-config.js";
import { aparienciaGuardada, avisarEsperaGuardado, avisarWorkersGuardado, avisoLiderGuardado, consumoGuardado, idiomaGuardado, tiernosGuardados, vistaGuardada } from "./preferencias.js";

/** Lo fijo: si hay fixtures, y con datos de verdad el nombre de esta máquina (ficha de cada worker) y el usuario (la carpeta del home en la barra). */
export function baseConsulta(fixtures: boolean): Record<string, string> {
  const q: Record<string, string> = { fixtures: fixtures ? "1" : "0" };
  if (fixtures) return q;
  q.maquina = os.hostname();
  try {
    q.usuario = os.userInfo().username;
  } catch {}
  return q;
}

/** `base` con lo que se elige en Ajustes, leído en cada carga (el idioma o la letra pudieron cambiar). `modo`: bench o captura, que no leen preferencias. */
export function crearConsulta(base: Record<string, string>, modo: boolean): () => Record<string, string> {
  return () => {
    const q = { ...base };
    // El idioma va en la query como los modos: el primer render ya sale en el bueno.
    const env = process.env.HILOS_IDIOMA;
    q.idioma = env === "en" || env === "es" ? env : modo ? "en" : (idiomaGuardado() ?? "en");
    // Los mensajes tiernos, igual: sólo viajan cuando están apagados.
    const tiernos = process.env.HILOS_TIERNOS;
    if (tiernos ? tiernos === "0" : !modo && !tiernosGuardados()) q.tiernos = "0";

    // El aviso de "te espera", igual: sólo viaja cuando está apagado.
    const avisar = process.env.HILOS_AVISAR;
    if (avisar ? avisar === "0" : !modo && !avisarEsperaGuardado()) q.avisar = "0";
    // El de los workers, igual (`avisarw`).
    const avisarW = process.env.HILOS_AVISAR_WORKERS;
    if (avisarW ? avisarW === "0" : !modo && !avisarWorkersGuardado()) q.avisarw = "0";
    // El aviso al líder (por tanda o por worker), igual: sólo viaja cuando es por worker (el default es la tanda).
    if (!modo && avisoLiderGuardado() === "worker") q.avisolider = "worker";

    // El tamaño de letra y las fuentes, igual (el renderer valida: src/tipografia.ts).
    const guardada = modo ? {} : aparienciaGuardada();
    const letra = process.env.HILOS_LETRA ?? guardada.letra;
    const fuente = process.env.HILOS_FUENTE ?? guardada.fuente;
    const mono = process.env.HILOS_MONO ?? guardada.mono;
    const tema = process.env.HILOS_TEMA ?? guardada.tema;
    if (tema) q.tema = tema;
    if (letra) q.letra = String(letra);
    if (fuente) q.fuente = fuente;
    if (mono) q.mono = mono;
    // La vista de la barra (todo o sólo líderes), igual: sin salto al abrir.
    const vista = process.env.HILOS_VISTA ?? (modo ? null : vistaGuardada());
    if (vista) q.vista = vista;
    // El panel de consumo, igual: sólo viaja cuando está a la vista.
    const consumo = process.env.HILOS_CONSUMO;
    if (consumo ? consumo === "1" : !modo && consumoGuardado()) q.consumo = "1";
    return q;
  };
}

/**
 * Quién es esta máquina para el celular (título, color, manifest, ícono de la página que se sirve), leído de
 * `maquinas.json` en cada pedido de la página: un archivo chico, y sólo cuando alguien abre trama por la red.
 * Sin el archivo (o roto: no se adivina) es la de siempre.
 */
export function identidadEsta(): Identidad {
  const c = leerMaquinas(path.join(ESTADO, "maquinas.json"));
  return identidadDe("error" in c ? SOLA : c);
}
