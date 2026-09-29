/**
 * Lo que devuelve la API pública del sorteo en el panel (Dashboard,
 * app/api/sorteo/*). Si cambian allá, hay que cambiarlos acá.
 */

export interface CompraSorteo {
  id: number;
  numero: string;
  fecha: string;
  tipo: "out_invoice" | "out_refund";
  monto: number;
}

export interface ClienteSorteo {
  id: number;
  nombre: string;
  /** Vacío en la API pública. */
  rif: string;
  compras: number;
  notasCredito: number;
  monto: number;
  tickets: number;
  faltaSiguiente: number;
  /** Vacío en la API pública. */
  documentos: CompraSorteo[];
}

export interface DatosSorteo {
  mes: string;
  desde: string;
  hasta: string;
  sede: string;
  montoPorTicket: number;
  mesCerrado: boolean;
  clientes: ClienteSorteo[];
  totales: { clientes: number; participantes: number; tickets: number; monto: number; compras: number };
  leido: string;
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
  datos: DatosSorteo;
  ganadores: Ganador[];
  ganadoresError: string | null;
  /** El panel no respondió: son los últimos datos que se tenían (hora en `datos.leido`). */
  desactualizado?: boolean;
}
