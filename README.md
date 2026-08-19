# Agent Skills de pymo

Skills para que un agente de código (Claude Code, Cursor, Codex, OpenCode y otros) escriba
integraciones correctas contra las APIs de [pymo](https://pymo.uy), la plataforma de facturación
electrónica (CFE) de Uruguay ante DGI.

## Instalación

En Claude Code, como plugin, que es la forma que se mantiene actualizada sola:

```
/plugin marketplace add pymouy/skills
/plugin install gateway@pymo
```

En Cursor, Codex y otros:

```bash
npx skills add pymouy/skills
```

El CLI detecta los agentes que tenés instalados y te deja elegir a cuáles agregarla.

También se puede copiar el directorio a mano: `skills/gateway/` va en `.claude/skills/` de tu
proyecto, o donde tu agente lea sus skills. Una copia a mano no se actualiza sola, y esta skill se
regenera desde el código real del gateway: una copia vieja no queda incompleta, queda describiendo
una API que ya cambió.

## Qué hay acá

| Skill | Para qué |
|---|---|
| `gateway` | Escribir, revisar o depurar una integración con el gateway: login por sesión, emisión de CFE, consulta de estado, recepción de comprobantes de proveedores y datos de referencia. |

Cada skill trae, además de `SKILL.md`, referencias que el agente carga sólo cuando las necesita
(`referencias/`), ejemplos de request y de código (`fixtures/`) y un validador offline sin
dependencias que revisa un request antes de mandarlo (`scripts/validar.mjs`, Node 18+).

## Qué decide la skill y qué no

Un CFE no es un registro de API reversible: es un documento fiscal, consume un número de CAE que no
vuelve, y un comprobante mal emitido sólo se compensa con otro comprobante. La skill está escrita
para eso.

**Sí decide** cómo se autentica, qué endpoint corresponde, qué forma tiene el request, cómo se lee
la respuesta, cómo se reintenta y cómo se reconcilia el estado final.

**No decide** qué tipo de CFE corresponde a una operación, qué tratamiento fiscal lleva una línea,
si corresponde una nota de crédito o una anulación, ni cuándo se puede emitir en contingencia. Eso
es del régimen fiscal y del contador de la empresa. Donde falta un dato fiscal, la skill le indica
al agente que frene y pregunte, no que complete el campo con algo plausible.

## Cómo se mantiene

`SKILL.md` y `referencias/` **se generan** a partir del contrato real del gateway y de la
documentación para integradores; no se editan a mano. La regeneración corre contra el código de las
rutas, así que la skill no puede quedar describiendo una API que ya no existe sin que un guard lo
marque.

Si algo acá contradice a la API, es un error nuestro: abrí un issue.

## Documentación

La documentación para integradores, con playground y especificación OpenAPI, está en el sitio de
docs de pymo. Esta skill es un derivado de esa documentación, no un reemplazo.

## Licencia

Ver [LICENSE](./LICENSE).
