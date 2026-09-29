"use client";

import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Search, Ticket } from "lucide-react";
import type { ClienteSorteo, DatosSorteo } from "@/lib/tipos";
import { dinero, fecha } from "./formato";

type Orden = "monto" | "compras" | "tickets" | "nombre";

interface Props {
  datos: DatosSorteo;
  ganadores: Set<number>;
  /** Página pública: sin RIF ni detalle de facturas (no vienen en los datos). */
  publico?: boolean;
}

export function TablaParticipantes({ datos, ganadores, publico = false }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [soloConTickets, setSoloConTickets] = useState(false);
  const [orden, setOrden] = useState<{ campo: Orden; asc: boolean }>({ campo: "monto", asc: false });
  const [abierto, setAbierto] = useState<number | null>(null);

  const totalTickets = datos.totales.tickets;
  const puesto = useMemo(() => new Map(datos.clientes.map((c, i) => [c.id, i + 1])), [datos.clientes]);

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = datos.clientes.filter(
      (c) => (!soloConTickets || c.tickets > 0) && (!q || c.nombre.toLowerCase().includes(q) || c.rif.toLowerCase().includes(q)),
    );
    const signo = orden.asc ? 1 : -1;
    return [...lista].sort((a, b) => {
      const d = orden.campo === "nombre" ? a.nombre.localeCompare(b.nombre) : (a[orden.campo] as number) - (b[orden.campo] as number);
      return d * signo || b.monto - a.monto;
    });
  }, [datos.clientes, busqueda, soloConTickets, orden]);

  const cambiarOrden = (campo: Orden) =>
    setOrden((o) => (o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: campo === "nombre" }));

  const exportar = () => {
    const hoja = XLSX.utils.json_to_sheet(
      datos.clientes.map((c) => ({
        "#": puesto.get(c.id),
        Cliente: c.nombre,
        ...(publico ? {} : { RIF: c.rif }),
        Compras: c.compras,
        "Notas de crédito": c.notasCredito,
        "Monto total (USD)": c.monto,
        Tickets: c.tickets,
        "Probabilidad (%)": totalTickets ? Math.round((c.tickets / totalTickets) * 10000) / 100 : 0,
        "Falta para el siguiente ticket (USD)": c.faltaSiguiente,
      })),
    );
    hoja["!cols"] = [{ wch: 5 }, { wch: 48 }, ...(publico ? [] : [{ wch: 16 }]), { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 9 }, { wch: 14 }, { wch: 22 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Participantes");
    XLSX.writeFile(libro, `sorteo-caracas-${datos.mes}.xlsx`);
  };

  const Encabezado = ({ campo, children, className = "" }: { campo: Orden; children: React.ReactNode; className?: string }) => (
    <th className={`px-4 py-3 font-semibold ${className}`}>
      <button type="button" onClick={() => cambiarOrden(campo)} className="inline-flex items-center gap-1 hover:text-[#0a5fb4]">
        {children}
        {orden.campo === campo && (orden.asc ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
      </button>
    </th>
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Clientes de Caracas con compras</h2>
          <p className="text-sm text-slate-500">
            Total facturado del mes (con IVA) menos notas de crédito · 1 ticket cada {dinero(datos.montoPorTicket)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={publico ? "Buscar cliente…" : "Buscar cliente o RIF…"}
              className="h-10 w-64 rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-[#1a9ad6] focus:bg-white focus:ring-2 focus:ring-[#1a9ad6]/20"
            />
          </label>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-600">
            <input type="checkbox" checked={soloConTickets} onChange={(e) => setSoloConTickets(e.target.checked)} className="accent-[#0a5fb4]" />
            Solo con tickets
          </label>
          <button
            type="button"
            onClick={exportar}
            className="flex h-10 items-center gap-2 rounded-xl bg-[#0b2a6f] px-4 text-sm font-semibold text-white hover:bg-[#0a5fb4]"
          >
            <Download size={16} /> Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-12 px-4 py-3 font-semibold">#</th>
              <Encabezado campo="nombre">Cliente</Encabezado>
              <Encabezado campo="compras" className="text-right">Compras</Encabezado>
              <Encabezado campo="monto" className="text-right">Monto total</Encabezado>
              <Encabezado campo="tickets" className="text-center">Tickets</Encabezado>
              <th className="px-4 py-3 text-right font-semibold">Probabilidad</th>
              <th className="px-4 py-3 text-right font-semibold">Próximo ticket</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map((c) => (
              <Fila
                key={c.id}
                c={c}
                puesto={puesto.get(c.id)!}
                totalTickets={totalTickets}
                ganador={ganadores.has(c.id)}
                abierto={abierto === c.id}
                onToggle={c.documentos.length ? () => setAbierto(abierto === c.id ? null : c.id) : undefined}
              />
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  Ningún cliente coincide con la búsqueda
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
            <tr>
              <td className="px-4 py-3" />
              <td className="px-4 py-3">{datos.totales.clientes} clientes</td>
              <td className="px-4 py-3 text-right tabular-nums">{datos.totales.compras}</td>
              <td className="px-4 py-3 text-right tabular-nums">{dinero(datos.totales.monto, 2)}</td>
              <td className="px-4 py-3 text-center tabular-nums">{totalTickets}</td>
              <td className="px-4 py-3 text-right tabular-nums">100%</td>
              <td className="px-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Fila({
  c, puesto, totalTickets, ganador, abierto, onToggle,
}: { c: ClienteSorteo; puesto: number; totalTickets: number; ganador: boolean; abierto: boolean; onToggle?: () => void }) {
  const participa = c.tickets > 0;
  const probabilidad = totalTickets ? (c.tickets / totalTickets) * 100 : 0;
  return (
    <Fragment>
      <tr className={`transition hover:bg-blue-50/50 ${onToggle ? "cursor-pointer" : ""} ${participa ? "" : "text-slate-400"}`} onClick={onToggle}>
        <td className="px-4 py-3 tabular-nums text-slate-400">{puesto}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {onToggle && (abierto ? <ChevronDown size={15} className="shrink-0 text-slate-400" /> : <ChevronRight size={15} className="shrink-0 text-slate-400" />)}
            <div className="min-w-0">
              <p className={`truncate font-semibold ${participa ? "text-slate-900" : ""}`}>
                {c.nombre}
                {ganador && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">Ganador</span>}
              </p>
              {c.rif && <p className="text-xs text-slate-400">{c.rif}</p>}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {c.compras}
          {c.notasCredito > 0 && <span className="ml-1 text-xs text-rose-500">(−{c.notasCredito} NC)</span>}
        </td>
        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${participa ? "text-slate-900" : ""}`}>{dinero(c.monto, 2)}</td>
        <td className="px-4 py-3 text-center">
          {participa ? (
            <span className="inline-flex min-w-[3rem] items-center justify-center gap-1 rounded-full bg-gradient-to-r from-[#0a5fb4] to-[#1a9ad6] px-2.5 py-1 text-xs font-bold text-white">
              <Ticket size={12} /> {c.tickets}
            </span>
          ) : (
            <span className="text-xs">0</span>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">{participa ? `${probabilidad.toFixed(2)}%` : "–"}</td>
        <td className="px-4 py-3 text-right text-xs tabular-nums">faltan {dinero(c.faltaSiguiente, 2)}</td>
      </tr>
      {abierto && (
        <tr className="bg-slate-50/70">
          <td />
          <td colSpan={6} className="px-4 pb-4 pt-1">
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {c.documentos.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                  <span>
                    <span className="font-semibold text-slate-700">{d.numero}</span>
                    <span className="ml-2 text-slate-400">{fecha(d.fecha)}</span>
                    {d.tipo === "out_refund" && <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-600">NC</span>}
                  </span>
                  <span className={`font-semibold tabular-nums ${d.monto < 0 ? "text-rose-600" : "text-slate-800"}`}>{dinero(d.monto, 2)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
