/* Detección segura y de sólo lectura de modelos y servidores locales (systemd, puertos típicos,
 * archivos GGUF en ~/models y arneses de ejecución como dsh, opencode y ollama).
 * PROHIBIDO arrancar servidores o tocar la GPU durante la detección: sólo lee archivos, units y
 * puertos ya abiertos. Arrancar un servidor sólo ocurre con acción explícita del usuario
 * (arrancarServidorLocal).
 */
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { COMANDO_INSTALAR_DSH } from './dsh-ajustes.ts';
import { resolverDsh } from './dsh.ts';
import { type Plataforma, plataformaActual } from './rutas.ts';
import { COMANDO_INSTALAR_OPENCODE, hayOpencode } from './opencode.ts';
import { leerEntornoOllama } from './ollama-entorno.ts';
import { textoT } from './errores.ts';

const S = '/';
const NL = '\n';

export type OrigenModelo = 'systemd' | 'puerto' | 'archivo' | 'ollama';
export type ServidorTipo = 'llama-server' | 'lm-studio' | 'vllm' | 'ollama' | 'desconocido';
export type EstadoServidor = 'prendido' | 'apagado';

export type ModeloDetectado = {
  id: string;
  nombre: string;
  origen: OrigenModelo;
  origenDetalle: string;
  servidor: ServidorTipo;
  estadoServidor: EstadoServidor;
  url: string;
  unit?: string;
  modelo: string;
  archivoGguf?: string;
  vramEstimadaMiB?: number | null;
  tamanoBytes?: number | null;
};

export type ArnesLocal = {
  id: 'dsh' | 'opencode' | 'ollama';
  nombre: string;
  instalado: boolean;
  version: string | null;
  comando: string;
};

/** Cada programa que sirve modelos locales: si está instalado, si anda y qué modelos se le ven. */
export type ServidorLocal = {
  id: Exclude<ServidorTipo, 'desconocido'>;
  nombre: string;
  instalado: boolean;
  version: string | null;
  /** 'andando' (contesta en su puerto), 'apagado' (instalado, no contesta) o 'no-instalado'. */
  estado: 'andando' | 'apagado' | 'no-instalado';
  puerto: number;
  /** Los ids (`ModeloDetectado.id`) de los modelos que se le vieron. */
  modelos: string[];
};

export type ResultadoDeteccion = {
  modelos: ModeloDetectado[];
  arneses: ArnesLocal[];
  servidores: ServidorLocal[];
  /** Para elegir la guía de instalación (Linux o Windows) y saber si hay units que prender. */
  plataforma: Plataforma;
  vramGpuMiB: number | null;
};

export type DepsDeteccion = {
  home: string;
  env: NodeJS.ProcessEnv;
  ejecutar: (bin: string, args: string[], o: { timeout: number }) => Promise<string>;
  leer: (archivo: string) => Promise<string | null>;
  listarDir: (dir: string) => Promise<string[]>;
  stat: (archivo: string) => Promise<{ size: number; isDirectory: boolean } | null>;
  pedirJson: (url: string, ms: number) => Promise<unknown | null>;
  puertoAbierto: (host: string, puerto: number, ms: number) => Promise<boolean>;
  leerVramGpu?: () => Promise<number | null>;
};

function puertoAbiertoReal(host: string, port: number, ms = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let terminado = false;
    const fin = (abierto: boolean) => {
      if (!terminado) {
        terminado = true;
        socket.destroy();
        resolve(abierto);
      }
    };
    socket.setTimeout(ms);
    socket.once('connect', () => fin(true));
    socket.once('timeout', () => fin(false));
    socket.once('error', () => fin(false));
    socket.connect(port, host);
  });
}

export function depsDeteccionDeVerdad(env: NodeJS.ProcessEnv = process.env): DepsDeteccion {
  const home = os.homedir();
  return {
    home,
    env,
    ejecutar: (bin, args, o) =>
      new Promise((ok, mal) => {
        execFile(bin, args, { timeout: o.timeout, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (e, stdout) =>
          e ? mal(e) : ok(String(stdout)),
        );
      }),
    leer: (f) => readFile(f, 'utf8').catch(() => null),
    listarDir: (d) => readdir(d).catch(() => []),
    stat: (f) => stat(f).then((s) => ({ size: s.size, isDirectory: s.isDirectory() }), () => null),
    pedirJson: async (url, ms) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'error' });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    puertoAbierto: (host, puerto, ms) => puertoAbiertoReal(host, puerto, ms),
    leerVramGpu: () => leerEntornoOllama().then((e) => e.gpu?.vramMiB ?? null, () => null),
  };
}

export function limpiarNombreUnit(desc: string, alias: string): string {
  const s = desc
    .replace(new RegExp('^llama-server\\s+', 'i'), '')
    .replace(new RegExp('\\s+en\\s+127\\.0\\.0\\.1.*$', 'i'), '')
    .replace(new RegExp('\\s*\\(fork\\s+[^)]+\\)', 'i'), '')
    .trim();
  return s || alias;
}

export function parsearUnit(
  contenido: string,
  unitName: string,
  home: string,
): {
  nombre: string;
  alias: string;
  modelo: string;
  port: number;
  host: string;
  url: string;
  ggufPath?: string;
} | null {
  const esLlama = new RegExp('llama-server|vllm', 'i').test(contenido) || new RegExp('llama', 'i').test(unitName);
  if (!esLlama) return null;

  const mDesc = new RegExp('^Description\\s*=\\s*(.+)', 'm').exec(contenido);
  const rawDesc = mDesc ? mDesc[1].trim() : '';

  const mExec = new RegExp('ExecStart\\s*=\\s*([^]+?)(?=' + NL + '\\s*[A-Z][a-zA-Z0-9_]*\\s*=|' + NL + '\\[|(?![^]))', 'm').exec(contenido);
  const execStr = mExec ? mExec[1].replace(new RegExp('\\\\' + NL + '\\s*', 'g'), ' ') : contenido;

  const mAlias = new RegExp('--alias\\s+([^\\s\\\\]+)').exec(execStr);
  const alias = mAlias ? mAlias[1] : unitName.replace(new RegExp('\\.service$'), '');
  const nombre = limpiarNombreUnit(rawDesc, alias);

  const mModel = new RegExp('(?:-m|--model)\\s+([^\\s\\\\]+)').exec(execStr);
  let ggufPath: string | undefined;
  if (mModel) {
    let p = mModel[1].replace(new RegExp('%h', 'g'), home);
    if (p.startsWith('~' + S)) {
      p = path.join(home, p.slice(2));
    }
    ggufPath = p;
  }

  const mPort = new RegExp('--port\\s+(\\d+)').exec(execStr);
  const port = mPort ? parseInt(mPort[1], 10) : 8080;

  const mHost = new RegExp('--host\\s+([^\\s\\\\]+)').exec(execStr);
  const host = mHost ? mHost[1] : '127.0.0.1';

  return {
    nombre,
    alias,
    modelo: alias,
    port,
    host,
    url: 'http:' + S + S + host + ':' + port,
    ggufPath,
  };
}

export async function detectarUnits(d: DepsDeteccion, plat: Plataforma = plataformaActual()): Promise<ModeloDetectado[]> {
  // Las units son de systemd: sin él (Windows, macOS) no hay nada que mirar ni `systemctl` que correr.
  if (plat !== 'linux') return [];
  const candidatos = new Set<string>();

  const dirUser = path.join(d.home, '.config', 'systemd', 'user');
  const archivos = await d.listarDir(dirUser);
  for (const f of archivos) {
    if (f.endsWith('.service') && (new RegExp('llama', 'i').test(f) || new RegExp('vllm', 'i').test(f) || new RegExp('lmstudio', 'i').test(f))) {
      candidatos.add(f);
    }
  }

  try {
    const listSalida = await d.ejecutar(
      'systemctl',
      ['--user', 'list-unit-files', '*llama*', '*vllm*', '*lmstudio*'],
      { timeout: 3000 },
    );
    for (const linea of listSalida.split('\n')) {
      const parte = linea.trim().split(new RegExp('\\s+'))[0];
      if (parte && parte.endsWith('.service')) {
        candidatos.add(parte);
      }
    }
  } catch {
  }

  const resultados: ModeloDetectado[] = [];
  for (const unit of Array.from(candidatos).sort()) {
    let contenido = await d.leer(path.join(dirUser, unit));
    if (!contenido) {
      try {
        contenido = await d.ejecutar('systemctl', ['--user', 'cat', unit], { timeout: 2000 });
      } catch {
        contenido = null;
      }
    }
    if (!contenido) continue;

    const parseado = parsearUnit(contenido, unit, d.home);
    if (!parseado) continue;

    let activo = false;
    try {
      const est = (await d.ejecutar('systemctl', ['--user', 'is-active', unit], { timeout: 1500 })).trim();
      activo = est === 'active';
    } catch {
      activo = false;
    }

    let tamanoBytes: number | null = null;
    let vramEstimadaMiB: number | null = null;
    if (parseado.ggufPath) {
      const st = await d.stat(parseado.ggufPath);
      if (st && st.size > 0) {
        tamanoBytes = st.size;
        const archivoMiB = Math.round(st.size / (1024 * 1024));
        vramEstimadaMiB = Math.round(archivoMiB * 1.15 + 1024);
      }
    }

    resultados.push({
      id: 'systemd:' + unit,
      nombre: parseado.nombre,
      origen: 'systemd',
      origenDetalle: unit,
      servidor: new RegExp('vllm', 'i').test(unit) ? 'vllm' : 'llama-server',
      estadoServidor: activo ? 'prendido' : 'apagado',
      url: parseado.url,
      unit,
      modelo: parseado.modelo,
      ...(parseado.ggufPath ? { archivoGguf: parseado.ggufPath } : {}),
      vramEstimadaMiB,
      tamanoBytes,
    });
  }

  return resultados;
}

const PUERTOS_CONOCIDOS: readonly { puerto: number; servidor: ServidorTipo }[] = [
  { puerto: 8080, servidor: 'llama-server' },
  { puerto: 1234, servidor: 'lm-studio' },
  { puerto: 8000, servidor: 'vllm' },
  { puerto: 11434, servidor: 'ollama' },
];

export async function detectarPuertos(
  d: DepsDeteccion,
  yaDetectados: ModeloDetectado[],
): Promise<ModeloDetectado[]> {
  const encontrados: ModeloDetectado[] = [];

  for (const { puerto, servidor } of PUERTOS_CONOCIDOS) {
    const abierto = await d.puertoAbierto('127.0.0.1', puerto, 300);
    if (!abierto) continue;

    const existente = yaDetectados.find((m) => {
      try {
        const u = new URL(m.url);
        return u.port === String(puerto);
      } catch {
        return false;
      }
    });

    if (existente && existente.estadoServidor === 'prendido') {
      continue;
    }

    const urlBase = 'http:' + S + S + '127.0.0.1:' + puerto;
    let json = await d.pedirJson(urlBase + S + 'v1' + S + 'models', 500);
    if (!json && puerto === 8080) {
      json = await d.pedirJson(urlBase + S + 'models', 500);
    }
    if (!json && puerto === 11434) {
      json = await d.pedirJson(urlBase + S + 'api' + S + 'tags', 500);
    }

    const modelosExtraidos: { id: string; tamano?: number }[] = [];
    if (json && typeof json === 'object') {
      const j = json as Record<string, unknown>;
      if (Array.isArray(j.data)) {
        for (const item of j.data) {
          if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
            modelosExtraidos.push({ id: item.id });
          }
        }
      } else if (Array.isArray(j.models)) {
        for (const item of j.models) {
          if (item && typeof item === 'object') {
            const mObj = item as Record<string, unknown>;
            const nom = typeof mObj.name === 'string' ? mObj.name : typeof mObj.id === 'string' ? mObj.id : null;
            if (nom) {
              const sz = typeof mObj.size === 'number' ? mObj.size : undefined;
              modelosExtraidos.push({ id: nom, tamano: sz });
            }
          }
        }
      }
    }

    if (modelosExtraidos.length > 0) {
      for (const m of modelosExtraidos) {
        const yaExiste = yaDetectados.some(
          (y) => y.modelo.toLowerCase() === m.id.toLowerCase() && y.url.includes(':' + puerto),
        );
        if (yaExiste) {
          if (existente) existente.estadoServidor = 'prendido';
          continue;
        }

        encontrados.push({
          id: 'puerto:' + puerto + ':' + m.id,
          nombre: m.id,
          origen: 'puerto',
          origenDetalle: servidor + ' (puerto ' + puerto + ')',
          servidor,
          estadoServidor: 'prendido',
          url: urlBase,
          modelo: m.id,
          tamanoBytes: m.tamano ?? null,
        });
      }
    } else if (existente) {
      existente.estadoServidor = 'prendido';
    }
  }

  return encontrados;
}

export async function detectarArchivosGguf(
  d: DepsDeteccion,
  yaDetectados: ModeloDetectado[],
): Promise<ModeloDetectado[]> {
  const encontrados: ModeloDetectado[] = [];
  const carpetas = [
    path.join(d.home, 'models'),
    path.join(d.home, '.cache', 'lm-studio', 'models'),
  ];

  const yaGgufs = new Set(
    yaDetectados
      .map((m) => m.archivoGguf?.toLowerCase())
      .filter((p): p is string => Boolean(p)),
  );

  function agregarGguf(nombreArchivo: string, rutaCompleta: string, bytes: number) {
    if (new RegExp('mmproj', 'i').test(nombreArchivo) || yaGgufs.has(rutaCompleta.toLowerCase())) return;
    yaGgufs.add(rutaCompleta.toLowerCase());

    const limpio = nombreArchivo.replace(new RegExp('\\.gguf$', 'i'), '').replace(new RegExp('[-_.]+', 'g'), ' ').trim();
    const archivoMiB = Math.round(bytes / (1024 * 1024));
    const vramEstimadaMiB = Math.round(archivoMiB * 1.15 + 1024);

    encontrados.push({
      id: 'archivo:' + rutaCompleta,
      nombre: limpio,
      origen: 'archivo',
      origenDetalle: rutaCompleta.replace(d.home, '~'),
      servidor: 'llama-server',
      estadoServidor: 'apagado',
      url: 'http:' + S + S + '127.0.0.1:8080',
      modelo: limpio.replace(new RegExp('\\s+', 'g'), '-').toLowerCase(),
      archivoGguf: rutaCompleta,
      vramEstimadaMiB,
      tamanoBytes: bytes,
    });
  }

  for (const dir of carpetas) {
    const hijos = await d.listarDir(dir);
    for (const h of hijos) {
      const rutaH = path.join(dir, h);
      const st = await d.stat(rutaH);
      if (!st) continue;

      if (!st.isDirectory && h.toLowerCase().endsWith('.gguf')) {
        if (yaGgufs.has(rutaH.toLowerCase())) continue;
        agregarGguf(h, rutaH, st.size);
      } else if (st.isDirectory) {
        const nietos = await d.listarDir(rutaH);
        for (const n of nietos) {
          if (n.toLowerCase().endsWith('.gguf')) {
            const rutaN = path.join(rutaH, n);
            if (yaGgufs.has(rutaN.toLowerCase())) continue;
            const stN = await d.stat(rutaN);
            if (stN && !stN.isDirectory) {
              agregarGguf(n, rutaN, stN.size);
            }
          }
        }
      }
    }
  }

  return encontrados;
}

export async function detectarArneses(d: DepsDeteccion, plat: Plataforma = plataformaActual()): Promise<ArnesLocal[]> {
  const arneses: ArnesLocal[] = [];

  let dshInstalado = false;
  let dshVersion: string | null = null;
  try {
    const rutaDsh = resolverDsh(d.env, d.home);
    dshInstalado = Boolean(rutaDsh);
    if (dshInstalado) {
      const v = await d.ejecutar(rutaDsh, ['--version'], { timeout: 1500 });
      dshVersion = v.trim() || null;
    }
  } catch {
    dshInstalado = false;
  }
  arneses.push({
    id: 'dsh',
    nombre: 'DeepSeek Harness (dsh)',
    instalado: dshInstalado,
    version: dshVersion,
    comando: COMANDO_INSTALAR_DSH,
  });

  let ocInstalado = false;
  try {
    ocInstalado = hayOpencode(d.env, d.home);
  } catch {
    ocInstalado = false;
  }
  arneses.push({
    id: 'opencode',
    nombre: 'OpenCode',
    instalado: ocInstalado,
    version: null,
    comando: COMANDO_INSTALAR_OPENCODE,
  });

  let ollamaInstalado = false;
  let ollamaVersion: string | null = null;
  try {
    // Windows no tiene `which`: `where` dice lo mismo (y sale con error si no está).
    const out = await d.ejecutar(plat === 'win32' ? 'where' : 'which', ['ollama'], { timeout: 1000 });
    ollamaInstalado = Boolean(out.trim());
    if (ollamaInstalado) {
      const v = await d.ejecutar('ollama', ['--version'], { timeout: 1000 });
      ollamaVersion = v.trim().replace(new RegExp('^ollama version is ', 'i'), '') || null;
    }
  } catch {
    ollamaInstalado = false;
  }
  arneses.push({
    id: 'ollama',
    nombre: 'Ollama',
    instalado: ollamaInstalado,
    version: ollamaVersion,
    comando: 'curl -fsSL https:' + S + S + 'ollama.com' + S + 'install.sh | sh',
  });

  return arneses;
}

const SERVIDORES: readonly { id: ServidorLocal['id']; nombre: string; puerto: number }[] = [
  { id: 'llama-server', nombre: 'llama.cpp (llama-server)', puerto: 8080 },
  { id: 'lm-studio', nombre: 'LM Studio', puerto: 1234 },
  { id: 'vllm', nombre: 'vLLM', puerto: 8000 },
  { id: 'ollama', nombre: 'Ollama', puerto: 11434 },
];

/** ¿Hay un ejecutable con ese nombre en el PATH? (`which`, o `where` en Windows; sólo busca, no corre nada del programa.) */
async function hayEnPath(d: DepsDeteccion, plat: Plataforma, bin: string): Promise<boolean> {
  try {
    return Boolean((await d.ejecutar(plat === 'win32' ? 'where' : 'which', [bin], { timeout: 1000 })).trim());
  } catch {
    return false;
  }
}

async function algunoExiste(d: DepsDeteccion, rutas: string[]): Promise<boolean> {
  for (const r of rutas) if (await d.stat(r)) return true;
  return false;
}

/**
 * Qué programa de modelos locales está instalado, cuál anda y qué modelos tiene cada uno. Sólo mira: PATH, rutas de instalación
 * típicas y puertos abiertos. Ninguna versión se pide a llama-server ni a vLLM (arrancarían la GPU); la de Ollama ya la trae `arneses`.
 */
export async function detectarServidores(
  d: DepsDeteccion,
  modelos: ModeloDetectado[],
  arneses: ArnesLocal[],
  plat: Plataforma = plataformaActual(),
): Promise<ServidorLocal[]> {
  const win = plat === 'win32';
  const appdata = d.env.LOCALAPPDATA || path.join(d.home, 'AppData', 'Local');
  const rutas: Record<ServidorLocal['id'], string[]> = {
    'llama-server': win
      ? [path.join(d.home, 'llama.cpp', 'build', 'bin', 'Release', 'llama-server.exe'), path.join(d.home, 'llama.cpp', 'llama-server.exe')]
      : [path.join(d.home, 'llama.cpp', 'build', 'bin', 'llama-server'), path.join(d.home, '.local', 'bin', 'llama-server')],
    'lm-studio': win
      ? [path.join(appdata, 'Programs', 'LM Studio', 'LM Studio.exe'), path.join(d.home, '.lmstudio', 'bin', 'lms.exe')]
      : [path.join(d.home, '.lmstudio', 'bin', 'lms'), path.join(d.home, '.cache', 'lm-studio')],
    vllm: [],
    ollama: [],
  };
  const resultado: ServidorLocal[] = [];
  for (const sv of SERVIDORES) {
    const suyos = modelos.filter((m) => m.servidor === sv.id);
    let instalado = false;
    let version: string | null = null;
    if (sv.id === 'ollama') {
      const a = arneses.find((x) => x.id === 'ollama');
      instalado = Boolean(a?.instalado);
      version = a?.version ?? null;
    } else if (sv.id === 'vllm') {
      // vLLM no tiene versión para Windows: sólo se lo busca en Linux.
      instalado = !win && (await hayEnPath(d, plat, 'vllm'));
    } else {
      const bin = sv.id === 'lm-studio' ? 'lms' : 'llama-server';
      instalado = (await hayEnPath(d, plat, bin)) || (await algunoExiste(d, rutas[sv.id]));
    }
    const prendidos = suyos.some((m) => m.estadoServidor === 'prendido');
    let andando = prendidos;
    if (!andando && (instalado || sv.id === 'ollama')) {
      try {
        andando = await d.puertoAbierto('127.0.0.1', sv.puerto, 300);
      } catch {
        andando = false;
      }
    }
    // Si anda es que está: aunque no se haya encontrado el ejecutable (instalado a mano en otra ruta).
    if (andando) instalado = true;
    resultado.push({
      id: sv.id,
      nombre: sv.nombre,
      instalado,
      version,
      estado: andando ? 'andando' : instalado ? 'apagado' : 'no-instalado',
      puerto: sv.puerto,
      modelos: suyos.map((m) => m.id),
    });
  }
  return resultado;
}

export async function detectarLocales(d: DepsDeteccion = depsDeteccionDeVerdad(), plat: Plataforma = plataformaActual()): Promise<ResultadoDeteccion> {
  const units = await detectarUnits(d, plat);
  const puertos = await detectarPuertos(d, units);
  const archivos = await detectarArchivosGguf(d, [...units, ...puertos]);
  const arneses = await detectarArneses(d, plat);

  let vramGpuMiB: number | null = null;
  try {
    vramGpuMiB = d.leerVramGpu ? await d.leerVramGpu() : null;
  } catch {
    vramGpuMiB = null;
  }

  const modelos = [...units, ...puertos, ...archivos].sort((a, b) => {
    if (a.estadoServidor === 'prendido' && b.estadoServidor !== 'prendido') return -1;
    if (a.estadoServidor !== 'prendido' && b.estadoServidor === 'prendido') return 1;
    return a.nombre.localeCompare(b.nombre);
  });

  const servidores = await detectarServidores(d, modelos, arneses, plat);
  return { modelos, arneses, servidores, plataforma: plat, vramGpuMiB };
}

export async function arrancarServidorLocal(
  unit: string,
  d: DepsDeteccion = depsDeteccionDeVerdad(),
): Promise<{ ok: boolean; error?: string }> {
  if (!unit || typeof unit !== 'string' || !new RegExp('^[a-zA-Z0-9_\\-.]+\\.service$').test(unit) || unit.includes(S)) {
    return { ok: false, error: 'Nombre de unit inválido' };
  }

  try {
    await d.ejecutar('systemctl', ['--user', 'start', unit], { timeout: 10000 });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Prender o apagar el servicio de un modelo detectado, con el clic del usuario. Sólo units de systemd (Linux) y sólo una que la
 * detección encuentre: no se le pasa a `systemctl` un nombre que alguien más escriba. Apagar libera la GPU; prender la ocupa.
 */
export async function controlarServidorLocal(
  accion: 'prender' | 'apagar',
  unit: unknown,
  d: DepsDeteccion = depsDeteccionDeVerdad(),
  plat: Plataforma = plataformaActual(),
): Promise<{ ok: boolean; error?: string }> {
  if (plat !== 'linux') return { ok: false, error: textoT('main.localesSinServicio') };
  if (accion !== 'prender' && accion !== 'apagar') return { ok: false, error: textoT('main.localesAccion') };
  if (typeof unit !== 'string') return { ok: false, error: textoT('main.localesUnit') };
  const conocidas = await detectarUnits(d, plat);
  if (!conocidas.some((m) => m.unit === unit)) return { ok: false, error: textoT('main.localesUnit') };
  if (accion === 'prender') return arrancarServidorLocal(unit, d);
  try {
    await d.ejecutar('systemctl', ['--user', 'stop', unit], { timeout: 15000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
