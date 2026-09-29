"use client";

import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  type AudioCodec, type VideoCodec,
} from "mediabunny";
import { BOMBILLOS, OCULTO, ladoIzquierdo, type SegmentoDibujado } from "@/components/RuletaSorteo";

/**
 * Video del giro (modo «Grabar giro» del operador).
 *
 * NO se graba en vivo. La primera versión grababa el canvas con
 * MediaRecorder mientras giraba: si el equipo no daba abasto (ruleta en
 * pantalla + confeti + dibujo + codificación, todo en el mismo hilo) se
 * perdían cuadros —el video «se colgaba»— y el audio, que va en tiempo real,
 * quedaba corrido respecto de la imagen.
 *
 * Ahora el video se GENERA después del giro, cuadro por cuadro, a partir del
 * plan del giro (rotación inicial y final, duración y curva: los mismos
 * datos que animaron la ruleta de la página):
 * - cada cuadro se dibuja para su instante exacto (30 fps) y se codifica con
 *   WebCodecs (mediabunny arma el MP4): no se pierde ninguno, tarde lo que
 *   tarde el equipo;
 * - el sonido se sintetiza aparte (OfflineAudioContext) con la misma línea de
 *   tiempo: cada clic cae justo cuando un segmento pasa por el puntero y la
 *   fanfarria justo al detenerse. Sincronizado por construcción.
 * - el confeti es una simulación propia y determinista (la librería de
 *   confeti anima en tiempo real y no se puede avanzar cuadro a cuadro).
 *
 * La geometría copia la del SVG de components/RuletaSorteo.tsx (viewBox
 * 1000×1000: rueda R = 452, aro 494, puntero arriba): si se cambia allá, hay
 * que cambiarla acá.
 */

/** Lo que hizo la ruleta de la página (RuletaHandle.ultimoGiro()). */
export interface PlanGiro {
  desde: number;
  hasta: number;
  /** Milisegundos. */
  duracion: number;
  segmentos: SegmentoDibujado[];
}

export interface DatosVideo {
  titulo: string;
  plan: PlanGiro;
  ganador: { id: number; nombre: string; tickets: number; numero: number };
  onProgreso?: (fraccion: number) => void;
}

const LADO = 1080;
const CX = 540;
const CY = 604;
const K = 360 / 452; // escala del viewBox de la ruleta al video
const R_SVG = 452;
const HUB_SVG = 120;
const FPS = 30;
const INTRO = 1.2; // s de ruleta quieta antes del giro
const COLA = 5.5; // s con el ganador (cartel + confeti)
const MUESTREO = 48000;
const FUENTE = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const CONFETI = ["#1737d8", "#1a9ad6", "#0a5fb4", "#f5b72b", "#ffffff", "#39e27d"];

const rad = (grados: number) => (grados * Math.PI) / 180;
const vx = (x: number) => CX + (x - 500) * K;
const vy = (y: number) => CY + (y - 500) * K;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

// ── Soporte ──────────────────────────────────────────────────────────────

let codecs: Promise<{ video: VideoCodec | null; audio: AudioCodec | null }> | null = null;
function elegirCodecs() {
  codecs ??= (async () => {
    if (typeof VideoEncoder === "undefined") return { video: null, audio: null };
    const [video, audio] = await Promise.all([
      getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: LADO, height: LADO }).catch(() => null),
      typeof AudioEncoder === "undefined" ? Promise.resolve(null) : getFirstEncodableAudioCodec(["aac", "opus"]).catch(() => null),
    ]);
    return { video, audio };
  })();
  return codecs;
}

/** ¿Este navegador puede generar el video? (WebCodecs: Chrome, Edge, Safari 16.4+, Firefox 130+). */
export async function puedeGenerarVideo() {
  return !!(await elegirCodecs()).video;
}

// ── Línea de tiempo ──────────────────────────────────────────────────────

function rotacionEn(plan: PlanGiro, t: number) {
  const dur = plan.duracion / 1000;
  if (t <= INTRO) return plan.desde;
  if (t >= INTRO + dur) return plan.hasta;
  return plan.desde + (plan.hasta - plan.desde) * easeOut((t - INTRO) / dur);
}

/** Índice del segmento bajo el puntero (búsqueda binaria sobre a0). */
function segmentoBajoPuntero(segmentos: SegmentoDibujado[], rotacion: number) {
  const a = (((360 - (rotacion % 360)) % 360) + 360) % 360;
  let lo = 0;
  let hi = segmentos.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (segmentos[m].a0 <= a) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/** Momentos (s) de los clics: cuando cambia el segmento bajo el puntero, con 45 ms mínimos entre clics (igual que en vivo). */
function momentosDeClic(plan: PlanGiro) {
  const dur = plan.duracion / 1000;
  const clics: number[] = [];
  let anterior = segmentoBajoPuntero(plan.segmentos, plan.desde);
  let ultimo = -1;
  for (let t = INTRO; t <= INTRO + dur; t += 0.001) {
    const s = segmentoBajoPuntero(plan.segmentos, rotacionEn(plan, t));
    if (s !== anterior) {
      anterior = s;
      if (t - ultimo > 0.045) {
        clics.push(t);
        ultimo = t;
      }
    }
  }
  return clics;
}

async function sintetizarAudio(plan: PlanGiro, total: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(total * MUESTREO), MUESTREO);
  const tono = (inicio: number, frecuencia: number, duracion: number, volumen: number, tipo: OscillatorType) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(frecuencia, inicio);
    gain.gain.setValueAtTime(volumen, inicio);
    gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
    osc.connect(gain).connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + duracion + 0.02);
  };
  for (const t of momentosDeClic(plan)) tono(t, 1400, 0.035, 0.12, "triangle");
  const fin = INTRO + plan.duracion / 1000;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tono(fin + i * 0.13, f, i === 3 ? 0.7 : 0.18, 0.18, "square"));
  return ctx.startRendering();
}

// ── Dibujo ───────────────────────────────────────────────────────────────

function lienzo() {
  const c = document.createElement("canvas");
  c.width = c.height = LADO;
  return c;
}

function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolver) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => resolver(null);
    img.src = src;
  });
}

function redondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Texto centrado que se achica hasta caber en `ancho` (y se parte en 2 líneas si hace falta). */
function textoAjustado(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, ancho: number, tamano: number, minimo: number, peso = 900) {
  let t = tamano;
  ctx.font = `${peso} ${t}px ${FUENTE}`;
  while (ctx.measureText(texto).width > ancho && t > minimo) {
    t -= 2;
    ctx.font = `${peso} ${t}px ${FUENTE}`;
  }
  if (ctx.measureText(texto).width <= ancho) {
    ctx.fillText(texto, x, y);
    return;
  }
  const palabras = texto.split(" ");
  const corte = Math.ceil(palabras.length / 2);
  ctx.fillText(palabras.slice(0, corte).join(" "), x, y - t * 0.55);
  ctx.fillText(palabras.slice(corte).join(" "), x, y + t * 0.55);
}

/** Fondo, logo, título y aro: no cambian en todo el video. */
function capaFondo(titulo: string, logo: HTMLImageElement | null) {
  const c = lienzo();
  const ctx = c.getContext("2d")!;
  const fondo = ctx.createRadialGradient(CX, CY, 60, CX, CY, 820);
  fondo.addColorStop(0, "#1a3aa8");
  fondo.addColorStop(0.55, "#0b1f5c");
  fondo.addColorStop(1, "#040b24");
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, LADO, LADO);
  if (logo) {
    const h = 44;
    const w = (logo.width / logo.height) * h;
    ctx.fillStyle = "#ffffff";
    redondeado(ctx, CX - w / 2 - 24, 34, w + 48, h + 26, 20);
    ctx.fill();
    ctx.drawImage(logo, CX - w / 2, 47, w, h);
  }
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  textoAjustado(ctx, titulo, CX, 150, 980, 50, 30);
  // Halo + aro
  ctx.save();
  ctx.shadowColor = "rgba(26,154,214,.55)";
  ctx.shadowBlur = 90;
  ctx.fillStyle = "#0b2a6f";
  ctx.beginPath();
  ctx.arc(CX, CY, 494 * K, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const aro = ctx.createLinearGradient(CX - 494 * K, CY - 494 * K, CX + 494 * K, CY + 494 * K);
  aro.addColorStop(0, "#0b2a6f");
  aro.addColorStop(1, "#040b24");
  ctx.fillStyle = aro;
  ctx.strokeStyle = "#f5b72b";
  ctx.lineWidth = 6 * K;
  ctx.beginPath();
  ctx.arc(CX, CY, 494 * K, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return c;
}

/** Disco de segmentos (sin etiquetas), centrado en el lienzo; se dibuja rotado en cada cuadro. */
function capaDisco(segmentos: SegmentoDibujado[], resaltado: number | null) {
  const c = lienzo();
  const ctx = c.getContext("2d")!;
  ctx.translate(LADO / 2, LADO / 2);
  const R = R_SVG * K;
  if (segmentos.length <= 1) {
    ctx.fillStyle = segmentos[0] && segmentos[0].id === resaltado ? "#f5b72b" : (segmentos[0]?.color ?? "#0b2a6f");
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }
  for (const s of segmentos) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, rad(s.a0 - 90), rad(s.a1 - 90));
    ctx.closePath();
    ctx.fillStyle = s.id === resaltado ? "#f5b72b" : s.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = segmentos.length > 80 ? 0.6 : 1.5;
    ctx.stroke();
  }
  return c;
}

/** Aro interior, centro con el logo y puntero: fijos, por encima de la rueda. */
function capaFrente(logo: HTMLImageElement | null) {
  const c = lienzo();
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "#f5b72b";
  ctx.lineWidth = 4 * K;
  ctx.beginPath();
  ctx.arc(CX, CY, (R_SVG + 6) * K, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "rgba(4,11,36,.55)";
  ctx.beginPath();
  ctx.arc(CX, CY, (HUB_SVG + 12) * K, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#f5b72b";
  ctx.lineWidth = 12 * K;
  ctx.beginPath();
  ctx.arc(CX, CY, HUB_SVG * K, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (logo) {
    const w = HUB_SVG * 2 * 0.72 * K;
    const h = (logo.height / logo.width) * w;
    ctx.drawImage(logo, CX - w / 2, CY - h / 2 - 10 * K, w, h);
  }
  ctx.fillStyle = "#0a5fb4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${18 * K}px ${FUENTE}`;
  ctx.fillText("S O R T E O", CX, CY + 34 * K);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#f5b72b";
  ctx.strokeStyle = "#7a4d00";
  ctx.lineWidth = 4 * K;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(vx(458), vy(-4));
  ctx.lineTo(vx(542), vy(-4));
  ctx.lineTo(vx(500), vy(92));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#fff6d6";
  ctx.beginPath();
  ctx.arc(vx(500), vy(18), 12 * K, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Bombillo con brillo, pre-dibujado (sombras por cuadro son lo más caro del canvas). */
function spriteBombillo(prendido: boolean) {
  const c = document.createElement("canvas");
  c.width = c.height = 40;
  const ctx = c.getContext("2d")!;
  if (prendido) {
    const g = ctx.createRadialGradient(20, 20, 2, 20, 20, 20);
    g.addColorStop(0, "rgba(255,217,112,.9)");
    g.addColorStop(1, "rgba(255,217,112,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 40, 40);
  }
  ctx.fillStyle = prendido ? "#fffbe8" : "#7a5a12";
  ctx.beginPath();
  ctx.arc(20, 20, 7 * K, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Cartel del ganador, pre-dibujado (se dibuja con escala y transparencia). */
function capaCartel(ganador: DatosVideo["ganador"]) {
  const w = 860;
  const h = 400;
  const c = document.createElement("canvas");
  c.width = w + 100;
  c.height = h + 100;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, "#0b2a6f");
  g.addColorStop(0.55, "#1737d8");
  g.addColorStop(1, "#1a9ad6");
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 40;
  redondeado(ctx, -w / 2, -h / 2, w, h, 44);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#f5b72b";
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffe08a";
  ctx.font = `800 26px ${FUENTE}`;
  ctx.fillText(`G A N A D O R   # ${ganador.numero}`, 0, -130);
  ctx.fillStyle = "#dbeafe";
  ctx.font = `700 30px ${FUENTE}`;
  ctx.fillText("¡FELICIDADES!", 0, -78);
  ctx.fillStyle = "#ffffff";
  textoAjustado(ctx, ganador.nombre, 0, 10, w - 80, 64, 34);
  ctx.fillStyle = "#dbeafe";
  ctx.font = `700 30px ${FUENTE}`;
  ctx.fillText(`${ganador.tickets.toLocaleString("es-VE")} ${ganador.tickets === 1 ? "ticket" : "tickets"}`, 0, 120);
  return c;
}

/**
 * Confeti determinista (misma semilla, mismo video): una explosión desde el
 * centro, dos cañones desde abajo a los costados y una lluvia desde arriba que
 * cubre toda la cola del video.
 */
function crearConfeti(cantidad: number) {
  let semilla = 20260929;
  const azar = () => ((semilla = (semilla * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: cantidad }, (_, i) => {
    const tipo = i % 4; // 0 = centro, 1 = cañón izquierdo, 2 = cañón derecho, 3 = lluvia
    const base = {
      giro: azar() * Math.PI * 2,
      vgiro: (azar() - 0.5) * 12,
      w: 10 + azar() * 12,
      h: 6 + azar() * 8,
      color: CONFETI[Math.floor(azar() * CONFETI.length)],
      bamboleo: 30 + azar() * 50,
      fase: azar() * Math.PI * 2,
    };
    if (tipo === 3) {
      return { ...base, x: azar() * LADO, y: -30, vx: (azar() - 0.5) * 80, vy: 60 + azar() * 120, retraso: 0.25 + azar() * 3.2 };
    }
    const angulo = tipo === 0 ? rad(-90 + (azar() - 0.5) * 120) : tipo === 1 ? rad(-62 + (azar() - 0.5) * 40) : rad(-118 + (azar() - 0.5) * 40);
    const v = (tipo === 0 ? 1100 : 1500) * (0.5 + azar() * 0.6);
    return {
      ...base,
      x: tipo === 0 ? CX : tipo === 1 ? -10 : LADO + 10,
      y: tipo === 0 ? CY : LADO * 0.85,
      vx: Math.cos(angulo) * v,
      vy: Math.sin(angulo) * v,
      retraso: tipo === 0 ? 0 : 0.1 + azar() * 0.5,
    };
  });
}

function dibujarConfeti(ctx: CanvasRenderingContext2D, piezas: ReturnType<typeof crearConfeti>, t: number) {
  // Roce alto y gravedad baja: suben rápido y bajan flotando (velocidad
  // terminal ≈ 380 px/s), como papelitos. Solución cerrada del movimiento con
  // roce lineal: cada cuadro se calcula solo, sin depender de los anteriores.
  const gravedad = 800;
  const roce = 2.1;
  for (const p of piezas) {
    const s = t - p.retraso;
    if (s < 0) continue;
    const f = (1 - Math.exp(-roce * s)) / roce;
    const x = p.x + p.vx * f + Math.sin(s * 3 + p.fase) * p.bamboleo * Math.min(1, s);
    const y = p.y + p.vy * f + (gravedad / roce) * (s - f);
    if (y > LADO + 40 || x < -60 || x > LADO + 60) continue;
    const alfa = Math.max(0, Math.min(1, (5.3 - (t - 0)) / 0.8));
    if (alfa <= 0) continue;
    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.translate(x, y);
    ctx.rotate(p.giro + p.vgiro * s);
    ctx.scale(1, Math.abs(Math.cos(p.vgiro * s * 0.7)) * 0.8 + 0.2);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

// ── Generación ───────────────────────────────────────────────────────────

export async function generarVideoGiro({ titulo, plan, ganador, onProgreso }: DatosVideo): Promise<{ blob: Blob; extension: string }> {
  const { video, audio } = await elegirCodecs();
  if (!video) throw new Error("Este navegador no puede generar el video");

  const dur = plan.duracion / 1000;
  const total = INTRO + dur + COLA;
  const cuadros = Math.round(total * FPS);
  const logo = await cargarImagen("/sorteo/logo-supricom.png");

  const fondo = capaFondo(titulo, logo);
  const disco = capaDisco(plan.segmentos, null);
  const discoGanador = capaDisco(plan.segmentos, ganador.id);
  const frente = capaFrente(logo);
  const bombilloOn = spriteBombillo(true);
  const bombilloOff = spriteBombillo(false);
  const cartel = capaCartel(ganador);
  const confeti = crearConfeti(360);
  const fuenteEtiqueta = (s: SegmentoDibujado) => {
    const arco = ((s.a1 - s.a0) * Math.PI * 320) / 180;
    const tope = Math.min(28, arco * 0.62);
    if (tope < 9) return 0;
    return Math.min(tope, Math.max(15, (R_SVG - HUB_SVG - 58) / (OCULTO.length * 0.58))) * K;
  };
  const fuentes = plan.segmentos.map(fuenteEtiqueta);

  const c = lienzo();
  const ctx = c.getContext("2d")!;
  const fin = INTRO + dur;

  const dibujar = (t: number) => {
    const r = rotacionEn(plan, t);
    const girando = t > INTRO && t < fin;
    const revelado = t >= fin;
    ctx.drawImage(fondo, 0, 0);

    const fase = Math.floor(t * 4) % 2;
    for (let i = 0; i < BOMBILLOS; i++) {
      const a = rad((i * 360) / BOMBILLOS);
      const x = CX + 474 * K * Math.sin(a);
      const y = CY - 474 * K * Math.cos(a);
      ctx.drawImage(!girando || i % 2 === fase ? bombilloOn : bombilloOff, x - 20, y - 20);
    }

    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(rad(r));
    ctx.drawImage(revelado ? discoGanador : disco, -LADO / 2, -LADO / 2);
    ctx.textBaseline = "middle";
    plan.segmentos.forEach((s, i) => {
      if (!fuentes[i]) return;
      const medio = (s.a0 + s.a1) / 2;
      const izquierda = ladoIzquierdo(medio, r);
      ctx.save();
      ctx.rotate(rad(izquierda ? medio + 90 : medio - 90));
      ctx.textAlign = izquierda ? "left" : "right";
      ctx.font = `700 ${fuentes[i]}px ${FUENTE}`;
      ctx.fillStyle = revelado && s.id === ganador.id ? "#3d2600" : "#ffffff";
      ctx.fillText(OCULTO, (izquierda ? -1 : 1) * (R_SVG - 26) * K, 0);
      ctx.restore();
    });
    ctx.restore();

    ctx.drawImage(frente, 0, 0);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = revelado ? "#ffe08a" : "#ffffff";
    textoAjustado(ctx, revelado ? ganador.nombre : girando ? OCULTO : "¡Mucha suerte!", CX, 1044, 1000, 40, 24, 800);

    if (revelado) {
      const s = t - fin;
      const a = Math.min(1, s / 0.45);
      const escala = 0.75 + 0.25 * (1 - Math.pow(1 - a, 3));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(2,6,23,.6)";
      ctx.fillRect(0, 0, LADO, LADO);
      ctx.translate(CX, CY);
      ctx.scale(escala, escala);
      ctx.drawImage(cartel, -cartel.width / 2, -cartel.height / 2);
      ctx.restore();
      dibujarConfeti(ctx, confeti, s);
    }
  };

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const fuenteVideo = new CanvasSource(c, { codec: video, bitrate: 6_000_000, keyFrameInterval: 2 });
  output.addVideoTrack(fuenteVideo, { frameRate: FPS });
  const fuenteAudio = audio ? new AudioBufferSource({ codec: audio, bitrate: 128_000 }) : null;
  if (fuenteAudio) output.addAudioTrack(fuenteAudio);

  try {
    await output.start();
    if (fuenteAudio) await fuenteAudio.add(await sintetizarAudio(plan, total));
    for (let i = 0; i < cuadros; i++) {
      dibujar(i / FPS);
      await fuenteVideo.add(i / FPS, 1 / FPS);
      if (i % 15 === 0) {
        onProgreso?.(i / cuadros);
        // Deja respirar a la página (el cartel y el confeti de la pantalla siguen animándose).
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  }
  onProgreso?.(1);
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("El video quedó vacío");
  return { blob: new Blob([buffer], { type: "video/mp4" }), extension: "mp4" };
}
