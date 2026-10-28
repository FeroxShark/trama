/* Tests de detección segura de modelos locales (systemd, puertos, GGUF, arneses). */
import test from 'node:test';
import { soloPosix } from "./plataforma.ts";
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parsearUnit,
  limpiarNombreUnit,
  detectarUnits,
  detectarPuertos,
  detectarArchivosGguf,
  detectarArneses,
  detectarLocales,
  arrancarServidorLocal,
  depsDeteccionDeVerdad,
  type DepsDeteccion,
} from '../electron/locales-deteccion.ts';

const SAMPLE_QWEN_UNIT = `[Unit]
Description=llama-server Qwen3.8 27B HauhauCS (uncensored, multimodal, FastMTP) en 127.0.0.1:8080
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=simple
Environment=LLAMA_CTX=32768
EnvironmentFile=-%h/.config/trama/locales/hauhaucs.env
ExecStart=%h/llama.cpp/build/bin/llama-server \\
    -m %h/models/qwen38-27b/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf \\
    --mmproj %h/models/qwen38-27b/mmproj-Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-BF16.gguf \\
    --no-mmproj-offload \\
    --spec-draft-model %h/models/qwen38-27b/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-FastMTP-32K.gguf \\
    --host 127.0.0.1 --port 8080 --alias qwen38-uncensored \\
    -c DOLLAR{LLAMA_CTX} -ngl 99 --flash-attn on \\
    --cache-type-k q8_0 --cache-type-v q8_0 \\
    --reasoning-effort medium \\
    --threads 10 --batch-size 4096 --ubatch-size 1024 --parallel 1 \\
    --jinja
Restart=on-failure
RestartSec=5
`;

const SAMPLE_BONSAI_UNIT = `[Unit]
Description=llama-server Bonsai 2 27B (Ternary PQ2_0, fork PrismML) en 127.0.0.1:8080
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=simple
Environment=LLAMA_CTX=65536
EnvironmentFile=-%h/.config/trama/locales/bonsai.env
ExecStart=%h/llama.cpp-bonsai/build/bin/llama-server \\
    -m %h/models/bonsai2-27b/Ternary-Bonsai-2-27B-PQ2_0.gguf \\
    --host 127.0.0.1 --port 8080 --alias bonsai2-27b \\
    -c DOLLAR{LLAMA_CTX} -ngl 99 --flash-attn on \\
    --cache-type-k q8_0 --cache-type-v q8_0 \\
    --reasoning-effort medium \\
    --threads 10 --batch-size 4096 --ubatch-size 1024 --parallel 1 \\
    --jinja
Restart=on-failure
RestartSec=5
`;

test('limpiarNombreUnit limpia encabezado y sufijo de IP', () => {
  assert.equal(
    limpiarNombreUnit('llama-server Qwen3.8 27B HauhauCS en 127.0.0.1:8080', 'qwen'),
    'Qwen3.8 27B HauhauCS',
  );
  assert.equal(
    limpiarNombreUnit('llama-server Bonsai 2 27B (fork PrismML) en 127.0.0.1:8080', 'bonsai'),
    'Bonsai 2 27B',
  );
});

test('parsearUnit extrae datos de qwen-llama-server', () => {
  const p = parsearUnit(SAMPLE_QWEN_UNIT, 'qwen-llama-server.service', '/home/usuario');
  assert.ok(p);
  assert.equal(p.alias, 'qwen38-uncensored');
  assert.equal(p.modelo, 'qwen38-uncensored');
  assert.equal(p.port, 8080);
  assert.equal(p.host, '127.0.0.1');
  assert.equal(p.url, 'http://127.0.0.1:8080');
  assert.ok(p.nombre.includes('Qwen3.8 27B'));
});

test('parsearUnit extrae datos de bonsai', () => {
  const p = parsearUnit(SAMPLE_BONSAI_UNIT, 'qwen-llama-server-bonsai.service', '/home/usuario');
  assert.ok(p);
  assert.equal(p.alias, 'bonsai2-27b');
  assert.equal(p.port, 8080);
  assert.equal(p.url, 'http://127.0.0.1:8080');
  assert.ok(p.nombre.includes('Bonsai 2 27B'));
});

test('parsearUnit ignora units que no son llama-server ni vllm', () => {
  const p = parsearUnit(`Description=ssh daemon\nExecStart=bin`, 'sshd.service', '/home/usuario');
  assert.equal(p, null);
});

test('detectarUnits encuentra units y respeta estado apagado', { skip: soloPosix("units de systemd y ggufs bajo /home") }, async () => {
  const fakeDeps: DepsDeteccion = {
    home: '/home/usuario',
    env: {},
    ejecutar: async (bin, args) => {
      if (args[0] === '--user' && args[1] === 'is-active') return 'inactive\n';
      return '';
    },
    leer: async (f) => {
      if (f.endsWith('qwen-llama-server.service')) return SAMPLE_QWEN_UNIT;
      if (f.endsWith('qwen-llama-server-bonsai.service')) return SAMPLE_BONSAI_UNIT;
      return null;
    },
    listarDir: async () => ['qwen-llama-server.service', 'qwen-llama-server-bonsai.service', 'otro.service'],
    stat: async () => ({ size: 16 * 1024 * 1024 * 1024, isDirectory: false }),
    pedirJson: async () => null,
    puertoAbierto: async () => false,
  };

  const res = await detectarUnits(fakeDeps);
  assert.equal(res.length, 2);

  const qwen = res.find((r) => r.modelo === 'qwen38-uncensored');
  assert.ok(qwen);
  assert.equal(qwen.estadoServidor, 'apagado');
  assert.equal(qwen.servidor, 'llama-server');
  assert.equal(qwen.origen, 'systemd');
  assert.equal(qwen.url, 'http://127.0.0.1:8080');
  assert.ok(qwen.vramEstimadaMiB && qwen.vramEstimadaMiB > 16000);

  const bonsai = res.find((r) => r.modelo === 'bonsai2-27b');
  assert.ok(bonsai);
  assert.equal(bonsai.estadoServidor, 'apagado');
});

test('detectarPuertos detecta servidor prendido en puerto abierto', async () => {
  const fakeDeps: DepsDeteccion = {
    home: '/home/usuario',
    env: {},
    ejecutar: async () => '',
    leer: async () => null,
    listarDir: async () => [],
    stat: async () => null,
    pedirJson: async (url) => {
      if (url.includes(':1234/v1/models')) {
        return { data: [{ id: 'mistral-nemo-12b' }] };
      }
      return null;
    },
    puertoAbierto: async (_h, puerto) => puerto === 1234,
  };

  const res = await detectarPuertos(fakeDeps, []);
  assert.equal(res.length, 1);
  assert.equal(res[0].modelo, 'mistral-nemo-12b');
  assert.equal(res[0].servidor, 'lm-studio');
  assert.equal(res[0].estadoServidor, 'prendido');
  assert.equal(res[0].url, 'http://127.0.0.1:1234');
});

test('detectarArchivosGguf encuentra ggufs no cubiertos por units', { skip: soloPosix("units de systemd y ggufs bajo /home") }, async () => {
  const fakeDeps: DepsDeteccion = {
    home: '/home/usuario',
    env: {},
    ejecutar: async () => '',
    leer: async () => null,
    listarDir: async (d) => {
      if (d === '/home/usuario/models') return ['nuevo-modelo.gguf', 'mmproj-ignorar.gguf', 'carpeta'];
      if (d === '/home/usuario/models/carpeta') return ['submodelo.gguf'];
      return [];
    },
    stat: async (f) => {
      if (f.endsWith('carpeta')) return { size: 0, isDirectory: true };
      return { size: 8 * 1024 * 1024 * 1024, isDirectory: false };
    },
    pedirJson: async () => null,
    puertoAbierto: async () => false,
  };

  const res = await detectarArchivosGguf(fakeDeps, []);
  assert.equal(res.length, 2);
  assert.ok(res.some((r) => r.nombre.includes('nuevo modelo')));
  assert.ok(res.some((r) => r.nombre.includes('submodelo')));
  assert.ok(!res.some((r) => r.nombre.includes('mmproj')));
});

test('detectarArneses informa dsh, opencode y ollama instalados o con comando', async () => {
  const fakeDeps: DepsDeteccion = {
    home: '/home/usuario',
    env: { PATH: '/usr/bin' },
    ejecutar: async (_bin, args) => {
      if (args[0] === 'ollama') return '/usr/bin/ollama\n';
      if (args[0] === '--version') return 'ollama version is 0.5.1\n';
      return '';
    },
    leer: async () => null,
    listarDir: async () => [],
    stat: async () => null,
    pedirJson: async () => null,
    puertoAbierto: async () => false,
  };

  const arneses = await detectarArneses(fakeDeps);
  assert.equal(arneses.length, 3);
  const ids = arneses.map((a) => a.id);
  assert.deepEqual(ids, ['dsh', 'opencode', 'ollama']);
  for (const a of arneses) {
    assert.ok(a.comando.length > 5);
  }
});

test('seguridad: detectarLocales es estrictamente de sólo lectura', async () => {
  const llamadas: string[] = [];
  const fakeDeps: DepsDeteccion = {
    home: '/home/usuario',
    env: {},
    ejecutar: async (bin, args) => {
      llamadas.push(bin + ' ' + args.join(' '));
      return '';
    },
    leer: async () => null,
    listarDir: async () => [],
    stat: async () => null,
    pedirJson: async () => null,
    puertoAbierto: async () => false,
    leerVramGpu: async () => 24576,
  };

  const res = await detectarLocales(fakeDeps);
  assert.ok(res);
  for (const ll of llamadas) {
    assert.ok(!ll.includes('start'), 'No debe arrancar nada durante la detección: ' + ll);
    assert.ok(!ll.includes('restart'), 'No debe reiniciar nada durante la detección: ' + ll);
  }
});

test('arrancarServidorLocal valida nombres de unit y ejecuta systemctl start', async () => {
  const malas = ['../../../etc/passwd', 'invalido;bad', 'unit con espacios.service', ''];
  for (const m of malas) {
    const r = await arrancarServidorLocal(m, fakeDepsValidador);
    assert.equal(r.ok, false);
  }

  let comandoEjecutado = '';
  const fakeDepsOk: DepsDeteccion = {
    ...fakeDepsValidador,
    ejecutar: async (bin, args) => {
      comandoEjecutado = bin + ' ' + args.join(' ');
      return '';
    },
  };
  const rOk = await arrancarServidorLocal('qwen-llama-server.service', fakeDepsOk);
  assert.equal(rOk.ok, true);
  assert.equal(comandoEjecutado, 'systemctl --user start qwen-llama-server.service');
});

const fakeDepsValidador: DepsDeteccion = {
  home: '/home/usuario',
  env: {},
  ejecutar: async () => '',
  leer: async () => null,
  listarDir: async () => [],
  stat: async () => null,
  pedirJson: async () => null,
  puertoAbierto: async () => false,
};

// Sólo tiene sentido en la máquina del dueño (sus dos units de systemd); en CI y en otras máquinas se saltea.
const UNITS_DEL_DUENO = ['qwen-llama-server.service', 'qwen-llama-server-bonsai.service'];
const SIN_UNITS_DEL_DUENO = UNITS_DEL_DUENO.some((u) => !existsSync(path.join(os.homedir(), '.config', 'systemd', 'user', u)))
  ? 'esta máquina no tiene las units de llama-server del dueño'
  : false;

test('máquina real: detecta las dos units de llama-server del dueño y ambas están apagadas', { skip: SIN_UNITS_DEL_DUENO }, async () => {
  const realDeps = depsDeteccionDeVerdad();
  const res = await detectarUnits(realDeps);
  assert.ok(res.length >= 2, 'Deben detectarse al menos las 2 units del dueño');
  const qwen = res.find((r) => r.modelo === 'qwen38-uncensored');
  const bonsai = res.find((r) => r.modelo === 'bonsai2-27b');
  assert.ok(qwen, 'Debe encontrar qwen-llama-server');
  assert.ok(bonsai, 'Debe encontrar qwen-llama-server-bonsai');
  assert.equal(qwen.estadoServidor, 'apagado', 'qwen debe estar apagado');
  assert.equal(bonsai.estadoServidor, 'apagado', 'bonsai debe estar apagado');
  assert.equal(qwen.url, 'http://127.0.0.1:8080');
  assert.equal(bonsai.url, 'http://127.0.0.1:8080');
});
