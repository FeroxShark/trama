// La cuenta de cuánto contexto (`-c` de llama-server) entra en la VRAM. Pura (sin `electron`, sin disco, sin
// procesos): la prueba `tests/locales-calc.test.ts`. Es una ESTIMACIÓN: lo que la confirma es "Probar", que carga el
// modelo de verdad (`electron/locales.ts`).
//
//   presupuesto = total − lo que ocupan los demás − lo que Handy/TTS piden si cargan − margen
//   entra       = pesos + fijo + KV(ctx)          con KV(ctx) = bytes por token × ctx
//
// "Los demás" es lo que dice nvidia-smi menos el propio llama-server (que se apaga para cargar otro valor).

export const MIB = 1024 * 1024;
/** Lo que se deja libre para el escritorio y lo que no se midió. */
export const MARGEN_MIB = 512;
/** llama-server redondea `n_ctx` a múltiplos de 256: los valores se normalizan a eso. */
export const MULTIPLO_CTX = 256;

/** Quién más usa la GPU y cuánto pide, con el proceso que lo delata (nombre de proceso o línea de comando). */
export const CONSUMIDORES: readonly { nombre: string; nominalMiB: number; reconoce: (proceso: string, cmd: string) => boolean }[] = [
  { nombre: "Handy", nominalMiB: Math.round(3.3 * 1024), reconoce: (p) => /(^|\/)handy$/i.test(p.trim()) },
  { nombre: "TTS", nominalMiB: Math.round(4.9 * 1024), reconoce: (_p, cmd) => cmd.includes("asistente-tts-qwen") },
];

export type AppGpu = { pid: number; proceso: string; miB: number };
export type Consumo = { nombre: string; nominalMiB: number; actualMiB: number };
export type Gpu = {
  totalMiB: number;
  usadoMiB: number;
  /** Lo que ocupa hoy un llama-server (el que se reemplaza al cargar otro valor). */
  llamaMiB: number;
  consumidores: Consumo[];
};

/** La salida de `nvidia-smi --query-gpu=memory.total,memory.used --format=csv,noheader,nounits` (MiB). */
export function parsearMemoria(salida: string): { totalMiB: number; usadoMiB: number } | null {
  const linea = salida.trim().split("\n")[0] ?? "";
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(linea);
  return m ? { totalMiB: Number(m[1]), usadoMiB: Number(m[2]) } : null;
}

/** La salida de `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits`. */
export function parsearApps(salida: string): AppGpu[] {
  const out: AppGpu[] = [];
  for (const l of salida.split("\n")) {
    const m = /^\s*(\d+)\s*,\s*(.*?)\s*,\s*(\d+)\s*$/.exec(l);
    if (m) out.push({ pid: Number(m[1]), proceso: m[2], miB: Number(m[3]) });
  }
  return out;
}

/** De la lista de procesos con GPU, lo que es un llama-server y lo que es de cada consumidor conocido. */
export function clasificar(apps: readonly AppGpu[], cmdlineDe: (pid: number) => string): { llamaMiB: number; consumidores: Consumo[] } {
  let llamaMiB = 0;
  const actual = new Map<string, number>();
  for (const a of apps) {
    if (/llama-server$/.test(a.proceso.trim())) {
      llamaMiB += a.miB;
      continue;
    }
    const cmd = cmdlineDe(a.pid);
    const c = CONSUMIDORES.find((x) => x.reconoce(a.proceso, cmd));
    if (c) actual.set(c.nombre, (actual.get(c.nombre) ?? 0) + a.miB);
  }
  return { llamaMiB, consumidores: CONSUMIDORES.map((c) => ({ nombre: c.nombre, nominalMiB: c.nominalMiB, actualMiB: actual.get(c.nombre) ?? 0 })) };
}

/** Lo que pesa el KV por token: capas con atención × (K + V) × cabezas KV × bytes por elemento. */
export type FormaKv = { capas: number; kvHeads: number; dimK: number; dimV: number; bytesPorElemento: number };
export const kvBytesPorToken = (k: FormaKv) => Math.ceil(k.capas * k.kvHeads * (k.dimK + k.dimV) * k.bytesPorElemento);
/** q8_0 guarda 32 elementos en 34 bytes. */
export const BYTES_Q8_0 = 34 / 32;

export type CuentaModelo = {
  /** Los archivos que van a la GPU (modelo y borrador, sin el mmproj que corre en CPU). */
  pesosMiB: number;
  /** Buffers de cómputo, el estado recurrente y el contexto CUDA: lo que no crece con `-c`. */
  fijoMiB: number;
  /** Lo que pesa el KV por token con el KV en q8_0 (la base: `kvBytesPorToken`); las opciones lo escalan. */
  kvBytesPorToken: number;
  ctxMin: number;
  ctxMax: number;
  /** De cuánto en cuánto sube el control. */
  paso: number;
  /** Lo que pesa el borrador MTP (va dentro de `pesosMiB`); sin dato, `MTP_MIB_DEFECTO`. 0: el modelo no tiene borrador. */
  mtpMiB?: number;
  /** Cuántas capas tiene el modelo (lo que `-ngl` reparte); sin dato, `CAPAS_DEFECTO`. */
  capasTotal?: number;
};

// ---------- las opciones de la unit (las 5 variables del env) ----------

export type TipoKv = "q8_0" | "q4_0" | "f16";
export const TIPOS_KV: readonly TipoKv[] = ["q8_0", "q4_0", "f16"];
/** Lo que se pide a la unit además del `-c`: `LLAMA_MTP`, `LLAMA_KV`, `LLAMA_KV_RAM` y `LLAMA_NGL`. */
export type Opciones = { mtp: boolean; kv: TipoKv; kvRam: boolean; ngl: number };
/** 99 = todas las capas en la GPU. */
export const NGL_TODAS = 99;
export const OPCIONES_DEFECTO: Opciones = { mtp: true, kv: "q8_0", kvRam: false, ngl: NGL_TODAS };
/** Bytes por elemento del KV: q8_0 guarda 32 en 34 bytes, q4_0 32 en 18, f16 2 por elemento. */
export const KV_BYTES: Record<TipoKv, number> = { q8_0: BYTES_Q8_0, q4_0: 18 / 32, f16: 2 };
/** Lo que ocupa el borrador MTP en la VRAM (1,5 a 1,9 GB). */
export const MTP_MIB_DEFECTO = 1700;
/** Capas de un Qwen3.8 27B (64 y la de salida): lo que `-ngl` reparte. */
export const CAPAS_DEFECTO = 65;
/** Lo que se deja libre de RAM para el sistema. */
export const MARGEN_RAM_MIB = 1024;

export const opcionesIguales = (a: Opciones, b: Opciones) => a.mtp === b.mtp && a.kv === b.kv && a.kvRam === b.kvRam && a.ngl === b.ngl;

/** Una opción suelta, validada; lo que no se entiende vuelve al default (nunca se rechaza: el env lo puede haber editado a mano). */
export function opcionesValidas(x: unknown): Opciones {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const ngl = typeof o.ngl === "number" && Number.isInteger(o.ngl) && o.ngl >= 0 ? Math.min(o.ngl, NGL_TODAS) : NGL_TODAS;
  return {
    mtp: typeof o.mtp === "boolean" ? o.mtp : OPCIONES_DEFECTO.mtp,
    kv: TIPOS_KV.includes(o.kv as TipoKv) ? (o.kv as TipoKv) : OPCIONES_DEFECTO.kv,
    kvRam: typeof o.kvRam === "boolean" ? o.kvRam : OPCIONES_DEFECTO.kvRam,
    ngl,
  };
}

/** Lo que de verdad ocupa cada recurso con unas opciones: pesos y KV repartidos entre la VRAM y la RAM. */
export type CuentaEfectiva = {
  /** Pesos que quedan en la GPU (con el borrador si hay MTP). */
  pesosGpuMiB: number;
  /** Pesos de las capas que no entran en la GPU: van a la RAM. */
  pesosRamMiB: number;
  kvGpuBytesPorToken: number;
  kvRamBytesPorToken: number;
};

/**
 * `-ngl` reparte los pesos del modelo (el borrador queda en la GPU) y el KV de esas capas va con ellas; con
 * `--no-kv-offload` (KV en RAM) todo el KV está en la RAM. Sin MTP no se carga el borrador. q4_0 / f16 cambian los bytes del KV.
 */
export function cuentaEfectiva(m: Pick<CuentaModelo, "pesosMiB" | "kvBytesPorToken" | "mtpMiB" | "capasTotal">, o: Opciones): CuentaEfectiva {
  const draft = Math.min(m.mtpMiB ?? MTP_MIB_DEFECTO, m.pesosMiB);
  const principal = m.pesosMiB - draft;
  const frac = Math.max(0, Math.min(1, o.ngl / (m.capasTotal ?? CAPAS_DEFECTO)));
  const kvTotal = o.kv === "q8_0" ? m.kvBytesPorToken : (m.kvBytesPorToken * KV_BYTES[o.kv]) / BYTES_Q8_0;
  const kvGpu = o.kvRam ? 0 : kvTotal * frac;
  return {
    pesosGpuMiB: principal * frac + (o.mtp ? draft : 0),
    pesosRamMiB: principal * (1 - frac),
    kvGpuBytesPorToken: kvGpu,
    kvRamBytesPorToken: kvTotal - kvGpu,
  };
}

/** La RAM de la máquina (`/proc/meminfo`): la disponible para programas y la total. */
export type Ram = { totalMiB: number; libreMiB: number };

export function parsearMeminfo(texto: string): Ram | null {
  const kb = (k: string) => {
    const m = new RegExp(`^${k}:\\s+(\\d+)\\s*kB`, "m").exec(texto);
    return m ? Number(m[1]) : null;
  };
  const total = kb("MemTotal");
  const libre = kb("MemAvailable");
  return total != null && libre != null ? { totalMiB: Math.round(total / 1024), libreMiB: Math.round(libre / 1024) } : null;
}

export type Estimacion = {
  totalMiB: number;
  /** Lo que ocupan los demás ahora (sin el llama-server que se reemplaza). */
  otrosMiB: number;
  /** Lo que Handy / TTS piden de más si cargan y hoy no están (o están a medias). */
  reservas: { nombre: string; miB: number }[];
  reservaMiB: number;
  margenMiB: number;
  /** Lo que le queda al modelo (pesos + fijo + KV). Puede ser negativo. */
  presupuestoMiB: number;
  /** Pesos en la GPU + fijo: lo que cuesta cargarlo antes del primer token. */
  modeloMiB: number;
  /** Los pesos que van a la GPU (con las opciones: sin borrador, con parte de las capas). */
  pesosGpuMiB: number;
  /** MiB de KV en la VRAM cada 1000 tokens (con el KV en RAM, 0). */
  kvMiBPorK: number;
  /** El mayor `-c` que entra (múltiplo de `paso`, entre `ctxMin` y `ctxMax`); 0 si ni el mínimo entra. */
  maxCtx: number;
  /** Lo mismo sin guardar lugar para Handy / TTS: lo que entra si no cargan. */
  maxCtxSinReservas: number;
  /** La RAM que usan las opciones: pesos de las capas fuera de la GPU y KV en RAM por cada 1000 tokens. */
  ramPesosMiB: number;
  ramKvMiBPorK: number;
  /** La RAM de la máquina (null si no se pudo leer). */
  ram: Ram | null;
  /** Lo que sobra de RAM para el KV (descontado el margen y los pesos); null sin dato. */
  ramSobraMiB: number | null;
};

/** Cuántos MiB pide un `-c` (pesos, fijo y KV) en la VRAM. */
export const necesitaMiB = (m: Pick<CuentaModelo, "pesosMiB" | "fijoMiB" | "kvBytesPorToken">, ctx: number) =>
  m.pesosMiB + m.fijoMiB + (m.kvBytesPorToken * ctx) / MIB;

/** Cuántos MiB de RAM pide un `-c` con esas opciones (pesos de las capas fuera de la GPU y KV en RAM). */
export const ramNecesitaMiB = (e: Pick<Estimacion, "ramPesosMiB" | "ramKvMiBPorK">, ctx: number) => e.ramPesosMiB + (e.ramKvMiBPorK * ctx) / 1000;

/** El mayor múltiplo de `paso` que entra en `sobraMiB` de KV, acotado; 0 si no llega al mínimo. */
export function ctxQueEntra(sobraMiB: number, m: CuentaModelo): number {
  if (!(sobraMiB > 0) || m.kvBytesPorToken <= 0) return 0;
  const tokens = Math.floor((sobraMiB * MIB) / m.kvBytesPorToken);
  const c = Math.min(m.ctxMax, Math.floor(tokens / m.paso) * m.paso);
  return c >= m.ctxMin ? c : 0;
}

/** Lo mismo con las dos memorias: lo que sobra de VRAM para el KV de la GPU y lo que sobra de RAM para el KV en RAM (null: sin dato). */
function ctxQueEntraCon(sobraVramMiB: number, sobraRamMiB: number | null, cu: CuentaEfectiva, m: CuentaModelo): number {
  if (sobraVramMiB < 0 || (sobraRamMiB != null && sobraRamMiB < 0)) return 0;
  const deVram = cu.kvGpuBytesPorToken > 0 ? (sobraVramMiB * MIB) / cu.kvGpuBytesPorToken : Infinity;
  const deRam = cu.kvRamBytesPorToken > 0 && sobraRamMiB != null ? (sobraRamMiB * MIB) / cu.kvRamBytesPorToken : Infinity;
  const tokens = Math.min(deVram, deRam);
  const c = Number.isFinite(tokens) ? Math.min(m.ctxMax, Math.floor(Math.floor(tokens) / m.paso) * m.paso) : m.ctxMax;
  return c >= m.ctxMin ? c : 0;
}

export function estimar(g: Gpu, m: CuentaModelo, margenMiB = MARGEN_MIB, opciones: Opciones = OPCIONES_DEFECTO, ram: Ram | null = null): Estimacion {
  const cu = cuentaEfectiva(m, opciones);
  const otrosMiB = Math.max(0, g.usadoMiB - g.llamaMiB);
  const reservas = g.consumidores.map((c) => ({ nombre: c.nombre, miB: Math.max(0, c.nominalMiB - c.actualMiB) })).filter((r) => r.miB > 0);
  const reservaMiB = reservas.reduce((s, r) => s + r.miB, 0);
  const libreMiB = g.totalMiB - otrosMiB - margenMiB;
  const modeloMiB = cu.pesosGpuMiB + m.fijoMiB;
  const ramSobraMiB = ram ? ram.libreMiB - MARGEN_RAM_MIB - cu.pesosRamMiB : null;
  return {
    totalMiB: g.totalMiB,
    otrosMiB,
    reservas,
    reservaMiB,
    margenMiB,
    presupuestoMiB: libreMiB - reservaMiB,
    modeloMiB,
    pesosGpuMiB: cu.pesosGpuMiB,
    kvMiBPorK: (cu.kvGpuBytesPorToken * 1000) / MIB,
    maxCtx: ctxQueEntraCon(libreMiB - reservaMiB - modeloMiB, ramSobraMiB, cu, m),
    maxCtxSinReservas: ctxQueEntraCon(libreMiB - modeloMiB, ramSobraMiB, cu, m),
    ramPesosMiB: cu.pesosRamMiB,
    ramKvMiBPorK: (cu.kvRamBytesPorToken * 1000) / MIB,
    ram,
    ramSobraMiB,
  };
}

/** Si `ctx` entra en la RAM con esas opciones (sin dato de RAM, sí: no se sabe). */
export const entraEnRam = (e: Pick<Estimacion, "ram" | "ramPesosMiB" | "ramKvMiBPorK">, ctx: number) =>
  e.ram == null || ramNecesitaMiB(e, ctx) <= e.ram.libreMiB - MARGEN_RAM_MIB;

/**
 * De las opciones, de la más rápida a la más lenta, la primera con la que `ctx` entra (VRAM y RAM; sin guardar lugar para
 * Handy / TTS: lo que hoy corre). Primero más precisión del KV y borrador; después sin MTP, KV más chico, KV en RAM y, al
 * final, capas en la RAM. `null` si con nada entra.
 */
export function mejorCombinacion(g: Gpu, m: CuentaModelo, ram: Ram | null, ctx: number, margenMiB = MARGEN_MIB): Opciones | null {
  const capas = m.capasTotal ?? CAPAS_DEFECTO;
  const candidatas: Opciones[] = [
    { mtp: true, kv: "q8_0", kvRam: false, ngl: NGL_TODAS },
    { mtp: true, kv: "q4_0", kvRam: false, ngl: NGL_TODAS },
    { mtp: false, kv: "q8_0", kvRam: false, ngl: NGL_TODAS },
    { mtp: false, kv: "q4_0", kvRam: false, ngl: NGL_TODAS },
    { mtp: true, kv: "q8_0", kvRam: true, ngl: NGL_TODAS },
    { mtp: true, kv: "q4_0", kvRam: true, ngl: NGL_TODAS },
    { mtp: false, kv: "q4_0", kvRam: true, ngl: NGL_TODAS },
  ];
  // Último recurso: el KV en RAM, sin MTP, y cada vez menos capas en la GPU (de a 4: cada una cuesta velocidad).
  for (let ngl = capas - 4; ngl > 0; ngl -= 4) candidatas.push({ mtp: false, kv: "q4_0", kvRam: true, ngl });
  return candidatas.find((o) => ctx <= estimar(g, m, margenMiB, o, ram).maxCtxSinReservas) ?? null;
}

/**
 * El `-c` pedido, validado: un entero entre el mínimo y el máximo del modelo, llevado al múltiplo de 256 de abajo
 * (llama-server lo redondea: así `n_ctx` que contesta es el mismo número que se escribió). `null` si no vale.
 */
export function ctxValido(v: unknown, ctxMin: number, ctxMax: number): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  const c = Math.floor(n / MULTIPLO_CTX) * MULTIPLO_CTX;
  return c >= ctxMin && c <= ctxMax ? c : null;
}

/**
 * Cambia el `contextWindow` de un modelo en un `settings.yaml` de dsh sin tocar nada más (comentarios, orden, el resto
 * de los modelos). `null` si no hay una entrada con ese id o no tiene `contextWindow`.
 */
export function conContextWindow(yaml: string, dshId: string, ctx: number): string | null {
  const lineas = yaml.split("\n");
  const inicio = lineas.findIndex((l) => new RegExp(`^\\s*-\\s+id:\\s*${dshId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(#.*)?$`).test(l));
  if (inicio < 0) return null;
  const sangria = (lineas[inicio].match(/^\s*/) ?? [""])[0].length;
  for (let i = inicio + 1; i < lineas.length; i++) {
    const l = lineas[i];
    const s = (l.match(/^\s*/) ?? [""])[0].length;
    // La siguiente entrada de la lista (o salir de ella) cierra el bloque de este modelo.
    if (l.trim() !== "" && !l.trim().startsWith("#") && s <= sangria) return null;
    const m = /^(\s*contextWindow:\s*)\d+(.*)$/.exec(l);
    if (m) {
      lineas[i] = `${m[1]}${ctx}${m[2]}`;
      return lineas.join("\n");
    }
  }
  return null;
}

/** El `contextWindow` que tiene hoy un modelo en ese yaml (o `null`). */
export function contextWindowDe(yaml: string, dshId: string): number | null {
  const lineas = yaml.split("\n");
  const inicio = lineas.findIndex((l) => new RegExp(`^\\s*-\\s+id:\\s*${dshId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(#.*)?$`).test(l));
  if (inicio < 0) return null;
  const sangria = (lineas[inicio].match(/^\s*/) ?? [""])[0].length;
  for (let i = inicio + 1; i < lineas.length; i++) {
    const l = lineas[i];
    const s = (l.match(/^\s*/) ?? [""])[0].length;
    if (l.trim() !== "" && !l.trim().startsWith("#") && s <= sangria) return null;
    const m = /^\s*contextWindow:\s*(\d+)/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

/** El valor de `LLAMA_CTX` de un env file de la unit (o `null`). */
export function ctxDeEnv(texto: string): number | null {
  const m = /^LLAMA_CTX=(\d+)\s*$/m.exec(texto);
  return m ? Number(m[1]) : null;
}

/** Las opciones de un env file (`LLAMA_MTP`, `LLAMA_KV`, `LLAMA_KV_RAM`, `LLAMA_NGL`); lo que falta o no se entiende vale el default. */
export function opcionesDeEnv(texto: string): Opciones {
  const v = (k: string) => new RegExp(`^${k}=(\\S+)\\s*$`, "m").exec(texto)?.[1];
  const mtp = v("LLAMA_MTP");
  const ram = v("LLAMA_KV_RAM");
  const ngl = v("LLAMA_NGL");
  return opcionesValidas({
    mtp: mtp === "1" ? true : mtp === "0" ? false : undefined,
    kv: v("LLAMA_KV"),
    kvRam: ram === "1" ? true : ram === "0" ? false : undefined,
    ngl: ngl != null && /^\d+$/.test(ngl) ? Number(ngl) : undefined,
  });
}

const CLAVES_ENV = ["LLAMA_CTX", "LLAMA_MTP", "LLAMA_KV", "LLAMA_KV_RAM", "LLAMA_NGL"] as const;

/**
 * El env file de la unit con las 5 variables escritas siempre (aunque valgan el default). Con el texto anterior conserva
 * todas las otras líneas (comentarios y variables ajenas) y cambia cada una de las cinco en su lugar; sin él arma uno nuevo.
 */
export function envDe(ctx: number, opciones: Opciones = OPCIONES_DEFECTO, previo?: string | null): string {
  const nuevas: Record<(typeof CLAVES_ENV)[number], string> = {
    LLAMA_CTX: String(ctx),
    LLAMA_MTP: opciones.mtp ? "1" : "0",
    LLAMA_KV: opciones.kv,
    LLAMA_KV_RAM: opciones.kvRam ? "1" : "0",
    LLAMA_NGL: String(opciones.ngl),
  };
  const puestas = new Set<string>();
  const lineas: string[] = [];
  for (const l of (previo ?? "# Lo escribe trama (Contexto del modelo local): lo lee la unit con EnvironmentFile.\n").replace(/\n+$/, "").split("\n")) {
    const k = /^\s*([A-Z_]+)=/.exec(l)?.[1] as (typeof CLAVES_ENV)[number] | undefined;
    if (k && k in nuevas) {
      if (puestas.has(k)) continue;
      puestas.add(k);
      lineas.push(`${k}=${nuevas[k]}`);
    } else lineas.push(l);
  }
  for (const k of CLAVES_ENV) if (!puestas.has(k)) lineas.push(`${k}=${nuevas[k]}`);
  return `${lineas.join("\n")}\n`;
}

/** El `n_ctx` que dice `/props` de llama-server (o `null` si no se entiende). */
export function nCtxDe(props: unknown): number | null {
  const p = props as { default_generation_settings?: { n_ctx?: unknown }; n_ctx?: unknown } | null;
  const n = p?.default_generation_settings?.n_ctx ?? p?.n_ctx;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Lo libre para el modelo con lo que corre ahora (sin contar a Handy/TTS por si cargan): total − los demás − margen. */
export const libreMiB = (e: Pick<Estimacion, "presupuestoMiB" | "reservaMiB">) => e.presupuestoMiB + e.reservaMiB;

/**
 * El `-c` fijo de una unit que NO lee `LLAMA_CTX` (la de antes de la plantilla de trama): el número de su `-c` /
 * `--ctx-size`. `null` si la unit lee `LLAMA_CTX` (el valor de trama rige) o si no se entiende.
 */
export function ctxFijoDeUnit(texto: string): number | null {
  const sinComentarios = texto
    .split("\n")
    .filter((l) => !/^\s*[#;]/.test(l))
    .join("\n");
  if (/\$\{?LLAMA_CTX\b/.test(sinComentarios)) return null;
  const m = /(?:^|\s)(?:-c|--ctx-size)[ =]+(\d+)\b/m.exec(sinComentarios);
  return m ? Number(m[1]) : null;
}

export type EstadoUnit = { activo: string; sub: string; reinicios: number };

/** `systemctl show -p ActiveState -p SubState -p NRestarts` → sus valores. */
export function estadoDeShow(texto: string): EstadoUnit {
  const v = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(texto)?.[1]?.trim() ?? "";
  return { activo: v("ActiveState"), sub: v("SubState"), reinicios: Number(v("NRestarts")) || 0 };
}

/**
 * Si la carga se cayó: el proceso murió y systemd lo va a relanzar (`auto-restart`), ya se relanzó desde que empezó
 * (`NRestarts` subió; `reset-failed` lo puede bajar a 0, por eso "distinto y > 0") o la unit quedó `failed`.
 * Con `Restart=on-failure` cada relanzo vuelve a leer los pesos y vuelve a caerse: esperar no sirve.
 */
export const seCayo = (s: EstadoUnit, reiniciosAntes: number) =>
  s.sub === "auto-restart" || s.activo === "failed" || (s.reinicios > 0 && s.reinicios !== reiniciosAntes);

/** Lo que dice llama-server (o CUDA) cuando no le alcanza la VRAM. */
const SIN_MEMORIA = /out of memory|cudaMalloc failed|failed to allocate|unable to allocate|alloc(?:ate)?_buffer.*failed|\bOOM\b/i;
/** Una línea que explica un fallo (no las de systemd diciendo que falló). */
const ERROR = /error|failed|fallo|cannot|unable|abort/i;

/**
 * Por qué no cargó, de lo que dejó el conmutador (stderr) y el journal de la unit: `sinMemoria` si fue
 * la VRAM; si no, la última línea que suena a error (sin las de systemd), cortada.
 */
export function motivoDeLog(texto: string): { sinMemoria: boolean; linea: string | null } {
  const lineas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lineas.some((l) => SIN_MEMORIA.test(l))) return { sinMemoria: true, linea: lineas.find((l) => SIN_MEMORIA.test(l))!.slice(0, 200) };
  const propias = lineas.filter((l) => !/systemd\[\d+\]|\.service:|^(?:Started|Stopped|Starting|Stopping) /.test(l));
  const linea = [...propias].reverse().find((l) => ERROR.test(l)) ?? propias.at(-1) ?? lineas.at(-1) ?? null;
  return { sinMemoria: false, linea: linea ? linea.slice(0, 200) : null };
}
