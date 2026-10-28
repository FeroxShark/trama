// Ajustes > Locales, lo que Trama detecta (llama.cpp, LM Studio, vLLM, Ollama): las guías cortas de instalación para Linux y Windows,
// con qué arnés corre un modelo y cómo se lo elige como motor de workers o de líder. Puro: sin red, sin GPU y sin hablar con el main.
import type { ModeloDetectado, ServidorLocal } from "../../electron/locales-deteccion";
import type { Plataforma } from "../../electron/rutas";
import type { ClaveSola } from "../i18n";
import { agregarLocal, elegirLider, elegirWorker, type Borrador } from "./modelos-borrador";

/** Con qué programa corre un modelo local: `claude` (el mismo Claude Code contra su dirección, id `ollama:…`) o `dsh` (`dsh:ollama/…`). */
export type ArnesUso = "claude" | "dsh";
export const ARNESES_USO: readonly ArnesUso[] = ["claude", "dsh"];

/** Para qué se lo usa: los workers (el tipo `default`, que cubre a los que no tienen elección propia) o el líder. */
export type RolUso = "workers" | "lider";

export type GuiaServidor = {
  /** Comando para copiar; null si se baja de una página. */
  instalar: string | null;
  /** La página de descarga, si hace falta. */
  web: string | null;
  notaInstalar: ClaveSola;
  /** Cómo se arranca ya instalado (para copiar). Null si no hay forma por línea de comandos. */
  arrancar: string | null;
  notaArrancar: ClaveSola;
};

type Plat = Exclude<Plataforma, "darwin">;

const GUIAS: Record<ServidorLocal["id"], Record<Plat, GuiaServidor>> = {
  "llama-server": {
    linux: {
      instalar: "git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp && cmake -B build -DGGML_CUDA=ON && cmake --build build --config Release -j",
      web: null,
      notaInstalar: "ajustes.locIns_llama_linux",
      arrancar: "llama-server -m ~/models/modelo.gguf --port 8080 -ngl 99",
      notaArrancar: "ajustes.locArr_llama",
    },
    win32: {
      instalar: "winget install llama.cpp",
      web: null,
      notaInstalar: "ajustes.locIns_llama_win32",
      arrancar: "llama-server -m C:\\models\\modelo.gguf --port 8080 -ngl 99",
      notaArrancar: "ajustes.locArr_llama",
    },
  },
  "lm-studio": {
    linux: { instalar: null, web: "https://lmstudio.ai/download", notaInstalar: "ajustes.locIns_lms_linux", arrancar: "~/.lmstudio/bin/lms server start", notaArrancar: "ajustes.locArr_lms" },
    win32: { instalar: "winget install ElementLabs.LMStudio", web: null, notaInstalar: "ajustes.locIns_lms_win32", arrancar: "lms server start", notaArrancar: "ajustes.locArr_lms" },
  },
  vllm: {
    linux: { instalar: "python3 -m venv ~/vllm && ~/vllm/bin/pip install vllm", web: null, notaInstalar: "ajustes.locIns_vllm_linux", arrancar: "~/vllm/bin/vllm serve <modelo> --port 8000", notaArrancar: "ajustes.locArr_vllm" },
    win32: { instalar: null, web: null, notaInstalar: "ajustes.locIns_vllm_win32", arrancar: null, notaArrancar: "ajustes.locArr_vllm" },
  },
  ollama: {
    linux: { instalar: "curl -fsSL https://ollama.com/install.sh | sh", web: null, notaInstalar: "ajustes.locIns_ollama_linux", arrancar: "ollama serve", notaArrancar: "ajustes.locArr_ollama_linux" },
    win32: { instalar: "winget install Ollama.Ollama", web: null, notaInstalar: "ajustes.locIns_ollama_win32", arrancar: null, notaArrancar: "ajustes.locArr_ollama_win32" },
  },
};

/** La guía del programa para esta plataforma (macOS no es una plataforma de Trama: se muestra la de Linux). */
export const guiaDe = (id: ServidorLocal["id"], plat: Plataforma): GuiaServidor => GUIAS[id][plat === "win32" ? "win32" : "linux"];

/** El id que se guarda en `modelos.json` / lideres.json para ese modelo con ese arnés. */
export const idUso = (m: ModeloDetectado, arnes: ArnesUso): string => (arnes === "dsh" ? `dsh:ollama/${m.modelo}` : `ollama:${m.modelo}`);

/** ¿Ya es el motor de ese rol, con cualquiera de los dos arneses? Devuelve con cuál (o null). */
export function usoActual(b: Borrador, m: ModeloDetectado, rol: RolUso): ArnesUso | null {
  const actual = rol === "lider" ? b.lider?.modelo : b.workers.default?.modelo;
  return ARNESES_USO.find((a) => idUso(m, a) === actual) ?? null;
}

/** Lo que se agrega al borrador: el modelo como local (queda en los menús) y se lo pone de motor del rol con ese arnés. */
export function usarComo(b: Borrador, m: ModeloDetectado, arnes: ArnesUso, rol: RolUso): Borrador {
  const con = agregarLocal(b, m.url, m.modelo);
  const id = idUso(m, arnes);
  return rol === "lider" ? elegirLider(con, id) : elegirWorker(con, "default", id);
}

/** MiB → «12,0 GB» (o «12.0 GB»): la VRAM se dice en GB. */
export const gbDeMiB = (miB: number, coma: boolean): string => {
  const t = (miB / 1024).toFixed(1);
  return coma ? t.replace(".", ",") : t;
};

/** Otro modelo del mismo servidor y puerto que ya está prendido: dos en el mismo puerto no entran a la vez. */
export const choqueDePuerto = (m: ModeloDetectado, todos: ModeloDetectado[]): ModeloDetectado | null =>
  todos.find((o) => o.id !== m.id && o.estadoServidor === "prendido" && o.url === m.url && o.servidor === m.servidor) ?? null;
