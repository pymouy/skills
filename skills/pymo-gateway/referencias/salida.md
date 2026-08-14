<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Salida del comprobante

## PDF (representación impresa)

```
GET /v1/companies/{rut}/invoices?id={cfeId}
```

Devuelve el PDF del CFE. El `cfeId` es el `id` interno que devuelve la emisión (o
`GET .../sentCfes`). **Verificado en local**: responde `200` con
`content-type: application/pdf` (un CFE real dio 34.579 bytes). El PDF se **genera en el gateway**, no se pide a DGI, y requiere que la
empresa tenga logo cargado.

## Verificación pública por QR

El gateway **arma el QR por vos**: la emisión ya devuelve `qrUrl` y `securityCode`
(los primeros 6 del `sentXmlHash`) - el integrador no construye la URL. Su forma
(verificado en el código del gateway):

```
{baseConsultaQR}?{rutEmisor},{cfeType},{serie},{nro},{montoPagar},{fchEmis},{hashURLencoded}
```

El endpoint público que resuelve esa URL:

```
GET /consultaQR/cfe?{rutEmisor},{cfeType},{serie},{nro},{monto},{fecha},{hash}
```

- **Match válido** → `200 application/pdf` (la representación impresa del CFE).
  **Verificado en local** con un CFE real (34.581 bytes).
- **No existe** → `412 UNEXISTENT_INSTANCE`. **Verificado en local.**

Es **público** (sin sesión): es la URL que DGI exige codificar en el QR impreso.

## XML del sobre + adenda

```
GET /v1/companies/{rut}/sentCfes/{cfeType}/{serie}/{number}/sobreAdenda
```

Devuelve la adenda del sobre de un CFE emitido, identificado por tipo, serie y número.
