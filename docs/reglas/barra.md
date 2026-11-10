# Reglas: barra

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Barra lateral

- **Barra lateral:** Antes de rediseñar la barra, leer app/src/barra/CONVENCIONES.md y conservar cada señal o justificar el cambio en el RESULTADO. Lo controla `tests/barra-convenciones.test.ts`.

## Carpeta de un líder en la barra

- **Carpeta de un líder en la barra (`armarArbol`):** `mover` (a mano) > Shark > `fijadas` > primer worker > `inferido` > general. Lo que se decide solo se fija con el líder (`nombres.json.fijadas`, vía `Arbol.decididas`) y no se recalcula; lo elegido a mano no se pierde (`nombres.json.bak`). No hagas depender la carpeta de algo que cambia por sondeo. Detalle en `docs/estado/carpeta-estable.md`; lo controla `tests/carpeta-estable.test.ts`.
