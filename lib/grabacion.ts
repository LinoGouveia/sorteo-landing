"use client";

import confetti from "canvas-confetti";
import { BOMBILLOS, OCULTO, ladoIzquierdo, type SegmentoDibujado } from "@/components/RuletaSorteo";

/**
 * Grabación del giro (modo «Grabar giro» del operador).
 *
 * No graba la pantalla (eso pide permiso al navegador cada vez y graba lo que
 * haya alrededor): dibuja la ruleta cuadro a cuadro en un <canvas> propio de
 * 1080×1080, con la misma rotación que la ruleta de la página, y lo graba con
 * MediaRecorder. Sale un video cuadrado listo para redes: título, ruleta
 * anónima girando, clics y fanfarria, y al final el cartel del ganador con
 * confeti.
 *
 * La geometría copia la del SVG de components/RuletaSorteo.tsx (viewBox
 * 1000×1000: rueda R = 452, aro 494, puntero arriba): si se cambia allá, hay
 * que cambiarla acá.
 */

export interface EstadoVideo {
  rotacion: number;
  segmentos: SegmentoDibujado[];
  /** Segmento en dorado (el ganador, ya detenido). */
  resaltado: number | null;
  girando: boolean;
  /** Ganador revelado: se dibuja el cartel. */
  ganador: { nombre: string; tickets: number; numero: number } | null;
}

const LADO = 1080;
const CX = 540;
const CY = 604;
const K = 360 / 452; // escala del viewBox de la ruleta al video
const R_SVG = 452;
const HUB_SVG = 120;
const FPS = 30;

const rad = (grados: number) => (grados * Math.PI) / 180;
/** Del viewBox 1000×1000 (centro 500,500) al video. */
const vx = (x: number) => CX + (x - 500) * K;
const vy = (y: number) => CY + (y - 500) * K;

function tipoVideo(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const opciones: [string, string][] = [
    ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mimeType, extension] of opciones) if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, extension };
  return null;
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

/** Texto centrado que se achica hasta caber en `ancho` (y parte en 2 líneas si hace falta). */
function textoAjustado(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, ancho: number, tamano: number, minimo: number, peso = 900) {
  let t = tamano;
  ctx.font = `${peso} ${t}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  while (ctx.measureText(texto).width > ancho && t > minimo) {
    t -= 2;
    ctx.font = `${peso} ${t}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  }
  if (ctx.measureText(texto).width <= ancho) {
    ctx.fillText(texto, x, y);
    return;
  }
  const palabras = texto.split(" ");
  let corte = Math.ceil(palabras.length / 2);
  const l1 = palabras.slice(0, corte).join(" ");
  const l2 = palabras.slice(corte).join(" ");
  ctx.fillText(l1, x, y - t * 0.55);
  ctx.fillText(l2, x, y + t * 0.55);
}

export class GrabadoraGiro {
  private lienzo = document.createElement("canvas");
  private ctx = this.lienzo.getContext("2d")!;
  private lienzoConfeti = document.createElement("canvas");
  private confeti: confetti.CreateTypes;
  private logo: HTMLImageElement | null = null;
  private grabador: MediaRecorder | null = null;
  private partes: Blob[] = [];
  private cuadro = 0;
  private activo = false;
  private inicioGanador = 0;
  private formato = tipoVideo();

  constructor(private opciones: { titulo: string; estado: () => EstadoVideo; audio: MediaStream | null }) {
    this.lienzo.width = this.lienzo.height = LADO;
    this.lienzoConfeti.width = this.lienzoConfeti.height = LADO;
    // Sin worker: el confeti tiene que dibujarse en este hilo para copiarlo al video.
    this.confeti = confetti.create(this.lienzoConfeti, { resize: false, useWorker: false });
  }

  static soportado() {
    return typeof document !== "undefined" && !!tipoVideo() && typeof HTMLCanvasElement.prototype.captureStream === "function";
  }

  async iniciar() {
    if (!this.formato) throw new Error("Este navegador no puede grabar video");
    this.logo = await cargarImagen("/sorteo/logo-supricom.png");
    const stream = this.lienzo.captureStream(FPS);
    for (const pista of this.opciones.audio?.getAudioTracks() ?? []) stream.addTrack(pista);
    this.grabador = new MediaRecorder(stream, { mimeType: this.formato.mimeType, videoBitsPerSecond: 8_000_000 });
    this.partes = [];
    this.grabador.ondataavailable = (e) => { if (e.data.size) this.partes.push(e.data); };
    this.activo = true;
    this.dibujar();
    this.grabador.start(500);
  }

  /** Confeti en el video (se llama al revelar el ganador). */
  celebrar() {
    this.inicioGanador = performance.now();
    const colores = ["#1737d8", "#1a9ad6", "#0a5fb4", "#f5b72b", "#ffffff", "#39e27d"];
    this.confeti({ particleCount: 180, spread: 110, startVelocity: 60, origin: { y: 0.6 }, colors: colores, scalar: 1.6 });
    this.confeti({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.8 }, colors: colores, scalar: 1.6 });
    this.confeti({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.8 }, colors: colores, scalar: 1.6 });
  }

  detener(): Promise<{ blob: Blob; extension: string }> {
    return new Promise((resolver, rechazar) => {
      const g = this.grabador;
      if (!g || !this.formato) return rechazar(new Error("No se estaba grabando"));
      const { mimeType, extension } = this.formato;
      g.onstop = () => {
        this.activo = false;
        cancelAnimationFrame(this.cuadro);
        this.confeti.reset();
        resolver({ blob: new Blob(this.partes, { type: mimeType.split(";")[0] }), extension });
      };
      g.stop();
    });
  }

  cancelar() {
    this.activo = false;
    cancelAnimationFrame(this.cuadro);
    try { this.grabador?.stop(); } catch { /* ya estaba detenido */ }
    this.confeti.reset();
  }

  private dibujar = () => {
    if (!this.activo) return;
    const ctx = this.ctx;
    const e = this.opciones.estado();
    const ahora = performance.now();

    // Fondo
    const fondo = ctx.createRadialGradient(CX, CY, 60, CX, CY, 820);
    fondo.addColorStop(0, "#1a3aa8");
    fondo.addColorStop(0.55, "#0b1f5c");
    fondo.addColorStop(1, "#040b24");
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, LADO, LADO);

    // Logo y título
    if (this.logo) {
      const h = 44;
      const w = (this.logo.width / this.logo.height) * h;
      ctx.fillStyle = "#ffffff";
      redondeado(ctx, CX - w / 2 - 24, 34, w + 48, h + 26, 20);
      ctx.fill();
      ctx.drawImage(this.logo, CX - w / 2, 47, w, h);
    }
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    textoAjustado(ctx, this.opciones.titulo, CX, 150, 980, 50, 30);

    // Halo
    ctx.save();
    ctx.shadowColor = "rgba(26,154,214,.55)";
    ctx.shadowBlur = 90;
    ctx.fillStyle = "#0b2a6f";
    ctx.beginPath();
    ctx.arc(CX, CY, 494 * K, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Aro
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

    // Bombillos
    const fase = Math.floor(ahora / 250) % 2;
    for (let i = 0; i < BOMBILLOS; i++) {
      const a = rad((i * 360) / BOMBILLOS);
      const x = CX + 474 * K * Math.sin(a);
      const y = CY - 474 * K * Math.cos(a);
      const prendido = !e.girando || i % 2 === fase;
      ctx.save();
      ctx.fillStyle = prendido ? "#fffbe8" : "#7a5a12";
      if (prendido) { ctx.shadowColor = "#ffd970"; ctx.shadowBlur = 14; }
      ctx.beginPath();
      ctx.arc(x, y, 7 * K, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Rueda (gira)
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(rad(e.rotacion));
    const R = R_SVG * K;
    if (e.segmentos.length <= 1) {
      ctx.fillStyle = e.segmentos[0]?.color ?? "#0b2a6f";
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (const s of e.segmentos) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, rad(s.a0 - 90), rad(s.a1 - 90));
        ctx.closePath();
        ctx.fillStyle = s.id === e.resaltado ? "#f5b72b" : s.color;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.lineWidth = e.segmentos.length > 80 ? 0.6 : 1.5;
        ctx.stroke();
      }
    }
    ctx.textBaseline = "middle";
    for (const s of e.segmentos) {
      const ancho = s.a1 - s.a0;
      const arco = (ancho * Math.PI * 320) / 180;
      const tope = Math.min(28, arco * 0.62);
      if (tope < 9) continue;
      const largo = R_SVG - HUB_SVG - 58;
      const fuente = Math.min(tope, Math.max(15, largo / (OCULTO.length * 0.58)));
      // Igual que en la ruleta: lo que queda a la izquierda se da vuelta para no quedar de cabeza.
      const medio = (s.a0 + s.a1) / 2;
      const izquierda = ladoIzquierdo(medio, e.rotacion);
      ctx.save();
      ctx.rotate(rad(izquierda ? medio + 90 : medio - 90));
      ctx.textAlign = izquierda ? "left" : "right";
      ctx.font = `700 ${fuente * K}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle = s.id === e.resaltado ? "#3d2600" : "#ffffff";
      ctx.fillText(OCULTO, (izquierda ? -1 : 1) * (R_SVG - 26) * K, 0);
      ctx.restore();
    }
    ctx.restore();

    // Aro interior
    ctx.strokeStyle = "#f5b72b";
    ctx.lineWidth = 4 * K;
    ctx.beginPath();
    ctx.arc(CX, CY, (R_SVG + 6) * K, 0, Math.PI * 2);
    ctx.stroke();

    // Centro
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
    if (this.logo) {
      const w = HUB_SVG * 2 * 0.72 * K;
      const h = (this.logo.height / this.logo.width) * w;
      ctx.drawImage(this.logo, CX - w / 2, CY - h / 2 - 10 * K, w, h);
    }
    ctx.fillStyle = "#0a5fb4";
    ctx.textAlign = "center";
    ctx.font = `900 ${18 * K}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText("S O R T E O", CX, CY + 34 * K);

    // Puntero (fijo, arriba)
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

    // Texto de abajo
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    const abajo = e.ganador ? e.ganador.nombre : e.girando ? OCULTO : "¡Mucha suerte!";
    ctx.fillStyle = e.ganador ? "#ffe08a" : "#ffffff";
    textoAjustado(ctx, abajo, CX, 1044, 1000, 40, 24, 800);

    // Cartel del ganador
    if (e.ganador) {
      const t = Math.min(1, (ahora - this.inicioGanador) / 450);
      const escala = 0.75 + 0.25 * (1 - Math.pow(1 - t, 3));
      ctx.save();
      ctx.globalAlpha = t;
      ctx.fillStyle = "rgba(2,6,23,.6)";
      ctx.fillRect(0, 0, LADO, LADO);
      ctx.translate(CX, CY);
      ctx.scale(escala, escala);
      const w = 860;
      const h = 400;
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
      ctx.font = `800 26px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(`G A N A D O R   # ${e.ganador.numero}`, 0, -130);
      ctx.fillStyle = "#dbeafe";
      ctx.font = `700 30px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText("¡FELICIDADES!", 0, -78);
      ctx.fillStyle = "#ffffff";
      textoAjustado(ctx, e.ganador.nombre, 0, 10, w - 80, 64, 34);
      ctx.fillStyle = "#dbeafe";
      ctx.font = `700 30px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(`${e.ganador.tickets.toLocaleString("es-VE")} ${e.ganador.tickets === 1 ? "ticket" : "tickets"}`, 0, 120);
      ctx.restore();
    }

    ctx.drawImage(this.lienzoConfeti, 0, 0);
    this.cuadro = requestAnimationFrame(this.dibujar);
  };
}
