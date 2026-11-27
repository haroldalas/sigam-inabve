// Seguimiento telefónico: llamadas a beneficiarios, reservas de 7 días hábiles y pase a Despacho (registro en SIVET)
// JPII: responsables de Seguimiento · regionales: dependientes de la sede · administración: pase a Despacho y SIVET
import { h } from '../ui.js';
import { seguimiento } from './solicitudes.js';

export default async function () {
  return h('div', {}, await seguimiento());
}
