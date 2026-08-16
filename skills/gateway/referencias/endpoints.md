<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Endpoints soportados

Las **49 operaciones** que esta skill soporta, en el orden del flujo de una
integración. El esquema exacto de cada una (parámetros, cuerpo, respuestas, ejemplos) está en
`contrato.openapi.json`, que es el contrato: esta tabla es para elegir, no para construir.

Un endpoint que no esté acá no es parte de la superficie soportada, aunque exista en el gateway
o aparezca en la referencia publicada. Si creés que necesitás uno, pará y preguntá.

**Acceso**: `pública` no necesita sesión · `restringida` necesita sesión · `restringida por RUT`
necesita sesión y sólo opera sobre el RUT de tu propia empresa.

## 1 Autenticación

| Operación | Qué hace | Acceso |
|---|---|---|
| `PUT /v1/companies/{companyRut}/password` | Cambia la contraseña de la cuenta. | restringida por RUT |
| `POST /v1/login` | Inicia la sesión y setea la cookie connect.sid que necesitan todas las demás llamadas. | pública |
| `POST /v1/logout` | Cierra la sesión. | restringida |

## 2 Configuración

| Operación | Qué hace | Acceso |
|---|---|---|
| `GET /v1/companies/{companyRut}` | Lee los datos y la configuración de la empresa. | restringida por RUT |
| `PATCH /v1/companies/{companyRut}/bo/{boNumber}` | Actualiza los datos de contacto de una sucursal: nombre, dirección fiscal, ciudad, departamento y teléfono. **No cambia la URL de callback**: el gateway aplica sólo esos cinco campos y descarta el resto sin avisar, así que mandar `callbackNotificationUrl` responde éxito y no hace nada. Esa se pide a pymo. | restringida por RUT |
| `GET /v1/companies/{companyRut}/certFile` | Descarga el archivo del certificado. | restringida por RUT |
| `GET /v1/companies/{companyRut}/certs` | Lee los certificados cargados y su vigencia. | restringida por RUT |
| `POST /v1/companies/{companyRut}/certs` | Sube el certificado de firma. Requisito duro: sin certificado no hay emisión. | restringida por RUT |
| `GET /v1/companies/{companyRut}/certs/{certAlias}` | Lee un certificado. | restringida por RUT |
| `GET /v1/companies/{companyRut}/cfesActiveNumbers`<br>alias `/v2/companies/{companyRut}/cfesActiveNumbers` | Lista la numeración CAE autorizada disponible para emitir. | restringida por RUT |
| `GET /v1/companies/{companyRut}/cfesActiveNumbers/{code}`<br>alias `/v2/companies/{companyRut}/cfesActiveNumbers/{code}` | Numeración CAE de un tipo de CFE. | restringida por RUT |
| `POST /v1/companies/{companyRut}/cfesActiveNumbers/{code}/upload-xml` | Carga una autorización CAE de DGI. Requisito por tipo de documento antes de emitirlo. | restringida por RUT |
| `GET /v1/companies/{companyRut}/logo` | Lee el logo de la empresa. | restringida por RUT |
| `POST /v1/companies/{companyRut}/logo` | Sube el logo de la empresa (configuración de impresión). | restringida por RUT |
| `PATCH /v1/companies/{companyRut}/updateCaesBy` | Activa o desactiva CAEs por filtro. | restringida por RUT |

## 3 Emisión

| Operación | Qué hace | Acceso |
|---|---|---|
| `POST /v1/companies/{companyRut}/addDetailsBulkSendCfes` | Agrega filas a un envío masivo antes de ejecutarlo. | restringida por RUT |
| `GET /v1/companies/{companyRut}/bulkSendCfes` | Lista los envíos masivos. | restringida por RUT |
| `POST /v1/companies/{companyRut}/bulkSendCfes/{branchOffice}` | Emite muchos CFEs desde un CSV. | restringida por RUT |
| `GET /v1/companies/{companyRut}/bulkSendCfes/{bulkCfesManagerId}/originalFile` | Descarga el CSV original del envío masivo. | restringida por RUT |
| `GET /v1/companies/{companyRut}/bulkSendCfes/{bulkCfesManagerId}/status` | Consulta el estado de un envío masivo. | restringida por RUT |
| `GET /v1/companies/{companyRut}/bulkSendCfesByFilter` | Consulta resultados de envíos masivos por filtro. | restringida por RUT |
| `POST /v1/companies/{companyRut}/createCreditNote` | > 🧪 **Beta.** Endpoint nuevo y en desarrollo: se publica a propósito, pero la forma de la request o de la respuesta puede cambiar antes de estabilizarse. | restringida por RUT |
| `POST /v1/companies/{companyRut}/createDebitNote` | > 🧪 **Beta.** Endpoint nuevo y en desarrollo: se publica a propósito, pero la forma de la request o de la respuesta puede cambiar antes de estabilizarse. | restringida por RUT |
| `POST /v1/companies/{companyRut}/sendCfes/{branchOffice}` | Emite cualquier CFE (el tipo va en el body). Es asíncrono: devuelve un id y NO confirma la aceptación, después hay que consultar el estado. Requiere certificado y CAE del tipo de documento. | restringida por RUT |

## 4 Estado

| Operación | Qué hace | Acceso |
|---|---|---|
| `GET /v1/companies/{companyRut}/activity` | Totales emitidos, aceptados y rechazados en un rango de fechas. | restringida por RUT |
| `GET /v1/companies/{companyRut}/getDGIReportStatus/{date}` | Estado en DGI del reporte diario de una fecha. | restringida por RUT |
| `GET /v1/companies/{companyRut}/invoices` | Lista las facturas de la empresa. | restringida por RUT |
| `GET /v1/companies/{companyRut}/sentCfes` | Lee todos los CFEs emitidos y su estado en DGI (Aceptado/Rechazado). Es la forma normal de resolver el resultado de una emisión. | restringida por RUT |
| `GET /v1/companies/{companyRut}/sentCfes/{branchOffice}` | CFEs emitidos y su estado para una sucursal. | restringida por RUT |
| `GET /v1/companies/{companyRut}/sentCfes/{cfeType}/{serie}/{number}/sobreAdenda` | Obtiene la adenda del sobre de un CFE emitido. | restringida por RUT |
| `GET /v1/companies/{companyRut}/sentReportes` | Lista los reportes diarios enviados a DGI. | restringida por RUT |
| `GET /v1/companies/{companyRut}/sentReportes/{branchOffice}` | Lista los reportes diarios enviados a DGI, filtrados por sucursal. | restringida por RUT |

## 5 Recepción

| Operación | Qué hace | Acceso |
|---|---|---|
| `GET /v1/companies/{companyRut}/inCfesAtDGI` | Lista los CFEs recibidos según DGI (rango de fechas). | restringida por RUT |
| `GET /v1/companies/{companyRut}/inSobres` | Bandeja de recepción: sobres recibidos. | restringida por RUT |
| `POST /v1/companies/{companyRut}/inSobres` | Registra un sobre recibido. | restringida por RUT |
| `GET /v1/companies/{companyRut}/inSobres/{sobreId}` | Un sobre recibido, por su id. **Ojo con `cfes`**: la ruta `.../inSobres/cfes` es un endpoint distinto y gana sobre esta, porque el gateway la registra antes, así que `sobreId` nunca puede valer literalmente `cfes`. Con cualquier otro id, esta es la que responde. | restringida por RUT |
| `GET /v1/companies/{companyRut}/inSobres/{sobreId}/cfes/{cfeId}` | Obtiene un CFE recibido dentro de un sobre. | restringida por RUT |
| `GET /v1/companies/{companyRut}/inSobres/cfes` | Lista los CFEs recibidos. | restringida por RUT |
| `GET /v1/companies/{companyRut}/inSobres/cfes/{cfeId}` | Obtiene un CFE recibido. | restringida por RUT |
| `PUT /v1/companies/{companyRut}/inSobres/cfes/{cfeId}/cfeStatus` | Acepta o rechaza un CFE recibido. | restringida por RUT |
| `GET /v1/companies/{companyRut}/inSobres/cfes/{cfeId}/invoice` | Obtiene el CFE recibido como PDF. | restringida por RUT |

## 6 Referencia

| Operación | Qué hace | Acceso |
|---|---|---|
| `GET /v1/currenciesQuotes` | Cotizaciones del BCU para facturar en moneda extranjera. | restringida |
| `GET /v1/taxes` | Catálogo de impuestos. | restringida |

## 7 Servicios DGI

| Operación | Qué hace | Acceso |
|---|---|---|
| `GET /v1/dgiData/{companyRut}` | Valida un RUT y trae los datos de esa parte en DGI. Consulta a DGI. | restringida por RUT |
| `GET /v1/dgiData/{companyRut}/changesSince` | Cambios en los datos del contribuyente en DGI desde una fecha. | restringida por RUT |
| `GET /v1/dgiData/{companyRut}/cva` | Estado del certificado único de vigencia anual (CVA) de una empresa. | restringida por RUT |

## 8 Público/webhook

| Operación | Qué hace | Acceso |
|---|---|---|
| `GET /consultaQR/cfe` | Verificación pública de un CFE por QR (sin autenticación). | pública |

## Filtrado de listados

Todos los `GET` de listado aceptan el mismo querystring:

```
GET .../recurso?[&f=<campo>][&<campo>=<valor>][&<campo>[<oper>]=<valor>][&s=<orden>][&sk=<skip>][&l=<limite>][&p=<populate>]
```

Operadores: `contains`, `gt`, `gte`, `lt`, `lte`, `ne`. El límite por default es 1000.
`updatedAt[gte]=<fecha>` es el filtro con el que se hace el polling de estado.
