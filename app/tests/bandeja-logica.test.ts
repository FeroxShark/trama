// La bandeja de la cola (src/hilo/Bandeja.tsx): lo que dice en cada estado, el umbral de un paso largo, la pregunta de «Enviar ahora»
// y dónde cae una fila arrastrada. Lo del disco y la cola misma está en tests/cola-sin-perder.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicarOrden, cabecera, canalDe, comandoCorto, confirmacion, corrimiento, destinoArrastre, esLargo, mover, pasoDe, PASO_LARGO_S } from "../src/hilo/bandeja-logica.ts";
import { cambiarIdioma, idioma } from "../src/i18n/index.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";

const leer = (r: string) => readFileSync(new URL(`../src/${r}`, import.meta.url), "utf8");
const conEspanol = <T>(f: () => T): T => {
  const antes = idioma();
  cambiarIdioma("es");
  try {
    return f();
  } finally {
    cambiarIdioma(antes);
  }
};
const base = { enEspera: 0, enCamino: 0, fallo: false, canal: "turno" as const, paso: null, cortable: true };

test("punto 2: la bandeja va pegada sobre la caja; en la conversación ya no hay fila de cola", () => {
  const v = leer("hilo/Lider.tsx");
  const zona = v.indexOf('className="caja-zona"');
  const band = v.indexOf("<Bandeja ", zona);
  const caja = v.indexOf('<div className="caja" data-arrastra', zona);
  assert.ok(zona > 0 && band > zona && caja > band, "la bandeja está en la zona de la caja, justo antes");
  assert.equal(v.slice(band, caja).includes('className="caja-ajeno"'), false, "entre la bandeja y la caja no hay nada más");
  assert.doesNotMatch(v, /data-cola-resumen|encolado-x|encolado-re/);
  assert.match(leer("hilo/solapa-cola.css"), /\.band-marco \+ \.caja/);
});

test("punto 5: el estado en palabras, según por dónde entra", () => {
  conEspanol(() => {
    assert.deepEqual(
      { ...cabecera({ ...base, enEspera: 1 }) },
      { tono: "espera", icono: "reloj", titulo: "En cola", nota: "entra tras este paso", tiempo: null, parar: false },
    );
    const tres = cabecera({ ...base, enEspera: 3 });
    assert.equal(tres.titulo, "3 en cola");
    assert.equal(tres.nota, "entran juntos tras este paso");
    assert.equal(tres.icono, "capas");
    assert.equal(cabecera({ ...base, enEspera: 2, canal: "fin" }).nota, "entran juntos al terminar el turno");
    assert.equal(cabecera({ ...base, enEspera: 1, canal: "terminal" }).nota, "entra cuando termine en la terminal");
    assert.equal(cabecera({ ...base, enCamino: 1 }).titulo, "En camino");
    assert.equal(cabecera({ ...base, enEspera: 1, enCamino: 1 }).titulo, "2 en cola", "lo que espera y lo que ya salió se cuentan juntos");
  });
});

test("canal: terminal, a mitad de turno, al terminar el turno o ya", () => {
  assert.equal(canalDe({ ocupado: true, ajeno: true, directo: true }), "terminal");
  assert.equal(canalDe({ ocupado: true, ajeno: false, directo: true }), "turno");
  assert.equal(canalDe({ ocupado: true, ajeno: false, directo: false }), "fin");
  assert.equal(canalDe({ ocupado: false, ajeno: false, directo: true }), "ahora");
});

test("punto 5: pasados los 2 minutos dice que espera un comando largo, cuánto lleva y ofrece Parar", () => {
  conEspanol(() => {
    const inicio = 1_000_000;
    const bash = { hace: { que: "herramienta", nombre: "Bash", detalle: "npm test -- --reporter dot" }, inicio };
    assert.equal(PASO_LARGO_S, 120);
    assert.equal(esLargo(pasoDe(bash, inicio + 119_000)), false, "a los 119 s, todavía no");
    const p = pasoDe(bash, inicio + 180_000);
    assert.equal(esLargo(p), true, "a los 3 m, sí");
    const c = cabecera({ ...base, enEspera: 1, paso: p });
    assert.deepEqual({ ...c }, { tono: "largo", icono: "arena", titulo: "Esperando un comando largo", nota: null, tiempo: "3 m", parar: true });

    const leyendo = pasoDe({ hace: { que: "herramienta", nombre: "Read", detalle: "src/x.ts" }, inicio }, inicio + 180_000);
    assert.equal(leyendo?.comando, null, "lo que no es un comando no se nombra como comando");
    assert.equal(cabecera({ ...base, enEspera: 1, paso: leyendo }).titulo, "Esperando un paso largo");
    assert.equal(cabecera({ ...base, enEspera: 1, paso: p, cortable: false }).parar, false, "sin poder cortar, no ofrece Parar");
    assert.equal(cabecera({ ...base, enEspera: 1, canal: "terminal", paso: p }).tono, "espera", "de la terminal no se sabe cuánto lleva: no dice nada de eso");
    assert.equal(pasoDe({ hace: null, inicio: 0 }, inicio), null, "sin paso en curso");
  });
});

test("punto 6: lo que no salió se dice primero, aunque el paso sea largo; nunca sólo con color", () => {
  conEspanol(() => {
    const p = { segundos: 300, comando: "npm test" };
    const c = cabecera({ ...base, enEspera: 3, fallo: true, paso: p });
    assert.deepEqual({ ...c }, { tono: "fallo", icono: "error", titulo: "1 no se pudo enviar", nota: "2 esperan", tiempo: null, parar: false });
    assert.equal(cabecera({ ...base, enEspera: 2, fallo: true }).nota, "1 espera");
    assert.equal(cabecera({ ...base, enEspera: 1, fallo: true }).nota, null);
  });
  for (const d of [es, en]) assert.ok(d["cola.guardado"].length > 10, "dice que sigue guardado");
});

test("punto 3: «Enviar ahora» pregunta qué corta y qué pasa con los mensajes", () => {
  conEspanol(() => {
    const largo = { segundos: 180, comando: "npm test -- --reporter dot" };
    assert.deepEqual(confirmacion({ canal: "turno", paso: largo, n: 3 }), {
      titulo: "¿Cortar «npm test» y enviar ahora?",
      cuerpo: "Lleva 3 m. Lo que ya hizo queda como está y los 3 mensajes entran juntos, en este orden.",
    });
    assert.deepEqual(confirmacion({ canal: "turno", paso: { segundos: 20, comando: null }, n: 1 }), {
      titulo: "¿Cortar este paso y enviar ahora?",
      cuerpo: "Lo que ya hizo queda como está y el mensaje entra enseguida.",
    });
    assert.equal(confirmacion({ canal: "terminal", paso: null, n: 2 }).titulo, "¿Cortar lo que hace en la terminal y enviar ahora?");
  });
});

test("punto 3: Editar, Borrar y Enviar ahora están en la fila; la pregunta arranca en lo que no corta", () => {
  const v = leer("hilo/Bandeja.tsx");
  for (const m of ["data-editar-cola", "data-borrar-cola", "data-enviar-cola", "data-reintentar-cola", "data-cortar-y-enviar", "data-seguir-esperando"]) assert.ok(v.includes(m), m);
  assert.match(v, /ref=\{seguirBtn\}[^>]*data-seguir-esperando/, "el foco por defecto es «Seguir esperando»");
  assert.match(v, /cola\.ya\(sid, true\)/, "cortar y dejar que la cola siga");
  assert.match(v, /marcarParando\(sid\)/, "el líder de la app muestra que está parando");
  assert.match(v, /cola\.retener\(sid, true\)/, "mientras se edita, se arrastra o se confirma, no sale");
});

test("comandoCorto: la primera línea, sin opciones, cortada en una palabra", () => {
  assert.equal(comandoCorto("npm test -- --reporter dot"), "npm test");
  assert.equal(comandoCorto("cargo test\nsegunda línea"), "cargo test");
  assert.equal(comandoCorto("ls -la /tmp"), "ls");
  const largo = comandoCorto("python3 scripts/una/ruta/bastante/larga/de/verdad/que/no/entra.py arg");
  assert.ok(largo.length <= 33 && largo.endsWith("…"), largo);
});

test("punto 4: mover y aplicar el orden pedido", () => {
  assert.deepEqual(mover(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(mover(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  const l = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(aplicarOrden(l, null), l, "sin pedido, la misma lista");
  assert.deepEqual(aplicarOrden(l, [3, 1, 2]).map((x) => x.id), [3, 1, 2]);
  assert.deepEqual(aplicarOrden(l, [3, 9]).map((x) => x.id), [3, 1, 2], "lo que ya no está se ignora y lo recién llegado queda atrás");
});

test("punto 4: la fila cae a mitad de camino entre sus dos lugares, con alturas distintas", () => {
  const h = [40, 60, 40];
  assert.equal(destinoArrastre(h, 0, 0, 2), 0);
  assert.equal(destinoArrastre(h, 0, 20, 2), 0, "todavía no llegó a la mitad: no cambia");
  assert.equal(destinoArrastre(h, 0, 40, 2), 1);
  assert.equal(destinoArrastre(h, 0, 500, 2), 2, "más allá del final, última");
  assert.equal(destinoArrastre(h, 2, -500, 2), 0, "más allá del principio, primera");
  assert.equal(destinoArrastre(h, 2, -40, 2), 1);
  // La fila se dibuja corrida desde su lugar nuevo: lugar + corrimiento = lo que se movió el puntero.
  assert.equal(corrimiento(h, 0, 0, 2), 0);
  assert.equal(corrimiento(h, 0, 1, 2), 62, "pasó a una de 60 (y el espacio)");
  assert.equal(corrimiento(h, 2, 0, 2), -104, "subió por encima de 40 y 60 (y dos espacios)");
});

test("punto 4: se ordena también sin arrastrar, con las flechas sobre el agarre", () => {
  const v = leer("hilo/Bandeja.tsx");
  assert.match(v, /ArrowUp/);
  assert.match(v, /ArrowDown/);
  assert.match(v, /role="status"/, "se anuncia en voz");
  assert.match(v, /"Escape"/, "Esc suelta la fila donde estaba");
});

test("punto 7: el texto va primero y la miniatura, chica, después; un clic la amplía", () => {
  const v = leer("hilo/Bandeja.tsx");
  const cuerpo = v.indexOf('className="band-cuerpo"');
  const minis = v.indexOf("<Minis ");
  assert.ok(cuerpo > 0 && minis > cuerpo, "texto antes que imagen");
  assert.match(v, /<Visor img=\{abierta\}/);
  assert.match(leer("hilo/solapa-cola.css"), /\.band-mini \{[^}]*width: 2\.25rem/);
});

test("el marcador de la caja sigue diciendo cuándo se suma", () => {
  assert.equal(es["lider.phOcupado"], "Se suma al terminar este paso");
});

test("los textos de la cola están en los dos idiomas, con las mismas variables", () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const claves = Object.keys(es).filter((k) => k.startsWith("cola."));
  assert.ok(claves.length > 30);
  for (const k of claves) assert.deepEqual(vars((en as Record<string, string>)[k]), vars((es as Record<string, string>)[k]), k);
});
