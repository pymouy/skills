<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Recepción de CFEs

Cuando la empresa recibe comprobantes de sus proveedores, el gateway los expone
bajo `inSobres`:

| Qué | Endpoint |
|---|---|
| Sobres recibidos | `GET /v1/companies/{rut}/inSobres` |
| CFEs recibidos (todos los sobres) | `GET /v1/companies/{rut}/inSobres/cfes` |
| Un CFE recibido | `GET /v1/companies/{rut}/inSobres/cfes/{cfeId}` |
| PDF del CFE recibido | `GET /v1/companies/{rut}/inSobres/cfes/{cfeId}/invoice` |
| Aceptar / rechazar | `PUT /v1/companies/{rut}/inSobres/cfes/{cfeId}/cfeStatus` |
| Recibidos según DGI | `GET /v1/companies/{rut}/inCfesAtDGI?from=...&to=...` |

Todos los listados aceptan el filtrado estándar.

El webhook `CFE_STATUS_CHANGE` también notifica novedades de recepción - ver
Webhooks.

## Estados de un CFE recibido

| Estado | Qué significa | Quién lo pone |
|---|---|---|
| `PENDING_REVISION` | Recibido, esperando que la empresa lo acepte o lo rechace. Es el estado inicial | El gateway, al recibir |
| `ACCEPTED` | La empresa lo aceptó | La empresa |
| `REJECTED` | La empresa lo rechazó | La empresa |
| `FORMAT_REJECTED` | El sobre no cumplió validaciones de formato | El gateway |
| `DUPLICATED` | Ya había un CFE con ese tipo y número del mismo emisor | El gateway |
| `REJECTED_BY_DGI` | DGI rechazó el comprobante | DGI |

Los tres últimos no los pone el integrador: son resultado del procesamiento.

## Aceptar o rechazar

```
PUT /v1/companies/{rut}/inSobres/cfes/{cfeId}/cfeStatus
```

```json
{ "cfeStatus": "ACCEPTED" }
```

> **⚠️ Atención**
>
> **Sólo `ACCEPTED` acepta. Todo lo demás rechaza.**
>
> La implementación es literalmente `if (cfeStatus == "ACCEPTED") ACCEPTED else
> REJECTED`: no valida, no devuelve error y no distingue entre un valor
> desconocido y un rechazo deliberado. En la práctica eso significa que
> **rechazan** el comprobante:
>
> - `"accepted"` en minúscula, o con un espacio de más
> - `"PENDING_REVISION"`, aunque la anotación del `/doc` lo liste como valor válido
> - un body vacío, o sin la clave `cfeStatus`
> - cualquier error de tipeo
>
> Mandá exactamente `ACCEPTED`, en mayúsculas, y comprobá el estado resultante en
> la respuesta antes de darlo por hecho. Volver atrás es otro `PUT`, pero mientras
> tanto el proveedor ve un rechazo.

La respuesta devuelve el CFE con su `cfeStatus` ya actualizado, así que se puede
verificar sin una segunda llamada.

> **Nota**
>
> Dos ejemplos de respuesta de esta sección (`GET .../inSobres` y
> `GET .../inSobres/{sobreId}`) se publican como texto y no como JSON: la anotación
> de origen tiene una llave mal cerrada. Parsealos con cuidado: la forma de la
> respuesta real es la que documenta el contrato.
