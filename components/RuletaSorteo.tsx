"use client";

/**
 * Ruleta del sorteo. Cada cliente es un segmento de tamaño proporcional a sus
 * tickets.
 *
 * La ruleta NO decide nada: el ganador lo elige el servidor
 * (POST /api/sorteo/girar, lib/sorteo/ganadores.ts) y acá solo se calcula el
 * giro para que el puntero termine dentro del segmento de ese cliente. Así
 * todas las pantallas muestran el mismo resultado y nadie puede sacar un
 * ganador desde su navegador.
 */

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";

export interface SegmentoRuleta {
  id: number;
  nombre: string;
  tickets: number;
}

export interface RuletaHandle {
  /** Anima el giro hasta el segmento del cliente `id`. Resuelve al detenerse (false si no está en la ruleta). */
  girarHacia: (id: number) => Promise<boolean>;
}

interface Props {
  participantes: SegmentoRuleta[];
  /** Cliente ganador del último giro: su segmento va en dorado. */
  resaltado?: number | null;
  sonido: boolean;
  /** Solo el operador: el centro de la ruleta es el botón de girar. */
  puedeGirar: boolean;
  /** Hay un giro pedido al servidor o animándose. */
  ocupado: boolean;
  onGirar: () => void;
}

const C = 500;
const R = 452;
const HUB = 118;
const VUELTAS = 8;
const DURACION = 9000;
// Paleta de la marca: azul rey (fondo de Supri), azul y celeste del logo, marino.
const COLORES = ["#1737d8", "#0a5fb4", "#1a9ad6", "#0b2a6f"];
const BOMBILLOS = 40;


/** Ángulo 0 = arriba (donde está el puntero), sentido horario. */
const punto = (grados: number, r: number) => {
  const a = (grados * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

let audio: AudioContext | null = null;
function contextoAudio() {
  if (typeof window === "undefined") return null;
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function tono(frecuencia: number, duracion: number, volumen: number, tipo: OscillatorType = "triangle", retraso = 0) {
  const ctx = contextoAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + retraso;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(frecuencia, t0);
  gain.gain.setValueAtTime(volumen, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duracion + 0.02);
}

export function fanfarria() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tono(f, i === 3 ? 0.7 : 0.18, 0.18, "square", i * 0.13));
}

export const RuletaSorteo = forwardRef<RuletaHandle, Props>(function RuletaSorteo(
  { participantes, resaltado = null, sonido, puedeGirar, ocupado, onGirar },
  ref,
) {
  const rueda = useRef<HTMLDivElement>(null);
  const puntero = useRef<SVGGElement>(null);
  const rotacion = useRef(0);
  const [girando, setGirando] = useState(false);
  const [bajoPuntero, setBajoPuntero] = useState<string | null>(null);

  const total = participantes.reduce((s, p) => s + p.tickets, 0);
  // El ganador resaltado sigue dibujado pero ya no juega.
  const enJuego = participantes.filter((p) => p.id !== resaltado);

  const segmentos = useMemo(() => {
    let acumulado = 0;
    return participantes.map((p, i) => {
      const a0 = (acumulado / total) * 360;
      acumulado += p.tickets;
      const a1 = (acumulado / total) * 360;
      let color = COLORES[i % COLORES.length];
      // Que el último no quede del mismo color que el primero.
      if (i === participantes.length - 1 && i > 0 && i % COLORES.length === 0) color = COLORES[2];
      return { ...p, a0, a1, color, inicio: acumulado - p.tickets };
    });
  }, [participantes, total]);

  const segmentoEn = useCallback(
    (anguloRueda: number) => segmentos.find((s) => anguloRueda >= s.a0 && anguloRueda < s.a1) ?? segmentos[segmentos.length - 1],
    [segmentos],
  );

  const girarHacia = useCallback((id: number) => new Promise<boolean>((resolver) => {
    const ganador = segmentos.find((s) => s.id === id);
    if (!ganador || total === 0) return resolver(false);
    // Lejos de los bordes del segmento para que no quede en duda visual.
    // (El punto exacto dentro del segmento es solo estética.)
    const objetivo = ganador.a0 + (ganador.a1 - ganador.a0) * (0.18 + 0.64 * Math.random());
    const desde = rotacion.current;
    const ajuste = (((360 - objetivo - (desde % 360)) % 360) + 360) % 360;
    const hasta = desde + 360 * VUELTAS + ajuste;
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duracion = reducido ? 1500 : DURACION;

    if (sonido) contextoAudio();
    setGirando(true);

    const t0 = performance.now();
    let ultimoId = -1;
    let ultimoClic = 0;
    const cuadro = (ahora: number) => {
      const t = Math.min(1, (ahora - t0) / duracion);
      const r = desde + (hasta - desde) * easeOut(t);
      if (rueda.current) rueda.current.style.transform = `rotate(${r}deg)`;
      const seg = segmentoEn(((360 - (r % 360)) % 360 + 360) % 360);
      if (seg && seg.id !== ultimoId) {
        ultimoId = seg.id;
        setBajoPuntero(seg.nombre);
        if (ahora - ultimoClic > 45) {
          ultimoClic = ahora;
          if (sonido) tono(1400, 0.035, 0.12);
          if (puntero.current) {
            puntero.current.style.transition = "none";
            puntero.current.style.transform = "rotate(-14deg)";
            requestAnimationFrame(() => {
              if (!puntero.current) return;
              puntero.current.style.transition = "transform 120ms ease-out";
              puntero.current.style.transform = "rotate(0deg)";
            });
          }
        }
      }
      if (t < 1) {
        requestAnimationFrame(cuadro);
        return;
      }
      rotacion.current = hasta;
      setGirando(false);
      resolver(true);
    };
    requestAnimationFrame(cuadro);
  }), [total, segmentos, segmentoEn, sonido]);

  useImperativeHandle(ref, () => ({ girarHacia }), [girarHacia]);

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="relative aspect-square w-full max-w-[min(100%,78vh)]">
        {/* Halo */}
        <div className="absolute inset-[4%] rounded-full bg-[#1a9ad6]/40 blur-3xl" aria-hidden />

        {/* Aro con bombillos (fijo) */}
        <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="aro" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0b2a6f" />
              <stop offset="100%" stopColor="#040b24" />
            </linearGradient>
          </defs>
          <circle cx={C} cy={C} r={494} fill="url(#aro)" stroke="#f5b72b" strokeWidth={6} />
          <circle cx={C} cy={C} r={R + 6} fill="none" stroke="#f5b72b" strokeWidth={4} />
          {Array.from({ length: BOMBILLOS }, (_, i) => {
            const [x, y] = punto((i * 360) / BOMBILLOS, 474);
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={7}
                className={girando ? (i % 2 ? "sorteo-bombillo-a" : "sorteo-bombillo-b") : "sorteo-bombillo-quieto"}
              />
            );
          })}
        </svg>

        {/* Rueda (gira) */}
        <div ref={rueda} className="absolute inset-0 will-change-transform" style={{ transform: `rotate(${rotacion.current}deg)` }}>
          <svg viewBox="0 0 1000 1000" className="h-full w-full">
            {total === 0 ? (
              <circle cx={C} cy={C} r={R} fill="#0b2a6f" />
            ) : segmentos.length === 1 ? (
              <circle cx={C} cy={C} r={R} fill={segmentos[0].color} />
            ) : (
              segmentos.map((s) => {
                const [x0, y0] = punto(s.a0, R);
                const [x1, y1] = punto(s.a1, R);
                const grande = s.a1 - s.a0 > 180 ? 1 : 0;
                return (
                  <path
                    key={s.id}
                    d={`M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${grande} 1 ${x1} ${y1} Z`}
                    fill={s.id === resaltado ? "#f5b72b" : s.color}
                    stroke="#ffffff"
                    strokeOpacity={0.35}
                    strokeWidth={segmentos.length > 80 ? 0.6 : 1.5}
                  />
                );
              })
            )}
            {segmentos.map((s) => {
              const ancho = s.a1 - s.a0;
              const arco = (ancho * Math.PI * 320) / 180;
              const tope = Math.min(28, arco * 0.62);
              if (tope < 9) return null;
              const largo = R - HUB - 58;
              // Primero se achica la letra para que entre el nombre completo; se
              // recorta solo si ni con letra chica (15) cabe.
              const fuente = Math.min(tope, Math.max(15, largo / (s.nombre.length * 0.58)));
              const maxChars = Math.max(4, Math.floor(largo / (fuente * 0.58)));
              const texto = s.nombre.length > maxChars ? `${s.nombre.slice(0, maxChars - 1).trimEnd()}…` : s.nombre;
              const medio = (s.a0 + s.a1) / 2;
              return (
                <g key={`t${s.id}`} transform={`rotate(${medio - 90} ${C} ${C})`}>
                  <text
                    x={C + R - 26}
                    y={C}
                    textAnchor="end"
                    dominantBaseline="central"
                    fill={s.id === resaltado ? "#3d2600" : "#ffffff"}
                    fontSize={fuente}
                    fontWeight={700}
                    style={{ letterSpacing: "0.02em", paintOrder: "stroke", stroke: "rgba(4,11,36,0.35)", strokeWidth: 2 }}
                  >
                    {texto}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Puntero (fijo, arriba) */}
        <svg viewBox="0 0 1000 1000" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <g ref={puntero} style={{ transformOrigin: "500px 20px", transformBox: "view-box" }}>
            <path d="M 458 -4 L 542 -4 L 500 92 Z" fill="#f5b72b" stroke="#7a4d00" strokeWidth={4} strokeLinejoin="round" style={{ filter: "drop-shadow(0 6px 6px rgba(0,0,0,.45))" }} />
            <circle cx={500} cy={18} r={12} fill="#fff6d6" />
          </g>
        </svg>

        {/* Centro: botón de girar (solo el operador) */}
        <button
          type="button"
          onClick={onGirar}
          disabled={!puedeGirar || ocupado || girando || enJuego.length === 0}
          className={`group absolute left-1/2 top-1/2 flex aspect-square w-[24%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-[6px] border-[#f5b72b] bg-white shadow-[0_0_0_6px_rgba(4,11,36,.55),0_12px_30px_rgba(0,0,0,.45)] transition focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1a9ad6] ${
            puedeGirar ? "hover:scale-[1.04] active:scale-95 disabled:cursor-not-allowed disabled:hover:scale-100" : "cursor-default"
          }`}
          aria-label={puedeGirar ? "Girar la ruleta" : "Ruleta del sorteo"}
        >
          <img src="/sorteo/logo-supricom.png" alt="Supricom" className="w-[78%] select-none" draggable={false} />
          <span className={`mt-[6%] text-[clamp(9px,1.5vw,20px)] font-black tracking-[0.25em] ${puedeGirar ? "text-[#0b2a6f] group-disabled:text-slate-400" : "text-[#0a5fb4]"}`}>
            {girando || ocupado ? "…" : puedeGirar ? "GIRAR" : "SORTEO"}
          </span>
        </button>
      </div>

      <div className="flex h-12 items-center justify-center px-4 text-center" aria-live="polite">
        {girando && bajoPuntero ? (
          <p className="max-w-full truncate text-xl font-extrabold tracking-wide text-white sm:text-2xl">{bajoPuntero}</p>
        ) : (
          <p className="text-sm font-medium text-blue-100/80">
            {enJuego.length === 0
              ? "No quedan clientes en la ruleta"
              : `${enJuego.length} clientes · ${enJuego.reduce((t, p) => t + p.tickets, 0).toLocaleString("es-VE")} tickets en juego`}
          </p>
        )}
      </div>

      <style jsx global>{`
        .sorteo-bombillo-quieto { fill: #fff3c4; filter: drop-shadow(0 0 4px #f5b72b); }
        .sorteo-bombillo-a, .sorteo-bombillo-b { animation: sorteo-parpadeo 0.5s steps(1) infinite; }
        .sorteo-bombillo-b { animation-delay: 0.25s; }
        @keyframes sorteo-parpadeo {
          0% { fill: #fffbe8; filter: drop-shadow(0 0 7px #ffd970); }
          50% { fill: #7a5a12; filter: none; }
        }
      `}</style>
    </div>
  );
});
