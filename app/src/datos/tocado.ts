// Lo que el usuario tocó en el tablero nuevo y todavía no mandó (src/datos/pendientes.ts, `Respuestas`). Vive
// afuera del componente porque el panel se vuelve a montar cada vez que se abre, y en el main
// (`$HILOS_STATE/pendientes.json`, electron/pendientes.ts) para sobrevivir a un reinicio. Se carga una vez;
// cada cambio se guarda con un respiro (no por tecla) y al cerrar la ventana. En capturas y bench es sólo memoria.
import { useSyncExternalStore } from "react";
import { MODO } from "../modo";
import { main } from "../puente";
import type { ItemId } from "./tablero";
import { OTRA, podar, preguntaContestada, pruebaContestada, vacias, type ProyectoPend, type RespPregunta, type RespPrueba, type Respuestas } from "./pendientes";

const GUARDAR_MS = 300;

let estado: Respuestas = vacias();
let pedido = false;
let sucio = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const oyentes = new Set<() => void>();
const enDisco = !MODO.fixtures && !!main;

const avisar = () => oyentes.forEach((f) => f());
const poner = (r: Respuestas) => {
  estado = r;
  avisar();
  if (enDisco) {
    sucio = true;
    clearTimeout(timer);
    timer = setTimeout(guardar, GUARDAR_MS);
  }
};

/** Sólo lo contestado: una pregunta sin opción o una "otra" vacía no se guarda. */
function paraGuardar(r: Respuestas) {
  const q: Record<string, RespPregunta> = {};
  const p: Record<string, RespPrueba> = {};
  for (const [id, x] of Object.entries(r.q)) if (preguntaContestada(x)) q[id] = x;
  for (const [id, x] of Object.entries(r.p)) if (pruebaContestada(x)) p[id] = x;
  return { q, p };
}

function guardar() {
  clearTimeout(timer);
  if (!sucio || !main) return;
  sucio = false;
  void main.pendientes.guardar(paraGuardar(estado)).catch(() => {
    sucio = true;
  });
}

// Lo mismo que hace `volver.ts` con lo suyo: al recargar o cerrar, lo que esté esperando el respiro se va ya.
if (typeof addEventListener === "function") addEventListener("pagehide", guardar);

/** Lo que el main devolvió, ya limpio allá; acá sólo la forma. */
function desdeDisco(x: unknown): Respuestas {
  const r = vacias();
  const o = (x && typeof x === "object" ? x : {}) as { q?: Record<string, { op?: unknown; otra?: unknown }>; p?: Record<string, { res?: unknown; nota?: unknown }> };
  for (const [k, v] of Object.entries(o.q ?? {})) if (typeof v?.op === "string") r.q[Number(k)] = { op: v.op, otra: typeof v.otra === "string" ? v.otra : "" };
  for (const [k, v] of Object.entries(o.p ?? {}))
    if (v?.res === "anda" || v?.res === "no-anda") r.p[Number(k)] = { res: v.res, nota: typeof v.nota === "string" ? v.nota : "" };
  return r;
}

/** Para las capturas del proyecto abierto y del chat: un poco de todo contestado (items de `pendientesFijos`). */
export function muestraTocada(): Respuestas {
  const r = vacias();
  r.q[9002] = { op: "c", otra: "" };
  r.q[9004] = { op: OTRA, otra: "atlas-mapas, sin la fecha" };
  if (MODO.captura === "tablero-nuevo-avisar") {
    r.q[9001] = { op: "a", otra: "" };
    r.q[9021] = { op: "b", otra: "" };
  }
  r.p[9011] = { res: "anda", nota: "" };
  r.p[9012] = { res: "no-anda", nota: "Importa pero pierde los colores" };
  return r;
}
const deMuestra = () => (MODO.captura === "tablero-nuevo-proyecto" || MODO.captura === "tablero-nuevo-chat" || MODO.captura === "tablero-nuevo-avisar" ? muestraTocada() : vacias());

/** Trae lo guardado, una sola vez; lo que se tocó mientras tanto manda sobre lo viejo. */
export function cargarTocado(): void {
  if (pedido) return;
  pedido = true;
  if (!enDisco) {
    estado = deMuestra();
    avisar();
    return;
  }
  void main!.pendientes
    .leer()
    .then((x) => {
      const viejo = desdeDisco(x);
      estado = { q: { ...viejo.q, ...estado.q }, p: { ...viejo.p, ...estado.p } };
      avisar();
    })
    .catch(() => {});
}

export const tocadoAhora = () => estado;
export function suscribirTocado(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/** El estado de lo tocado, al día en el componente. */
export function useTocado(): Respuestas {
  return useSyncExternalStore(suscribirTocado, tocadoAhora);
}

export const tocarPregunta = (id: ItemId, x: RespPregunta) => poner({ ...estado, q: { ...estado.q, [id]: x } });
export const tocarPrueba = (id: ItemId, x: RespPrueba) => poner({ ...estado, p: { ...estado.p, [id]: x } });

/** Saca de lo tocado esos items (ya se mandaron). */
export function soltarTocado(ids: ReadonlySet<ItemId>): void {
  // Las claves del objeto son texto: un id de acá (número) y uno de otra máquina (`dell:12`) se comparan igual.
  const mandados = new Set([...ids].map(String));
  const sin = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([k]) => !mandados.has(k))) as Record<string, T>;
  poner({ q: sin(estado.q), p: sin(estado.p) });
}

/** Con el tablero recién leído: lo que ya no espera (se cerró, se movió, ya se mandó) deja de figurar. */
export function podarTocado(ps: readonly ProyectoPend[]): void {
  const n = podar(estado, ps);
  if (n !== estado) poner(n);
}
