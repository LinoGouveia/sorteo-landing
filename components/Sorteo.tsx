"use client";

/**
 * Landing del sorteo de clientes de Supricom (sorteo.supricom.com.ve).
 *
 * El sorteo activo (sede, mes, monto por ticket y título) se configura en el
 * panel (SuperAdmin › Ventas › Sorteo de clientes); esta página lo toma solo.
 * Sin base de datos propia: todo sale del panel por las rutas /api/sorteo/*
 * de esta app (lib/panel.ts).
 *
 * - La ruleta es ANÓNIMA: cada segmento dice «? ? ?» y la API ni siquiera trae
 *   los nombres; el nombre se conoce cuando gana (lista de ganadores).
 * - Gira solo el operador, con la clave SORTEO_CLAVE del panel (botón
 *   «Operador» al pie). El ganador lo elige el panel; todas las pantallas
 *   consultan /api/sorteo/ganadores cada pocos segundos y giran hasta él.
 * - «Grabar giro» (operador): al tocar GIRAR la ruleta se agranda y el fondo
 *   se difumina; cuando sale el ganador se genera el video del giro cuadro a
 *   cuadro, con el sonido sincronizado (lib/grabacion.ts), y se descarga
 *   solo. No se graba en vivo: así el giro en pantalla no se traba.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  AlertTriangle, Crown, KeyRound, LogOut, Maximize2, Minimize2,
  RotateCcw, Ticket, Trophy, Users, Video, Volume2, VolumeX, X,
} from "lucide-react";
import type { Ganador, InfoSorteo, Participante, RespuestaGanadores, RespuestaSorteo } from "@/lib/tipos";
import { generarVideoGiro, puedeGenerarVideo } from "@/lib/grabacion";
import { RuletaSorteo, fanfarria, type RuletaHandle, type SegmentoRuleta } from "./RuletaSorteo";
import { dinero, nombreMes } from "./formato";

const SONDEO_MS = 5000;
const CLAVE_SESION = "sorteo:clave";
const PREF_GRABAR = "sorteo:grabar";
const CONFETI = ["#1737d8", "#1a9ad6", "#0a5fb4", "#f5b72b", "#ffffff", "#39e27d"];

const leerClave = () => {
  try { return sessionStorage.getItem(CLAVE_SESION) || ""; } catch { return ""; }
};
const guardarClave = (clave: string) => {
  try {
    if (clave) sessionStorage.setItem(CLAVE_SESION, clave);
    else sessionStorage.removeItem(CLAVE_SESION);
  } catch { /* sin almacenamiento: la clave vive solo en memoria */ }
};
const leerPref = (llave: string) => {
  try { return localStorage.getItem(llave) === "1"; } catch { return false; }
};
const guardarPref = (llave: string, valor: boolean) => {
  try { localStorage.setItem(llave, valor ? "1" : "0"); } catch { /* sin almacenamiento */ }
};

export const tituloDe = (info: InfoSorteo) => info.titulo || `Gran Sorteo ${nombreMes(info.mes)}`;

/** Grande, chico, grande, chico…: los segmentos gordos no quedan todos juntos. */
function intercalar<T>(ordenados: T[]): T[] {
  const r: T[] = [];
  for (let i = 0, j = ordenados.length - 1; i <= j; i++, j--) {
    r.push(ordenados[i]);
    if (i !== j) r.push(ordenados[j]);
  }
  return r;
}

const mismaLista = (a: Ganador[], b: Ganador[]) => a.length === b.length && a.every((g, i) => g.id === b[i].id);

const nombreArchivo = (info: InfoSorteo, numero: number, extension: string) =>
  `sorteo-${info.sede.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}-${info.mes}-ganador-${numero}.${extension}`;

export function Sorteo() {
  const [info, setInfo] = useState<InfoSorteo | null>(null);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [totales, setTotales] = useState<RespuestaSorteo["totales"] | null>(null);
  const [ganadores, setGanadores] = useState<Ganador[]>([]);
  const [ganadoresError, setGanadoresError] = useState<string | null>(null);
  // El panel no respondió: se muestran los últimos datos que tenía la landing.
  const [desactualizado, setDesactualizado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  // Sorteo que muestra esta pantalla (sede:mes:monto). Si el sondeo trae otro
  // (cambiaron la configuración en el panel), se recargan los participantes.
  const claveActual = useRef<string | null>(null);

  // Premios ya mostrados en esta pantalla. Los que aparecen y no están acá se
  // "revelan": la ruleta gira hasta ellos. Al cargar, todo lo anterior cuenta
  // como visto (no se re-giran los premios de antes).
  const [revelados, setRevelados] = useState<Set<number>>(new Set());
  const iniciado = useRef(false);
  // El último ganador se queda en la ruleta (en dorado, bajo el puntero)
  // hasta el giro siguiente: si saliera al detenerse, el puntero quedaría
  // apuntando a otro cliente y confunde a quien está mirando.
  const [destacado, setDestacado] = useState<number | null>(null);

  const [clave, setClave] = useState("");
  const [esOperador, setEsOperador] = useState(false);
  const [pidiendoClave, setPidiendoClave] = useState(false);

  const [sonido, setSonido] = useState(true);
  const [pidiendo, setPidiendo] = useState(false);
  const [animando, setAnimando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Ganador | null>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);

  // Grabación del giro
  const [puedeGrabar, setPuedeGrabar] = useState(false);
  const [grabar, setGrabar] = useState(false);
  // Este giro se graba (se decide al tocar GIRAR).
  const grabarEsteGiro = useRef(false);
  const [grabando, setGrabando] = useState(false);
  // Avance de la generación del video (0 a 1); null = no se está generando.
  const [preparando, setPreparando] = useState<number | null>(null);
  const [enfoque, setEnfoque] = useState(false);
  const [videoListo, setVideoListo] = useState<string | null>(null);

  const raiz = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const disparar = useRef<confetti.CreateTypes | null>(null);
  const ruleta = useRef<RuletaHandle>(null);

  useEffect(() => {
    void puedeGenerarVideo().then(setPuedeGrabar);
    setGrabar(leerPref(PREF_GRABAR));
  }, []);

  const cabeceras = useCallback(
    (extra?: Record<string, string>): Record<string, string> => ({ ...(clave ? { "x-sorteo-clave": clave } : {}), ...extra }),
    [clave],
  );

  const recibirGanadores = useCallback((lista: Ganador[], err: string | null) => {
    setGanadoresError(err);
    setGanadores((prev) => (mismaLista(prev, lista) ? prev : lista));
    if (!iniciado.current) {
      iniciado.current = true;
      setRevelados(new Set(lista.map((g) => g.id)));
    }
  }, []);

  // Otro sorteo (otra sede, mes o monto): los premios que ya tenga cuentan
  // como vistos (no se re-giran) y se vuelven a leer los participantes.
  const cambiarDeSorteo = useCallback(() => {
    claveActual.current = null;
    iniciado.current = false;
    setDestacado(null);
    setResultado(null);
    setRevelados(new Set());
    setGanadores([]);
    setRecarga((n) => n + 1);
  }, []);

  // Sorteo activo (panel; caché de 60 s en esta app) + ganadores.
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    fetch("/api/sorteo")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.success) throw new Error(j.error || `Error ${r.status}`);
        if (!vivo) return;
        const d: RespuestaSorteo = j.data;
        setInfo(d.sorteo);
        setParticipantes(d.participantes);
        setTotales(d.totales);
        setDesactualizado(!!d.desactualizado);
        claveActual.current = d.sorteo.clave;
        recibirGanadores(d.ganadores, d.ganadoresError);
      })
      .catch((e) => vivo && setError(e.message || "No se pudo cargar el sorteo"))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [recarga, recibirGanadores]);

  // Sondeo de ganadores: así todas las pantallas ven el giro del operador.
  const sondear = useCallback(async () => {
    try {
      const r = await fetch("/api/sorteo/ganadores", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.success) return;
      const d: RespuestaGanadores = j.data;
      setDesactualizado(!!d.desactualizado);
      if (claveActual.current && d.sorteo && d.sorteo !== claveActual.current) {
        cambiarDeSorteo();
        return;
      }
      recibirGanadores(d.ganadores, d.ganadoresError);
    } catch { /* sin red: se reintenta en el próximo sondeo */ }
  }, [recibirGanadores, cambiarDeSorteo]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void sondear(); }, SONDEO_MS);
    return () => clearInterval(t);
  }, [sondear]);

  // Modo operador: la clave queda guardada en la pestaña; se revalida al cargar.
  useEffect(() => {
    const guardada = leerClave();
    if (!guardada) return;
    fetch("/api/sorteo/operador", { method: "POST", headers: { "x-sorteo-clave": guardada } })
      .then((r) => {
        if (r.ok) { setEsOperador(true); setClave(guardada); }
        else if (r.status === 401) guardarClave("");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const cambio = () => setPantallaCompleta(document.fullscreenElement === raiz.current);
    document.addEventListener("fullscreenchange", cambio);
    return () => document.removeEventListener("fullscreenchange", cambio);
  }, []);

  useEffect(() => {
    if (!lienzo.current) return;
    disparar.current = confetti.create(lienzo.current, { resize: true, useWorker: true });
    return () => { disparar.current?.reset(); disparar.current = null; };
  }, []);

  const celebrar = useCallback(() => {
    const d = disparar.current;
    if (!d) return;
    const fin = Date.now() + 2200;
    d({ particleCount: 160, spread: 100, startVelocity: 55, origin: { y: 0.55 }, colors: CONFETI, disableForReducedMotion: true });
    const lluvia = () => {
      d({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: CONFETI, disableForReducedMotion: true });
      d({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: CONFETI, disableForReducedMotion: true });
      if (Date.now() < fin) requestAnimationFrame(lluvia);
    };
    lluvia();
  }, []);

  const vistos = useMemo(() => ganadores.filter((g) => revelados.has(g.id)), [ganadores, revelados]);
  const idsGanadores = useMemo(() => new Set(vistos.map((g) => g.partnerId)), [vistos]);

  // En la ruleta: clientes con tickets que no ganaron (entre los premios ya
  // mostrados; el que se está revelando sigue adentro hasta que se detiene,
  // y el último ganador hasta el giro siguiente). Sin nombres: es anónima.
  const enRuleta = useMemo<SegmentoRuleta[]>(() => {
    const lista = participantes.filter((c) => c.tickets > 0 && (!idsGanadores.has(c.id) || c.id === destacado));
    return intercalar(lista).map((c) => ({ id: c.id, nombre: "", tickets: c.tickets }));
  }, [participantes, idsGanadores, destacado]);
  const enJuego = enRuleta.filter((c) => c.id !== destacado);
  const ticketsEnRuleta = enJuego.reduce((s, c) => s + c.tickets, 0);

  /** Genera el video del giro que acaba de terminar (con el plan que usó la ruleta) y lo descarga. */
  const hacerVideo = useCallback(async (ganador: Ganador, numero: number) => {
    const plan = ruleta.current?.ultimoGiro();
    if (!plan || !info) return;
    setPreparando(0);
    try {
      const { blob, extension } = await generarVideoGiro({
        titulo: tituloDe(info),
        plan,
        ganador: { id: ganador.partnerId, nombre: ganador.nombre, tickets: ganador.tickets, numero },
        onProgreso: (p) => setPreparando(p),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreArchivo(info, numero, extension);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      setVideoListo(a.download);
    } catch (e: any) {
      setAviso(`No se pudo generar el video: ${e?.message || "error"}`);
    } finally {
      setPreparando(null);
    }
  }, [info]);

  // Revelar premios nuevos: girar hasta el ganador, festejar y mostrarlo.
  useEffect(() => {
    if (animando || !info) return;
    const pendiente = ganadores.find((g) => !revelados.has(g.id));
    if (!pendiente) return;
    setResultado(null);
    // Primero sale el ganador anterior; el giro arranca en el render
    // siguiente, con la ruleta ya redibujada sin él.
    if (destacado !== null && destacado !== pendiente.partnerId) {
      setDestacado(null);
      return;
    }
    setAnimando(true);
    (async () => {
      await ruleta.current?.girarHacia(pendiente.partnerId);
      const numero = ganadores.findIndex((g) => g.id === pendiente.id) + 1;
      setRevelados((prev) => new Set(prev).add(pendiente.id));
      setDestacado(pendiente.partnerId);
      setResultado(pendiente);
      if (sonido) fanfarria();
      celebrar();
      setAnimando(false);
      if (grabarEsteGiro.current) {
        grabarEsteGiro.current = false;
        setGrabando(false);
        void hacerVideo(pendiente, numero);
      }
    })();
  }, [ganadores, revelados, animando, info, destacado, sonido, celebrar, hacerVideo]);

  // Si anulan al ganador destacado, deja de estar resaltado.
  useEffect(() => {
    if (destacado !== null && !idsGanadores.has(destacado)) setDestacado(null);
  }, [destacado, idsGanadores]);

  // El enfoque (ruleta grande, fondo difuminado) termina cuando ya no se
  // graba ni se prepara el video y se cerró el cartel del ganador.
  useEffect(() => {
    if (enfoque && !grabando && preparando === null && !pidiendo && !animando && !resultado) setEnfoque(false);
  }, [enfoque, grabando, preparando, pidiendo, animando, resultado]);

  const girar = async () => {
    if (!esOperador || pidiendo || animando || grabando || preparando !== null) return;
    setPidiendo(true);
    setAviso(null);
    setVideoListo(null);
    if (grabar && puedeGrabar && info) {
      grabarEsteGiro.current = true;
      setGrabando(true);
      setEnfoque(true);
      // El tiempo del zoom antes de que arranque el giro.
      await new Promise((r) => setTimeout(r, 600));
    }
    try {
      const r = await fetch("/api/sorteo/girar", { method: "POST", headers: cabeceras() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || `Error ${r.status}`);
      const g: Ganador = j.data;
      setGanadores((prev) => (prev.some((x) => x.id === g.id) ? prev : [...prev, g]));
    } catch (e: any) {
      grabarEsteGiro.current = false;
      setGrabando(false);
      setAviso(e.message || "No se pudo girar");
    } finally {
      setPidiendo(false);
    }
  };

  const anular = async (cuerpo: { id?: number; todos?: boolean }) => {
    setAviso(null);
    try {
      const r = await fetch("/api/sorteo/anular", {
        method: "POST",
        headers: cabeceras({ "Content-Type": "application/json" }),
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || `Error ${r.status}`);
      await sondear();
    } catch (e: any) {
      setAviso(e.message || "No se pudo anular");
    }
  };

  const alternarPantalla = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await raiz.current?.requestFullscreen();
    } catch { /* el navegador no lo permite */ }
  };

  const salirOperador = () => {
    guardarClave("");
    setClave("");
    setEsOperador(false);
  };

  const ocupado = pidiendo || animando || grabando || preparando !== null;

  return (
    <div ref={raiz} className={pantallaCompleta ? "h-screen overflow-y-auto bg-[#040b24] p-4 md:p-8" : "min-h-screen bg-[#040b24] px-4 py-6 md:px-8"}>
      <canvas ref={lienzo} className="pointer-events-none fixed inset-0 z-[70] h-full w-full" aria-hidden />

      <div className={pantallaCompleta ? "" : "mx-auto max-w-[1500px] space-y-6"}>
        {!pantallaCompleta && <Encabezado info={info} totales={totales} />}

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle size={18} /> {error}
            <button type="button" onClick={() => setRecarga((n) => n + 1)} className="ml-auto font-semibold underline">Reintentar</button>
          </div>
        )}

        {esOperador && ganadoresError && !pantallaCompleta && (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle size={18} /> {ganadoresError}. Hasta que se resuelva no se puede girar.
          </div>
        )}

        {desactualizado && !pantallaCompleta && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>No hay conexión con el sistema de Supricom: se muestran los últimos datos. Por ahora no se puede girar.</p>
          </div>
        )}

        {cargando && !info && <Cargando />}

        {info && (
          <section className={`relative overflow-hidden rounded-[2rem] bg-[#06123a] ring-1 ring-white/10 ${pantallaCompleta ? "min-h-full" : ""}`}>
            <FondoCircuito />
            <div className="relative grid gap-8 p-5 md:p-8 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex flex-col items-center">
                {pantallaCompleta && (
                  <div className="mb-4 flex items-center gap-4 text-center">
                    <div className="rounded-2xl bg-white px-4 py-2"><img src="/sorteo/logo-supricom.png" alt="Supricom" className="h-7" /></div>
                    <h2 className="text-2xl font-black text-white md:text-3xl">{tituloDe(info)}</h2>
                  </div>
                )}
                {/* Enfoque: el mismo componente (no se desmonta: conserva el giro) pasa a
                    ocupar la pantalla, con el resto de la página difuminado detrás. */}
                <div
                  className={
                    enfoque
                      ? "sorteo-enfoque fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#040b24]/60 p-4 backdrop-blur-xl"
                      : "w-full"
                  }
                >
                  {enfoque && (
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-white px-4 py-2"><img src="/sorteo/logo-supricom.png" alt="Supricom" className="h-6" /></div>
                      <h2 className="text-xl font-black text-white md:text-3xl">{tituloDe(info)}</h2>
                      {grabando && (
                        <span className="flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> REC
                        </span>
                      )}
                      {preparando !== null && <ChipPreparando progreso={preparando} />}
                    </div>
                  )}
                  <RuletaSorteo
                    ref={ruleta}
                    participantes={enRuleta}
                    anonima
                    grande={enfoque}
                    resaltado={animando ? null : destacado}
                    sonido={sonido}
                    puedeGirar={esOperador && !ganadoresError && !desactualizado}
                    ocupado={ocupado}
                    onGirar={girar}
                  />
                </div>
                {aviso && (
                  <p className="mt-2 flex items-center gap-2 rounded-xl bg-rose-500/15 px-4 py-2 text-sm text-rose-200">
                    <AlertTriangle size={15} /> {aviso}
                  </p>
                )}
                {preparando !== null && !enfoque && <ChipPreparando progreso={preparando} />}
                {videoListo && (
                  <p className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-500/15 px-4 py-2 text-sm text-emerald-200">
                    <Video size={15} /> Video guardado en Descargas: {videoListo}
                  </p>
                )}
              </div>

              <aside className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  <BotonControl onClick={() => setSonido((s) => !s)} activo={sonido} titulo={sonido ? "Silenciar" : "Activar sonido"}>
                    {sonido ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </BotonControl>
                  <BotonControl onClick={alternarPantalla} titulo={pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}>
                    {pantallaCompleta ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    <span>{pantallaCompleta ? "Salir" : "Pantalla completa"}</span>
                  </BotonControl>
                  {esOperador && puedeGrabar && (
                    <BotonControl
                      onClick={() => { const v = !grabar; setGrabar(v); guardarPref(PREF_GRABAR, v); }}
                      activo={grabar}
                      titulo={grabar ? "Grabar giro: activado" : "Grabar giro: desactivado"}
                    >
                      <Video size={16} className={grabar ? "text-rose-400" : ""} />
                      <span>{grabar ? "Grabar giro: sí" : "Grabar giro: no"}</span>
                    </BotonControl>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/5">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <h3 className="flex items-center gap-2 font-bold text-white">
                      <Trophy size={18} className="text-[#f5b72b]" /> Ganadores
                      <span className="rounded-full bg-[#f5b72b]/20 px-2 text-xs text-[#f5b72b]">{vistos.length}</span>
                    </h3>
                    {esOperador && vistos.length > 0 && (
                      <button
                        type="button"
                        onClick={() => window.confirm("¿Anular TODOS los premios? Todos los clientes vuelven a la ruleta.") && anular({ todos: true })}
                        disabled={ocupado}
                        className="flex items-center gap-1 text-xs text-blue-200/70 hover:text-white disabled:opacity-40"
                      >
                        <RotateCcw size={13} /> Reiniciar
                      </button>
                    )}
                  </div>
                  {vistos.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center text-sm text-blue-200/60">
                      <Crown size={30} className="text-[#f5b72b]/50" />
                      {esOperador ? <span>Toca <b className="text-white">GIRAR</b> para sacar al primer ganador.</span> : "Todavía no hay ganadores."}
                    </div>
                  ) : (
                    <ol className="max-h-[420px] space-y-2 overflow-y-auto p-3">
                      {vistos.map((g, i) => (
                        <li key={g.id} className="group flex items-center gap-3 rounded-xl bg-white/[0.06] p-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ffd970] to-[#e09a12] text-sm font-black text-[#3d2600]">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-white" title={g.nombre}>{g.nombre}</p>
                            <p className="text-xs text-blue-200/70">
                              {g.tickets} {g.tickets === 1 ? "ticket" : "tickets"} · {new Date(g.fecha).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          {esOperador && (
                            <button
                              type="button"
                              onClick={() => window.confirm(`¿Anular el premio de ${g.nombre}? Vuelve a la ruleta.`) && anular({ id: g.id })}
                              disabled={ocupado}
                              className="rounded-lg p-1.5 text-blue-200/50 opacity-0 transition hover:bg-white/10 hover:text-white focus:opacity-100 group-hover:opacity-100 disabled:hidden"
                              title="Anular este premio"
                            >
                              <X size={15} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <p className="text-center text-xs text-blue-200/50">{enJuego.length} clientes · {ticketsEnRuleta.toLocaleString("es-VE")} tickets en juego</p>
              </aside>
            </div>
          </section>
        )}

        {!pantallaCompleta && (
          <footer className="flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-5 text-xs text-blue-200/50 sm:flex-row">
            <p>© {new Date().getFullYear()} Supricom · ¡Tu Mayorista de Confianza!</p>
            {esOperador ? (
              clave && (
                <button type="button" onClick={salirOperador} className="flex items-center gap-1.5 hover:text-white">
                  <LogOut size={13} /> Salir del modo operador
                </button>
              )
            ) : (
              <button type="button" onClick={() => setPidiendoClave(true)} className="flex items-center gap-1.5 hover:text-white">
                <KeyRound size={13} /> Operador
              </button>
            )}
          </footer>
        )}
      </div>

      {pidiendoClave && (
        <ModalClave
          onCerrar={() => setPidiendoClave(false)}
          onValida={(c) => { guardarClave(c); setClave(c); setEsOperador(true); setPidiendoClave(false); }}
        />
      )}

      {resultado && (
        <ModalGanador
          ganador={resultado}
          numero={vistos.findIndex((g) => g.id === resultado.id) + 1}
          esOperador={esOperador}
          quedan={enJuego.length}
          onCerrar={() => setResultado(null)}
          onOtra={() => { setResultado(null); void girar(); }}
          onAnular={() => { void anular({ id: resultado.id }); setResultado(null); }}
        />
      )}

      <style jsx global>{`
        .sorteo-enfoque { animation: sorteo-enfoque 0.5s cubic-bezier(0.2, 0.9, 0.3, 1) both; }
        @keyframes sorteo-enfoque { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .sorteo-enfoque { animation: none; } }
      `}</style>
    </div>
  );
}

function ChipPreparando({ progreso }: { progreso: number }) {
  return (
    <span className="mt-2 flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">
      <Video size={13} className="text-rose-300" /> Preparando video… {Math.round(progreso * 100)}%
    </span>
  );
}

function Encabezado({ info, totales }: { info: InfoSorteo | null; totales: RespuestaSorteo["totales"] | null }) {
  const kpis = [
    { label: "Clientes con compras", valor: totales ? totales.clientes.toLocaleString("es-VE") : "–", icono: Users },
    { label: "Participan (≥ 1 ticket)", valor: totales ? totales.participantes.toLocaleString("es-VE") : "–", icono: Crown },
    { label: "Tickets en juego", valor: totales ? totales.tickets.toLocaleString("es-VE") : "–", icono: Ticket },
  ];
  return (
    <header className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(120deg,#040b24_0%,#0b2a6f_38%,#1737d8_72%,#1a9ad6_100%)] text-white shadow-xl shadow-blue-900/20 ring-1 ring-white/10">
      <FondoCircuito />
      <img
        src="/sorteo/supri-mascota.jpg"
        alt="Supri, la mascota de Supricom"
        className="pointer-events-none absolute -bottom-10 right-0 hidden h-[125%] select-none object-contain lg:block"
        style={{
          maskImage: "radial-gradient(ellipse 60% 62% at 50% 45%, #000 55%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 62% at 50% 45%, #000 55%, transparent 78%)",
        }}
        draggable={false}
      />
      <div className="relative p-6 md:p-10 lg:pr-[300px]">
        <div className="rounded-2xl bg-white px-4 py-2 shadow-lg w-fit"><img src="/sorteo/logo-supricom.png" alt="Supricom" className="h-6 md:h-7" /></div>

        {info?.titulo ? (
          <h1 className="mt-6 text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">{info.titulo}</h1>
        ) : (
          <h1 className="mt-6 text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
            Gran Sorteo
            {info && <span className="block bg-gradient-to-r from-[#ffe08a] to-[#f5b72b] bg-clip-text text-transparent">{nombreMes(info.mes)}</span>}
          </h1>
        )}
        {info && (
          <p className="mt-3 max-w-xl text-base text-blue-100/90 md:text-lg">
            ¡Gracias por confiar en tu mayorista! Cada <b className="text-white">{dinero(info.montoPorTicket)}</b> en compras de{" "}
            {nombreMes(info.mes).toLowerCase()} es <b className="text-white">1 ticket</b> para la ruleta.
          </p>
        )}

        <div className="mt-8 grid grid-cols-3 gap-3">
          {kpis.map(({ label, valor, icono: Icono }) => (
            <div key={label} className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-100/80"><Icono size={14} className="shrink-0" /> {label}</div>
              <p className="mt-1 text-lg font-black tabular-nums sm:text-2xl md:text-3xl">{valor}</p>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

function ModalClave({ onCerrar, onValida }: { onCerrar: () => void; onValida: (clave: string) => void }) {
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valor.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/sorteo/operador", { method: "POST", headers: { "x-sorteo-clave": valor.trim() } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Clave incorrecta");
      onValida(valor.trim());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#020617]/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="titulo-clave">
      <form onSubmit={enviar} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 id="titulo-clave" className="flex items-center gap-2 text-lg font-bold text-slate-900"><KeyRound size={18} className="text-[#0a5fb4]" /> Modo operador</h2>
          <button type="button" onClick={onCerrar} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <p className="mt-2 text-sm text-slate-500">Solo quien presenta el sorteo. La clave queda guardada en esta pestaña hasta cerrarla.</p>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Clave de operador"
          className="mt-4 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#1a9ad6] focus:ring-2 focus:ring-[#1a9ad6]/20"
        />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <button type="submit" disabled={enviando || !valor.trim()} className="mt-4 h-11 w-full rounded-xl bg-[#0b2a6f] text-sm font-semibold text-white hover:bg-[#0a5fb4] disabled:opacity-50">
          {enviando ? "Verificando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

function ModalGanador({
  ganador, numero, esOperador, quedan, onCerrar, onOtra, onAnular,
}: {
  ganador: Ganador; numero: number; esOperador: boolean; quedan: number;
  onCerrar: () => void; onOtra: () => void; onAnular: () => void;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#020617]/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="titulo-ganador">
      <div className="sorteo-entrada relative w-full max-w-lg overflow-hidden rounded-[2rem] bg-[linear-gradient(160deg,#0b2a6f_0%,#1737d8_55%,#1a9ad6_100%)] text-center text-white shadow-2xl ring-4 ring-[#f5b72b]">
        <FondoCircuito />
        <button type="button" onClick={onCerrar} className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="relative px-6 pb-7 pt-6 md:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-[#ffe08a]">Ganador #{numero || "–"}</p>
          <img src="/sorteo/supri-busto.jpg" alt="" className="mx-auto mt-3 h-36 w-36 rounded-full border-4 border-[#f5b72b] object-cover object-top shadow-lg" />
          <h2 className="mt-4 text-sm font-semibold uppercase tracking-widest text-blue-100">¡Felicidades!</h2>
          <p id="titulo-ganador" className="mt-1 text-3xl font-black leading-tight md:text-4xl">{ganador.nombre}</p>

          <div className="mt-6 grid grid-cols-3 gap-2">
            {[
              ["Tickets", ganador.tickets.toLocaleString("es-VE")],
              ["Compras", ganador.compras.toLocaleString("es-VE")],
              ["Monto", dinero(ganador.monto)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-white/10 px-2 py-3">
                <p className="text-[11px] uppercase tracking-wide text-blue-100/70">{k}</p>
                <p className="text-lg font-black tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-blue-100/70">
            Salió el ticket {(ganador.ticketSorteado + 1).toLocaleString("es-VE")} de {ganador.totalTickets.toLocaleString("es-VE")} en juego
            ({((ganador.tickets / ganador.totalTickets) * 100).toFixed(2)}% de probabilidad).
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={onCerrar} className="flex-1 rounded-2xl bg-white/10 px-4 py-3 font-semibold hover:bg-white/20">
              Cerrar
            </button>
            {esOperador && (
              <button
                type="button"
                onClick={onOtra}
                disabled={quedan === 0}
                className="flex-1 rounded-2xl bg-gradient-to-r from-[#ffd970] to-[#f5b72b] px-4 py-3 font-black text-[#3d2600] shadow-lg hover:brightness-105 disabled:opacity-50"
              >
                Girar otra vez
              </button>
            )}
          </div>
          {esOperador && (
            <button type="button" onClick={onAnular} className="mt-4 text-xs text-blue-100/60 underline-offset-2 hover:text-white hover:underline">
              Anular este premio (el cliente vuelve a la ruleta)
            </button>
          )}
        </div>
      </div>
      <style jsx global>{`
        .sorteo-entrada { animation: sorteo-entrada 0.55s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
        @keyframes sorteo-entrada { from { opacity: 0; transform: scale(0.7) translateY(30px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .sorteo-entrada { animation: none; } }
      `}</style>
    </div>
  );
}

function BotonControl({ onClick, activo, titulo, children }: { onClick: () => void; activo?: boolean; titulo: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${
        activo === false ? "border-white/10 bg-white/5 text-blue-200/60" : "border-white/15 bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

/** Trazos de circuito como los de la melena de Supri. */
function FondoCircuito() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.22]" aria-hidden>
      <defs>
        <pattern id={`${id}-p`} width="220" height="220" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#39e27d" strokeWidth="1.4" strokeLinecap="round">
            <path d="M10 40 H70 L95 65 H150" />
            <path d="M40 120 V160 L65 185 H120" />
            <path d="M160 20 V70 L190 100 V140" />
            <path d="M120 200 L150 170 H210" />
          </g>
          <g fill="#39e27d">
            <circle cx="150" cy="65" r="3.5" /><circle cx="10" cy="40" r="3.5" />
            <circle cx="120" cy="185" r="3.5" /><circle cx="40" cy="120" r="3.5" />
            <circle cx="190" cy="140" r="3.5" /><circle cx="160" cy="20" r="3.5" />
            <circle cx="210" cy="170" r="3.5" />
          </g>
        </pattern>
        <radialGradient id={`${id}-g`} cx="30%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.15" />
        </radialGradient>
        <mask id={`${id}-m`}><rect width="100%" height="100%" fill={`url(#${id}-g)`} /></mask>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-p)`} mask={`url(#${id}-m)`} />
    </svg>
  );
}

function Cargando() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-[2rem] bg-[#06123a] py-24 text-blue-100">
      <div className="h-14 w-14 animate-spin rounded-full border-4 border-[#1a9ad6]/30 border-t-[#f5b72b]" />
      <p className="text-sm">Cargando el sorteo…</p>
    </div>
  );
}
