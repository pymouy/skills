// El mismo trabajo que integracion-mala.js, escrito de forma que los errores caros no
// se puedan cometer. Es el modelo mental, no una librería: falta el manejo de sesión
// completo, el logging y los tipos.
//
// Las cuatro decisiones que importan están marcadas.

// (1) El ambiente sale de configuración y el default es homologación. Un .env faltante
//     deja al cliente rehearsando, no emitiendo documentos fiscales.
const BASE = process.env.PYMO_BASE_URL || 'https://gatewaytest.pymo.uy';
const RUT = process.env.PYMO_RUT;
const SUCURSAL = process.env.PYMO_BO || '1';

console.log(`[pymo] cliente apuntando a ${BASE}`);

// El gateway responde HTTP 200 con status "FAIL" en varios lugares, así que el resultado
// de pymo se lee del cuerpo y nunca del código HTTP.
async function llamar(metodo, ruta, cuerpo, cookie) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = await res.json();
  if (res.status === 401) throw new SesionVencida();
  if (data.status !== 'SUCCESS') {
    throw new ErrorDePymo(data.message?.code ?? 'SIN_CODIGO', data.message?.value);
  }
  return data.payload;
}

// (2) clientEmissionId es la identidad del documento, no del intento: viene de la orden,
//     ya persistido, y no se genera acá. Un reintento manda exactamente el mismo cuerpo.
async function emitir(orden, cookie) {
  const cuerpo = {
    [orden.tipoCfe]: [
      {
        clientEmissionId: orden.clientEmissionId,
        IdDoc: { MntBruto: '1', FmaPago: orden.formaPago },
        Receptor: orden.receptor,
        Totales: { TpoMoneda: orden.moneda },
        Items: orden.items,
      },
    ],
    emailsToNotify: [],
  };

  const payload = await llamar('POST', `/v1/companies/${RUT}/sendCfes/${SUCURSAL}`, cuerpo, cookie);

  // (3) El envelope dice SUCCESS aunque no se haya emitido nada. Se recorre entrada por
  //     entrada, y se correlaciona por clientEmissionId, nunca por posición.
  const resultados = new Map();
  for (const entrada of payload.cfesIds) {
    if (entrada.status === 'FAIL') {
      const id = entrada.receivedDataWithError?.clientEmissionId;
      // DUPLICATED_KEY no es un fallo: el comprobante ya existía y viene el original.
      if (entrada.message?.code === 'DUPLICATED_KEY' && entrada.firstCfeResponse) {
        resultados.set(entrada.firstCfeResponse.clientEmissionId, entrada.firstCfeResponse);
      } else {
        resultados.set(id, { error: entrada.message?.code, detalle: entrada.message?.value });
      }
    } else {
      resultados.set(entrada.clientEmissionId, entrada);
    }
  }
  return resultados;
}

// (4) Lo que devuelve la emisión es un comprobante creado y firmado, no aceptado por DGI.
//     El estado fiscal se reconcilia después, y es una consulta distinta.
const ESTADOS_FINALES = new Set([
  'PROCESSED_ACCEPTED',
  'PROCESSED_REJECTED',
  'PROCESSED_RELIQUIDATED',
  'FORMAT_REJECTED',
  'SOBRE_DUPLICATED',
  'DUPLICATED_AT_DGI',
  'BAD_CUSTOM_SERIE_NUMBER',
  'DELETED_MISSING_CAE',
  'REPORTED_DAILY_REPORT',
  'CFE_UNKNOWN_ERROR',
]);

// Dos patrones que el verificador NO tiene que marcar como error, y que aparecieron
// escritos por agentes que estaban haciendo lo correcto:
//
//   - Este comentario nombra /v1/cotizaciones justamente para decir que NO se usa: no está
//     en el contrato, y la cotización se pide por currenciesQuotes, acá abajo.
//   - Y una frase con una ruta adentro sigue siendo una frase, no un endpoint inventado.
const AYUDA_MONEDA =
  'GET /v1/currenciesQuotes trae la cotización del BCU, pero cuál corresponde a la fecha ' +
  'del comprobante lo define la empresa.';

// Un mensaje de error puede nombrar un endpoint fuera de superficie justamente para
// explicar por qué no se usa: nombrar no es llamar, y esto no es un hallazgo.
class AnulacionNoSoportada extends Error {
  constructor() {
    super(
      'No anulo el comprobante: POST /v1/companies/{rut}/anular no está en el contrato, ' +
        'y anular no es lo mismo que emitir una nota de crédito. Pará y preguntá a pymo.'
    );
  }
}

// Y una ruta interpolada con paréntesis adentro sigue siendo la misma ruta aprobada.
const rutaCae = (rut, tipo) => `/v1/companies/${encodeURIComponent(rut)}/cfesActiveNumbers/${tipo}`;

// Filtrar por un estado de comprobante EMITIDO es una lectura, no una aceptación:
// los dos usan la palabra cfeStatus y no son la misma cosa.
const FILTRO_RECHAZADOS = { cfeStatus: 'PROCESSED_REJECTED' };

async function reconciliar(desde, cookie) {
  const payload = await llamar('GET', `/v1/companies/${RUT}/sentCfes?updatedAt[gte]=${desde}`, null, cookie);
  return (payload.companySentCfes ?? [])
    .map((cfe) => ({ id: cfe._id, estado: cfe.actualCfeStatus, final: ESTADOS_FINALES.has(cfe.actualCfeStatus) }))
    .filter((x) => x.final);
}

// El webhook es una señal para ir a consultar, no un dato: no viene firmado, no se
// reintenta y no trae los comprobantes. El polling de arriba es el respaldo obligatorio.
function alRecibirWebhook(aviso) {
  if (aviso?.type === 'CFE_STATUS_CHANGE') encolarReconciliacion();
  return 200;
}

// Leer la bandeja filtrando por el estado inicial es correcto: el hallazgo es escribir
// un valor que no sea ACCEPTED o REJECTED, no compararse contra los otros estados.
async function pendientesDeRevisar(cookie) {
  const payload = await llamar('GET', `/v1/companies/${RUT}/inSobres/cfes`, null, cookie);
  return (payload.receivedCfes ?? []).filter((c) => c.cfeStatus === 'PENDING_REVISION');
}

// Sólo "ACCEPTED" acepta: el gateway trata cualquier otra cosa como rechazo, sin avisar.
async function responderRecibido(cfeId, acepta, cookie) {
  const payload = await llamar(
    'PUT',
    `/v1/companies/${RUT}/inSobres/cfes/${cfeId}/cfeStatus`,
    { cfeStatus: acepta ? 'ACCEPTED' : 'REJECTED' },
    cookie
  );
  return payload;
}
