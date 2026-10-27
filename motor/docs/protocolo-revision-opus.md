# Revisión de la v2 del protocolo (Opus, 2026-10-27)

Lo más valioso del protocolo es la combinación de “un reintento y después clasificar” con “rojo en main antes de implementar”. Abajo van los agujeros, primero los errores concretos.

Errores concretos (arreglar antes de pasarlo al skill)
A cuenta el test como archivo. Toda subtarea con test modifica al menos 2 archivos, así que siempre es mediano. El ejemplo de 4.1 (Barra.tsx + Barra.test.tsx) dice A=chico, pero por la definición es mediano. La consecuencia es que las filas 7 y 8 casi nunca aplican, y 7b/8b mandan a “partir” algo que no se puede partir (código + su test). Eso termina en I=sí y Sonnet. Es justo la escalada que no querés, y la mete la definición.
La fila 1b va antes que la fila 2. Una tarea grande indivisible sin chequeo se lanza a Sonnet sin nada que la desmienta. Poné la 2 arriba de todo, o hacé que 1b exija C≠ninguno.
1b es un bucle. Sonnet compacta en ~50 % de las corridas grandes. Compactación manda a “partir”, I=sí manda de vuelta a 1b. Falta un estado final: si 1b compacta, va al tablero/dueño.
El líder tiene effort low (sección 1), pero Opus sólo tiene medium y high habilitados (1.1), y la regla dice que lo apagado no se usa nunca.
agy:claude-sonnet-5-5-high aparece como vía para el exit 76 (sección 7) y no está en 1.1.
El camino trivial no corre hoy. Pide gate sin test congelado y --test es obligatorio. Además, con main en verde (P0), “ya existe un chequeo que da rojo en main” deja casi sólo grep, que es el chequeo más fácil de engañar: alcanza con nombrar el símbolo.
Los exits 83, 89, 90 y 91 aparecen en “requieren al dueño” y no están definidos en ningún lado.
Las referencias están corridas en uno:
“rúbrica, sección 5” es la 6.
“gate de vía rápida (sección 7)” es la 8.
“clasificar (sección 6)” es la 7.
“sección 3.1” para la vía rápida es la 3.2.
Si esto alimenta un skill, el modelo va a seguir las referencias equivocadas.
hechos-check:
Con total == 0 sale 1. Un lector honesto que contesta todo con NO ENCONTRADO hace tirar el reporte. Si hay NO ENCONTRADO y cero HECHO, tiene que salir 0.
Matchea por substring sin largo mínimo, así que } o return null; pasan casi siempre dentro de ±3 líneas. Exigí al menos 15 caracteres no blancos, o match de línea completa.
No normaliza espacios internos: un hecho real con un espacio de más da FALSO. Usá " ".join(texto.split()) de los dos lados.
Guardá el sha en 11-hechos.md. Cuando se integra T0, los números de línea de i18n quedan corridos y viajan así al brief.
La lección de i18n “claves al final del objeto” garantiza choques. Dos subtareas que agregan al final chocan siempre (exit 80). Con orden alfabético dentro de un namespace por feature, los agregados se reparten y la mayoría rebasea limpio.
1. Huecos e interacciones
El espejo “oculto” no está oculto. Vive en tareas/<slug>/ al lado de Tn.test.*, y el brief de F5 le da al worker esa ruta (“Copiá <ruta de Tn.test.*>”). Con un ls lo ve. Para cerrarlo:
el test congelado va inline en el brief;
el espejo va en otro directorio;
los settings del worker tienen un deny de Read sobre ese path.
Vía rápida + espejo da falsos positivos. Un Haiku que sólo ve el brief no conoce la API que va a elegir el worker (nombres, props), y el espejo falla por nombres. Generalo después del commit 1, a partir del test visible: mismas llamadas, otros valores. Es barato y sigue siendo independiente de la implementación.
En la vía rápida nadie mira qué prueba el test. El gate verifica rojo→verde, no que el test pida lo que se pidió. Que el líder lea sólo el diff del commit 1 (≤50 líneas) es el único chequeo semántico, y cuesta poco. El gate también tiene que verificar que el commit 1 toque sólo archivos de test.
T0 no tiene salida para claves no previstas. Si T2 descubre que necesita una clave que el líder no previó, tocar i18n da exit 21, se clasifica como brief malo y se rehace todo. Falta la salida: DECISION: falta clave X → T0b → --seguir en T2.
--desde-main ensucia las métricas. Reusar id y rama con otro modelo u otra partición mezcla intentos en la misma fila de medicion.tsv, y --rinde atribuye mal. Usá id.n por intento.
--desde-main choca con la regla de destructivos. Resetear la rama descarta commits igual que --descartar, sólo que con el patch guardado. Pedir OK para uno y no para el otro es incoherente. Decidí la política una sola vez (“ramas pa/* no integradas, con patch guardado, son descartables”) y aplicala a los dos.
F7 hoy es débil. D=alto incluye seguridad y datos del usuario, que no pueden ir a OpenCode, así que F7 queda casi siempre en Flash. En subtareas chicas, que el líder lea el diff es más fuerte y casi igual de barato.
2. Costo del líder

Con tus propios números se ve dónde está el equilibrio:

En codigo-acotado, Haiku directo cuesta ~0.24 / 0.51 ≈ 0.47 US$ por integrada. El protocolo completo (~1.5–2.4 US$ estimados) no le gana nunca ahí.
En codigo-multi (Sonnet 32 %, Opus 18 %) el costo por integrada anda entre ~3 y 28 US$. Ahí el protocolo completo sí puede ganar.

La regla que sale: completo sólo para codigo-multi o tareas grandes, y todo lo demás por trivial o vía rápida. No hace falta un umbral de tamaño más fino.

Qué sacarle al líder:

estado.tsv lo escriben pa y gate, no el líder. pa ya sabe id, modelo, exit, US$ y si compactó; gate sabe su exit.
A sale de wc -c y del conteo de archivos. Un piso de D sale de patrones de ruta (nucleo.ts, puente.ts, migrations/, .env). El líder contesta sólo B, C y E.
El exit 97 con --async lo resuelve pa solo: relanza con el siguiente de -m, porque es infra y es determinista. Hoy cada corte de GLM en un abanico de F2 le cuesta un turno al líder.
Un líder por tarea madre, que arranca leyendo tareas/<slug>/. El costo crece con el contexto acumulado y el estado ya está en disco. No requiere código.
3. Rúbrica
Con el arreglo de A (no contar tests ni archivos de T0), 7b y 8b dejan de ser un bucle en casi todos los casos.
La fila 5 (B=decidir, D=bajo → Sonnet) choca con la sección 2 (“diseño: líder u Opus”). Además, una subtarea con B=decidir indica que F3 no decidió. ¿Cuánto le cuesta al líder escribir la decisión en tres líneas del brief, comparado con una corrida de Sonnet?
No veo ninguna pregunta faltante.
4. Gate

Trampas que pasan todo lo propuesto:

Mockear el módulo bajo test o tocar el setup. Con vi.mock('./modulo-bajo-test', ...), o cambiando el beforeEach o los valores de entrada, las líneas expect( quedan intactas. Mejor que proteger aserciones: el gate pisa el archivo de test con la copia congelada y corre esa. Los casos que agregue el worker van en *.extra.test.* y corren aparte. Es más simple que parsear aserciones y cierra todo el setup.
Snapshots. toMatchSnapshot() más un snapshot nuevo en el commit 2 da verde trivial. Cualquier cambio en __snapshots__/ fuera de permitidos se rechaza.
Faltan anti-patrones: xit(, xdescribe(, it.todo, .fails( (vitest invierte el resultado) y return; al principio de un test.

Falsos positivos que van a molestar:

eslint-disable-next-line react-hooks/exhaustive-deps, que es legítimo y común en React.
@ts-expect-error en tests de entrada inválida.

Para esos dos, allowlist por regla o que sean sólo aviso.

“Rojo por aserción y no por import” se puede automatizar con vitest --reporter=json:

Si un archivo falla con assertionResults vacío, la suite no cargó (import o sintaxis) y el rojo no vale.
Si hay al menos un assertionResult en failed, el rojo vale. Eso incluye un TypeError: x is not a function dentro del test, que es el rojo legítimo de una función nueva.
5. Reglas de falla

Distinguir “entendió y no pudo” de “error puntual” hoy requiere juicio. Con señales que ya tenés se puede volver casi determinista:

Señal	Clase
gate 21	brief
compactó / max-turns	partición (si es 1b: dueño)
DECISION ≠ nada	estimación (B)
22 / 25 / 26 / 27	trampa → un reintento
23, primera vez	puntual → --seguir
23, segunda vez	subir B o E un paso; si la tabla da el mismo modelo → brief

Fallas que no entran en ninguna fila:

Diff vacío con un RESULTADO que dice “listo”.
Gate rojo después de --actualizar: el rebase rompió algo y no está definido quién lo arregla ni con qué modelo.
Gate verde y el dueño rechaza. Eso debería volver a la rúbrica como subestimación de C.
6. Experimento
No es ciego. B tiene dos commits test:/fix: y un test nuevo, así que se reconoce. Squasheá las dos ramas y sacá los mensajes antes de mostrarlas.
Elegir una de dos no mide “integrada sin retrabajo” por brazo. Obliga a un ganador y no ve empates. Calificá cada rama por separado (si/no/parcial), en orden aleatorio.
El costo del líder no se puede separar si los dos brazos corren en paralelo contra el mismo cupo. Usá una sesión de líder por brazo y contá los tokens de su log, no reparto --cupos antes y después.
Los costos tienen cola pesada. Con n = 8, una sola corrida de Opus a 5 US$ decide el total. Usá la mediana de la razón B/A por tarea, no la suma.
Elegí las 8 tareas al azar del tablero antes de clasificarlas, no a mano.
7. Top 5 por impacto
#	Qué	Por qué	Costo	Gana
1	A no cuenta tests ni archivos de T0; fila 2 primero; 1b compactada → dueño	La definición actual empuja tareas chicas a Sonnet y abre dos bucles	chico (~10 líneas en rubrica_resolver + doc)	Más Haiku, menos re-puntuaciones; tu regla deja de pelear con la tabla
2	pa/gate escriben estado.tsv; gate --plan calcula A, piso de D, calientes, KB y rojo-en-main desde 20-plan.md; relanzamiento automático en 97 async	El riesgo #1 es el costo del líder, y casi todo eso es contabilidad	mediano (~150)	Menos turnos de Opus por tarea, menos errores en A y D
3	Gate corre la copia congelada pisando la de la rama; extras aparte; anti-patrones ampliados; rojo validado con el JSON de vitest	Proteger líneas expect no cubre mocks ni setup; con esto sobra el chequeo de aserciones	chico (~40)	Cierra la trampa más probable de un Haiku apurado
4	Espejo oculto de verdad (otro directorio + deny Read + test inline), generado del test visible; el líder lee el commit 1 en vía rápida	Hoy el worker puede leer el espejo, y en vía rápida nadie valida el test	chico	La vía rápida pasa a ser verificable
5	clasificar con la tabla de señales + las filas faltantes	Saca juicio caro del líder y cierra los bucles	chico-mediano (~60)	Menos turnos de líder, cero escaladas a ciegas

Antes del experimento: P0, 1 y 3. El resto puede esperar a tener datos.
