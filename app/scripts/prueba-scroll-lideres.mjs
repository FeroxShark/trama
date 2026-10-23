#!/usr/bin/env node
// Cambiar entre conversaciones de líderes no pierde el scroll: la app offscreen (HILOS_PRUEBA, fixtures y fakes, nunca la
// trama de verdad) con tres líderes de 3000 mensajes inventados (captura `lider-formato`, `HILOS_VARIANTE=larga`).
// Por CDP, con clic en la barra y scroll por `scrollBy`:
//   - un líder que quedó abajo del todo vuelve abajo del todo (y sigue pegado: lo que le llegue después lo deja al fondo);
//   - uno que Ana subió a mano vuelve al mismo mensaje, en el mismo punto de la pantalla;
//   - ambos tras cambiar muchas veces entre los tres, dejando a cada uno en un lugar distinto;
//   - también si mientras estaba en otro le llegaron mensajes (el punto es el mensaje, no la distancia al final) y si se cambia en ráfaga, sin esperar a que se pinte.
// Sale con 1 si alguna falla. Una instancia a la vez.
//   npm run build && node scripts/prueba-scroll-lideres.mjs   (VUELTAS=n: cuántas rondas)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const VUELTAS = Number(process.env.VUELTAS ?? 6);
const LIDERES = ["s-fix-a3", "s-fix-c7", "s-fix-e9"];
/** Cuánto puede correrse el punto de la pantalla (px) sin que cuente como perdido. */
const TOL = 24;

async function abrir() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-scroll-"));
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const base = { ...process.env };
  // Heredadas de quien lanza (un worker, el motor): con ellas Electron correría como Node pelado.
  for (const k of ["ELECTRON_RUN_AS_NODE", "HILOS_MOTOR", "TRAMA_UNIDAD"]) delete base[k];
  const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...base,
      HILOS_PRUEBA: "300",
      HILOS_CAPTURA: "lider-formato",
      HILOS_CAPTURA_MS: "300000",
      HILOS_VARIANTE: "larga",
      HILOS_IDIOMA: "es",
      HILOS_TAM: "1280 900",
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_STATE: path.join(tmp, "pa"),
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
      HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
      HILOS_TABLERO: "/bin/false",
    },
    stdio: "ignore",
  });
  let url = null;
  for (let i = 0; i < 150 && !url; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      url = ts.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!url) await espera(100);
  }
  if (!url) {
    app.kill();
    throw new Error("la app no abrió el puerto de CDP");
  }
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  });
  const cdp = (method, params = {}) =>
    new Promise((r) => {
      const id = ++n;
      pend.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const en = async (fn, ...args) => {
    const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "error en la página");
    return r.result?.result?.value;
  };
  const cerrar = () => {
    ws.close();
    app.kill();
    rmSync(tmp, { recursive: true, force: true });
  };
  return { cdp, en, cerrar };
}

/** Lo que se ve de la conversación abierta: cuánto falta al final y qué mensaje está arriba del todo, y a qué altura. */
const mirar = () => {
  const z = document.querySelector(".conv-zona");
  if (!z) return null;
  const r = z.getBoundingClientRect();
  let ancla = null;
  for (const x of z.querySelector(".conv").children) {
    const b = x.getBoundingClientRect();
    if (b.bottom > r.top + 2) {
      ancla = { texto: (x.textContent ?? "").slice(0, 60), y: Math.round(b.top - r.top) };
      break;
    }
  }
  return { lejos: Math.round(z.scrollHeight - z.scrollTop - z.clientHeight), alto: z.scrollHeight, ancla, hay: z.querySelectorAll(".conv > *").length };
};

const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  return cond ? 0 : 1;
};

const a = await abrir();
let fallas = 0;
try {
  await a.cdp("Page.enable");
  await a.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await espera(3000);

  // En una ventana offscreen el mouse de CDP no llega (tampoco la ruedita): el clic es el del DOM, que entra por el mismo onClick de la fila.
  const clic = (sid) => a.en((sid) => document.querySelector(`[data-lider="${sid}"]`).click(), sid);
  /** Espera a que el chat de ese líder esté montado, pintado y quieto (el alto no cambia en 3 miradas seguidas). */
  const quieto = async (sid, mismo = false) => {
    let ant = -1;
    let iguales = 0;
    for (let i = 0; i < 150 && iguales < 3; i++) {
      await espera(120);
      const m = await a.en((sid, mismo) => {
        const b = document.querySelector("[data-lider][aria-current]");
        const nueva = mismo || document.querySelector(".conv-zona") !== window.__viejo;
        return b?.dataset.lider === sid && nueva ? "listo" : null;
      }, sid, mismo);
      const v = m ? await a.en(mirar) : null;
      if (v && v.hay > 100 && v.alto === ant) iguales++;
      else iguales = 0;
      ant = v?.alto ?? -1;
    }
    const v = await a.en(mirar);
    return iguales < 3 ? { ...v, inquieto: true } : v;
  };
  const abrirLider = async (sid) => {
    // Ya es la abierta: no se vuelve a armar.
    if (await a.en((sid) => document.querySelector("[data-lider][aria-current]")?.dataset.lider === sid, sid)) return quieto(sid, true);
    // Marca la zona que hay: la del líder nuevo es otro elemento (el chat se monta de nuevo en cada cambio).
    await a.en(() => (window.__viejo = document.querySelector(".conv-zona")));
    await clic(sid);
    return quieto(sid);
  };
  /** Tras una ráfaga: espera a que ese líder esté abierto y el alto quieto. */
  const quietoDespues = async (sid) => {
    let ant = -1;
    for (let i = 0, iguales = 0; i < 150 && iguales < 3; i++) {
      await espera(120);
      const v = await a.en((sid) => (document.querySelector("[data-lider][aria-current]")?.dataset.lider === sid ? document.querySelector(".conv-zona")?.scrollHeight : -1), sid);
      iguales = v > 0 && v === ant ? iguales + 1 : 0;
      ant = v;
    }
  };
  const bajarTodo = async () => {
    await a.en(() => {
      const z = document.querySelector(".conv-zona");
      z.scrollTo({ top: z.scrollHeight, behavior: "instant" });
    });
    await espera(300);
  };
  const subir = async (px) => {
    await a.en((px) => document.querySelector(".conv-zona").scrollBy({ top: -px, behavior: "instant" }), px);
    await espera(250);
  };

  // Cada líder queda en un lugar distinto: el 0 abajo del todo, los demás subidos a mano a distintas alturas.
  const dejado = {};
  for (const [i, sid] of LIDERES.entries()) {
    await abrirLider(sid);
    if (i > 0) await subir(1100 * (3 + i * 9));
    dejado[sid] = await a.en(mirar);
    console.log(`     ${sid}: ${i === 0 ? "abajo" : "subido"} (faltan ${dejado[sid].lejos}px)`);
  }
  fallas += ok(dejado[LIDERES[0]].lejos < 8, "el primero está abajo del todo");

  /** Lo que se espera de un líder que vuelve: `antes` es lo que se vio al dejarlo. */
  const comprobar = async (que, antes, m) => {
    if (m.inquieto) fallas += ok(false, `${que}: el chat no se quedó quieto`);
    if (antes.lejos < 8) {
      let f = ok(m.lejos < 8, `${que}: vuelve abajo del todo (faltan ${m.lejos}px)`);
      // Y sigue pegado: si lo de adentro crece (llega un mensaje), lo deja al fondo.
      const sigue = await a.en(async () => {
        const z = document.querySelector(".conv-zona");
        const x = document.createElement("div");
        x.style.height = "300px";
        z.firstElementChild.append(x);
        await new Promise((r) => setTimeout(r, 300));
        const lejos = Math.round(z.scrollHeight - z.scrollTop - z.clientHeight);
        x.remove();
        await new Promise((r) => setTimeout(r, 200));
        return lejos;
      });
      f += ok(sigue < 8, `${que}: sigue pegado al fondo cuando le llega algo (faltan ${sigue}px)`);
      fallas += f;
    } else {
      const igual = m.ancla && antes.ancla && m.ancla.texto === antes.ancla.texto && Math.abs(m.ancla.y - antes.ancla.y) <= TOL;
      fallas += ok(!!igual, `${que}: vuelve al mismo punto (antes ${JSON.stringify(antes.ancla)} / ahora ${JSON.stringify(m.ancla)})`);
    }
  };
  /** Abre un panel de la barra (se esconde la conversación por CSS, sin desmontarla) y lo cierra. */
  const conPanel = async () => {
    const pulsar = () => a.en(() => document.querySelector(".pie button").click());
    await pulsar();
    await espera(500);
    await pulsar();
    await espera(100);
  };

  for (let v = 1; v <= VUELTAS; v++) {
    const orden = [...LIDERES.slice(v % 3), ...LIDERES.slice(0, v % 3)];
    for (const sid of orden) {
      const m = await abrirLider(sid);
      await comprobar(`ronda ${v} ${sid}`, dejado[sid], m);
    }
  }

  // Un panel encima (Tablero, Ramas…) esconde la conversación sin desmontarla: al volver, está donde estaba.
  for (const sid of LIDERES) {
    await abrirLider(sid);
    await conPanel();
    await espera(700);
    const m = await a.en(mirar);
    await comprobar(`panel encima de ${sid}`, dejado[sid], m);
  }

  // Le llegan mensajes a cada uno mientras se mira otro: el que estaba abajo sigue abajo, el subido sigue en su mensaje.
  for (const [i, sid] of LIDERES.entries()) {
    const otro = LIDERES[(i + 1) % LIDERES.length];
    await abrirLider(otro);
    await a.en((sid) => globalThis.__crecerCharla(sid, 30), sid);
    const m = await abrirLider(sid);
    await comprobar(`con mensajes nuevos ${sid}`, dejado[sid], m);
  }

  // En ráfaga, sin esperar a que se pinte ninguno: el último queda como lo dejaron.
  for (let v = 0; v < VUELTAS; v++) {
    const m = await a.en(async (ids, v) => {
      const esp = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const id of [ids[(v + 1) % 3], ids[(v + 2) % 3], ids[v % 3], ids[(v + 1) % 3]]) {
        document.querySelector(`[data-lider="${id}"]`).click();
        await esp(25 + 40 * ((v + 1) % 3));
      }
      return ids[(v + 1) % 3];
    }, LIDERES, v);
    await quietoDespues(m);
    const ahora = await a.en(mirar);
    await comprobar(`ráfaga ${v + 1} ${m}`, dejado[m], ahora);
  }

  // Uno TRABAJANDO (turno en curso: el bloque de abajo con el paso y el texto que crece en vivo): lo que crece abajo no lo
  // saca del fondo al volver, y el que Ana subió vuelve a su punto aunque abajo siga llegando texto.
  const [pegado, subido] = [LIDERES[0], LIDERES[1]];
  const otro = LIDERES[2];
  /** Le manda "novela" por la caja, como Ana: el turno queda en curso con el texto creciendo. */
  const enVivo = async (sid) => {
    await a.en(() => {
      const c = document.querySelector("textarea");
      c.focus();
    });
    await a.cdp("Input.insertText", { text: "novela" });
    for (const type of ["keyDown", "keyUp"]) await a.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
    await espera(600);
  };
  const parar = (sid) => a.en((sid) => globalThis.__pararTrabajo(sid), sid);
  const medir = async () => {
    await espera(500);
    return a.en(mirar);
  };
  // Está abajo, trabajando, y se lo deja y se vuelve varias veces con el texto creciendo entre medio.
  await abrirLider(pegado);
  await bajarTodo();
  await enVivo(pegado);
  await espera(800);
  let v = await a.en(mirar);
  fallas += ok(v.lejos < 8, `trabajando, abierto: sigue el fondo mientras crece (faltan ${v.lejos}px)`);
  for (let r = 1; r <= VUELTAS; r++) {
    await abrirLider(otro);
    await espera(300 + 170 * (r % 4));
    await abrirLider(pegado);
    v = await medir();
    fallas += ok(v.lejos < 8, `trabajando, vuelta ${r}: vuelve abajo del todo (faltan ${v.lejos}px)`);
    await espera(700);
    v = await a.en(mirar);
    fallas += ok(v.lejos < 8, `trabajando, vuelta ${r}: sigue pegado mientras crece (faltan ${v.lejos}px)`);
  }
  // En ráfaga, sin esperar a que se pinte.
  for (let r = 0; r < VUELTAS; r++) {
    await a.en(async (a1, b1, r) => {
      const esp = (ms) => new Promise((x) => setTimeout(x, ms));
      for (const id of [b1, a1, b1, a1]) {
        document.querySelector(`[data-lider="${id}"]`).click();
        await esp(30 + 35 * r);
      }
    }, pegado, otro, r);
    await quietoDespues(pegado);
    v = await medir();
    if (process.env.DEPURAR) for (let q = 0; q < 4; q++) { await espera(700); console.log('       +', JSON.stringify(await a.en(mirar))); }
    fallas += ok(v.lejos < 8, `trabajando, ráfaga ${r + 1}: queda abajo del todo (faltan ${v.lejos}px)`);
  }
  await parar(pegado);

  // El subido, también trabajando: vuelve a su punto.
  await abrirLider(subido);
  await enVivo(subido);
  await subir(1100 * 12);
  const punto = await a.en(mirar);
  await espera(800);
  for (let r = 1; r <= 3; r++) {
    await abrirLider(otro);
    await espera(500);
    const m = await abrirLider(subido);
    await espera(400);
    await comprobar(`trabajando subido, vuelta ${r}`, punto, await a.en(mirar));
    void m;
  }
  await parar(subido);

  // El borrador de la caja: al volver, el cursor queda donde estaba (nunca al inicio del texto), y sin haberlo movido, al final.
  const cursor = () => a.en(() => ({ ini: document.querySelector("textarea").selectionStart, fin: document.querySelector("textarea").selectionEnd, largo: document.querySelector("textarea").value.length }));
  const [escrito, aparte] = [LIDERES[2], LIDERES[0]];
  await abrirLider(escrito);
  await a.en(() => document.querySelector("textarea").focus());
  await a.cdp("Input.insertText", { text: "un borrador que se dejó escrito" });
  await abrirLider(aparte);
  await abrirLider(escrito);
  let c = await cursor();
  fallas += ok(c.largo > 0 && c.ini === c.largo && c.fin === c.largo, `borrador: el cursor vuelve al final del texto (${c.ini}/${c.largo})`);
  await a.en(() => document.querySelector("textarea").setSelectionRange(6, 6));
  await abrirLider(aparte);
  await abrirLider(escrito);
  c = await cursor();
  fallas += ok(c.ini === 6 && c.fin === 6, `borrador: si estaba en el medio, vuelve al medio (${c.ini})`);
} finally {
  a.cerrar();
}
console.log(fallas ? `${fallas} fallas` : "todo bien");
process.exit(fallas ? 1 : 0);
