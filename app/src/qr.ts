// Un generador de códigos QR sin dependencias, para que Ajustes > Celular dibuje la dirección de trama sin mandarla a ningún
// servicio. Modo de bytes (UTF-8), corrección de errores M y versiones 1 a 10 (hasta 213 bytes: sobra para una URL). Devuelve la
// matriz de módulos (`true` = oscuro); `qrSvg` la dibuja como un solo camino. Lo prueba tests/qr.test.ts (decodificado con zbar).

/** Parámetros del nivel M, por versión (índice 1 a 10): palabras de corrección por bloque y cantidad de bloques. */
const ECC_POR_BLOQUE = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOQUES = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const VERSION_MAX = 10;

/** Los módulos de datos (y de corrección) de una versión: lo que queda sin patrones fijos. */
function modulosCrudos(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    r -= (25 * a - 10) * a - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

const palabrasDatos = (v: number) => Math.floor(modulosCrudos(v) / 8) - ECC_POR_BLOQUE[v] * BLOQUES[v];

// Aritmética de GF(256) con el polinomio 0x11D.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** El resto de dividir `datos` por el generador de grado `n` (las palabras de corrección). */
function resto(datos: number[], n: number): number[] {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const sig = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      sig[j] ^= gen[j];
      sig[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = sig;
  }
  const r = new Array<number>(n).fill(0);
  for (const d of datos) {
    const f = d ^ r.shift()!;
    r.push(0);
    for (let i = 0; i < n; i++) r[i] ^= mul(gen[i + 1], f);
  }
  return r;
}

/** Los bytes del texto, en el mensaje de datos de la versión `v` (con cabecera, relleno y terminador). */
function mensaje(bytes: Uint8Array, v: number): number[] {
  const bits: number[] = [];
  const poner = (valor: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  poner(0b0100, 4);
  poner(bytes.length, v >= 10 ? 16 : 8);
  for (const b of bytes) poner(b, 8);
  const total = palabrasDatos(v) * 8;
  poner(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  const palabras: number[] = [];
  for (let i = 0; i < bits.length; i += 8) palabras.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; palabras.length < palabrasDatos(v); pad ^= 0xec ^ 0x11) palabras.push(pad);
  return palabras;
}

/** Parte los datos en bloques, les suma su corrección y los intercala. */
function intercalar(datos: number[], v: number): number[] {
  const nb = BLOQUES[v];
  const ecc = ECC_POR_BLOQUE[v];
  const crudas = Math.floor(modulosCrudos(v) / 8);
  const cortos = nb - (crudas % nb);
  const largoCorto = Math.floor(crudas / nb);
  const bloques: number[][] = [];
  const correcciones: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const largo = largoCorto - ecc + (i < cortos ? 0 : 1);
    const dat = datos.slice(k, k + largo);
    k += largo;
    bloques.push(dat);
    correcciones.push(resto(dat, ecc));
  }
  const fuera: number[] = [];
  const maxDat = Math.max(...bloques.map((b) => b.length));
  for (let i = 0; i < maxDat; i++) for (const b of bloques) if (i < b.length) fuera.push(b[i]);
  for (let i = 0; i < ecc; i++) for (const c of correcciones) fuera.push(c[i]);
  return fuera;
}

const posicionesAlineacion = (v: number): number[] => {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const tam = v * 4 + 17;
  const paso = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let p = tam - 7; r.length < n; p -= paso) r.splice(1, 0, p);
  return r;
};

type Matriz = { tam: number; mod: boolean[][]; fijo: boolean[][] };

function patrones(v: number): Matriz {
  const tam = v * 4 + 17;
  const mod = Array.from({ length: tam }, () => new Array<boolean>(tam).fill(false));
  const fijo = Array.from({ length: tam }, () => new Array<boolean>(tam).fill(false));
  const poner = (x: number, y: number, oscuro: boolean) => {
    mod[y][x] = oscuro;
    fijo[y][x] = true;
  };
  for (let i = 0; i < tam; i++) {
    poner(6, i, i % 2 === 0);
    poner(i, 6, i % 2 === 0);
  }
  const buscador = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= tam || y >= tam) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        poner(x, y, d !== 2 && d !== 4);
      }
  };
  buscador(3, 3);
  buscador(tam - 4, 3);
  buscador(3, tam - 4);
  const pos = posicionesAlineacion(v);
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) poner(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  // Los lugares del formato y de la versión se reservan; su contenido va después.
  for (let i = 0; i < 9; i++) {
    fijo[8][i] = true;
    fijo[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    fijo[8][tam - 1 - i] = true;
    fijo[tam - 1 - i][8] = true;
  }
  poner(8, tam - 8, true);
  if (v >= 7) {
    for (let i = 0; i < 18; i++) {
      fijo[Math.floor(i / 3)][tam - 11 + (i % 3)] = true;
      fijo[tam - 11 + (i % 3)][Math.floor(i / 3)] = true;
    }
  }
  return { tam, mod, fijo };
}

function ponerVersion(m: Matriz, v: number) {
  if (v < 7) return;
  let r = v;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  const bits = (v << 12) | r;
  for (let i = 0; i < 18; i++) {
    const b = ((bits >>> i) & 1) === 1;
    const a = m.tam - 11 + (i % 3);
    const c = Math.floor(i / 3);
    m.mod[c][a] = b;
    m.mod[a][c] = b;
  }
}

/** Escribe los 15 bits del formato (nivel M y la máscara) en sus dos lugares. */
function ponerFormato(m: Matriz, mascara: number) {
  const dato = (0 << 3) | mascara; // nivel M = 00
  let r = dato;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  const bits = ((dato << 10) | r) ^ 0x5412;
  const b = (i: number) => ((bits >>> i) & 1) === 1;
  const t = m.tam;
  for (let i = 0; i <= 5; i++) m.mod[i][8] = b(i);
  m.mod[7][8] = b(6);
  m.mod[8][8] = b(7);
  m.mod[8][7] = b(8);
  for (let i = 9; i < 15; i++) m.mod[8][14 - i] = b(i);
  for (let i = 0; i < 8; i++) m.mod[8][t - 1 - i] = b(i);
  for (let i = 8; i < 15; i++) m.mod[t - 15 + i][8] = b(i);
  m.mod[t - 8][8] = true;
}

const MASCARAS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Las cuatro reglas de penalización de la norma: gana la máscara con menos. */
function penalidad(mod: boolean[][]): number {
  const n = mod.length;
  let p = 0;
  const lineas = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let corrida = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) corrida++;
        else {
          if (corrida >= 5) p += corrida - 2;
          corrida = 1;
        }
      }
      // Un patrón 1:1:3:1:1 con cuatro claros de un lado.
      for (let j = 0; j + 11 <= n; j++) {
        const s = Array.from({ length: 11 }, (_, k) => (get(i, j + k) ? 1 : 0)).join("");
        if (s === "10111010000" || s === "00001011101") p += 40;
      }
    }
  };
  lineas((i, j) => mod[i][j]);
  lineas((i, j) => mod[j][i]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
  let oscuros = 0;
  for (const f of mod) for (const c of f) if (c) oscuros++;
  p += Math.floor(Math.abs(oscuros * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/** La matriz del QR de `texto`, o `null` si no entra en la versión 10 (213 bytes). */
export function qr(texto: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(texto);
  let v = 1;
  while (v <= VERSION_MAX && (v >= 10 ? 4 + 16 : 4 + 8) + bytes.length * 8 > palabrasDatos(v) * 8) v++;
  if (v > VERSION_MAX) return null;
  const palabras = intercalar(mensaje(bytes, v), v);
  const bits: boolean[] = [];
  for (const w of palabras) for (let i = 7; i >= 0; i--) bits.push(((w >>> i) & 1) === 1);
  const base = patrones(v);
  // Los datos van en zigzag, de a dos columnas desde la derecha, saltando la columna del temporizador.
  let k = 0;
  for (let derecha = base.tam - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let vert = 0; vert < base.tam; vert++)
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const arriba = ((derecha + 1) & 2) === 0;
        const y = arriba ? base.tam - 1 - vert : vert;
        if (!base.fijo[y][x] && k < bits.length) base.mod[y][x] = bits[k++];
      }
  }
  let mejor: boolean[][] | null = null;
  let menor = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    const m: Matriz = { tam: base.tam, fijo: base.fijo, mod: base.mod.map((f) => f.slice()) };
    for (let y = 0; y < m.tam; y++) for (let x = 0; x < m.tam; x++) if (!m.fijo[y][x] && MASCARAS[mascara](x, y)) m.mod[y][x] = !m.mod[y][x];
    ponerFormato(m, mascara);
    ponerVersion(m, v);
    const p = penalidad(m.mod);
    if (p < menor) {
      menor = p;
      mejor = m.mod;
    }
  }
  return mejor;
}

/** El camino SVG de la matriz: un rectángulo por tramo oscuro de cada fila (la zona de silencio la pone quien lo pinta). */
export function qrCamino(m: boolean[][]): string {
  const partes: string[] = [];
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m.length; x++) {
      if (!m[y][x]) continue;
      let fin = x;
      while (fin + 1 < m.length && m[y][fin + 1]) fin++;
      partes.push(`M${x} ${y}h${fin - x + 1}v1h-${fin - x + 1}z`);
      x = fin;
    }
  return partes.join("");
}
