# La carpeta de un líder no salta sola

Reporte (Gonza, Windows): "tiene un chat, cambia de carpeta y después vuelve a la carpeta donde lo quería". Sin reproducción;
estas son las causas que se encontraron leyendo el camino de la carpeta (`armarArbol`, `statusline.ts`, `nombres.ts`, `registro.ts`).

## Cómo se decide la carpeta

`mover` (elegida a mano, `nombres.proyectos`) > Shark > **`fijadas`** (`nombres.fijadas`) > carpeta del primer worker listado >
`inferido` (proyecto que nombra el primer mensaje) > general. La `cwd` del líder no cuenta.

## Causas (de más a menos probable para lo de Gonza)

1. **Todo se recalculaba en cada sondeo.** La carpeta de un líder sin elección dependía de cosas que cambian: el primer worker
   *que `pa --hilos` lista ahora* (si se integra, archiva o poda, o aparece uno más viejo, cambia), el `inferido` (sale de leer
   el transcript y el registry) y, sin proceso, de lo que le quede colgando. Cada cambio movía el chat y el siguiente lo
   devolvía. Arreglo: lo que la barra decide sola se fija con el líder (`fijadas`, guardada en `nombres.json` por el efecto de
   `Barra.tsx` sobre `Arbol.decididas`) y no se recalcula. Sólo `mover` la pisa; "soltar" (null) borra las dos.
2. **`registro()` tragaba cualquier error de lectura.** Un `registry.json` bloqueado un instante (Windows: antivirus, `pa`
   renombrando encima) o a medias daba `[]`, y con eso `inferido: null` para TODOS los líderes durante un sondeo: todos
   caían a general y volvían. Ahora vale la última lectura buena; sólo "no existe" es "sin proyectos".
3. **`nombres.json` ilegible = vacío para siempre.** `leer()` daba cualquier error por "no hay nada", lo recordaba, y el
   próximo guardado pisaba todo lo elegido a mano. Ahora: sin archivo es vacío; roto se recupera de `nombres.json.bak`
   (copia de lo último escrito); ilegible un instante no se recuerda y escribir rechaza antes que pisar.
4. **Lecturas concurrentes de `nombres.json`.** Dos cambios seguidos al arrancar armaban dos copias en memoria y el último
   en escribir borraba el cambio del otro. Ahora hay una sola lectura en vuelo.

## No tocado

`proyectoDe`/`real()` (rutas de Windows) sólo alimentan `Lider.proyecto`, que `armarArbol` ignora: no mueven la barra.
El merge de máquinas pasa `inferido` sin cambios. Si en una máquina remota el registry no tiene el proyecto, ese líder se
decide con lo que haya y queda fijado.

## Test

`app/tests/carpeta-estable.test.ts`: un líder por todas las transiciones (worker que aparece y se va, registry sin leer,
compactación, sin proceso, vuelta) y carpeta estable; el control sin fijar demuestra que antes saltaba.
