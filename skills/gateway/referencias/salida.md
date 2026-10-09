<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Salida del comprobante

## PDF (representación impresa)

```
GET /v1/companies/{rut}/invoices?id={cfeId}
```

Devuelve el PDF del CFE. El `cfeId` es el `id` interno que devuelve la emisión (o
`GET .../sentCfes`). Responde `200` con `content-type: application/pdf`. El PDF
se **genera en el gateway**, no se pide a DGI, y requiere que la empresa tenga
logo cargado.

## Verificación pública por QR

El gateway arma el QR por vos: la emisión devuelve `qrUrl` y `securityCode` (los primeros 6 del
`sentXmlHash`), así que no construyas la URL. Su forma es
`{baseConsultaQR}?{rutEmisor},{cfeType},{serie},{nro},{montoPagar},{fchEmis},{hashURLencoded}`.

Quien resuelve esa URL es la persona que escanea el ticket, no tu integración, y el endpoint que
la atiende no está en la superficie publicada. No lo llames desde tu código.

## XML del sobre + adenda

```
GET /v1/companies/{rut}/sentCfes/{cfeType}/{serie}/{number}/sobreAdenda
```

Devuelve la adenda del sobre de un CFE emitido, identificado por tipo, serie y número.
