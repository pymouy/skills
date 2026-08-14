#!/usr/bin/env node
//
// Verificador determinista de la skill pymo-gateway.
//
// Hay errores contra esta API que son demasiado caros para dejarlos al criterio de
// quien escribe el código - persona o modelo. Duplicar una emisión, apuntar a
// producción sin querer o leer un lote como si el envelope dijera la verdad no son
// bugs que se arreglan después: producen documentos fiscales.
//
// Este archivo chequea justamente esos, y sólo esos. No es un linter, no opina de
// estilo y no toca la red: lee un JSON, o lee archivos de texto, y responde.
//
//   node scripts/validar.mjs pedido <archivo.json> --url <url-completa> [--metodo POST] [--rut <rut>]
//   node scripts/validar.mjs pedido <archivo.json> --endpoint "POST /v1/..." [--rut <rut>]
//   node scripts/validar.mjs codigo <archivo-o-carpeta>...
//   node scripts/validar.mjs autoprueba
//
// Sale 0 si no hay hallazgos de nivel ERROR, 1 si los hay. Los AVISO no hacen fallar.
//
// Node 18+, sin dependencias: el bundle se copia dentro del repo del integrador y
// tiene que correr ahí sin instalar nada.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRATO = join(HERE, '..', 'referencias', 'contrato.openapi.json');
const PRODUCCION = 'gateway.pymo.uy';
const HOMOLOGACION = 'gatewaytest.pymo.uy';

if (!existsSync(CONTRATO)) {
  console.error(`No encuentro el contrato en ${CONTRATO}.`);
  console.error('Este script se corre desde adentro del bundle de la skill, no suelto.');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(CONTRATO, 'utf8'));

// --- hallazgos -------------------------------------------------------------

const hallazgos = [];
const error = (regla, donde, que, hacer) => hallazgos.push({ nivel: 'ERROR', regla, donde, que, hacer });
const aviso = (regla, donde, que, hacer) => hallazgos.push({ nivel: 'AVISO', regla, donde, que, hacer });

const informar = () => {
  const errores = hallazgos.filter((h) => h.nivel === 'ERROR');
  for (const h of hallazgos) {
    console.log(`${h.nivel === 'ERROR' ? '✗' : '!'} [${h.regla}] ${h.donde}`);
    console.log(`    ${h.que}`);
    if (h.hacer) console.log(`    → ${h.hacer}`);
  }
  if (!hallazgos.length) console.log('✓ sin hallazgos');
  else console.log(`\n${errores.length} error(es), ${hallazgos.length - errores.length} aviso(s)`);
  return errores.length ? 1 : 0;
};

// --- rutas del contrato ----------------------------------------------------

const normalizar = (p) =>
  p
    .replace(/\$\{[^}]*\}/g, '{}')   // `${rut}`
    .replace(/\{[^}]*\}/g, '{}')     // `{companyRut}`, `{rut}`
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}') // `:rut`
    .replace(/%[sd]/g, '{}')         // `%s`
    .replace(/\/+$/, '');

// Un segmento concreto (un RUT, un id) también cuenta como parámetro: así una URL real
// matchea la plantilla del contrato.
//
// Devuelve TODAS las compatibles, no la primera. Las plantillas se solapan: con la misma
// cantidad de segmentos, dos plantillas que difieren sólo en cuál está fijo aceptan la
// misma ruta concreta, y quedarse con la primera es jugarse a cómo quedó ordenada la lista
// - la mitad de las veces, a favor de no reportar nada.
const plantillasDe = (pathname, plantillas) => {
  const segs = pathname.replace(/\/+$/, '').split('/');
  return plantillas.filter((t) => {
    const ts = t.replace(/\/+$/, '').split('/');
    return ts.length === segs.length && ts.every((s, i) => (s.startsWith('{') && s.endsWith('}')) || s === segs[i]);
  });
};
const plantillaDe = (pathname, plantillas) => plantillasDe(pathname, plantillas)[0] ?? null;

// Los estados de un comprobante EMITIDO, del contrato. Filtrar por uno de estos es
// una lectura de `sentCfes`, no un cambio de estado de recepción: sin esta lista el
// chequeo de recepción marca el filtro de estado más común que hay.
const ESTADOS_EMITIDO = new Set(spec.components?.schemas?.EstadoCfe?.enum || []);

const operaciones = new Map(); // "POST /v1/..." -> op
const plantillas = [];
for (const [p, item] of Object.entries(spec.paths)) {
  plantillas.push(p);
  for (const [m, op] of Object.entries(item)) operaciones.set(`${m.toUpperCase()} ${p}`, op);
}
const plantillasNormalizadas = new Set(plantillas.map(normalizar));

// --- validación de esquema ------------------------------------------------
//
// Esto valida un SUBCONJUNTO de JSON Schema: el que usa este contrato, no el estándar.
// Decirlo no alcanza, porque una palabra nueva en el contrato se ignoraría en silencio y
// el verificador seguiría diciendo "sin hallazgos" sobre un cuerpo que no cumple.
//
// Así que la lista es explícita y `autoprueba` la hace cumplir: recorre el contrato y
// falla si aparece una palabra que este archivo no sabe evaluar. Ampliar el contrato
// obliga a ampliar esto, o a decidir a mano que la palabra es decorativa.
const PALABRAS_EVALUADAS = new Set([
  '$ref', 'allOf', 'oneOf', 'type', 'required', 'properties', 'additionalProperties',
  'enum', 'items', 'minItems', 'minProperties', 'nullable',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
]);

// Anotaciones: no restringen nada, así que ignorarlas es correcto y no un agujero.
const PALABRAS_DECORATIVAS = new Set(['description', 'title', 'example', 'examples', 'format', 'default', 'readOnly', 'writeOnly', 'deprecated', 'xml', 'externalDocs']);

const deref = (s) => (s && s.$ref ? deref(resolverRef(s.$ref)) : s);
const resolverRef = (ref) => {
  const partes = ref.replace(/^#\//, '').split('/');
  let cur = spec;
  for (const p of partes) cur = cur?.[p];
  if (!cur) throw new Error(`$ref sin resolver: ${ref}`);
  return cur;
};

const tipoDe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const validar = (valor, esquemaCrudo, ruta, errs) => {
  const esquema = deref(esquemaCrudo);
  if (!esquema) return;

  if (esquema.allOf) for (const sub of esquema.allOf) validar(valor, sub, ruta, errs);
  if (esquema.oneOf) {
    const ok = esquema.oneOf.some((sub) => {
      const e = [];
      validar(valor, sub, ruta, e);
      return e.length === 0;
    });
    if (!ok) errs.push(`${ruta}: no coincide con ninguna de las formas admitidas`);
    return;
  }

  if (valor === null) {
    if (!esquema.nullable) errs.push(`${ruta}: null no está admitido`);
    return;
  }

  const t = tipoDe(valor);
  if (esquema.type) {
    const esperado = esquema.type === 'integer' ? 'number' : esquema.type;
    if (t !== esperado) {
      errs.push(`${ruta}: se esperaba ${esquema.type}, llegó ${t}`);
      return;
    }
    if (esquema.type === 'integer' && !Number.isInteger(valor)) errs.push(`${ruta}: se esperaba un entero`);
  }

  if (esquema.enum && !esquema.enum.includes(valor)) {
    errs.push(`${ruta}: "${valor}" no es un valor admitido (${esquema.enum.join(', ')})`);
  }

  if (t === 'number') {
    // `exclusiveMinimum: true` junto a `minimum` es la forma de OpenAPI 3.0, que es la
    // que declara este contrato, y no la booleana-menos de las versiones posteriores.
    if (esquema.minimum !== undefined) {
      const estricto = esquema.exclusiveMinimum === true;
      if (estricto ? valor <= esquema.minimum : valor < esquema.minimum) {
        errs.push(`${ruta}: ${valor} tiene que ser ${estricto ? 'mayor que' : 'mayor o igual que'} ${esquema.minimum}`);
      }
    }
    if (esquema.maximum !== undefined) {
      const estricto = esquema.exclusiveMaximum === true;
      if (estricto ? valor >= esquema.maximum : valor > esquema.maximum) {
        errs.push(`${ruta}: ${valor} tiene que ser ${estricto ? 'menor que' : 'menor o igual que'} ${esquema.maximum}`);
      }
    }
  }

  if (t === 'object') {
    for (const req of esquema.required || []) {
      if (!(req in valor)) errs.push(`${ruta}: falta la propiedad obligatoria "${req}"`);
    }
    if (esquema.minProperties && Object.keys(valor).length < esquema.minProperties) {
      errs.push(`${ruta}: necesita al menos ${esquema.minProperties} propiedad(es)`);
    }
    for (const [k, v] of Object.entries(valor)) {
      const sub = esquema.properties?.[k];
      if (sub) validar(v, sub, `${ruta}.${k}`, errs);
      else if (esquema.additionalProperties === false) {
        errs.push(`${ruta}: la clave "${k}" no existe en el contrato (el gateway la ignora en silencio)`);
      }
    }
  }

  if (t === 'array') {
    if (esquema.minItems && valor.length < esquema.minItems) errs.push(`${ruta}: necesita al menos ${esquema.minItems} elemento(s)`);
    if (esquema.items) valor.forEach((v, i) => validar(v, esquema.items, `${ruta}[${i}]`, errs));
  }
};

// --- modo: pedido ----------------------------------------------------------

const modoPedido = (args) => {
  const archivo = args.find((a) => !a.startsWith('--'));
  const opt = (n) => {
    const i = args.indexOf(`--${n}`);
    return i === -1 ? null : args[i + 1];
  };
  if (!archivo) return uso('falta el archivo JSON del cuerpo del request');

  let cuerpo;
  try {
    cuerpo = JSON.parse(readFileSync(archivo, 'utf8'));
  } catch (e) {
    console.error(`No pude leer ${archivo} como JSON: ${e.message}`);
    return 2;
  }

  const url = opt('url');
  let endpoint = opt('endpoint');
  const rutSesion = opt('rut');
  let rutPath = null;

  if (url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      console.error(`--url no es una URL válida: ${url}`);
      return 2;
    }
    // R3: producción es una decisión humana, nunca la que valida un script.
    if (u.hostname === PRODUCCION) {
      error(
        'AMBIENTE',
        url,
        'El request apunta a producción. Un comprobante emitido acá es fiscal: consume numeración y no se borra.',
        `Integrá y probá contra https://${HOMOLOGACION}. Producción se decide explícitamente, con una persona.`
      );
    } else if (u.hostname !== HOMOLOGACION && !/^(localhost|127\.|0\.0\.0\.0)/.test(u.hostname)) {
      aviso('AMBIENTE', url, `Host desconocido "${u.hostname}": no es homologación ni producción.`, 'Confirmá a qué gateway estás apuntando.');
    }
    const compatibles = plantillasDe(u.pathname, plantillas);
    if (compatibles.length > 1) {
      console.error(`La ruta ${u.pathname} es compatible con más de una operación del contrato:`);
      for (const c of compatibles) console.error(`  ${c}`);
      console.error('No adivino cuál estás llamando. Pasá --endpoint "MÉTODO /plantilla" para decirlo.');
      return 2;
    }
    const plantilla = compatibles[0] ?? null;
    if (!plantilla) {
      error(
        'ENDPOINT',
        u.pathname,
        'La ruta no está en la superficie soportada por esta skill.',
        'Mirá referencias/endpoints.md. Si existe en el gateway pero no acá, está fuera de alcance: pará y preguntá.'
      );
      return informar();
    }
    // El método NO se adivina. Varias rutas llevan más de uno, y elegir el más probable
    // significa validar un cuerpo contra el esquema del endpoint equivocado: un POST que
    // emite pasaría como si fuera la lectura que comparte su ruta, sin cuerpo que revisar.
    const declarado = opt('metodo') || endpoint?.split(' ')[0];
    const posibles = metodosDe(plantilla);
    const metodo = (declarado || (posibles.length === 1 ? posibles[0] : null))?.toUpperCase();
    if (!metodo) {
      console.error(`La ruta ${plantilla} admite ${posibles.join(', ')}: no puedo saber cuál estás mandando.`);
      console.error(`Decilo con --metodo <${posibles.join('|')}>. Adivinarlo validaría el cuerpo contra otra operación.`);
      return 2;
    }
    if (!posibles.includes(metodo)) {
      console.error(`La ruta ${plantilla} no admite ${metodo} en esta skill. Métodos soportados: ${posibles.join(', ')}.`);
      return 2;
    }
    endpoint = `${metodo} ${plantilla}`;
    // R7: el RUT del path tiene que ser el de la sesión.
    const iRut = plantilla.split('/').indexOf('{companyRut}');
    if (iRut !== -1) rutPath = u.pathname.replace(/\/+$/, '').split('/')[iRut];
  }

  if (!endpoint) return uso('falta --url o --endpoint');
  if (!url) {
    aviso('AMBIENTE', endpoint, 'Sin --url no puedo verificar ambiente ni RUT.', `Pasá la URL completa para chequear los dos: --url https://${HOMOLOGACION}/...`);
  }

  // `--endpoint` acepta la plantilla del contrato y también una ruta concreta, que es lo
  // que alguien tiene a mano. Antes había un fallback que decía normalizar y devolvía la
  // misma clave carácter por carácter, así que una ruta con ids reales respondía "no es una
  // operación soportada" sobre una operación que sí lo es - y volvía antes de revisar el
  // cuerpo, que es para lo que se llama a esto.
  {
    const i = endpoint.indexOf(' ');
    const metodo = endpoint.slice(0, i).toUpperCase();
    const ruta = endpoint.slice(i + 1);
    if (!operaciones.has(endpoint)) {
      const compatibles = plantillasDe(ruta, plantillas);
      if (compatibles.length > 1) {
        console.error(`La ruta ${ruta} es compatible con más de una operación del contrato:`);
        for (const c of compatibles) console.error(`  ${c}`);
        console.error('No adivino cuál estás llamando. Pasá la plantilla exacta del contrato.');
        return 2;
      }
      if (compatibles.length === 1) endpoint = `${metodo} ${compatibles[0]}`;
    }
  }

  const op = operaciones.get(endpoint);
  if (!op) {
    error('ENDPOINT', endpoint, 'No es una operación soportada por esta skill.', 'Mirá referencias/endpoints.md.');
    return informar();
  }

  if (rutSesion && rutPath && rutSesion !== rutPath) {
    error(
      'RUT',
      endpoint,
      `El RUT del path (${rutPath}) no es el de la sesión (${rutSesion}). El gateway responde 403 FORBIDDEN.`,
      'Una sesión sólo opera sobre su propia empresa. Si tenés que operar sobre otra, es otra sesión.'
    );
  }

  const esquema = op.requestBody?.content?.['application/json']?.schema;
  if (esquema) {
    const errs = [];
    validar(cuerpo, esquema, 'cuerpo', errs);
    for (const e of errs) error('CONTRATO', archivo, e, 'Corregí el cuerpo contra referencias/contrato.openapi.json. No inventes el campo que falta.');
  } else if (op.requestBody) {
    aviso('CONTRATO', endpoint, 'El contrato no describe un cuerpo JSON para esta operación.', 'Mirá el media type en referencias/contrato.openapi.json.');
  }

  chequearEmision(endpoint, cuerpo, archivo);
  chequearRecepcion(endpoint, cuerpo, archivo);

  return informar();
};

const metodosDe = (plantilla) => Object.keys(spec.paths[plantilla] || {}).map((m) => m.toUpperCase()).sort();

// R2/R6: lo que el esquema no puede decir sobre un cuerpo de emisión.
const chequearEmision = (endpoint, cuerpo, archivo) => {
  if (!endpoint.includes('/sendCfes/')) return;
  if (tipoDe(cuerpo) !== 'object') return;

  const vistos = new Map();
  let comprobantes = 0;
  for (const [clave, lista] of Object.entries(cuerpo)) {
    if (clave === 'emailsToNotify' || clave === 'phonesToNotify') continue;
    if (!Array.isArray(lista)) continue;
    for (const cfe of lista) {
      comprobantes++;
      const id = cfe?.clientEmissionId;
      if (typeof id !== 'string' || !id.trim()) {
        error(
          'IDEMPOTENCIA',
          archivo,
          `Un comprobante de tipo ${clave} no trae clientEmissionId.`,
          'Es obligatorio y es la identidad del documento: se elige y se persiste ANTES del primer request.'
        );
        continue;
      }
      const k = `${clave}|${id}`;
      if (vistos.has(k)) {
        error(
          'IDEMPOTENCIA',
          archivo,
          `clientEmissionId "${id}" repetido dentro del mismo tipo (${clave}) en un solo request.`,
          'El índice único es empresa+sucursal+tipo+id: el segundo va a volver DUPLICATED_KEY en lugar de emitir.'
        );
      }
      vistos.set(k, true);
    }
  }
  if (!comprobantes) {
    error(
      'CONTRATO',
      archivo,
      'El cuerpo no lleva ningún comprobante bajo un código de tipo de CFE.',
      'Cada clave del cuerpo es un código de tipo (101, 111, …) y su valor la lista de comprobantes. No hay una clave "cfes".'
    );
  }
};

// R9: el PUT de recepción rechaza por default, así que un typo rechaza al proveedor.
const chequearRecepcion = (endpoint, cuerpo, archivo) => {
  if (!endpoint.includes('/cfeStatus')) return;
  const v = cuerpo?.cfeStatus;
  if (v === 'ACCEPTED' || v === 'REJECTED') return;
  error(
    'RECEPCION',
    archivo,
    `cfeStatus = ${JSON.stringify(v)}. El gateway compara contra "ACCEPTED" exacto y trata todo lo demás como rechazo, sin avisar.`,
    'Mandá exactamente "ACCEPTED" o "REJECTED", en mayúsculas, y verificá el estado en la respuesta.'
  );
};

// --- modo: codigo ----------------------------------------------------------

const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.php', '.rb', '.java', '.cs', '.go', '.kt', '.env', '.json', '.yml', '.yaml', '.sh']);
const IGNORAR = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__', '.venv', 'target']);

const archivosDe = (ruta) => {
  const st = statSync(ruta);
  if (st.isFile()) return [ruta];
  const out = [];
  for (const e of readdirSync(ruta)) {
    if (IGNORAR.has(e)) continue;
    const p = join(ruta, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...archivosDe(p));
    else if (EXT.has(extname(e)) || e.startsWith('.env')) out.push(p);
  }
  return out;
};

const esTest = (f) => /(^|[\/._-])(test|tests|spec|specs|__tests__|e2e)([\/._-]|$)/i.test(f);

// Heurística deliberadamente simple, y del lado seguro: sólo la línea entera comentada
// cuenta como comentario. Cubre `//`, `*` de JSDoc, `#` de Python y shell.
const esComentario = (linea) => /^\s*(\/\/|\*|\/\*|#|--)/.test(linea);

// Producción como el valor que queda cuando la configuración falta: a la derecha de `||`,
// `??` o `or`, o como segundo argumento de una lectura de entorno al estilo Python. Es una
// regla aparte y no un caso más del default genérico porque tiene que ganarle a la
// exención por `process.env`, que es justo lo que esta forma escribe.
const PROD_COMO_FALLBACK = new RegExp(
  `(?:\\|\\||\\?\\?|\\bor\\b|(?:getenv|environ\\.get|env\\.get)\\s*\\([^)]*,)\\s*['"\`]?\\s*(?:https?:\\/\\/)?${PRODUCCION.replace(/\./g, '\\.')}`,
  'i'
);

const RE_GENERADOR = /uuid|randomUUID|nanoid|uniqid|Guid\.NewGuid|guid\(\)|Date\.now|time\(\)|random|Random/i;
const RE_REINTENTO = /catch|except|retry|reintent|rescue|on_error|onError|backoff/i;

const revisarArchivo = (f) => {
  let texto;
  try {
    texto = readFileSync(f, 'utf8');
  } catch {
    return;
  }
  const lineas = texto.split('\n');
  const donde = (i) => `${f}:${i + 1}`;
  // Los chequeos de archivo entero miran SÓLO el código. Un comentario que nombra
  // `cfesIds` para explicar una columna de la base no es leer un lote, y contarlo hacía
  // fallar un archivo de persistencia que no llama a nada. Vale para los dos lados: si la
  // única mención de SUCCESS está en un comentario, tampoco alcanza como mitigación.
  const codigo = lineas.filter((l) => !esComentario(l)).join('\n');
  const mencionaEnvelope = /SUCCESS|['"]FAIL['"]|message\.code|message\[.code.\]/.test(codigo);
  // Un archivo que nombra los dos ambientes modeló la decisión; uno que sólo nombra
  // producción la tomó. Es la diferencia entre un mapa de ambientes y un accidente, y
  // marcar el primero como error es la forma más rápida de que nadie corra esto.
  const modelaAmbos = codigo.includes(HOMOLOGACION);

  lineas.forEach((linea, i) => {
    // C1 / C2: producción escrita en el código.
    if (linea.includes(PRODUCCION)) {
      if (esTest(f)) {
        error('PRODUCCION-EN-TESTS', donde(i), 'Un test apunta a producción. Un test que emite en producción emite de verdad.', `Usá https://${HOMOLOGACION}.`);
      } else if (PROD_COMO_FALLBACK.test(linea)) {
        // El caso que de verdad emite sin querer: producción a la derecha de `||` o `??`,
        // es decir el valor que queda cuando la configuración falta.
        //
        // Esta rama existe aparte, y va primero, por un defecto que estuvo acá y que este
        // verificador existía justamente para atrapar: la de abajo exime toda línea que
        // nombre `process.env`, y `process.env.PYMO_BASE_URL || 'https://gateway.pymo.uy'`
        // nombra `process.env`. O sea que la forma exacta que el comentario llamaba "el
        // caso que de verdad emite sin querer" salía en verde. Leer configuración no es una
        // mitigación cuando producción es lo que queda si la configuración no está.
        error(
          'PRODUCCION-IMPLICITA',
          donde(i),
          'La URL de producción es el valor por defecto cuando falta la configuración.',
          'El default tiene que ser homologación: un .env faltante o mal escrito tiene que dejarte rehearsando, no emitiendo.'
        );
      } else if (/\|\||\?\?|default|fallback/i.test(linea) && !/process\.env|getenv|ENV\[|os\.environ/.test(linea)) {
        // El resto de los defaults: producción como fallback escrito de otras formas, donde
        // sí vale eximir a la línea que lee configuración.
        error(
          'PRODUCCION-IMPLICITA',
          donde(i),
          'La URL de producción aparece como default o fallback.',
          'El default tiene que ser homologación: un .env faltante o mal escrito tiene que dejarte rehearsando, no emitiendo.'
        );
      } else if (/[=:]/.test(linea) && !modelaAmbos && !/process\.env|getenv|ENV\[|os\.environ/.test(linea)) {
        // Producción escrita a mano y sin el otro ambiente a la vista: no hay decisión,
        // hay una constante.
        error(
          'PRODUCCION-IMPLICITA',
          donde(i),
          'La URL de producción está escrita en el código y homologación no aparece por ningún lado.',
          'La URL base va en configuración, con homologación como default. Si un desarrollador cambia de ambiente editando una constante, en algún momento se mergea la constante equivocada.'
        );
      } else {
        aviso(
          'PRODUCCION',
          donde(i),
          'Se nombra el host de producción.',
          'Verificá que sólo se llegue ahí por una decisión explícita de configuración, y que el default sea homologación.'
        );
      }
    }

    // C7: endpoints fuera de la superficie soportada.
    //
    // PUNTO CIEGO CONOCIDO, y vale la pena entender por qué. Este verificador viaja con el
    // contrato de lo APROBADO y con nada más: no lleva la lista de lo que se retuvo, porque
    // esa lista es una decisión interna de pymo y no se publica. Consecuencia: una ruta
    // concreta que es compatible con una plantilla aprobada se da por buena aunque además
    // sea compatible con una retenida.
    //
    // Pasa cuando dos plantillas tienen la misma cantidad de segmentos y difieren sólo en
    // cuál es fijo: una ruta con un id concreto encaja en las dos, y desde acá se ve la
    // aprobada y nada más. El método tampoco ayuda: en `codigo` suele estar en otra línea.
    // No hay ejemplo textual acá a propósito - escribirlo sería nombrar la retenida.
    //
    // Lo cubre el generador, que sí tiene las dos listas y falla el build. Acá queda
    // anotado porque `codigo` es una ayuda y no una compuerta, y porque decir que la
    // detección de solapamientos está completa sería falso.
    //
    // El token es la ruta, no el literal entero. Una frase como
    // `'GET /v1/currenciesQuotes, pero la cotización la define la empresa'` es un literal
    // válido con una ruta adentro, y tomarlo completo inventa un endpoint que no existe.
    // Un segmento puede ser una interpolación completa -`${encodeURIComponent(rut)}`- y
    // esa lleva paréntesis, así que se matchea como unidad. Sin esto la ruta se cortaba a
    // la mitad y un endpoint APROBADO se reportaba como no soportado, que es el falso
    // positivo más caro: el que enseña a ignorar la herramienta.
    const SEG = '(?:\\$\\{[^}]*\\}|[A-Za-z0-9_{}:%.-])';
    for (const m of linea.matchAll(new RegExp(`\\/v[12]\\/${SEG}+(?:\\/${SEG}*)*`, 'g'))) {
      const n = normalizar(m[0].split('?')[0].replace(/[.,;:)\]}'"`]+$/, ''));
      if (!n.startsWith('/v1/') && !n.startsWith('/v2/')) continue;
      // Los ids concretos de un literal (`/v1/companies/219999990008/…`) tienen que
      // matchear el `{companyRut}` de la plantilla, igual que en el modo pedido. Si es
      // compatible con alguna plantilla del contrato, está soportada.
      if (plantillasDe(n, plantillas).length) continue;
      // Una base de concatenación no es un endpoint: si lo encontrado es más CORTO que
      // una plantilla, es el prefijo con el que se arma la URL y no se marca.
      //
      // Lo que NO vale es lo inverso. Una ruta que EXTIENDE una plantilla aprobada es otro
      // endpoint, no un prefijo de ella: `/v1/companies/{}` está soportado, y con la regla
      // al revés eso eximía a todo lo que cuelga de ahí - es decir, a casi toda la API,
      // incluido `createCreditNote`, que está en revisión. Lo encontró una evaluación, no
      // esta lista de casos.
      if ([...plantillasNormalizadas].some((t) => t.startsWith(n + '/'))) continue;
      // Un comentario no llama a nada, y el caso frecuente es justamente el bueno: alguien
      // explicando por qué NO usa ese endpoint. Se nombra, no se falla.
      // Nombrar no es llamar. Un comentario que explica por qué NO se usa un endpoint, o un
      // mensaje de error que lo menciona, son el comportamiento correcto; la línea que lo
      // llama es el hallazgo. Se distinguen por el verbo de llamada, y lo que queda en duda
      // se informa igual, porque un endpoint fuera de superficie escrito en el código es
      // algo que alguien tiene que mirar aunque hoy no se ejecute.
      // Nombrar no es llamar, pero CONSTRUIR sí cuenta: `const ruta = \`/v1/.../x\`` es una
      // llamada esperando a la línea siguiente, y pedir un verbo en la misma línea la deja
      // pasar - así se escapó una en una evaluación.
      //
      // Lo que separa una de otra es lo que hay JUSTO ANTES de la ruta. Si es la comilla que
      // abre el literal, o el cierre de una interpolación, el literal ES la ruta: eso se
      // construye para llamarlo. Si hay texto delante, la ruta está adentro de una frase y
      // la frase es prosa - un mensaje de error, una línea de documentación en un JSON.
      //
      // Con el host escrito adentro del literal, lo que precede a la ruta es el final del
      // hostname y no la comilla, así que una llamada de verdad se leía como una mención -
      // y el aviso decía "sin llamarlo acá" justo en la línea que lo llama. Se descarta el
      // prefijo `esquema://host` antes de mirar, con lo que el literal vuelve a empezar
      // donde empieza.
      const antes = linea.slice(0, m.index).replace(/https?:\/\/[A-Za-z0-9_.:-]*$/, '');
      const construye = /(['"`]|\$\{[^}]*\})\s*$/.test(antes);
      if (construye && !esComentario(linea)) {
        error('ENDPOINT-NO-SOPORTADO', donde(i), `Se llama a "${n}", que no está en la superficie soportada por esta skill.`, 'Mirá referencias/endpoints.md. Si de verdad hace falta, pará y preguntá a pymo.');
      } else {
        aviso('ENDPOINT-NO-SOPORTADO', donde(i), `${esComentario(linea) ? 'Un comentario nombra' : 'Se nombra'} "${n}", que está fuera de la superficie soportada, sin llamarlo acá.`, 'Si es para explicar por qué no lo usás, está bien. Si es una intención pendiente, pará y preguntá a pymo.');
      }
    }

    // C8: el typo que rechaza al proveedor. Sólo cuando el valor se ESCRIBE: filtrar o
    // comparar contra PENDING_REVISION es correcto y frecuente, y marcarlo sería marcar
    // la lectura de la bandeja de entrada.
    for (const m of linea.matchAll(/cfeStatus['"\]]*\s*[:=]\s*['"`]([A-Za-z_]+)['"`]/g)) {
      if (m[1] !== 'ACCEPTED' && m[1] !== 'REJECTED' && !ESTADOS_EMITIDO.has(m[1])) {
        error(
          'RECEPCION',
          donde(i),
          `Se manda cfeStatus = "${m[1]}". El gateway acepta sólo con "ACCEPTED" exacto y trata todo lo demás como rechazo, sin validar y sin error.`,
          'Usá "ACCEPTED" o "REJECTED" en mayúsculas, y verificá el estado que vuelve en la respuesta.'
        );
      }
    }
    // Comparar contra un valor que el gateway nunca escribe es una rama muerta.
    for (const m of linea.matchAll(/cfeStatus['"\]]*\s*[!=]==?\s*['"`](accepted|rejected|Accepted|Rejected)['"`]/g)) {
      aviso(
        'RECEPCION',
        donde(i),
        `Se compara cfeStatus contra "${m[1]}", que el gateway nunca devuelve: los estados son mayúsculas.`,
        'Compará contra "ACCEPTED", "REJECTED", "PENDING_REVISION", "FORMAT_REJECTED", "DUPLICATED" o "REJECTED_BY_DGI".'
      );
    }

    // C6: reintentar con un id nuevo.
    if (/clientEmissionId/.test(linea) && RE_GENERADOR.test(linea)) {
      const ventana = lineas.slice(Math.max(0, i - 15), i + 15).join('\n');
      if (RE_REINTENTO.test(ventana)) {
        error(
          'IDEMPOTENCIA',
          donde(i),
          'Se genera un clientEmissionId cerca de un bloque de reintento o de manejo de error.',
          'Un id nuevo en un reintento emite un SEGUNDO comprobante fiscal. El id se genera y se persiste una vez, antes del primer request, y se reusa tal cual.'
        );
      } else {
        aviso(
          'IDEMPOTENCIA',
          donde(i),
          'El clientEmissionId se genera acá.',
          'Asegurate de persistirlo con el comprobante antes de llamar, y de reusar ese mismo valor en cualquier reintento.'
        );
      }
    }
  });

  // Chequeos de archivo entero: más baratos y con muchos menos falsos positivos que
  // intentar leer el flujo línea por línea.

  // C3: éxito decidido por el código HTTP.
  const usaHttpOk = /res(ponse)?\.ok\b|status(Code)?\s*(===?|==)\s*200|status(Code)?\s*<\s*3\d\d|raise_for_status|IsSuccessStatusCode/.test(codigo);
  if (usaHttpOk && /pymo|sendCfes|cfesIds|connect\.sid/i.test(codigo) && !mencionaEnvelope) {
    error(
      'HTTP-200',
      f,
      'El éxito se decide por el código HTTP y en ningún lado se lee el status del cuerpo.',
      'El gateway responde HTTP 200 con status "FAIL" en al menos nueve lugares. Ramificá por status y por message.code.'
    );
  }

  // C4: el lote leído como si el envelope dijera la verdad.
  // Nombrar `cfesIds` no es leer el lote: aparece en el comentario de una columna y en un
  // DDL sin que el archivo toque la respuesta. Lo que cuenta es consumirlo - indexarlo,
  // recorrerlo, medirlo. `cfesIds[]` con corchetes vacíos es notación, no acceso.
  const consumeLote = /cfesIds\s*\[\s*[^\]\s]/.test(codigo)
    || /cfesIds\s*\.\s*(forEach|map|filter|find|reduce|length|slice|entries)/.test(codigo)
    || /\bof\s+[A-Za-z0-9_.$]*cfesIds/.test(codigo);
  if (consumeLote && !/FAIL/.test(codigo)) {
    error(
      'LOTE',
      f,
      'Se usa payload.cfesIds y no aparece ningún chequeo de entradas con status FAIL.',
      'El envelope dice SUCCESS aunque no se haya emitido ninguno. Recorré cada entrada y correlacioná por clientEmissionId, no por posición.'
    );
  }

  // C5: la emisión tratada como aceptación de DGI. Es AVISO y no error a propósito: se
  // apoya en vocabulario ("aceptada", "approved"), que es lo más blando que hay acá. La
  // regla en sí no es opinable - la respuesta del POST no es aceptación de DGI - pero
  // deducirla de cómo alguien nombró una variable sí lo es.
  if (/sendCfes/.test(codigo) && /(aceptad|approved|aprobad)/i.test(codigo) && !/PROCESSED_ACCEPTED|actualCfeStatus|sentCfes/.test(codigo)) {
    aviso(
      'ASINCRONIA',
      f,
      'Se habla de un comprobante aceptado, pero no se consulta el estado real en ningún lado.',
      'La respuesta de sendCfes no es aceptación de DGI. El estado final llega después: PROCESSED_ACCEPTED / PROCESSED_REJECTED en actualCfeStatus.'
    );
  }
};

const modoCodigo = (args) => {
  const rutas = args.filter((a) => !a.startsWith('--'));
  if (!rutas.length) return uso('falta la ruta a revisar');
  let n = 0;
  let noJs = 0;
  const JS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
  for (const r of rutas) {
    if (!existsSync(r)) {
      console.error(`No existe: ${r}`);
      return 2;
    }
    for (const f of archivosDe(resolve(r))) {
      n++;
      if (!JS.has(extname(f))) noJs++;
      revisarArchivo(f);
    }
  }
  console.log(`${n} archivo(s) revisados${noJs ? `, ${noJs} fuera de JavaScript` : ''}.\n`);
  const rc = informar();
  console.log('\nEsto es una ayuda, no una compuerta. Busca patrones de texto, puede errar en');
  console.log('las dos direcciones, y **no encontrar nada no significa que la integración esté**');
  console.log('**bien**: significa que estos patrones no aparecieron. Lo que decide sigue siendo');
  console.log('el contrato de seguridad de SKILL.md, leído por vos.');
  if (noJs) {
    console.log(`\nOjo: ${noJs} archivo(s) no son JavaScript. Los patrones se escribieron pensando`);
    console.log('también en Python, PHP y Java, pero sólo hay casos de prueba para JavaScript, así');
    console.log('que en esos archivos ni un hallazgo ni su ausencia están verificados.');
  }
  return rc;
};

// --- modo: autoprueba ------------------------------------------------------
//
// El verificador tiene que fallar donde se espera que falle. Los casos viven en
// fixtures/casos.json y son los mismos ejemplos que puede leer un integrador.

// Recorre los esquemas del contrato y devuelve las palabras que este archivo no sabe
// evaluar ni ha decidido ignorar. Cualquier resultado no vacío es un agujero: el
// verificador estaría diciendo "válido" sobre una restricción que nunca miró.
const auditarPalabras = () => {
  const desconocidas = new Map();
  const vistos = new Set();
  const recorrer = (nodo, ruta) => {
    if (!nodo || typeof nodo !== 'object' || vistos.has(nodo)) return;
    vistos.add(nodo);
    if (Array.isArray(nodo)) return nodo.forEach((n, i) => recorrer(n, `${ruta}[${i}]`));
    for (const [k, v] of Object.entries(nodo)) {
      if (PALABRAS_DECORATIVAS.has(k)) continue;
      if (k === 'properties') {
        for (const [nombre, sub] of Object.entries(v)) recorrer(sub, `${ruta}.${nombre}`);
        continue;
      }
      if (k === 'enum' || k === 'required') continue;
      if (!PALABRAS_EVALUADAS.has(k)) desconocidas.set(k, ruta);
      recorrer(v, `${ruta}.${k}`);
    }
  };
  for (const [nombre, esq] of Object.entries(spec.components?.schemas || {})) recorrer(esq, nombre);
  for (const [ruta, item] of Object.entries(spec.paths)) {
    for (const [m, op] of Object.entries(item)) {
      const s = op.requestBody?.content?.['application/json']?.schema;
      if (s) recorrer(s, `${m.toUpperCase()} ${ruta}`);
    }
  }
  return desconocidas;
};

// El motor de esquemas está escrito a mano, así que cada palabra que dice evaluar tiene
// que tener un caso que pase y uno que falle. Sin esto, una palabra puede estar en la
// lista de arriba y no hacer nada: el verificador respondería "válido" igual.
const CASOS_MOTOR = [
  ['type', { type: 'string' }, 'ok', 1],
  ['required', { type: 'object', required: ['a'] }, { a: 1 }, {}],
  ['properties', { type: 'object', properties: { a: { type: 'number' } } }, { a: 1 }, { a: 'x' }],
  ['additionalProperties', { type: 'object', properties: {}, additionalProperties: false }, {}, { x: 1 }],
  ['enum', { enum: ['A', 'B'] }, 'A', 'C'],
  ['items', { type: 'array', items: { type: 'number' } }, [1, 2], [1, 'x']],
  ['minItems', { type: 'array', minItems: 2, items: {} }, [1, 2], [1]],
  ['minProperties', { type: 'object', minProperties: 1 }, { a: 1 }, {}],
  ['nullable', { type: 'string', nullable: true }, null, undefined],
  ['no nullable', { type: 'string' }, 'x', null],
  ['minimum', { type: 'number', minimum: 0 }, 0, -1],
  ['exclusiveMinimum', { type: 'number', minimum: 0, exclusiveMinimum: true }, 1, 0],
  ['maximum', { type: 'number', maximum: 100 }, 100, 101],
  ['exclusiveMaximum', { type: 'number', maximum: 100, exclusiveMaximum: true }, 99, 100],
  ['oneOf', { oneOf: [{ type: 'number' }, { type: 'string' }] }, 'x', true],
  ['allOf', { allOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }] }, { a: 1, b: 2 }, { a: 1 }],
  ['$ref', { $ref: '#/components/schemas/Estado' }, 'SUCCESS', 'QUIZAS'],
];

const chequearMotor = () => {
  const fallos = [];
  for (const [nombre, esquema, valido, invalido] of CASOS_MOTOR) {
    if (valido !== undefined) {
      const e = [];
      validar(valido, esquema, 'v', e);
      if (e.length) fallos.push(`${nombre}: rechazó un valor válido (${JSON.stringify(valido)}) - ${e[0]}`);
    }
    if (invalido !== undefined) {
      const e = [];
      validar(invalido, esquema, 'v', e);
      if (!e.length) fallos.push(`${nombre}: aceptó un valor inválido (${JSON.stringify(invalido)})`);
    }
  }
  return fallos;
};

const modoAutoprueba = () => {
  const motor = chequearMotor();
  if (motor.length) {
    console.log(`autoprueba: el motor de esquemas falla en ${motor.length} caso(s)`);
    for (const f of motor) console.log(`  ✗ ${f}`);
    return 1;
  }
  const desconocidas = auditarPalabras();
  if (desconocidas.size) {
    console.log(`autoprueba: el contrato usa ${desconocidas.size} palabra(s) de esquema que validar.mjs no evalúa`);
    for (const [k, ruta] of desconocidas) console.log(`  ✗ "${k}" (en ${ruta})`);
    console.log('  Implementalas en `validar`, o agregalas a PALABRAS_DECORATIVAS si de verdad no restringen nada.');
    return 1;
  }
  const casos = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'casos.json'), 'utf8')).casos;
  let ok = 0;
  const fallos = [];
  for (const c of casos) {
    hallazgos.length = 0;
    let salida;
    if (c.modo === 'pedido') {
      const args = [join(HERE, '..', 'fixtures', c.archivo)];
      if (c.url) args.push('--url', c.url);
      if (c.endpoint) args.push('--endpoint', c.endpoint);
      if (c.rut) args.push('--rut', c.rut);
      if (c.metodo) args.push('--metodo', c.metodo);
      salida = silenciar(() => modoPedido(args));
    } else {
      salida = silenciar(() => modoCodigo([join(HERE, '..', 'fixtures', c.archivo)]));
    }
    // El código de salida se chequea SIEMPRE, con un default derivado de lo que el caso
    // espera: 0 si no espera errores, 1 si los espera, y `salida` explícito para los que
    // se niegan a adivinar (2). Sin esto, un fixture borrado hacía que modoPedido saliera
    // con 2 sin hallazgos, y un caso que esperaba [] lo contaba como éxito: la prueba
    // pasaba porque el archivo no estaba.
    const salidaEsperada = c.salida !== undefined ? c.salida : (c.espera || []).length ? 1 : 0;
    if (salida !== salidaEsperada) {
      fallos.push(`${c.id}: esperaba salir con ${salidaEsperada}, salió con ${salida}`);
      continue;
    }
    // El conjunto de reglas, no su cardinalidad: un caso no debería romperse porque el
    // mismo patrón aparece dos veces en el mismo archivo.
    const porNivel = (n) => [...new Set(hallazgos.filter((h) => h.nivel === n).map((h) => h.regla))].sort();
    const reglas = porNivel('ERROR');
    const esperadas = [...new Set(c.espera || [])].sort();
    // Los avisos se declaran sólo cuando importan. Bajar una regla de error a aviso es una
    // decisión legítima; que desaparezca del todo sin que nadie lo note, no. Un caso que
    // lista `espera_avisos` hace que esa distinción quede probada.
    const avisos = porNivel('AVISO');
    const avisosEsperados = [...new Set(c.espera_avisos || [])].sort();
    const faltanAvisos = avisosEsperados.filter((r) => !avisos.includes(r));
    if (JSON.stringify(reglas) === JSON.stringify(esperadas) && !faltanAvisos.length) ok++;
    else if (faltanAvisos.length) fallos.push(`${c.id}: faltan avisos [${faltanAvisos.join(', ')}]`);
    else fallos.push(`${c.id}: esperaba [${esperadas.join(', ')}], obtuvo [${reglas.join(', ')}]`);
  }
  hallazgos.length = 0;
  console.log(`autoprueba: ${ok}/${casos.length} casos, ${CASOS_MOTOR.length} palabras de esquema`);
  for (const f of fallos) console.log(`  ✗ ${f}`);
  return fallos.length ? 1 : 0;
};

const silenciar = (fn) => {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
};

// --- cli -------------------------------------------------------------------

const uso = (msg) => {
  if (msg) console.error(`validar.mjs: ${msg}\n`);
  console.error('Uso:');
  console.error('  node scripts/validar.mjs pedido <archivo.json> --url <url-completa> [--metodo POST] [--rut <rut>]');
  console.error('  node scripts/validar.mjs pedido <archivo.json> --endpoint "POST /v1/..." [--rut <rut>]');
  console.error('  node scripts/validar.mjs codigo <archivo-o-carpeta>...');
  console.error('  node scripts/validar.mjs autoprueba');
  return 2;
};

const [modo, ...resto] = process.argv.slice(2);
const salida =
  modo === 'pedido' ? modoPedido(resto)
  : modo === 'codigo' ? modoCodigo(resto)
  : modo === 'autoprueba' ? modoAutoprueba()
  : uso(modo ? `modo desconocido "${modo}"` : null);
process.exit(salida);
