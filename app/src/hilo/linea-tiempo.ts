// La línea de tiempo de la tarjeta de actividad: lo que fue pasando en el turno de un líder, en orden. Aparte de `actividad-logica.ts` porque
// éste no importa nada de la vista (su test corre sin el hook de imports); `herramientas.ts` sí.
import type { Mensaje } from "../datos/contrato";
import { iconoDe, type Icono } from "./actividad-logica";
import { archivoDe, usosDe } from "./herramientas";
import type { ArchivoDeHerramienta } from "../../electron/archivo-ruta";

/** Cómo va una herramienta: sin resultado y la última del turno, corriendo; con resultado, ok o error; una anterior sin resultado, nada. */
export type EstadoLinea = "corriendo" | "ok" | "error" | null;

/**
 * Lo que va dejando un turno en la tarjeta, en el orden en que pasó (el panel de progreso de src/hilo/Actividad.tsx): cada
 * pensamiento ya terminado (uno por mensaje del modelo, nunca se reemplaza ni se junta con el siguiente) y cada herramienta que llamó.
 * Los textos que dice el agente no van acá: salen como siempre en la conversación. El pensamiento que todavía llega no es una línea:
 * lo escribe la tarjeta abajo y, al cerrarse el mensaje, pasa a ser la siguiente.
 */
export type LineaTiempo =
  | { tipo: "pensamiento"; key: string; texto: string }
  | { tipo: "herramienta"; key: string; icono: Icono; nombre: string; detalle: string; estado: EstadoLinea; /** El archivo que lee, escribe o edita (si es de archivo y trae la ruta). */ archivo?: ArchivoDeHerramienta };

export function lineaDeTiempo(msgs: Mensaje[], transcript: string | null = null): LineaTiempo[] {
  const out: LineaTiempo[] = [];
  const delModelo = msgs.filter((m) => m.rol === "assistant");
  delModelo.forEach((m, k) => {
    if (m.pensado?.trim()) out.push({ tipo: "pensamiento", key: `p${m.i}`, texto: m.pensado.trim() });
    const ultimo = k === delModelo.length - 1;
    usosDe(m.herramientas, m.det, transcript).forEach((u, j) => {
      const r = u.det?.resultado;
      const estado: EstadoLinea = r ? (r.error ? "error" : "ok") : ultimo ? "corriendo" : null;
      const icono = iconoDe({ que: "herramienta", nombre: u.nombre, detalle: u.resumen || null });
      const archivo = archivoDe(u);
      out.push({ tipo: "herramienta", key: `h${m.i}.${j}`, icono, nombre: u.nombre, detalle: u.resumen, estado, ...(archivo ? { archivo } : {}) });
    });
  });
  return out;
}
