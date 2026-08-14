<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Emitir un CFE

```
POST /v1/companies/{rut}/sendCfes/{branchOffice}
```

- `rut`: RUT emisor (12 dígitos)
- `branchOffice`: número de sucursal DGI

Un solo endpoint cubre todos los tipos de CFE (eTicket, eFactura, notas de
crédito/débito, exportación, contingencia): el tipo va como clave en el body.

## Antes de poder emitir

Tres cosas tienen que existir del lado de pymo, y ninguna la crea el integrador
por API. Si falta alguna, la emisión no falla al principio del request: falla
**por comprobante**, dentro del array de respuesta.

| Requisito | Qué es | Si falta |
|---|---|---|
| La sucursal | La empresa tiene que tener la `branchOffice` que va en la URL | El request no encuentra datos de comunicación con DGI |
| Un certificado activo | Un certificado de firma vigente de la empresa, uno solo activo a la vez | `KEYSTORE_GET_ERROR` / `COMPANY_CERT_NOT_FOUND` |
| Un CAE activo **por cada tipo de CFE** | Rango de numeración autorizado por DGI para ese tipo | `DGI_MISSING_CAE` |

El CAE es por tipo, no por empresa: tener CAE de eFactura (`111`) no habilita
emitir eTickets (`101`). El gateway busca uno con `active: true` y `expireDate`
en el futuro, evaluado contra la hora local uruguaya.

Cada emisión consume un número del rango (`range.first` → `range.last`) de forma
atómica. Cuando el rango se agota el CAE se desactiva solo, y a partir de ahí ese
tipo responde `DGI_MISSING_CAE` hasta que se cargue uno nuevo. Hay un aviso
previo configurable por porcentaje de rango restante, así que no debería llegarse
al final por sorpresa.

`DGI_MISSING_CAE` es de los pocos errores **recuperables sin cambiar el request**:
cargado el CAE, reenviar el mismo `clientEmissionId` emite (ver
Idempotencia, sección del CAE faltante).

## Qué se manda

**No hay una clave `cfes`.** Cada clave del body es el código de tipo de CFE y su
valor es la lista de comprobantes de ese tipo, así que un mismo request puede
llevar eFacturas y eTickets a la vez. Las únicas claves que no son un tipo son
`emailsToNotify` y `phonesToNotify`; cualquier otra se ignora en silencio.

```json
{
  "111": [
    {
      "clientEmissionId": "pedido-2026-000123",
      "IdDoc": { "MntBruto": "1", "FmaPago": "1" },
      "Receptor": {
        "TipoDocRecep": "2",
        "CodPaisRecep": "UY",
        "DocRecep": "211234567005",
        "RznSocRecep": "EMPRESA DE EJEMPLO SA",
        "DirRecep": "Calle Falsa 1234",
        "CiudadRecep": "Montevideo",
        "DeptoRecep": "Montevideo"
      },
      "Totales": { "TpoMoneda": "UYU" },
      "Items": [
        { "NroLinDet": "1", "IndFact": "1", "NomItem": "Servicio de ejemplo",
          "Cantidad": 1, "UniMed": "N/A", "PrecioUnitario": 1000, "MontoItem": 1000 }
      ],
      "adenda": "Texto libre opcional"
    }
  ],
  "emailsToNotify": []
}
```

Obligatorios en cada comprobante: `clientEmissionId`, `IdDoc`, `Receptor`,
`Totales` e `Items` con al menos una línea. La estructura completa, campo por
campo, está en la Referencia de la API bajo el esquema
`SolicitudEmision`.

Los nombres de los campos son **los de DGI**, no los del gateway, y las reglas de
cada uno son las del documento [Formato CFE](https://www.efactura.dgi.gub.uy/principal/ampliacion_de_contenido/documento-de-formato-cfe-version-23-1) de DGI. Acá se documenta la estructura y
lo que el gateway hace con ella; lo que no está acá se resuelve contra ese
documento, no adivinando.

Dos que conviene tener claros:

- `IdDoc.Serie` y `IdDoc.Nro` sólo se mandan para los tipos que admiten serie y
  número propios. En el resto los asigna el gateway desde el CAE, y mandarlos no
  hace nada.
- `Receptor.DocRecep` con dígito verificador inválido **no falla en la emisión**.
  El gateway firma y responde `SUCCESS`; DGI rechaza el sobre después, de forma
  asíncrona. Es el caso más fácil de confundir con un éxito.

## Cómo responde (verificado en código)

> **⚠️ Atención**
>
> La respuesta del POST **no** significa "aceptado por DGI". El gateway **crea y
> firma el CFE con su CAE** y responde de inmediato; el envío a DGI ocurre
> **después, de forma asíncrona** (un proceso toma los CFEs y arma los sobres).
> Por eso un CFE puede volver `SUCCESS` en la
> emisión y quedar `PROCESSED_REJECTED` más tarde cuando DGI valida el sobre.

Flujo real:

1. `POST sendCfes` → el gateway asigna CAE, firma y persiste el CFE → responde
   `DGI_CFES_RECEIVE_SUCCESS` con los datos del comprobante.
2. Un proceso asíncrono envía el sobre a DGI.
3. El estado final (`PROCESSED_ACCEPTED` / `PROCESSED_REJECTED`) se consulta por
   `GET .../sentCfes` o llega por el webhook `CFE_STATUS_CHANGE`.

## Respuesta de éxito

`message.code = DGI_CFES_RECEIVE_SUCCESS`. El payload trae `cfesIds`, un array
con un objeto por CFE creado. Campos **exactos** que devuelve el servicio:

```json
{
  "payload": {
    "cfesIds": [
      {
        "id": "6a7121a37698d7c0ab3f1b51",
        "clientEmissionId": "009993ca34f74e0de3106aba89f818b3",
        "serie": "A",
        "nro": 3503,
        "type": "111",
        "caeNumber": 90120000538,
        "caeSerie": "A",
        "caeRange": { "first": 1, "last": 999999 },
        "caeExpirationDate": "2050-01-01T00:00:00.000Z",
        "total": "3050.00",
        "emitionDate": "2026-08-03T20:17:46.000-03:00",
        "sentXmlHash": "mghK5nJZkGskjJUkRv8EnG+U8xa1vs1tROJsIqDXBMk=",
        "securityCode": "mghK5n",
        "qrUrl": "https://.../consultaQR/cfe?219999990008,111,A,3503,3050.00,...",
        "CAEEspecial": "4",
        "CausalCAEEsp": null
      }
    ]
  },
  "message": { "code": "DGI_CFES_RECEIVE_SUCCESS", "value": "Cfes recibidos correctamente." },
  "status": "SUCCESS"
}
```

### Campos a persistir

Todos los de arriba, y en particular:

| Campo | Para qué |
|---|---|
| `serie`, `nro` | Identificación fiscal del comprobante |
| `caeNumber`, `caeSerie`, `caeRange`, `caeExpirationDate` | Autorización DGI, para la representación impresa |
| `sentXmlHash` / `securityCode` | Hash del XML firmado; `securityCode` son sus primeros 6 caracteres |
| `qrUrl` | URL del QR - la arma el gateway, el integrador no la construye (ver Salida) |
| `id` | Identificador interno para consultar estado y PDF |
| `clientEmissionId` | La clave de idempotencia - ver Idempotencia |

## Lotes: éxito parcial

Un request puede llevar varios comprobantes y **cada uno se resuelve por
separado**. El array `cfesIds` es heterogéneo: los que salieron traen los datos
del comprobante, los que fallaron traen un error, en el mismo array y sin nada
que los separe.

> **⚠️ Atención**
>
> **El estado de arriba no refleja lo de abajo.** El envelope responde siempre
> `status: "SUCCESS"` y `message.code: "DGI_CFES_RECEIVE_SUCCESS"`, aunque **todos**
> los comprobantes del lote hayan fallado. No hay conteo, ni bandera de éxito
> parcial, ni código distinto: hay que recorrer `cfesIds` y mirar cada entrada.

Una entrada fallida tiene esta forma (capturada de la suite de tests del
gateway):

```json
{
  "code": 412,
  "message": {
    "code": "RECEPTOR_DOC_EXT_REQUIRED",
    "value": "Es requerido especificar el documento extranjero del receptor: PASAPORTE (5), DNI (6), NIFE (7) o OTROS (4)"
  },
  "status": "FAIL",
  "receivedDataWithError": {
    "clientEmissionId": "pedido-2026-000123",
    "cfe": { "…": "el comprobante entero, como lo interpretó el gateway" }
  }
}
```

Cómo distinguirlas en código:

- Una entrada con `status: "FAIL"` es un error. Una con `serie` y `nro` es un
  comprobante emitido.
- **No te fíes del orden.** Para saber a cuál de tus comprobantes corresponde,
  usá `clientEmissionId`: está en `receivedDataWithError.clientEmissionId` en el
  error y en el nivel superior en el éxito.
- `receivedDataWithError.cfe` trae el comprobante **como lo interpretó el
  gateway**, con los totales ya calculados. Sirve para ver qué entendió de lo que
  mandaste.

## Errores

Códigos de emisión, del código del gateway:

| `message.code` | Significado | ¿Reintentable? |
|---|---|---|
| `DGI_MISSING_CAE` | No hay CAE disponible para ese tipo de CFE | No hasta cargar CAEs |
| `DGI_MISSING_SPECIAL_CAE` / `DGI_MISSING_CUSTOM_SPECIAL_CAE` | Falta CAE especial / custom | No hasta cargar el CAE |
| `DGI_BAD_CUSTOM_SERIE_NUMBER` | Serie/número custom inválido | No (corregir el input) |
| `REQUIRED_PARAMETERS` / `RECEPTOR_REQUIRED` / `RECEPTOR_DOC_REQUIRED` | Falta un dato obligatorio | No (corregir el input) |
| `DUPLICATED_KEY` | `clientEmissionId` ya usado | No reemite; devuelve el CFE original (ver Idempotencia) |
| `KEYSTORE_GET_ERROR` | El gateway no pudo obtener el certificado | Sí (transitorio del servidor) |
| `DGI_COMPANY_NOT_READY_YET` | La empresa aún no está lista en DGI | Sí, más tarde |
| `DGI_SOAP_ERROR` | Error hablando con DGI (fase asíncrona) | Sí |

> **Nota**
>
> El rechazo de DGI (`PROCESSED_REJECTED`) **no** viene en la respuesta del POST:
> llega asíncrono. Ejemplo real capturado en `GET .../sentCfes`, el motivo viaja en
> `cfeHistory[].data.digestAck`:
>
> ```json
> { "actualCfeStatus": "PROCESSED_REJECTED",
>   "cfeHistory": [ { "cfeStatus": "PROCESSED_REJECTED",
>     "data": { "digestAck": "DGI_ERR [SENDING SOBRE]: <Glosa>No cumple validaciones de Formato comprobantes - Dígito verificador RUT Receptor no es válido: 285267464895" } } ] }
> ```

## Estados del CFE

El estado vive en `actualCfeStatus`, y el historial completo con sus fechas en
`cfeHistory[]`. Se consulta con `GET .../sentCfes` o llega por el webhook
`CFE_STATUS_CHANGE`.

Son diecisiete valores, no cuatro. La distinción que importa al escribir el
polling es **si el estado puede cambiar solo**: si es transitorio hay que seguir
consultando, si es final no.

### Transitorios: seguí consultando

| Estado | Qué pasó |
|---|---|
| `CREATED` | Firmado y persistido, listo para que el job lo mande a DGI |
| `CREATED_WITHOUT_CAE_NRO` | Creado sin número de CAE asignado todavía |
| `BULK_CREATED_WITHOUT_CAE_NRO` | Igual, dentro de un envío masivo |
| `SCHEDULED` | Encolado para envío |
| `SCHEDULED_CONNECTION_ERR` | Encolado de nuevo porque falló la conexión con DGI. Reintenta solo |
| `SCHEDULED_WITHOUT_CAE_NRO` | Encolado, esperando numeración |
| `BULK_SCHEDULED_WITHOUT_CAE_NRO` | Igual, dentro de un envío masivo |
| `SENT` | El sobre salió hacia DGI; falta la respuesta |

### Finales: el comprobante ya no se mueve

| Estado | Qué pasó | ¿Comprobante fiscal válido? |
|---|---|---|
| `PROCESSED_ACCEPTED` | DGI lo aceptó | Sí |
| `PROCESSED_REJECTED` | DGI lo rechazó. El motivo viaja en `cfeHistory[].data.digestAck` | No |
| `PROCESSED_RELIQUIDATED` | Reliquidado (sólo CFC) | Sí, con ajuste |
| `FORMAT_REJECTED` | No pasó las validaciones de formato de DGI | No |
| `SOBRE_DUPLICATED` | El sobre ya había sido recibido por DGI | Se asume enviado |
| `DUPLICATED_AT_DGI` | DGI ya tenía ese comprobante. El original es el que vale | No, el original sí |
| `BAD_CUSTOM_SERIE_NUMBER` | La serie o el número propios eran inválidos | No |
| `DELETED_MISSING_CAE` | No había CAE al recibirlo. Ver Idempotencia: tu `clientEmissionId` queda libre para reintentar | No |
| `REPORTED_DAILY_REPORT` | Incluido en el reporte diario a DGI | Sí, es posterior a la aceptación |
| `CFE_UNKNOWN_ERROR` | Error no clasificado. Es el valor por defecto del historial | No |

`FAKE_CFES_HOMOLOGATION` existe para el proceso de homologación y no aparece en
operación normal.

> **⚠️ Atención**
>
> `PROCESSED_REJECTED` es el mismo valor para dos cosas distintas: un CFE rechazado
> y un CFC observado. Si trabajás con comprobantes de contingencia, el estado solo
> no alcanza para distinguirlos.

## Corregir o anular un comprobante ya emitido

**No se puede borrar ni editar un CFE emitido.** Se emite otro comprobante que lo
referencia: una nota de crédito para anular o descontar, una nota de débito para
agregar. Ambas son comprobantes fiscales por derecho propio, consumen su propia
numeración y también se informan a DGI.

```
POST /v1/companies/{rut}/createCreditNote
POST /v1/companies/{rut}/createDebitNote
```

```json
{
  "referencedDocuments": [
    {
      "clientEmissionId": "nc-2026-000045",
      "cfeId": "6a7121a37698d7c0ab3f1b51",
      "pctToAffect": 100
    }
  ],
  "emailsToNotify": []
}
```

Cómo se referencia el original, y las reglas que impone el gateway:

| Campo | Regla |
|---|---|
| `clientEmissionId` | **Obligatorio por documento**, igual que en una emisión: es la misma clave de idempotencia |
| `cfeId` **o** (`cfeType`, `serie`, `nro`) | Uno de los dos, nunca los dos. Mandar ambos es un error explícito |
| `pctToAffect` | Porcentaje del original a afectar, entre 0 y 100 |
| `mntToAffect` | Monto a afectar; tiene que ser mayor a 0 |
| `items` | Líneas explícitas. **Si se mandan, `pctToAffect` y `mntToAffect` se ignoran** |

La sucursal no se manda: se infiere del comprobante referenciado. El tipo de la
nota tampoco: sale del tipo del original (una NC de una eFactura `111` es `112`),
y si ese tipo no admite notas el gateway responde que no las admite en lugar de
inventar una.

Cuando no se mandan `items`, el gateway construye la línea a partir de la primera
del original, heredando `IndFact`, `UniMed` y `NomItem`. Si no puede inferirlos,
falla en lugar de adivinar.

> **Nota**
>
> **Verificado leyendo el código, no ejecutado.** Emitir una nota de crédito
> requiere un CFE original aceptado por DGI, y el stack local no llega hasta ahí:
> el único comprobante que se envió de verdad fue rechazado. Las reglas de arriba
> salen del código del gateway; los mensajes de error exactos y el resultado
> de un caso real no están reproducidos.

# Idempotencia y reintentos

## La clave de idempotencia

Cada CFE lleva un `clientEmissionId` (obligatorio) elegido por el integrador. El
gateway tiene un **índice único** sobre:

```
company + branchOffice + cfeType + clientEmissionId
```

**Verificado en código**: es un índice único de la base, no una comprobación que
pueda perderse en una condición de carrera.

## Qué devuelve un reintento con el mismo `clientEmissionId`

**Verificado en código**: el gateway
detecta la colisión, **no emite un segundo CFE**, busca el CFE original por
`company + branchOffice + cfeType + clientEmissionId` y lo devuelve. El objeto de
error trae `code: "DUPLICATED_KEY"` y un campo `firstCfeResponse` con los datos
del comprobante original:

```json
{
  "code": "DUPLICATED_KEY",
  "status": "FAIL",
  "firstCfeResponse": {
    "id": "6a7121a37698d7c0ab3f1b51",
    "clientEmissionId": "009993ca34f74e0de3106aba89f818b3",
    "serie": "A",
    "nro": 3503,
    "type": "111",
    "caeNumber": 90120000538,
    "caeSerie": "A",
    "caeRange": { "from": 1, "to": 10000 },
    "caeExpirationDate": "2050-01-01T00:00:00.000Z",
    "total": "3050.00",
    "emitionDate": "2026-08-03T20:17:46.000-03:00",
    "sentXmlHash": "mghK5nJZkGskjJUkRv8EnG+U8xa1vs1tROJsIqDXBMk=",
    "securityCode": "mghK5n",
    "bulkCfesManager": null,
    "TmstFirma": "2026-08-03T20:17:46-03:00",
    "qrUrl": "https://.../consultaQR/cfe?..."
  }
}
```

Es decir: un retry con el mismo id es **seguro** y te devuelve los
identificadores del CFE original (serie, número, CAE, hash, QR) - podés
persistirlos igual que en el éxito.

`firstCfeResponse` trae dos campos que el éxito no trae: `bulkCfesManager`, que
identifica el envío masivo si el CFE original vino por lote y es `null` si no, y
`TmstFirma`, la marca de tiempo de la firma.

## Reglas para el integrador

1. **Reintentar con el mismo `clientEmissionId`.** Ante timeout o error de red,
   reenviar con el mismo id: no se crea un segundo comprobante y recibís el
   original en `firstCfeResponse`.
2. **Nunca reintentar con un id nuevo.** Un `clientEmissionId` distinto es una
   emisión nueva: genera un **segundo CFE fiscalmente válido** (duplicado real
   ante DGI).
3. El id es único por empresa + sucursal + tipo de CFE; el mismo id con otro
   `cfeType` es otro comprobante.

## La excepción: CFE recibido sin CAE disponible

Hay un caso donde el mismo `clientEmissionId` **sí** se puede volver a usar para
emitir de verdad, y conviene conocerlo porque contradice la regla de arriba.

Si el CFE llega y la empresa no tiene un CAE disponible para ese tipo, el gateway
no lo emite: lo guarda marcado como `DELETED_MISSING_CAE` y **le renombra el id**
a `<tuId>-DELETED-MISSING-CAE-<n>`. Eso libera tu id del índice único.

Consecuencia práctica: cuando se cargue el CAE que faltaba, reenviar el mismo
`clientEmissionId` **emite** el comprobante, no devuelve un `DUPLICATED_KEY`. Es
el comportamiento deseado, y es la razón por la que un `DGI_MISSING_CAE` no es un
error terminal: se resuelve cargando el CAE y reintentando igual que un timeout.

Lo que no cambia: si el CFE sí se emitió, el id queda tomado para siempre.

> **Nota**
>
> Verificado en el código del gateway: el índice único, el manejo del
> `DUPLICATED_KEY`, la construcción de `firstCfeResponse` y el renombrado por CAE
> faltante. No se reprodujo un retry en vivo porque requiere una emisión real.
