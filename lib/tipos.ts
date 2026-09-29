/**
 * Lo que devuelve la API pública del sorteo en el panel (Dashboard,
 * app/api/sorteo/* y lib/sorteo/participantes#datosPublicos). Si cambian
 * allá, hay que cambiarlos acá.
 */

/** Sorteo activo, configurado en el panel (SuperAdmin › Ventas › Sorteo de clientes). */
export interface InfoSorteo {
  /** sede:mes:monto. Si cambia, es otro sorteo y la página recarga. */
  clave: string;
  /** null = "Gran Sorteo <Mes> de <Año>". */
  titulo: string | null;
  sede: string;
  mes: string;
  desde: string;
  hasta: string;
  montoPorTicket: number;
  mesCerrado: boolean;
}

/** Participante anónimo: solo id (para ubicar al ganador en la ruleta) y tickets. */
export interface Participante {
  id: number;
  tickets: number;
}

export interface Ganador {
  id: number;
  partnerId: number;
  nombre: string;
  compras: number;
  monto: number;
  tickets: number;
  ticketSorteado: number;
  totalTickets: number;
  participantes: number;
  fecha: string;
}

/** Respuesta de /api/sorteo de esta landing. */
export interface RespuestaSorteo {
  sorteo: InfoSorteo;
  participantes: Participante[];
  totales: { clientes: number; participantes: number; tickets: number };
  leido: string;
  ganadores: Ganador[];
  ganadoresError: string | null;
  /** El panel no respondió: son los últimos datos que se tenían. */
  desactualizado?: boolean;
}

/** Respuesta de /api/sorteo/ganadores de esta landing. */
export interface RespuestaGanadores {
  ganadores: Ganador[];
  ganadoresError: string | null;
  /** Clave del sorteo activo (sede:mes:monto). */
  sorteo?: string;
  desactualizado?: boolean;
}
