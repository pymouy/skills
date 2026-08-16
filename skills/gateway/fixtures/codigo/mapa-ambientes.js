// Un mapa de ambientes con los dos hosts, elegido por variable de entorno y con
// homologación como default. Está acá para fijar una calibración del verificador:
// esto NO es un hallazgo.
//
// La diferencia con integracion-mala.js no es que nombre producción, es que la
// decisión existe. Marcar este patrón como error convierte el verificador en ruido,
// y un verificador ruidoso es un verificador que nadie corre.

const AMBIENTES = {
  homologacion: 'https://gatewaytest.pymo.uy',
  produccion: 'https://gateway.pymo.uy',
};

const BASE = AMBIENTES[process.env.PYMO_AMBIENTE || 'homologacion'];
if (!BASE) throw new Error(`PYMO_AMBIENTE desconocido: ${process.env.PYMO_AMBIENTE}`);
console.log(`[pymo] cliente apuntando a ${BASE}`);

module.exports = { BASE };
