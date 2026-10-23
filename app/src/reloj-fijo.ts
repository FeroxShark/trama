// El reloj quieto de las capturas comparadas (scripts/visual.mjs): con `?ahora=<ms>` en la query
// (sólo `HILOS_AHORA`, con fixtures) `Date.now()` y `new Date()` dicen siempre ese instante, así las
// horas y los "hace 3 min" de los fixtures salen iguales en cada corrida. Va primero en `main.tsx`.
const ahora = Number(new URLSearchParams(location.search).get("ahora"));
if (Number.isFinite(ahora) && ahora > 0) {
  const Real = Date;
  class Quieto extends Real {
    constructor(...args: unknown[]) {
      // @ts-expect-error: pasa tal cual los argumentos al Date de verdad; sin ellos, el instante fijo.
      super(...(args.length ? args : [ahora]));
    }
    static now() {
      return ahora;
    }
  }
  globalThis.Date = Quieto as DateConstructor;
  // Lo que se anima una vez al montarse (el pulso del numerito) quedaría a medias o no según cuánto tarde en pintar la captura.
  document.documentElement.dataset.quieto = "";
}
