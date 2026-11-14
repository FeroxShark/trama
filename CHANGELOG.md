# Cambios

## 0.2.81

- Gemini 3.8 Flash sale del reparto y de los selectores: lo reemplaza Gemini 4 Hydrogen. Una configuración vieja que lo nombre sigue andando; pedirlo a mano con `-m` da el mismo error que cualquier modelo que no existe.

## 0.2.80

- En el aviso de workers, la fila de uno que terminó con rama lista trae el botón «Integrar» al lado de «Abrir»: ya no hace falta abrir el worker para integrarlo. Si falla, el error queda debajo de la fila.
- El riel es un poco más ancho para que los anillos de cupo entren con aire; antes tocaban los bordes.

## 0.2.79

- Piel nueva: fondo liso, tipografía IBM Plex y diez temas oscuros (Grafito de fábrica, Tinta, Carbón, Shell, Catppuccin Mocha, Tokyo Night, Gruvbox, Nord, Rosé Pine y Dracula), además de Claro y Alto contraste. En Ajustes > General se elige el color de acento (ocho muestras o uno propio) y se arma un tema «Mío» con cuatro colores, con aviso si el contraste queda bajo.
- Chats, Contexto y Cupo son paneles que se arrastran a la izquierda, a la derecha o abajo, se pliegan, se cierran y recuerdan dónde quedaron. El riel queda fijo a la izquierda. En ventana angosta y en el celular todo sigue como antes.
- Los cupos de 5 h y de la semana son dos anillos siempre a la vista en el riel, con insignia (tilde, alerta o cruz), marca del ritmo esperado y el detalle al apoyar el cursor. El panel Cupo suma el ritmo semanal en palabras, el detalle por suscripción y «Ritmo de los workers» (Ahorrar, Normal, Gastar), que cambia el plan del día sin abrir una terminal.
- En el chat, lo que hay que probar va en violeta con un matraz y lo que hay que decidir en ámbar; el aviso de workers muestra cada fila con su ícono y su palabra (terminó, falló, espera, corre).
- Una carpeta o un archivo `.html` nombrado en una respuesta aparece debajo como tarjeta con un botón para abrir la carpeta.
- El chip de modelo de cada fila lleva una marca por familia: rombo para Opus, círculo para Sonnet y triángulo para Haiku.
- El panel de Contexto se acomoda al ancho que tenga: las pestañas ya no se cortan y abajo se arma en dos columnas.

## 0.2.78

- El ajuste «Contexto antes de compactar» ahora también vale para los líderes: un líder de Opus con 300 000 compacta a ese tamaño al arrancar y al reanudar, y el panel de contexto muestra ese tope como límite en vez de 1 000 000.
- Ajustes > Modelos: los chips de «Contexto antes de compactar» vuelven a verse como chips y la lista de «Destrabar» queda bajo su título.

## 0.2.77

- El reparto usa Gemini 4 Hydrogen (con el cupo de Gemini y la calidad medida por Artificial Analysis) y vuelve a usar Claude y GPT por Google mientras agy los sirva.

## 0.2.76

- Al actualizar Trama la ventana se pone al día una sola vez: si ya se recargó sola con la versión nueva, no aparece el aviso de reiniciarla.

## 0.2.75

- Un worker que frena porque le falta información ya no te deja una decisión en el tablero: le llega al líder que lo lanzó, con cómo contestarle y seguir el mismo worker (o darle Chrome y los demás MCP con `--mcp`). A vos sólo te llega si el líder lo anota porque es una decisión tuya de verdad. `lanzar_worker` acepta `id` (seguir ese worker) y `mcp`.

## 0.2.74

- En el chat, una carpeta nombrada sin la ruta entera (`prompts/ficticios/`, `./fotos`) también es un botón que la abre en el explorador de archivos, desde la carpeta de ese chat. Antes sólo andaba con la ruta completa o con `~`.

## 0.2.73

- Contexto del modelo local: «Opciones para más contexto» (MTP, precisión del KV, KV en RAM, capas en la GPU) y el botón «Máximo contexto», hasta 262144 tokens, con la RAM que usa.

## 0.2.72

- «Actualizar» del aviso de Trama nueva anda también desde otra máquina por la tailnet (antes decía que sólo se podía desde la computadora). Hace falta que esa máquina ya tenga esta versión.

## 0.2.71

- Chats de Claude con la caché vencida: aunque esté elegido «Empezar con resumen», Trama ya no abre sola otra conversación; pregunta cada vez y el botón marcado es «Seguir la misma sesión». Si elegís el resumen, el chat nuevo sigue con la cuenta del original.
- Barra en «Recientes»: adentro de cada proyecto, los chats a la vista van por fecha, también los que están quietos.
- La app abre más rápido: Ajustes, el tablero, el chat y cada idioma se cargan recién cuando hacen falta.
- Al cerrar un chat, Trama barre los procesos que dejó colgando.

## 0.2.70

- Tablero: la lista «Probar …» se abre con una casilla por renglón («1 de 4 probados»); tildar todo la cierra. Los items viejos se ven como antes.
- La tarjeta «Te dejé esto» encuentra la prueba de cada worker dentro de esa lista y se tilda desde ahí; el panel clásico del tablero también muestra los renglones.

## 0.2.69

- Medición: cada modelo tiene un solo nombre al leer (`sonnet` y `claude-sonnet-5-5` son la misma fila; el effort pegado al nombre de agy, codex y dsh va a su columna). `pa --rinde` bajó de 107 a 91 filas y el reparto junta antes las 10 corridas que pide.
- Lecturas: una corrida `--leer` cuenta para el reparto según `pa --bien <id> si|no|parcial`, y su aviso al líder termina pidiéndolo.
- Tareas más chicas: frontend, código de varias partes y diseño tienen tope de 50 turnos (90 con `--indivisible "<motivo>"`, que queda anotado); si el contexto se compacta, el worker cierra el pedazo, hace commit y dice qué sigue. `pa` avisa si un pedido grande nombra más de 3 archivos o trae más de un objetivo.
- Al terminar, el worker puede dejar `HALLAZGO:` (algo que el líder tiene que saber) y `FALTA:` (frenó porque le faltó información). Con `FALTA`, la barra muestra «le falta info» y el aviso al líder empieza con «Frenó: le faltó información».
- Reparto sin clave de Artificial Analysis: usa una foto de los datos (del 10/11) con su curva por effort; Ajustes > Modelos dice de cuándo son los datos.
- Fable 5.2 aparece en la tabla de modelos (sigue sin elegirse sin permiso del dueño), y los modelos con calidad estimada dicen «estimada».
- Ajustes > Modelos: cada renglón de «Elegiría hoy» explica por qué, al pasar el mouse o con el teclado.
- Tablero: los «Probar» de los workers ya no crean un item cada uno: se juntan en «Probar <proyecto> (Linux/Windows)», que pasa a «Probar vX.Y.Z» al salir la versión; cada renglón se tilda aparte (`tablero tildar`) y tildar todo lo cierra.
- El número del pie de la barra cuenta sólo preguntas que esperan tu decisión (no pruebas) y ya no muestra «99+».

## 0.2.68

- Actualizar se ve: el aviso de Trama nueva y Ajustes > Actualizaciones muestran el paso real de la instalación («Compilando · paso 2 de 4»), el tiempo que lleva y, si un paso pasa de 3 minutos, «Tarda más de lo normal» con un botón para ver el registro. Con movimiento reducido la barra queda quieta.
- Reinicio más rápido: si el build nuevo sólo cambió la interfaz, la ventana recarga la página en vez de relanzar Electron; al cerrar, un líder sin turno en curso se corta a los 2 s (no a los 8), y las escrituras pendientes tienen tope.
- «Reiniciar la ventana» muestra la tarjeta «Actualizando Trama…» como una actualización.
- La medición del reinicio cuenta cada etapa desde el inicio de su propia corrida y guarda las últimas 30.
- Salud de Trama: bloque plegado en Ajustes > Actualizaciones con los últimos 30 días (vueltas de versión, reinicios lentos, líderes cortados al salir y avisos descartados), o «Todo bien».
- Ajustes > Actualizaciones: la fila «Versión» ya no sale cortada.
- Windows: la carcasa muestra «Descargando N %» e «Instalando» con la misma barra, y anota las vueltas de versión en la salud.

## 0.2.67

- Arranque seguro: Trama ya no vuelve sola a la versión anterior cuando una instalación la cierra desde afuera. Una señal (SIGTERM, SIGINT, SIGHUP) cuenta como salida a propósito, un arranque cortado mientras se instala no suma falla, y `arranque.json` se escribe con candado. Cada arranque y cada salida quedan en `trama.log` con versión, fallas y hace cuánto arrancó el anterior.
- `trama-estado` y el instalador miran primero el socket del motor y después el puerto local: ya no dicen «motor no responde» con el motor andando, y dicen por dónde contestó.
- Reparto: un modelo preferido sin cupo ya no arrastra la elección hacia uno más caro; si no está disponible, se elige normal según el perfil.
- Corrector ortográfico en español e inglés a la vez, con un interruptor en Ajustes > General (prendido por defecto).
- Claude se busca y se lanza siempre con el mismo resolvedor (también en Windows, con `.exe` o `.cmd` del prefijo de npm); un test impide volver a lanzarlo pelado.
- Windows: al cerrar con líderes respondiendo, la carcasa pregunta antes, como en Linux.
- Plan y cupos: el aviso de cupo agotado sale en una sola frase separada, sin repetirse.
- Tests: los de la base ya no dejan carpetas en `/tmp`, y la ayuda de `pa` vuelve a pasar la paridad.

## 0.2.66

- Workers: los que escriben apagan 13 herramientas de Claude Code que nunca usan (programar tareas, worktrees, notebooks, lista de pendientes, entre otras). El arranque de cada corrida baja de 20,5k a 9,7k tokens.

## 0.2.65

- Skill del líder: la guía de orquestar quedó mucho más chica (de 20 KB a 7 KB) y con una tabla de decisión por caso, para gastar menos: los workers en paralelo se lanzan en una sola llamada y se cobran de una, y el effort sale del permitido en Ajustes.
- Medición: el «retrabajo» ya no cuenta el pisado de otra corrida que estaba corriendo en paralelo. Ahora es 1 sólo si alguien retomó la corrida con `--seguir` después de integrarla, si se revirtió, o si otra corrida que arrancó después de integrarla (o cuya tarea la nombra) le reescribió las líneas; cuando la que la pisó ya corría en paralelo, la corrida queda con retrabajo 0 y en la columna nueva `pisado`. `pa --rinde` suma el «% pisado».
- Integrar: `--integrar` ya no compite con los workers por un puesto: si los N puestos están ocupados, integra igual (rebasea en un puesto reservado aparte, con su propio candado para que dos integraciones no se pisen).
- Empuje de `main`: la herramienta que empuja `main` al remoto se busca también en el PATH (no sólo en el motor), así que `main` se vuelve a empujar aunque no sea del repo.
- Barra lateral: cada carpeta tiene un botón «+» en su encabezado que abre un chat nuevo en ese proyecto.
- Windows: los adjuntos y la carpeta del líder se reconocen con las rutas de Windows (las que empiezan con «C:\» o con «\\servidor»). Antes no se veían ni como archivos ni como proyecto.
- Reparto: el costo de cada modelo sale de lo medido en las corridas (medicion.tsv) y no de los pesos fijos; el perfil agresivo ordena por el «US$ por éxito» (el costo por cada corrida integrada sin retrabajo). `pa --rinde` suma la columna «US$/éxito».
- Workers: arrancan más livianos y gastan menos. Los que escriben ya no cargan los conectores (MCP) ni los comandos de slash (salvo frontend y diseño), no lanzan subagentes, y su texto fijo es igual en cada corrida para aprovechar la caché. Cada tipo de tarea tiene un tope de turnos.
- Reparto: en el perfil ahorro, un modelo gratis sin historial propio sólo lee o hace tareas mecánicas hasta probar que rinde en ese tipo; diseño arranca en Sonnet, y Opus no arranca de cero en frontend ni en código de varias partes.
- Sin cupo: cuando Claude se queda sin cupo y el reparto ofrece Gemini, Codex o dsh, `pa` sigue la corrida con ese motor en vez de darla por fallada.
- `pa --seguir` con la caché vencida arranca con el resumen de lo que hizo la corrida, no sólo con el pedido nuevo.
- Modo Objetivo: `--integrar-si-pasa` integra la rama sola cuando el verificador pasa.
- Aviso de Trama al líder: trae el resultado del worker (resumido) y dice si la rama se integró sola o qué espera.
- Integrar: los restos sin commitear de otra corrida ya no se commitean encima del trabajo: van a un parche en `rescates/`.
- Ajustes > Modelos: los modelos de Claude que tu cuenta tiene y una regla deja afuera (como Fable 5.2) se ven en su grupo, apagados.
- Actualizar en Linux: con gnome-terminal o konsole, la ventana de la actualización ya no se da por cerrada al instante.
- Mensajes en cola: si su archivo no se puede leer, se guarda una copia antes de seguir. Algunos errores que salían sólo en español ahora salen en el idioma de la app.

## 0.2.64

- Plan y cupos: se sacó el renglón «Plan de la cuenta de siempre» de arriba (no guardaba); el plan de cada cuenta se elige en su propia tarjeta, y el título de la tarjeta sigue lo elegido.
- Instalación: el lanzador de Trama ya no se cae al arrancar cuando el escritorio le pasa una pantalla Wayland que no existe; usa la que haya. Era lo que hacía volver sola a la versión vieja.

## 0.2.63

- Plan y cupos: cada cuenta de Claude tiene su propio plan, Pro o Max, con un selector bajo su renglón (también la de siempre). Los workers usan el plan de la cuenta que está en uso; si una cuenta no eligió, vale el de la de siempre.

## 0.2.62

- Actualizar: la actualización ya no vuelve sola a la versión anterior cuando todo salió bien (le pasó a 0.2.61). Trae Fable 5.2 y los modelos de Claude según tu cuenta.

## 0.2.61

- Selector de modelo: Fable 5.2, si tu cuenta de Claude lo tiene. La lista de modelos de Claude ahora sale del catálogo de tu cuenta: un modelo nuevo aparece solo, sin esperar una versión de Trama; Fable 5.1 pasa a «Anteriores».

## 0.2.60

- Selector de carpeta del líder: cada proyecto con su logo.
- Selector de modelo: fuera Opus 4.1, Opus 4 y Sonnet 4. Probados uno por uno: los dos primeros los atiende Opus 5.5 y el tercero da error.

## 0.2.59

- Novedades en el idioma de la interfaz: con Trama en inglés, el aviso y Ajustes > Novedades salen en inglés.

## 0.2.58

- Novedades: al actualizar, un aviso con lo que trajo la versión nueva (y las intermedias si saltaste varias). En Ajustes, la lista de todas las versiones.

## 0.2.57

- Conectores como tienda: pestañas Skills, Conectores, Plugins y Hooks; «Tuyos | Descubrir»; buscador, categoría, orden y «Agregar»; tarjetas con qué hace cada cosa, de dónde viene y su uso o instalaciones, y un detalle. En Plugins, Descubrir trae Para vos, Nuevos, Más instalados y Categorías.
- Selector de modelo: también las versiones anteriores de Anthropic y de Google, debajo de «Anteriores» y con su esfuerzo válido.
- Barra: cada carpeta de proyecto muestra su logo chiquito al lado del nombre.

## 0.2.56

- Preguntas de un líder: el panel ya no tapa la conversación. Tiene tope de alto con scroll propio y se pliega a «N preguntas pendientes».
- Un chat que arranca en la carpeta de inicio pasa solo al proyecto donde trabaja (lanza `pa <proyecto>` o edita ahí), salvo que lo hayas movido a mano.
- Rutas de archivo en un mensaje (por ejemplo `/usr/bin/agy`): se abren mostrando el archivo en su carpeta.
- Perfiles de ahorro ordenados de más ahorro a más calidad, con una línea que lo explica.

## 0.2.55

- Actualizar: la ventana se relanza si el build cambió, aunque no haya oído el aviso del motor. Antes podía quedar con el proceso viejo y la página nueva.
- Abrir una carpeta desde un mensaje: si falla porque la app no pudo pedirlo, dice que hay que reiniciar Trama, no que «no es una carpeta».
- Pastilla de fondo: se cierra cuando la tarea termina a mitad de un turno, y una salida que nombra un proceso de fondo ya no cuenta como tarea.

## 0.2.54

- Ahorro: perfil `agresivo` en `reparto` (el modelo más barato que supere el piso de cada tipo). El perfil activo se ve y se cambia desde la barra de cupos.
- Borrar proyecto: en el menú de la carpeta. Lo quita de Trama, manda la carpeta a la papelera con guardas y se puede deshacer; no deja borrar con trabajo vivo.
- Tablero: «Limpiar» en masa con filtros y sugeridos desactualizados; cierra sin borrar y se puede deshacer.
- Chat: tarjeta «Te dejé esto en el tablero» cuando un líder o un worker suyo deja una pregunta o una prueba.
- Panel de contexto: tras compactar deja de mostrar lo de antes.
- Conectores: orden por uso, más «Descubrir»: catálogo de skills y conectores MCP, siempre con confirmación antes de instalar.
- Tienda de plugins: filtro por categoría y orden por recientes y más instalados.
- Limpieza de ramas y puestos viejos desde el panel de Ramas; textos más claros en conectores y guías al día con lo nuevo.
- Workers `--leer` de Gemini: pueden buscar y leer en internet.
- Windows: `pa`, `orquesta`, `lanzar`, `reparto`, `trama-estado` y Cuentas buscan `agy` y `claude` igual, también fuera del PATH y como `.cmd` de npm.
- Trama espera las escrituras pendientes al cerrar; tests más estables y CI en verde en Linux y Windows.

## 0.2.53

- Workers: `pa` vuelve a encontrar `reparto`, `tablero`, `cuentas` y sus hooks en toda instalación. Antes todos caían en silencio a Sonnet; ahora eligen según calidad y cupo, y si falta una pieza se ve.
- Un worker ya no queda como «trabajando» (ni sumando horas) si su proceso murió: el `.running` huérfano sólo cuenta si su pid es de verdad esa corrida (no un pid reciclado ni un hilo ajeno). La fila pasa a «murió» y `Parar` cierra el rastro en vez de decir que la corrida no existe.
- Los workers `--leer` pueden buscar en internet.
- Un líder en bypass que pasa a modo plan ya no pide permiso por cada comando (sí por `ExitPlanMode`, preguntas y edición), y Shift+Tab dice en palabras a qué modo pasó.
- Barra: la actividad de un chat es su último turno real, un reinicio sólo levanta lo reciente y hay Limpiar chats.
- Chat nuevo: carpeta Auto por defecto. La carpeta de un chat y un título ya mostrado no cambian solos; lo puesto a mano manda.
- Cuentas: «Usar en nuevos» dice que vale para los chats nuevos, el chat ofrece pasar a otra cuenta si la suya está en el tope, y cada cuenta muestra 5 h y semana juntas.
- La pastilla de fondo muestra en vivo las últimas líneas de la salida de cada tarea.
- El panel de consumo no ocupa lugar en Ajustes, Tablero, Ramas ni Estadísticas.
- Windows: `agy` y `claude` fuera del PATH o como `.cmd` cuentan como instalados, Cuentas no nombra Ubuntu, Trama ya no ejecuta `ollama` y el motor oculta sus consolas.

## 0.2.52

- Pastilla arriba de la caja con lo que el líder dejó corriendo de fondo y hace cuánto. Al tocarla, la lista.
- El resumen del turno dice «lanzó» una tarea de fondo mientras sigue corriendo, no «terminó».

## 0.2.51

- Clic derecho en el ícono de un proyecto (riel y lista): Renombrar, Cambiar logo y Volver al automático.
- Buscador en Ajustes > Proyectos para encontrar uno sin recorrer la lista.
- Un comando o herramienta largo que no suelta salida ya no se muestra como pausa ni «Sin novedades»: la tarjeta sigue como trabajando y dice hace cuánto no sale nada.
- Una corrida terminada ya no figura «en cola» semanas después: el `.pid` sólo cuenta si es de verdad esa corrida (un proceso, no un hilo ajeno, que arrancó antes que el archivo). `Parar` y «Cerrar y parar todo» ya no pueden señalar a un programa ajeno que reciclara ese número.

## 0.2.50

- Las carpetas que nombra un mensaje se abren con un clic en el explorador de archivos.

## 0.2.49

- Windows: ya no se abre un CMD un instante al actualizar los usos ni con otras tareas de fondo.

## 0.2.48

- Avisos de que murió un worker: ya no se acumulan ni quedan fijos. Sale un cartel gris que junta varios («Murieron 3 workers»), se va solo a los 7 s y no vuelve a aparecer. El estado sigue en la fila de cada worker.
- Las pastillas de trabajo del hilo llevan un ícono según la acción: comando, leer, editar, buscar, web, skill, MCP, delegar y esperar, entre otros.

## 0.2.47

- Los workers de agy, codex, opencode y dsh ya no se ven vacíos: su hilo muestra el pedido, los comandos y la respuesta, y se actualiza mientras corren.
- `pa --hilo` lee también el stream de esos motores, con el mismo formato que los de Claude.

## 0.2.46

- Reiniciar Trama ya no marca a los líderes como muertos: quedan retomables. Un líder sólo figura como muerto tras 7 días sin actividad. Un fallo real se sigue mostrando.
- Tarjeta de un líder trabajando: nuevo diseño Frase, más bajo. Dice qué está haciendo en palabras, con un solo estado, aviso en ámbar a los 2 minutos sin novedades, y se pliega al terminar.
- Vista de un worker: nuevo diseño Hilo. Pasos en palabras, repetidos agrupados, tira de tiempo por tipo, filtro «Sólo cambios» y rutas clicables.
- Mensajes en cola: bandeja Solapa sobre la caja, con Editar, Borrar, reordenar y «Enviar ahora». Cerrados cuatro casos en los que un mensaje se podía perder.
- Barra: chip de modelo y esfuerzo, títulos reales de los workers, «corre hace 4 m» y «Uncached» en tooltip.
- Cupos: agrupados por suscripción, «% usado», ámbar desde 80 %, rojo sólo sin cupo, y aviso si no se pudieron actualizar.
- Avisos de workers más chicos: una fila por worker, primero los que piden una decisión.
- «Show context» pasa arriba a la derecha.
- Una ruta con * o ? ya no se trata como imagen ni muestra «Imagen no disponible».

## 0.2.45

- Barra lateral: vuelven las señales de siempre. El ⚡ con el tiempo en la conversación caliente a la vista, el tiempo en palabras («hace 2 m», «ayer», «hace 3 d»), las frases tiernas, «2 sub.» y los tooltips. Lo que corre late y lo trabado gira. La palomita queda sólo en el worker que terminó, nunca en un líder.

## 0.2.44

- OpenCode gratis sin cupo: el líder ya no queda «Pensando» para siempre; corta el turno, lo dice en palabras y ofrece cambiar de modelo. El selector lo marca sin cupo.
- Windows: arreglada la ruta de la carpeta del proyecto en los checkpoints por turno.
- CI de GitHub en verde en Linux y Windows, con la prueba de la interfaz incluida.

## 0.2.43

- Barra lateral pulida: vuelven las coronas de los líderes con sus workers colgando debajo; los terminados se pliegan en «N terminados». Cada proyecto tiene su color, lo que corre muestra «N en marcha» y lo que pide atención resalta con ícono y palabra. Se fue el filtro «sólo líderes».

## 0.2.42

- Barra lateral nueva («Riel»): una línea por conversación, agrupada por proyecto, con riel de proyectos a la izquierda y buscador; entran muchas más conversaciones a la vista. Los cupos pasan a dos anillos chicos que se abren al tocarlos.
- Ajustes > Plan y cupos nuevo («tejido»): un renglón por cuenta con 5 h y semana juntos, estado en palabras, «En uso» y «Usar» (la cuenta la cambiás vos).

## 0.2.41

- MCP de Trama: líderes y workers de cualquier motor pueden lanzar workers, ver su estado, buscar en los hilos y mandarle un mensaje a otro líder. Se registra solo en cada motor.

## 0.2.40

- Checkpoints por turno: debajo de cada turno del líder que tocó archivos, el diff y «Volver a antes de este turno» con confirmación.
- Tareas programadas: mandar un mensaje a un líder más tarde («en 30 min», «18:30», «mañana 9:00») y posponer una conversación; sobreviven a un reinicio.
- Comando `pantalla` para que los workers prueben la interfaz en una Trama propia oculta (probado en Linux).

## 0.2.39

- Modo Objetivo: un worker se relanza solo hasta que pase el comando que lo verifica (`pa --objetivo --verificar`), y en Actualizar rama hay un campo opcional «Comando que verifica».
- Los colores sueltos pasaron a tokens del tema, y el chequeo de colores corre con los tests.

## 0.2.38

- Rediseño completo en vidrio: panel de contexto, cabecera del hilo y composer, vista de worker, Ajustes, Tablero, Estadísticas, Ramas, Bienvenida, popovers y menús.
- «Seguir con otro modelo»: desde el menú del hilo o un aviso de límite, la conversación sigue con otro modelo a partir de un resumen.
- El chip «N falló» y el rojo del líder cuentan sólo los fallos sin resolver.
- Cada tarjeta de cupo dice cuándo vuelve su ventana (Gemini ya no dice «week»).
- Ajustes > Cupos: la tarjeta NVIDIA NIM sin clave tiene botón «Poner clave».
- Accesibilidad: texto tenue con contraste AA en todos los temas, foco visible y etiquetas en botones de ícono.

## 0.2.37

- Rediseño (vidrio): la tarjeta de cupos pasa a tarjetas con la cifra grande (Claude 5 h y semana, Google en tres chicas, OpenCode en cápsula); lo que está sin cupo va tintado con «sin cupo» y la hora en que vuelve.
- Lo que pide tu atención se nota a simple vista: un worker que falló va en coral con borde luminoso y «Relanzar» relleno; una decisión pendiente, en ámbar; lo que corre o terminó queda calmo.
- Lista de líderes: chips «N falló» y «N esperan» arriba (llevan al primero), y sólo resaltan las filas que necesitan algo de vos.

## 0.2.36

- Reparto: cuando OpenCode gratis corta por límite de uso, ese camino queda agotado (antes seguía mostrando «cupo 100 %» y el worker moría).
- `tablero` encuentra su versión compilada también en la instalación (antes caía a la de python).
- Seguir con otro modelo (base): resumen de traspaso desde el transcript y `pa <proyecto> --seguir-con <modelo> --id <id>`. La acción en el hilo llega en la próxima.
- Tests sin esperas por reloj: un chequeo corre antes de `npm test`.

## 0.2.35

- Selector de modelo: los modelos sin cupo se ven atenuados con «sin cupo hasta <fecha>» (punto ámbar si queda poco), y una línea con qué trae cada motor (skills, MCP, subagentes, imágenes).
- Líder nuevo: si el pedido nombra un proyecto, la carpeta se elige sola; el selector de carpeta tiene buscador (nombre y ruta, flechas, Enter, Esc).
- Tarjeta de aviso de workers: cada fila con su color (verde terminó, ámbar pide decisión, rojo falló); un worker con commits pero sin resumen sale «terminó sin resumen», no como falla.
- Las skills de Claude se enlazan solas para los workers de agy, codex y opencode (respetando lo apagado).
- Reparto: «Camino hoy» ya no nombra modelos apagados.

## 0.2.34

- Panel de contexto: un `?` en cada categoría, lista de Herramientas, texto real del prompt de sistema, pestaña Vista previa (qué cargaría un líder o worker nuevo) y refresco solo cada 3 s.
- Subagentes del líder en el panel: gasto por subagente y desglose.
- Los avisos de workers despiertan al líder ocioso (~20 s, agrupados), sin esperar tu próximo mensaje.
- Reparto por cupo: un worker `claude-*` pasa solo a agy si tiene más cupo libre (`--exacto` lo evita); si agy corta por cupo, se relanza por Claude. Estadísticas muestra las sustituciones.
- Los workers heredan los MCP del usuario en modo diferido, respetando lo apagado.
- Workers de frontend y diseño cargan las skills de diseño instaladas.
- Vista de worker: la columna central ya no se corta con rutas largas.

## 0.2.33

- Windows: el instalador sólo toca sus propios archivos. Lo ajeno que quede dentro de la carpeta de Trama (por ejemplo logs de un servidor MCP) ya no traba la actualización, y si algo propio queda bloqueado se avisa qué archivo es.
- Windows: Trama nunca lanza el motor, líderes, agy ni MCP con la carpeta de instalación como directorio de trabajo.

## 0.2.32

- Panel de contexto: MCP y skills medidos por lo que de verdad está cargado (los MCP diferidos casi no cuentan), y el total cuadra con sus ítems y no cambia al refrescar.
- Panel de contexto: «Sistema» partido en piezas (prompt base, cada CLAUDE.md, memoria, hooks de inicio, skills) con sus tokens y su texto.
- Catálogo de skills: cuenta los usos de todas las sesiones, incluidas las que carga un hook (por ejemplo caveman).
- Panel de contexto: lo apagado se ve gris y no suma; botón Compactar (y clic derecho) en Mensajes.
- Título corto del líder: ya no puede quedar texto de una herramienta como `<invoke_tool …>`; los títulos así se corrigen solos.
- Windows: actualizar ya no falla si un `node.exe` de Trama está en uso, el node de Trama va al final del PATH de los procesos hijos y la copia para volver atrás guarda bien `app.asar`.

## 0.2.31

- Avisos de workers al líder: ya no se pierden si el líder o Trama se reinician mientras el worker corre. Quedan en una cola persistente y cuentan como entregados sólo cuando llegaron; al retomar un líder le llega un resumen de sus workers que terminaron mientras no estaba.

## 0.2.30

- Panel derecho de contexto nuevo: sólo el líder que mirás y sus workers, con barra apilada, mapa de bloques y lista por categoría (mensajes, herramientas, MCP, skills, memoria, sistema). Cada skill, conector, herramienta o archivo de memoria muestra sus tokens, cuántas veces se usó ("nunca usada") y un interruptor para apagarlo en todo Trama.
- Catálogo de skills con buscador y filtros (apagadas, nunca usadas, por plugin).
- Aviso de conversación inactiva: muestra sólo los tokens, sin el % de cupo estimado (no era fiable).

## 0.2.29

- Ajustes: la tabla "Precios de API" sale sólo en Ajustes > Modelos (aparecía arriba de todas las pestañas).

## 0.2.28

- Windows: ya no se abren ventanas de CMD sueltas (líderes, agy, MCP y chequeos corren con la consola oculta).
- Líder de agy (Gemini/Flash): sus workers ya no mueren al terminar el turno; en Windows salen afuera del job.
- Cupo de agy en la cabecera: se lee cada 10 min (antes 3 min, y cada lectura levantaba todos los MCP).
- Retomar un líder de Claude usa la cuenta principal elegida.
- Caché vencida: al retomar una conversación larga, Trama pregunta si seguir la misma sesión o empezar con un resumen, con el gasto estimado; se puede recordar la elección (Ajustes).
- Relevo más compacto: menos tokens al pasar a un líder nuevo.
- Títulos cortos: los chats se titulan con ≤6 palabras del tema (no el primer mensaje entero) y los workers por el Objetivo del brief; un título puesto a mano no se toca.
- Actividad: cada archivo que el agente, un worker o un subagente lee, escribe o edita se abre en el visor (imagen con miniatura, PDF, texto, markdown, audio, video; si no, con la app del sistema).
- Avisos de workers: el texto ya no queda aplastado; título en dos líneas, motivo debajo y el botón de relanzar en su fila.
- agy: el conteo de tokens de entrada ya no da negativo.

## 0.2.27

- Actualizar seguro: Trama guarda la versión anterior; si la nueva no abre o se cierra sola dos veces, vuelve sola y avisa. Botón "Volver a la versión anterior" en Ajustes > General.
- Nuevo líder arranca en el proyecto seleccionado o el último usado (no en la carpeta personal), con el selector de proyecto a la vista.
- Las conversaciones de workers se agrupan bajo su proyecto en vez de aparecer como proyectos sueltos.
- Cambiar de cuenta en una conversación: el aviso de Claude sale traducido, en una línea, con "Volver a <cuenta>"; y se avisa antes de cambiar.
- Workers: comparten node_modules sólo si el lockfile es el mismo; si no, instalan el suyo.
- `npm run check:changed`: chequeo rápido de sólo lo que cambió.

## 0.2.26

- Avisos de Trama (worker terminó/falló) se ven como fila de sistema, no como mensaje tuyo; el id abre el hilo del worker.
- Panel de Conectores (/mcp) rediseñado: agrupado, con ícono y estado en palabra; los apagados en el proyecto se prenden con un interruptor y los que piden sesión llevan a claude.ai.
- Barra de cupos: "2 d 17 h" en vez de "2 d", y la fecha y hora exactas del reinicio al pasar el mouse.
- Estadísticas: costo equivalente en dólares por modelo (precios editables en Ajustes > Modelos) y tiempo en cola de los workers.
- Limpieza de worktrees y ramas viejas ya integradas (Ajustes > Proyectos, con lista y confirmación; automática apagada).
- pa: cada worker deja una línea FRENÓ y `pa --rinde` junta las más frecuentes; se recompila solo si su código cambió.
- Windows: la carcasa quedó como adaptador fino y sin rastros de WSL.

## 0.2.25

- Limpieza de worktrees y ramas viejos de pa: `pa --limpiar [--ver|--si] [--dias N] [--json]` quita los puestos libres y sin cambios, las ramas de corridas que ya entraron a main y el build sin usar, con N días de antigüedad (7 por defecto); nunca una rama con trabajo sin integrar ni algo en curso. En Ajustes > Proyectos: lista de lo que se borraría, confirmación y una pasada automática que viene apagada.
- Gemini (agy): los modelos dependen de la cuenta, la región y la versión de agy. `reparto` elige sólo entre los que ese agy ofrece (los que no conoce entran con calidad estimada y marcada `~`), el selector de modelos los muestra, y si agy rechaza un modelo `pa` lo marca como no disponible y relanza con el siguiente candidato en vez de cortar.
- Barra: proyectos y líderes ordenados por lo último que se usó, con control "Recientes | A-Z" que se recuerda.
- Workers con modelos locales (dsh): compactan antes de llenar el contexto, que sale del `-c` real del modelo.
- Tests: ya no crean líderes en el estado real ni dependen de la memoria libre o de la máquina.

## 0.2.24

- Windows: pasar un líder a Claude por Google ya no da "spawn ENAMETOOLONG" (el mensaje va por stdin).
- Windows: el plugin pa-worker de agy se instala solo; si un modelo no se puede usar, pa pasa al siguiente con cupo en vez de cortar.
- Subagentes de Claude Code: muestran modelo y esfuerzo, con de dónde salen.
- Subagentes: "Ver informe completo" muestra su texto.

## 0.2.23

- Proyectos: toda carpeta donde trabaja un líder se anota sola en Ajustes > Proyectos (también las de líderes que ya existían).
- Barra de cupos: con varias cuentas de un proveedor, cada una muestra "En uso" o un botón "Usar primero".
- Ajustes: la barra de Guardar aparece sólo cuando hay cambios.
- Selector de modelo y esfuerzo unidos: el panel deja elegir también el esfuerzo.

## 0.2.22

- Windows: las cuentas agregadas de Claude comparten conversaciones, plugins, skills y ajustes con la principal (como en Linux). Las que ya existían se unen solas, sin borrar nada. Retomar una conversación con otra cuenta ya no da "No conversation found".
- Windows: los agentes usan PowerShell en vez de Git Bash (Ajustes > General > Terminal de los agentes).
- Imágenes que manda el líder (rutas locales o de herramientas) se ven en la conversación; si no existen, lo dice.
- Una sola lista de canales para Linux y Windows.
- Linux: AppImage en cada release.

## 0.2.21

- Cuentas: botón "Usar primero" en cada cuenta y selector de cuenta en el líder. Trama nunca cambia de cuenta sola.
- Ajustes > Celular: prender, agregar o quitar un dispositivo se aplica al instante; el link y el QR aparecen solos.
- Líder y workers: cada texto que escribe el modelo mientras trabaja queda en la conversación, en orden.
- Celular: la barra de copiar, volver y hacer rama ya no tapa el texto; íconos del modo que se ven en todos lados.
- CI de Windows en verde.

## 0.2.20

- NVIDIA NIM: clave, ayuda, modelos y cupo en la app; un límite de NVIDIA enfría sólo ese modelo.
- Ajustes > Locales: pantalla completa de modelos locales.
- Pensamiento del líder en vivo mientras trabaja.
- Líder caído: "Este líder se detuvo" con botón Retomar.
- Panel derecho: por cada worker vivo, cuánto lleva, el último paso y un botón para abrirlo.
- Conversaciones de Claude Code en cada proyecto ("De Claude Code"), para retomarlas en Trama.
- Ajustes > Conectores: catálogo de plugins (anthropics/skills, oficiales u otro repo) y plugins sincronizados de claude.ai.
- Windows: conectar una segunda cuenta ya no muestra "main.cuentasFallo".
- Windows: DeepSeek Harness se detecta en `%USERPROFILE%\.local\dsh.cmd`.

## 0.2.19

- Versiones nuevas casi al instante (Linux y Windows): Trama mira cada 2 minutos, al volver a la ventana y al volver la red; el aviso siempre muestra la última.

## 0.2.18

- Ajustes > Conectores: skills, plugins, servidores MCP y hooks en un solo lugar, con de dónde viene cada uno, qué hace, buscador y prender/apagar.
- Mensaje mandado con el líder trabajando: dice "en cola" hasta que el líder lo recibe.
- Editar un mensaje: la caja crece con el texto y se pueden quitar, agregar o pegar capturas.
- Bienvenida: "Conectar otra cuenta" aunque Claude ya esté conectado; estado de los modelos locales.
- Ramas: "Ver el análisis" vuelve a la conversación del líder que analizó la rama.
- Avisos al líder: uno solo al terminar la tanda (o por worker, en Ajustes > General); cupo y cuelgues, al momento.
- Artificial Analysis: actualizar desde la laptop o el celular ya no da error de conexión.

## 0.2.17

- Acceso desde el celular con Trama instalada (Linux y Windows): se prende desde Ajustes, sin tocar el servicio; escucha sólo en Tailscale y sólo entran los dispositivos de la lista.
- Windows: los cupos de Claude (cuenta de siempre y agregadas) se leen bien.
- Ajustes > OpenCode y Modelos: el texto ya no se amontona ni se sale de la pantalla.

## 0.2.16

- Windows nativo: elegir carpeta (agregar proyectos, carpeta del líder), portapapeles, salir y los demás pedidos de la ventana ya andan (antes "canal desconocido").
- Ajustes > Actualizaciones también en Linux; el aviso ya no queda trabado en "Actualizando…" de una instalación vieja.
- Logos de proyectos: Trama usa el ícono del proyecto (favicon, logo, ícono de la app) o la inicial; en Ajustes > Proyectos se puede elegir otro.
- Prueba de humo de Windows (`windows/humo/humo-gonza.ps1`).

## 0.2.15

- Windows nativo: el `pa` de TypeScript tiene todos los modos (conversaciones, archivar, renombrar, proyectos, medición, modelos, workers con todos los motores, relanzar sin cupo). Se acabó el error "todavía no está en el pa de TypeScript".
- Windows nativo: la barra de título vuelve, transparente, y los botones de Windows ya no tapan nada.

## 0.2.14

- Windows nativo: `pa`, `reparto`, `tablero` y `cuentas` se lanzan bien (conversaciones que no se guardaban, Plan y cupos sin datos).
- Windows nativo: sin barra de título; el contenido ocupa toda la ventana y los botones flotan arriba a la derecha.
- Windows nativo: la versión sale de la app (no más 0.1.3), se llama Trama y no Electron, y cada release trae lo que necesita "Buscar actualizaciones".
- Windows nativo: Handy se detecta donde lo instala su instalador; actualizar Antigravity usa `agy update`.

## 0.2.13

- Windows nativo (beta, sin WSL): instalador .exe en esta release. Al instalar trae solas las cuentas de Claude de una Trama anterior (copia sus logins, no toca los originales).
- `pa` en TypeScript conectado de punta a punta (se prueba con `TRAMA_PA=ts`; lo que falta cae al de siempre).
- Tests: un archivo que se pasa del tope de tiempo se corta entero, sin dejar procesos colgados.
- Docs: estado del port a Windows y lista de pruebas para un Windows real.

## 0.2.12

- Avisos de workers: ya no avisan "se cortó sin dejar mensaje" de un worker que sigue corriendo.
- CI en verde (Linux, Windows y armado del .exe nativo); prueba de humo del motor en Windows.
- Windows (en camino): todas las piezas de `pa` portadas a TypeScript (opciones, lanzar, motores, `reparto`); falta conectarlas.

## 0.2.11

- Windows (en camino, todavía no se publica): la app ya sabe abrir la terminal, cortar procesos y lanzar programas en Windows; `pa` en TypeScript avanza (puestos, worktrees, esperar/parar/matar, integrar y lecciones); `tablero` y `cuentas` portados; carcasa nativa y armado del .exe listos para probar en CI.
- CI: los tests que dependían de esta máquina ya no rompen el job de Linux y cada archivo tiene tope de tiempo.

## 0.2.10

- Avisos de workers: cuando uno termina, falla o se cuelga, el líder que lo lanzó se entera solo; notificación de escritorio para fallas y para "terminó la tanda" (configurable en Ajustes > General). Falla por cupo: dice el proveedor, cuándo vuelve y ofrece relanzar con otro modelo.
- Ajustes > Plan y cupos > Avanzado: los umbrales donde pa deja de usar un proveedor son editables, para Claude y Google, con botón para volver al de fábrica.
- Los topes de OpenCode Go se leen de OpenCode (con respaldo sin red, que muestra la fecha).
- Un subagente cortado por una interrupción ya no queda "Running" para siempre.
- `gate --espejo` corre el test oculto; `gate --plan` calcula tamaño, riesgo y archivos calientes desde el plan.

## Sin publicar

- Avisos de workers: cuando uno termina, falla (por cupo, con el proveedor y cuándo vuelve) o se cuelga (15 min sin actividad), el líder que lo lanzó recibe un mensaje corto por la cola y el dueño una notificación (PC y celular) por las fallas y cuando termina toda la tanda; los terminados normales suman un punto en la bandeja. Se prende en Ajustes > General; una falla por cupo ofrece «Relanzar con otro modelo».

## 0.2.9

- Los topes de OpenCode Go (pedidos cada 5 h y USD por mes, Go y Go Plus) se leen de opencode.ai/go al arrancar y cada día, y se guardan con su fecha de lectura; sin conexión se muestra la copia que viene con Trama («Datos del <fecha>»). `reparto` y los workers leen lo mismo.
- `pa --tarea` anota cada corrida en `estado.tsv` (`--subtarea`); `gate` anota su resultado ahí y corre el chequeo con las dependencias del proyecto (antes daba rojo falso).
- `pa --async` con varios modelos (`-m a,b`) relanza solo con el siguiente si se corta OpenCode; `--auditar --decisiones` le pasa al auditor lo decidido a propósito.
- `clasificar` nuevo: dice qué hacer con un intento fallido (rehacer el pedido, reintentar, subir de modelo o preguntarle al dueño).

## 0.2.8

- Actualizar ya no queda trabado en "Actualizando…" si el instalador anterior terminó después de que arrancó el motor nuevo.

## 0.2.7

- El botón "Notas de la versión" del aviso de Trama nueva abre el release en el navegador (antes no hacía nada).

## 0.2.6

- OpenCode 2.x: los workers ya no pueden escribir fuera de su carpeta (cada corrida usa su propio servidor y la config bloquea lo de afuera; en el líder, pregunta).
- OpenCode 2.x: una corrida que termina bien ya no se marca como fallida (2.x no cierra el último paso).
- `pa`: rechaza modelos y esfuerzos apagados en Ajustes; fases, tareas y rúbrica para medir el rendimiento; `gate` para revisar el trabajo de un worker antes de integrarlo.
- Ajustes > Modelos: contexto antes de compactar, por familia (Haiku 300k).

## 0.2.5

- El aviso de Trama nueva aparece a los 30 min como mucho (antes 6 h).
- Ajustes > General: versión de Trama y botón "Buscar actualizaciones".

## 0.2.4

- El líder elige modelo y esfuerzo de cada worker según el pedido. `reparto --resumen` le da al arrancar un resumen corto de cada modelo (nivel por esfuerzo, costo, cupo, para qué sirve); `reparto` sólo avisa si el modelo elegido no tiene cupo.
- Haiku por defecto para lo que se puede describir con precisión, con guía de cómo escribirle el pedido. Sonnet si es ambiguo o Haiku falló; Opus sólo para bases, bug sin pista o tras un fallo.

## 0.2.3

- Actualizar desde la app sin cortar trabajo: con líderes o workers activos ofrece "Actualizar cuando terminen" o "Actualizar ya" (con confirmación). Al terminar avisa "Trama X instalada" con botón para reiniciar la ventana.
- El instalador corrido desde `motor/scripts` de un checkout ya compila la app y anota de dónde actualizar (antes quedaba en la versión vieja diciendo "listo").
- Ajustes > Proyectos: botón "Merge with AI" en el aviso de instrucciones repartidas.
- Reparto: frontend y código de varias partes piden nivel Sonnet, no Argon (sin cupo de Argon caía en Opus).

## 0.2.2

- Mensajes en cola: todo lo encolado le llega al líder junto, en un solo mensaje y entre herramientas, sin interrumpir.
- Barra de cupos: logos siempre visibles, Google con filas de Gemini, Claude/GPT y Argon (5 h y semana), cuánto falta para el reinicio a la vista y tooltip corto. Sin filas "principal" repetidas.
- OpenCode: varias cuentas (cada una aislada), plan Gratis/Go/Go Plus detectado solo y fila propia en la barra.
- Subagentes: los terminados se pliegan y se archivan.
- Chip de modelo: muestra el esfuerzo en todos los motores (palabra y gráfico, max lleno).
- Proyectos: estado de instrucciones legible, "Acortar con un agente" y fusión con un agente.
- Transición corta entre vistas y piezas nuevas de Ajustes.
- Base para detectar modelos locales de llama.cpp, LM Studio y vLLM (la pantalla llega en la próxima).

## 0.2.1

- Aviso de "hay una Trama nueva": Trama mira el último release y ofrece Actualizar desde la app (sin GitHub ni comandos).
- Cambiar el modelo o el esfuerzo mientras el líder trabaja: se aplica al próximo mensaje, y un mensaje en cola sale con lo elegido al mandarse. El selector marca "próx." cuando hay un cambio pendiente.
- Subagentes en la vista grande: tocar su tarjeta abre sus pasos, en vivo o con el informe final.

## 0.2.0

### Modelos y motores
- OpenCode y DeepSeek Harness como motores de líderes y workers, con modelos gratis (OpenCode) y Ollama.
- Seguir una conversación con otro motor (Claude, Gemini, OpenCode, DeepSeek Harness): se pasa el historial y queda una raya "Siguió con…". Pide confirmación antes de cambiar.
- OpenCode Go (plan pago de OpenCode, apagado por defecto): en Ajustes > OpenCode se elige Gratis / Go / Go Plus. Con Go, sus modelos se ofrecen a líderes y workers como «Plan Go», con cupo propio por modelo (un 429 agota sólo ese modelo, unas 5 h) y costo marginal ~0 en el reparto. Los topes por modelo están en `motor/opencode/go-topes.json` y se ven en Plan y cupos. Sin Go, opencode usa un modelo gratis para los títulos de sesión (antes podía intentar uno de pago y dejar un 402).
- Selector de modelos compacto: proveedores a la izquierda, búsqueda en todos, marca "Gratis" / "De pago".
- Inteligencia de los modelos desde Artificial Analysis, actualizada a diario y por esfuerzo (low, medium, high, xhigh, max). `reparto --aa-diag` muestra con qué entrada de AA se emparejó cada modelo.
- El modo de permisos queda fijo y explicado en líderes de Gemini, OpenCode y DeepSeek Harness.
- Volver, Editar y Ramificar en todos los motores (no sólo Claude) y en conversaciones con varios motores.
- El rayito de caché sólo en Claude, con la duración real del pedido (1 h con suscripción, 5 min con API o créditos).

### Reparto de workers y cupos
- Ritmo semanal: si la semana va más rápido que el cupo, los workers pasan a modelos gratis o de Google; si sobra cupo cerca del reinicio, se aprovecha.
- Perfiles Ahorro / Equilibrado / Rendimiento y reserva del semanal de Claude para el líder.
- `pa --plan ausente|gastar-hoy|ahorrar-hoy|ver|borrar`: avisarle a los agentes que mañana no estás o que hoy conviene gastar o ahorrar.
- El mínimo de calidad por tipo se mide al mismo esfuerzo (las tareas de código acotado vuelven a Sonnet, no a Opus).
- Elegir qué modelos pueden usar los workers.

### Orquestación
- Tareas con plantilla (Listo cuando / Cómo verificar), detalle según la inteligencia del modelo, verificación obligatoria ("sin verificar"), lecciones por proyecto con poda, y `pa --auditar` para que otro modelo revise una rama.
- `AGENTS.md` como única fuente de instrucciones para todos los motores: `pa --unificar-md` y "Unificar en AGENTS.md" en Ajustes > Proyectos.

### App
- Barra lateral: sección "Activas" arriba con las sesiones calientes; proyectos con nombre propio (Ajustes > Proyectos); la fila se abre tocando cualquier parte.
- Usos rediseñados por proveedor y grupo, también con la barra angosta.
- Temas de color (Sistema, Oscuro, Claro, Bosque, Atardecer, Grafito, Contraste), probados para contraste y deuteranomalía.
- Ramas: tarjetas con filtros, "Aplicar todos los veredictos", Auditar; "Analizar de nuevo" con cualquier modelo.
- Guías por pantalla para usuarios nuevos y para lo nuevo de cada versión ("no volver a mostrar", "más tarde" o apagarlas en Ajustes > Guía).
- Estadísticas y Tablero rediseñados; Guía en Ajustes; umbral de compactar libre.
- La caja de texto queda en una sola fila a cualquier ancho y sigue al modelo real del líder.

### Instalación
- Un solo comando actualiza el motor y la app de escritorio: `git pull; bash motor/scripts/instalar-producto.sh`.
