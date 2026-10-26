// Dictar con el micrófono: graba con MediaRecorder, lo pasa a WAV 16 kHz mono acá mismo
// (AudioContext + OfflineAudioContext: el motor no depende de ffmpeg) y el texto que vuelve se agrega al borrador.
// Lo puro (el WAV, el texto, el tope) lo prueba tests/dictado.test.ts; lo del navegador queda abajo, sin tocar nada al importar.

/** Lo más que se graba: 5 min (el main no acepta más: electron/dictado.ts). */
export const TOPE_S = 300;
/** Lo que pide `handy --transcribe-file`. */
export const WAV_HZ = 16000;

/** Por qué no se puede dictar: sin contexto seguro (el celular por http), o el navegador no sabe grabar. */
export type Soporte = "si" | "inseguro" | "sin";

/** ¿Se puede pedir el micrófono acá? `getUserMedia` exige contexto seguro (https o localhost): por http en la tailnet no hay. */
export function soporte(g: { isSecureContext?: boolean; navigator?: { mediaDevices?: { getUserMedia?: unknown } }; MediaRecorder?: unknown } = globalThis as never): Soporte {
  if (!g.isSecureContext) return "inseguro";
  return g.navigator?.mediaDevices?.getUserMedia && typeof g.MediaRecorder === "function" ? "si" : "sin";
}

/** Mínimo de cuántos segundos vale una grabación: menos es un toque sin querer. */
export const MINIMO_S = 0.4;

/** "0:07", "4:59": el contador del botón. */
export const reloj = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Lo dictado agregado al final de lo escrito, con un espacio entre los dos si hace falta. */
export function agregarDictado(texto: string, dictado: string): string {
  const d = dictado.trim();
  if (!d) return texto;
  if (!texto || /\s$/.test(texto)) return texto + d;
  return `${texto} ${d}`;
}

/** Muestras (-1..1) → WAV PCM de 16 bits, un canal, a `hz` (se escribe tal cual, sin remuestrear). */
export function codificarWav(muestras: Float32Array, hz = WAV_HZ): Uint8Array {
  const datos = muestras.length * 2;
  const out = new Uint8Array(44 + datos);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + datos, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, hz, true);
  v.setUint32(28, hz * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, datos, true);
  for (let i = 0; i < muestras.length; i++) {
    const m = Math.max(-1, Math.min(1, muestras[i]));
    v.setInt16(44 + i * 2, Math.round(m < 0 ? m * 0x8000 : m * 0x7fff), true);
  }
  return out;
}

/** Un fallo del micrófono con la clave del texto que lo explica (i18n). */
export class ErrorDictado extends Error {
  clave: string;
  constructor(clave: string) {
    super(clave);
    this.clave = clave;
  }
}

/** Una grabación en curso. `parar` devuelve lo grabado; `cancelar` lo tira. */
export type Grabacion = { parar(): Promise<Blob>; cancelar(): void };

/** Pide el micrófono y empieza a grabar. Rechaza con `ErrorDictado` (permiso negado, sin micrófono, sin soporte). */
export async function empezar(): Promise<Grabacion> {
  if (soporte() !== "si") throw new ErrorDictado(soporte() === "inseguro" ? "dictado.inseguro" : "dictado.sinSoporte");
  let flujo: MediaStream;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const n = (e as DOMException)?.name;
    throw new ErrorDictado(n === "NotAllowedError" || n === "SecurityError" ? "dictado.sinPermiso" : n === "NotFoundError" || n === "OverconstrainedError" ? "dictado.sinMicrofono" : "dictado.sinAcceso");
  }
  const soltar = () => flujo.getTracks().forEach((t) => t.stop());
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(flujo);
  } catch {
    soltar();
    throw new ErrorDictado("dictado.sinSoporte");
  }
  const trozos: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && trozos.push(e.data);
  rec.start();
  return {
    parar: () =>
      new Promise<Blob>((ok, mal) => {
        rec.onerror = () => {
          soltar();
          mal(new ErrorDictado("dictado.sinAcceso"));
        };
        rec.onstop = () => {
          soltar();
          ok(new Blob(trozos, { type: rec.mimeType || "audio/webm" }));
        };
        if (rec.state === "inactive") rec.onstop?.(new Event("stop"));
        else rec.stop();
      }),
    cancelar: () => {
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      soltar();
    },
  };
}

/** Lo grabado (webm, ogg, mp4…) → WAV 16 kHz mono: se decodifica sin abrir salida de audio y un `OfflineAudioContext` mezcla a un canal y remuestrea. */
export async function aWav(blob: Blob): Promise<Uint8Array> {
  try {
    const dec = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
    const fuera = new OfflineAudioContext(1, Math.max(1, Math.ceil(dec.duration * WAV_HZ)), WAV_HZ);
    const fuente = fuera.createBufferSource();
    fuente.buffer = dec;
    fuente.connect(fuera.destination);
    fuente.start();
    return codificarWav((await fuera.startRendering()).getChannelData(0), WAV_HZ);
  } catch {
    throw new ErrorDictado("dictado.noSeLee");
  }
}
