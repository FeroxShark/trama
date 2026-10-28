import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { crearAvisosWorker, textoParaLider, type AvisoWorker, type FilaWorker } from "../electron/avisos-worker.ts";
import { procesoVivoDe, rastroDeWorker } from "../electron/avisos-worker-disco.ts";

// Ids y proyecto inventados. El estado de disco es falso: un PA_STATE de mentira con los archivos de una corrida.
const ID = "20261028-013200-1000007";
const OTRO_ID = "20261028-013200-1000008";
const PROY = "proyecto-falso";
/** Un pid que ya no existe: el de un hijo que salió. */
const PID_MUERTO = spawnSync(process.execPath, ["-e", "0"]).pid as number;

const fila = (estado: string, extra: Partial<FilaWorker> = {}): FilaWorker => ({ id: ID, proyecto: PROY, estado, tarea: "Objetivo: tarea falsa", modelo: "claude-a", jefe_id: "jefe-1", jefe: "ana", ...extra });

function estadoFalso() {
  const raiz = mkdtempSync(path.join(tmpdir(), "avisos-proceso-"));
  const base = path.join(raiz, PROY, ID);
  mkdirSync(path.join(raiz, PROY));
  for (const k of ["corrida", "hilo", "puesto", "sid"]) writeFileSync(`${base}.${k}`, `${k}=falso\n`);
  // pa crea el .json vacío al lanzar y lo llena al terminar.
  writeFileSync(`${base}.json`, "");
  return {
    raiz,
    /** El `.running` de la corrida: con el pid del claude, o vacío (pa todavía no lo tenía: vale el de pa). */
    running: (pid: number | "") => writeFileSync(path.join(raiz, `${PROY}.running`), `pid=${pid}\npa_pid=${process.pid}\ninicio=1\nproyecto=${PROY}\nid=${ID}\n`),
    sinRunning: () => rmSync(path.join(raiz, `${PROY}.running`), { force: true }),
    /** Lo que deja pa al terminar: el `.json` con el resultado. */
    terminar: (resultado: string) => writeFileSync(`${base}.json`, JSON.stringify({ type: "result", result: resultado })),
    /** Un `.json` vacío de hace rato: el worker murió sin llenarlo. */
    viejo: () => {
      const hace = new Date(Date.now() - 60 * 60_000);
      utimesSync(`${base}.json`, hace, hace);
    },
  };
}

function armar(e: ReturnType<typeof estadoFalso>) {
  const avisos: AvisoWorker[] = [];
  const av = crearAvisosWorker({
    leerRastro: (h) => rastroDeWorker(e.raiz, h),
    procesoVivo: (h) => procesoVivoDe(e.raiz, h),
    emitir: (a) => avisos.push(a),
  });
  return { av, avisos };
}

test("caso real: arranca y, en el mismo minuto, `pa --hilos` lo lista 'murio' con su .running y su pid vivos: no es una falla", async () => {
  const e = estadoFalso();
  e.running(process.pid);
  const { av, avisos } = armar(e);
  av.eventos([{ tipo: "inicio", id: ID }]);
  await av.hilos([]);
  await av.hilos([fila("murio")]);
  await av.hilos([fila("trabajando")]);
  await av.hilos([fila("murio")]);
  assert.deepEqual(avisos, [], "sigue corriendo: no es 'se cortó sin dejar mensaje' ni un fin");
  // Ahora sí se cortó: el pid murió y el .json vacío es viejo.
  e.running(PID_MUERTO);
  e.viejo();
  await av.hilos([fila("murio")]);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, "falla");
  assert.match(textoParaLider(avisos[0]), /falló: el proceso se cortó sin dejar mensaje/);
});

test("ventana de arranque: .json vacío recién creado y todavía sin .running; cuando termina, avisa 'fin' una sola vez", async () => {
  const e = estadoFalso();
  const { av, avisos } = armar(e);
  av.eventos([{ tipo: "inicio", id: ID }]);
  await av.hilos([]);
  await av.hilos([fila("murio")]);
  assert.deepEqual(avisos, []);
  e.running("");
  await av.hilos([fila("murio")]);
  assert.deepEqual(avisos, []);
  e.sinRunning();
  e.terminar("RESULTADO: listo");
  await av.hilos([fila("entregado")]);
  assert.deepEqual(avisos.map((a) => a.tipo), ["fin"]);
  await av.hilos([fila("entregado")]);
  assert.equal(avisos.length, 1, "una sola vez");
});

test("procesoVivoDe: vivo con su pid o con el .json vacío recién creado; cortado si el pid murió y el .json es viejo", async () => {
  const e = estadoFalso();
  const h = { id: ID, proyecto: PROY };
  assert.equal(await procesoVivoDe(e.raiz, h), true, ".json vacío recién creado, sin .running");
  e.viejo();
  assert.equal(await procesoVivoDe(e.raiz, h), false, ".json viejo y sin .running");
  e.running(process.pid);
  assert.equal(await procesoVivoDe(e.raiz, h), true, "pid vivo");
  e.running(PID_MUERTO);
  assert.equal(await procesoVivoDe(e.raiz, h), false, "pid muerto");
  e.running("");
  assert.equal(await procesoVivoDe(e.raiz, h), true, "sin pid: vale el de pa, que vive");
  e.terminar("RESULTADO: listo");
  e.sinRunning();
  assert.equal(await procesoVivoDe(e.raiz, h), false, "terminó y no queda nada vivo");
  assert.equal(await procesoVivoDe(e.raiz, { id: OTRO_ID, proyecto: PROY }), false, "otro id: nada");
  assert.equal(await procesoVivoDe(e.raiz, { id: "../x", proyecto: PROY }), false, "id inválido");
});
