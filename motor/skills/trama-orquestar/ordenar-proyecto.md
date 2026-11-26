# Ordenar un proyecto para que el modelo no se pierda

Para cuando trabajar en un proyecto cuesta de más: el modelo busca y lee mucho antes de poder actuar, o el contexto fijo
pesa demasiado. Todo lo que está acá sale de medir el cupo real (Trama, 2026-11-26).

## Por qué cuesta

- Cada llamada relee el contexto entero. Lo que está en caché cuesta ~1/10 del precio normal; lo que se escribe o reescribe, ~2×.
- El `CLAUDE.md` (y el `AGENTS.md` que importa) va en **cada llamada** de cada líder, subagente y worker del proyecto, y se
  vuelve a escribir tras cada compactación. Uno de 64 KB son ~16k tokens fijos: en un día de trabajo pesa más que el código leído.
- Cada resultado de una búsqueda o lectura queda en el contexto y se relee en todas las llamadas siguientes hasta compactar.
  Leer de más no se paga una vez: se paga en cada paso que sigue.

## Señales de que está desordenado

Si ves dos o más, el proyecto pide orden:

- `CLAUDE.md` + lo que importa (`@AGENTS.md`, etc.) suma más de ~15 KB (`wc -c CLAUDE.md AGENTS.md`).
- Pasaste más de ~10 búsquedas o lecturas antes del primer cambio, o no hay forma de saber dónde está algo sin buscar.
- Releíste el mismo archivo 3 veces o más en la sesión.
- Para tocar algo hay que leer un archivo de más de ~1500 líneas.
- Los docs contradicen al código, o hay varios docs que dicen lo mismo con diferencias.
- El `CLAUDE.md` cuenta historia (qué se probó, qué se cambió y cuándo) en vez de reglas.

## La forma que funciona (la de Trama)

**`CLAUDE.md` de 10 KB como máximo, como índice:**
1. Qué es el proyecto (2–3 líneas).
2. Cómo se trabaja: sólo las reglas que valen en cualquier tarea.
3. Los chequeos antes de un commit (comandos exactos).
4. Una tabla «Si tocás `<carpeta o archivo>` → leé `docs/reglas/<área>.md`».
5. Mapa rápido: una línea por carpeta (qué hay ahí).
6. Trampas conocidas: una línea cada una, con el archivo que la cubre.

**`docs/reglas/<área>.md`:** las reglas completas de cada área, enteras y sin resumir. Se leen sólo cuando se toca esa área.

**Fuera del contexto fijo:** la historia y las decisiones viejas (git ya las guarda; si hace falta, `docs/historial.md`),
los pendientes (van al tablero, nunca a un doc) y las explicaciones largas.

**Código:** los nombres dicen qué hacen; un archivo que se relee seguido y pasa de ~1500 líneas se parte por responsabilidad.

## Cómo ordenarlo sin romper nada

1. Primero terminá lo que te pidieron. Ordenar va después, y separado.
2. **Si sólo hay que mover docs**, hacelo vos:
   - mové el texto sin reescribir las reglas: cada regla que sale del `CLAUDE.md` queda entera en su `docs/reglas/<área>.md`;
   - comprobá que no se perdió ninguna (cada línea de regla vieja tiene que estar en algún archivo nuevo);
   - medí antes y después con `wc -c` y hacé un commit aparte (`docs: ordenar CLAUDE.md`).
3. **Si hay que tocar código** (partir archivos, renombrar, mover carpetas), no lo hagas en medio de otra tarea: dejalo en el
   tablero (`tablero agregar --columna ideas --origen trabajando --proyecto <p> --detalle "<qué viste, con el dato> <qué harías>" "<título>"`)
   o delegalo como tarea propia con tests (`pa <p> --tipo codigo-multi "…"`).
4. Decilo en una línea en tu respuesta, con el dato que lo justifica (p. ej. «el CLAUDE.md pesa 64 KB, ~16k tokens por llamada»).
