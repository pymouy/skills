---
name: pymo-gateway
description: "Integrar la API del gateway de pymo, facturación electrónica CFE de Uruguay ante DGI: login por sesión (cookie connect.sid), emisión con sendCfes y clientEmissionId, consulta de estado, recepción de comprobantes de proveedores y datos de referencia. Integrate the pymo Gateway API for Uruguayan electronic invoicing (CFE / DGI e-invoicing). Usar al escribir, revisar, depurar o testear código que nombre pymo, que llame a gatewaytest.pymo.uy o gateway.pymo.uy, o que use identificadores propios de esta API: sendCfes, clientEmissionId, cfesActiveNumbers, inSobres, connect.sid. Use when the work names pymo or calls those hosts. Los términos fiscales generales -CFE, DGI, RUT, CAE, eFactura, eTicket- activan esta skill sólo junto a pymo o a su API: por sí solos pueden ser cualquier proveedor uruguayo, y esta skill no describe el régimen fiscal, describe una API. No usar para preguntas conceptuales sobre facturación electrónica, ni para otro proveedor, ni para el CFDI mexicano, el DTE chileno o la NFe brasileña."
license: Propietario de pymo. Distribuido a integradores para construir contra la API; no redistribuir.
compatibility: "HTTP/JSON sobre TLS, sesión por cookie (no bearer, no API key, no OAuth). No hay SDK oficial: sirve cualquier cliente HTTP que persista cookies. Los chequeos de scripts/ necesitan Node 18+ y no tienen dependencias."
metadata:
  contrato-version: "1.0.0"
  contrato-sha256: "ede445e74cca11df"
  operaciones-soportadas: "49"
  generado-por: "gateway-docs/scripts/openapi-to-skill.mjs"
---

<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# pymo Gateway

Esta skill es para escribir, revisar o depurar una integración con el gateway de pymo: la API que
firma, envía y consulta comprobantes fiscales electrónicos (CFE) de Uruguay ante DGI.

Un CFE **no es un registro de API reversible**. Es un documento fiscal: consume un número de CAE que
no vuelve, no se borra, y un comprobante mal emitido sólo se compensa con otro comprobante. Por eso
esta skill no está optimizada para terminar sola, sino para terminar bien: donde falta un dato
fiscal, la respuesta correcta es frenar y preguntar, no completar el campo con algo plausible.

Lo que esta skill **sí** decide: cómo se autentica, qué endpoint corresponde, qué forma tiene el
request, cómo se lee la respuesta, cómo se reintenta y cómo se reconcilia el estado final.

Lo que **no** decide, nunca: qué tipo de CFE corresponde a una operación, qué tratamiento fiscal
lleva una línea, si corresponde una nota de crédito o una anulación, ni cuándo se puede emitir en
contingencia. Eso es del régimen fiscal y del contador de la empresa.

## Contrato de seguridad fiscal

Diez reglas. No son recomendaciones y no se ponderan contra la conveniencia de terminar la tarea.

1. **No inventes un valor fiscal.** Ni un campo del CFE que no esté documentado, ni un enum, ni un
   tratamiento de IVA, ni un tipo de documento, ni un monto, ni un dato de receptor, ni un criterio
   de contingencia, ni una decisión de corrección. Si no está en las fuentes de esta skill ni
   resuelto en el Formato CFE vigente de DGI que tengas a mano, **no lo completes**.

2. **`clientEmissionId` es la identidad permanente del comprobante que se quiere emitir**, no del
   intento HTTP. Se elige y queda **persistido de forma durable antes** del primer request, junto
   con el comprobante al que pertenece, de modo que un proceso que se cae a mitad de la emisión
   pueda recuperar el mismo id. Cómo se consigue esa durabilidad es tuyo: una transacción con el
   registro de origen es lo más simple, pero cualquier mecanismo que sobreviva a la caída sirve.

3. **Un reintento va con el mismo `clientEmissionId`.** Ante timeout, error de red o resultado
   ambiguo, se reenvía el mismo request con el mismo id: el gateway no emite un segundo comprobante
   y devuelve el original en `firstCfeResponse` con `code: "DUPLICATED_KEY"`. **Generar un id nuevo
   para reintentar emite un segundo comprobante fiscalmente válido ante DGI.** Es el error más caro
   que se puede cometer contra esta API.

4. **El código HTTP nunca alcanza para dar una operación por exitosa.** Hay al menos nueve lugares
   del gateway que responden `HTTP 200` con `status: "FAIL"` en el body, así que el resultado se
   decide leyendo `status` y `message.code`, que es estable; `message.value` es texto traducible y
   no es contrato.

   Lo que el código HTTP sí decide es el transporte y la sesión, y eso no hay que perderlo: un
   `401` es la sesión vencida y hay que reloguear, un `403` es un RUT que no es el tuyo, y un
   `5xx` o un timeout es un intento cuyo resultado no conocés - que es justamente cuando aplica
   la regla 3.

5. **`SUCCESS` en la emisión no es aceptación de DGI.** El gateway asigna CAE, firma y persiste, y
   responde de inmediato; el envío a DGI es asíncrono y posterior. Un comprobante puede volver
   `SUCCESS` y quedar `PROCESSED_REJECTED` después. No muestres, registres ni informes un CFE como
   aceptado antes de tener un estado final.

6. **Recorré todas las entradas de `payload.cfesIds`.** El envelope del lote responde siempre
   `SUCCESS` y `DGI_CFES_RECEIVE_SUCCESS`, aunque no se haya emitido ninguno. No hay conteo ni
   bandera de éxito parcial. Una entrada con `status: "FAIL"` es un error; una con `serie` y `nro`
   es un comprobante. **Correlacioná por `clientEmissionId`, nunca por posición en el array.**

7. **Verificá la preparación antes de emitir**, distinguiendo lo que podés comprobar de lo que
   tenés que preguntar:

   - **Comprobable con la superficie soportada:** la numeración CAE, con
     `GET /v1/companies/{companyRut}/cfesActiveNumbers/{code}` por cada tipo que vayas a emitir.
     Sirve un CAE con `active: true` y `expireDate` en el futuro. El CAE es **por tipo**: tener
     numeración de eFactura (`111`) no habilita emitir eTickets (`101`).
   - **Comprobable:** los datos de la empresa y sus sucursales, con
     `GET /v1/companies/{companyRut}`.
   - **NO comprobable desde esta skill:** si hay un certificado de firma activo. Los endpoints de
     certificados están fuera de la superficie soportada, así que no lo deduzcas de que la
     emisión funcione: pedile al integrador que lo confirme con pymo antes de la primera emisión.
     Sin certificado la emisión falla **por comprobante**, con `KEYSTORE_GET_ERROR` o
     `COMPANY_CERT_NOT_FOUND`, no al principio del request.

8. **Homologación por default.** Toda configuración y todo ejemplo que generes apunta a
   `https://gatewaytest.pymo.uy`. Producción (`https://gateway.pymo.uy`) es una decisión humana
   explícita, nunca un default, nunca un fallback, nunca un literal en el código. Un `.env` faltante
   tiene que dejar al cliente en homologación.

9. **Usá sólo los endpoints aprobados**, los que están en `referencias/contrato.openapi.json`. Que
   una ruta exista en el gateway, o responda cuando la probás, no la hace parte de la superficie
   soportada: el contrato es la lista, y es más corta que el gateway a propósito.

10. **Esta skill no emite en producción.** No ejecutes una emisión productiva, no la propongas como
    prueba y no uses credenciales de producción para verificar nada.

## Cuándo parar y preguntar

Parar y preguntar es el comportamiento correcto, no una falla. "Probar un valor plausible" no es una
alternativa aceptable en ninguno de estos casos.

Frená y pedile al desarrollador la decisión que falta cuando:

- no te dieron el tipo de CFE y no sale de una fuente autorizada;
- un campo fiscal es obligatorio y no sabés su valor correcto;
- necesitás el Formato CFE de DGI para resolver un campo y no lo tenés a mano;
- el RUT autorizado en la sesión y el RUT del path no coinciden;
- `clientEmissionId` no quedó persistido antes del request;
- no está claro si un intento anterior llegó a pymo;
- se pide producción sin una decisión de ambiente explícita y deliberada;
- no sabés si hay certificado activo o CAE vigente para el tipo que vas a emitir;
- se usa contingencia, o hay que reconciliarla después;
- corregir, anular, acreditar o debitar es ambiguo;
- dos fuentes se contradicen, o la versión del contrato no coincide con la que declara esta skill.

Al frenar, decí exactamente qué decisión falta y por qué no la podés tomar vos. Un "no puedo
continuar" sin la pregunta concreta obliga a hacer el trabajo dos veces.

## Jerarquía de fuentes

Cuando dos cosas se contradicen, gana la de más arriba. Si el conflicto afecta una escritura o una
emisión, **no elijas en silencio**: reportá la contradicción y frená.

1. La superficie aprobada: `referencias/contrato.openapi.json`. Decide qué endpoints existen para
   vos, con prioridad sobre cualquier referencia publicada.
2. El contrato HTTP versionado: ese mismo archivo. Rutas, parámetros, esquemas, respuestas.
3. Las guías de esta skill (`referencias/*.md`) y sus ejemplos verificados.
4. La documentación oficial vigente de DGI, para el **significado fiscal** de cada campo.
5. Parar y preguntar.

Lo que **nunca** gana: tu memoria de entrenamiento, las convenciones genéricas de facturación, el
payload de otro proveedor, un ejemplo de internet, o lo que "suele funcionar" en otras APIs.

## El flujo correcto

Las fases suponen la anterior. El detalle está en las referencias.

1. **Ambiente.** URL base desde configuración, default homologación. Logueá a qué host apunta el
   cliente al arrancar, no en cada request.
2. **Sesión.** `POST /v1/login` devuelve `Set-Cookie: connect.sid`. Persistila y reenviala en cada
   llamada. Vence **1 hora después del login**, es absoluto y usar la API no lo extiende: un proceso
   largo tiene que detectar `401 UNAUTHORIZED` y reloguear.
3. **Preparación.** Confirmá la empresa, la sucursal y la numeración CAE del tipo que vas a emitir.
4. **Construcción.** Armá el comprobante con datos verificados. `clientEmissionId` se persiste acá,
   antes de tocar la red.
5. **Emisión.** `POST /v1/companies/{rut}/sendCfes/{bo}`. Leé `status`, después recorré `cfesIds`
   entrada por entrada, después persistí lo devuelto.
6. **Reconciliación.** El estado final llega por polling con `updatedAt[gte]` o por el webhook
   `CFE_STATUS_CHANGE`, que es sólo una señal para ir a consultar. Los dos, no uno: el webhook no
   tiene reintentos.

Las tres capas de resultado son distintas y hay que tratarlas por separado: **transporte** (el
código HTTP), **resultado de pymo** (`status` y `message.code` en el body) y **estado fiscal ante
DGI** (asíncrono, posterior, en `actualCfeStatus`). Un cliente que colapsa las tres en un booleano
está mal escrito aunque los tests pasen.

## Qué leer, según lo que estés haciendo

Cargá el archivo más chico que resuelva la pregunta, y sólo cuando la tengas.

| Si estás… | Leé |
|---|---|
| eligiendo qué endpoint llamar | `referencias/endpoints.md` |
| configurando ambiente, login o manejo de sesión | `referencias/ambientes-y-sesion.md` |
| construyendo un comprobante o interpretando la respuesta de emisión | `referencias/emision.md` |
| escribiendo reintentos, o resolviendo un timeout | `referencias/emision.md` § idempotencia |
| esperando el resultado de DGI, o recibiendo el webhook | `referencias/estado-y-webhooks.md` |
| procesando comprobantes de proveedores | `referencias/recepcion.md` |
| ante un campo fiscal: `IndFact`, redondeo, contingencia | `referencias/fiscal.md` |
| generando el PDF, el QR o la adenda | `referencias/salida.md` |
| ante el esquema exacto de un cuerpo o una respuesta | `referencias/contrato.openapi.json` |
| ante el **significado fiscal** de un campo | El documento Formato CFE vigente de DGI |

Formato CFE de DGI: https://www.efactura.dgi.gub.uy/principal/ampliacion_de_contenido/documento-de-formato-cfe-version-23-1

## Verificación determinista

Hay errores demasiado caros para dejarlos al criterio del modelo. El bundle trae un verificador sin
dependencias que los detecta de forma repetible:

```bash
# Un request antes de mandarlo. Con la URL completa chequea además ambiente y RUT,
# así que es la forma que conviene usar.
node scripts/validar.mjs pedido cuerpo.json \
  --url https://gatewaytest.pymo.uy/v1/companies/219999990008/sendCfes/1 \
  --rut 219999990008

# Sin URL todavía: valida el cuerpo contra el contrato y avisa qué no pudo chequear.
node scripts/validar.mjs pedido cuerpo.json --endpoint "POST /v1/companies/{companyRut}/sendCfes/{branchOffice}"

# El código de la integración: los patrones que fallan en silencio.
node scripts/validar.mjs codigo src/

# Que el verificador siga detectando lo que dice detectar.
node scripts/validar.mjs autoprueba
```

Los tres son distintos y conviene no confundirlos:

- **`pedido` es estricto.** Compara el cuerpo contra el contrato, que es exacto. Corrélo sobre cada
  cuerpo de emisión que construyas y tratá sus errores como errores.
- **`autoprueba` es estricta.** Verifica que el propio verificador siga detectando lo que declara.
  Si falla, no confíes en `codigo` hasta arreglarlo.
- **`codigo` es una ayuda, no una compuerta.** Busca patrones de texto sobre el código de la
  integración. Sirve para mirar de nuevo un lugar sospechoso, y no para dar nada por terminado.

Sobre `codigo`, tres cosas que hay que tener presentes:

1. **Que no encuentre nada no significa que la integración esté bien.** Significa que esos patrones
   no aparecieron. Lo que decide es el contrato de seguridad de arriba, leído por vos.
2. **Se equivoca en las dos direcciones**, y lo hizo: marcó código correcto varias veces, y una vez
   dejó pasar en silencio casi toda la API. Un hallazgo se revisa, no se silencia; y su silencio no
   se cita como prueba.
3. **Tiene un punto ciego conocido con las rutas que se solapan.** Viaja con el contrato de
   lo soportado y no con la lista de lo retenido, así que una ruta concreta compatible con
   una plantilla aprobada se da por buena aunque además lo sea con una retenida. Está
   anotado en el código, y es otra razón para no leer su silencio como aprobación.
4. **Sólo está verificado en JavaScript.** Los patrones se escribieron pensando también en Python,
   PHP y Java, pero no hay casos de prueba para esos lenguajes, así que ahí ni un hallazgo ni su
   ausencia están respaldados.

Ninguno de los tres toca la red: `scripts/validar.mjs` no hace un solo request, y no necesita
credenciales ni sesión para nada de lo que chequea.

`fixtures/codigo/` es otra cosa, y conviene saberlo antes de copiar el bundle: son ejemplos de
integración, varios llaman a hosts de pymo en su texto, y uno apunta a producción a propósito
—es el hallazgo que el verificador tiene que encontrar—. Son material de lectura, ninguno está
registrado en un runner de tests y nada de esta skill los ejecuta. Si los abrís para aprender de
ellos, no los corras.

## Informe de entrega

Al terminar, entregá al desarrollador un resumen con esto. Sirve para que otra persona pueda
revisar la integración sin leerla entera, y expone los supuestos peligrosos antes del deploy:

- qué capacidades y endpoints aprobados usaste;
- qué ambiente quedó configurado y de dónde sale la URL base;
- dónde se genera y dónde se persiste `clientEmissionId`;
- cómo se guarda la cookie y qué pasa cuando vence la sesión;
- cómo se manejan los fallos de body (`status: "FAIL"`) y los fallos por comprobante dentro del lote;
- cómo se reconcilia el estado final de DGI;
- qué chequeos automáticos corriste y con qué resultado;
- **qué datos fiscales te dio el desarrollador, distinguidos de los que salieron de la documentación**;
- qué queda pendiente para homologar y para pasar a producción.

## Lo que esta skill no cubre

Está documentado que no está documentado, y la misma lista sale generada a
`referencias/limitaciones.json` para que un chequeo automático pueda leerla sin interpretar prosa.

Que algo no esté en el contrato **no es la instrucción**. La ausencia de una operación se lee
fácil como "usá otra cosa", y eso es justamente lo que no hay que hacer: la instrucción es esta
lista. Si necesitás algo de acá, **pedíselo a quien corresponda en lugar de deducirlo** - son los
puntos donde una deducción plausible produce un comprobante válido y equivocado.

1. **Referenciar el comprobante original desde una nota emitida por sendCfes con el código de tipo (112, 113, …)** — hay ruta soportada, pero es otra.
   El bloque de referencia dentro del cuerpo del comprobante no está descrito en el esquema Cfe ni en las guías. Lo que sí está documentado es POST /v1/companies/{companyRut}/createCreditNote, que está en el contrato y recibe referencedDocuments con cfeId o la terna cfeType+serie+nro.
   **No:** No inventes un bloque de referencia dentro del cuerpo de sendCfes: el esquema deja additionalProperties abierto, así que se firma igual y queda una nota que no anula nada. Usá el endpoint que documenta la referencia.
   **Preguntale a pymo:** ¿Se puede emitir una nota de crédito por sendCfes con el tipo 112 y referenciar el original en el cuerpo, o createCreditNote es el único camino soportado?

2. **Emitir en lote desde un CSV con bulkSendCfes** — endpoint soportado, formato del archivo sin documentar.
   El endpoint está en el contrato; la forma del CSV no está descrita en ninguna fuente de esta skill.
   **No:** No infieras las columnas ni su orden a partir del cuerpo JSON de sendCfes.
   **Preguntale a pymo:** ¿Cuál es el formato exacto del CSV de bulkSendCfes: columnas, orden, separador, codificación y cómo se expresan las líneas de detalle?

3. **Reconciliar comprobantes de contingencia una vez que DGI vuelve a responder** — sin procedimiento documentado.
   El mecanismo por el que los comprobantes 2xx se informan a DGI al normalizarse el servicio (reporte diario contra reenvío) no está reproducido ni descrito.
   **No:** No armes un proceso de reenvío por tu cuenta: cuándo corresponde contingencia y cómo se regulariza son criterios del régimen, no de la API.
   **Preguntale a pymo y el contador de la empresa:** ¿Cómo se informan a DGI los comprobantes emitidos en contingencia una vez restablecido el servicio, y qué tiene que hacer el integrador?

4. **Usar un único formato de fecha en toda la API** — inconsistente por diseño actual.
   Conviven ISO con offset (-03:00), ISO en UTC (Z) y YYYY-MM-DD en parámetros de ruta.
   **No:** No unifiques por tu cuenta: mirá el ejemplo del endpoint que vas a llamar.
   **Preguntale a pymo:** ¿Qué formato de fecha espera cada endpoint, y hay alguno donde el offset cambie la interpretación?

5. **Averiguar el número de sucursal de una empresa** — dato de onboarding, no de la API.
   Es el número de sucursal ante DGI y lo asigna pymo durante el alta.
   **No:** No lo adivines ni asumas que es 1.
   **Preguntale a pymo:** ¿Qué número de sucursal corresponde a cada punto de emisión de esta empresa?

6. **Reintentar con seguridad algo que no sea una emisión** — sin garantía escrita.
   clientEmissionId cubre sendCfes. Aceptar o rechazar un CFE recibido, o cualquier otra escritura, no tiene una garantía equivalente documentada.
   **No:** No repitas una escritura que no sea de emisión dando por hecho que es idempotente.
   **Preguntale a pymo:** ¿Qué pasa si se repite un PUT de cfeStatus, y hay alguna clave de idempotencia para las escrituras que no son emisión?

## Archivos de esta skill

| Archivo | Cuándo |
|---|---|
| `referencias/endpoints.md` | Para elegir el endpoint: las 49 operaciones soportadas, por fase |
| `referencias/ambientes-y-sesion.md` | Antes de la primera llamada: URL base, login, cookie, vencimiento, permisos por RUT |
| `referencias/emision.md` | Antes de emitir: requisitos, cuerpo del comprobante, respuesta, lotes, errores, estados e idempotencia |
| `referencias/estado-y-webhooks.md` | Para reconciliar: filtrado de listados, webhook `CFE_STATUS_CHANGE` y sus garantías |
| `referencias/recepcion.md` | Para recibir de proveedores: estados y el `PUT` que rechaza por default |
| `referencias/fiscal.md` | Para el contenido fiscal: `IndFact`, redondeo, contingencia y sus tipos |
| `referencias/salida.md` | Para el comprobante hacia afuera: PDF, QR y adenda |
| `referencias/contrato.openapi.json` | El contrato: esquemas exactos, ejemplos y la lista cerrada de endpoints. Es grande: buscá la operación, no lo leas entero |
| `referencias/limitaciones.json` | Antes de resolver algo que el contrato no cubre: qué capacidades no tienen ruta soportada, y a quién preguntarle |
| `scripts/validar.mjs` | Antes de mandar un request, y antes de dar la integración por terminada |
| `fixtures/` | Ejemplos válidos e inválidos, y los casos que usa la autoprueba del verificador |

Contrato: versión 1.0.0, 49 operaciones, sha256 `ede445e74cca11df`.
Si el gateway con el que hablás no se comporta como dice este contrato, no lo compenses en el
código: pará y confirmá qué versión estás integrando.
