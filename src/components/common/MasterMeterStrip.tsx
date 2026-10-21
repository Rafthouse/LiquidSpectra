import React, { useRef, useEffect, useState } from 'react';
import { audioEngine } from '../../audio/AudioEngine';

interface MasterMeterStripProps {
  masterVolume?: number;
  onChangeMasterVolume?: (vol: number) => void;
  className?: string;
}

export const MasterMeterStrip: React.FC<MasterMeterStripProps> = ({
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Peak / Clip display state
  const [peakDisplay, setPeakDisplay] = useState<{ text: string; isClip: boolean }>({
    text: '-inf',
    isClip: false,
  });

  // dB to Y calculation helper (-60 dB to +6 dB = 66 dB span)
  const MIN_DB = -60;
  const MAX_DB = 6;
  const DB_SPAN = MAX_DB - MIN_DB;

  const dbToNorm = (db: number): number => {
    const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
    return (clamped - MIN_DB) / DB_SPAN; // 0 (at -60dB) to 1 (at +6dB)
  };

  // 60FPS High-Performance Direct Canvas Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isDestroyed = false;
    let lastUiUpdateTime = 0;

    const render = () => {
      if (isDestroyed) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = '#06080C';
      ctx.fillRect(0, 0, width, height);

      // Get real audio metrics from AudioEngine
      const metrics = audioEngine.getMasterOutputLevels();

      // Update text readout at ~10 Hz to prevent React lag
      const now = performance.now();
      if (now - lastUiUpdateTime > 90) {
        lastUiUpdateTime = now;
        let readout = '-inf';
        if (metrics.maxPeakDb > -59) {
          readout = `${metrics.maxPeakDb >= 0 ? '+' : ''}${metrics.maxPeakDb.toFixed(1)}`;
        }
        setPeakDisplay({
          text: metrics.isClip ? 'CLIP' : readout,
          isClip: metrics.isClip,
        });
      }

      // Meter Geometry
      const meterTop = 6;
      const meterBottom = height - 6;
      const meterHeight = meterBottom - meterTop;

      const barWidth = 7;
      const barSpacing = 4;
      const totalBarsWidth = barWidth * 2 + barSpacing;
      const startX = width - totalBarsWidth - 8; // Right aligned with padding

      // Scale dB tick marks on the left
      const dbTicks = [6, 3, 0, -3, -6, -12, -18, -24, -36, -48, -60];
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '8px "JetBrains Mono", monospace';

      dbTicks.forEach((db) => {
        const norm = dbToNorm(db);
        const y = meterBottom - norm * meterHeight;

        // Tick line
        ctx.strokeStyle = db === 0 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = db === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(startX - 5, y);
        ctx.lineTo(startX - 1, y);
        ctx.stroke();

        // 0 dB reference line across meter slots
        if (db === 0) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(startX, y);
          ctx.lineTo(startX + totalBarsWidth, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Labels for major dB markers
        if ([-60, -36, -18, -6, 0, 6].includes(db)) {
          ctx.fillStyle = db === 0 ? '#38BDF8' : db > 0 ? '#F43F5E' : 'rgba(148, 163, 184, 0.5)';
          ctx.fillText(db > 0 ? `+${db}` : `${db}`, startX - 7, y);
        }
      });

      // Draw L and R meter tracks
      const channels = [
        { x: startX, peak: metrics.peakL, rms: metrics.rmsL, hold: metrics.peakHoldL },
        { x: startX + barWidth + barSpacing, peak: metrics.peakR, rms: metrics.rmsR, hold: metrics.peakHoldR },
      ];

      channels.forEach((ch) => {
        // Meter slot trough
        ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
        ctx.fillRect(ch.x, meterTop, barWidth, meterHeight);

        // Active Peak Bar
        const peakNorm = dbToNorm(ch.peak);
        if (peakNorm > 0.01) {
          const barH = peakNorm * meterHeight;
          const barY = meterBottom - barH;

          // Multi-stage gradient: Green (-60 to -12) -> Yellow (-12 to 0) -> Red (>0)
          const meterGrad = ctx.createLinearGradient(0, meterBottom, 0, meterTop);
          meterGrad.addColorStop(0, '#10B981');   // -60 dB (Emerald)
          meterGrad.addColorStop(0.72, '#34D399'); // -12 dB
          meterGrad.addColorStop(0.91, '#FBBF24'); // 0 dB (Amber)
          meterGrad.addColorStop(1, '#EF4444');    // +6 dB (Ruby)

          ctx.fillStyle = meterGrad;
          ctx.fillRect(ch.x, barY, barWidth, barH);
        }

        // RMS Core Bar (Solid Bright Center)
        const rmsNorm = dbToNorm(ch.rms);
        if (rmsNorm > 0.01) {
          const rmsH = rmsNorm * meterHeight;
          const rmsY = meterBottom - rmsH;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.fillRect(ch.x + 2, rmsY, barWidth - 4, rmsH);
        }

        // Peak Hold Marker
        const holdNorm = dbToNorm(ch.hold);
        if (holdNorm > 0.01) {
          const holdY = meterBottom - holdNorm * meterHeight;
          ctx.fillStyle = ch.hold >= 0 ? '#FF4444' : '#FFFFFF';
          ctx.fillRect(ch.x - 0.5, Math.floor(holdY), barWidth + 1, 1.5);
        }
      });

      // Unity Gain 0.0 dB Reference Marker Line (Pure transparent measurement)
      const zeroNorm = dbToNorm(0);
      const zeroY = meterBottom - zeroNorm * meterHeight;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX - 2, zeroY);
      ctx.lineTo(startX + totalBarsWidth + 2, zeroY);
      ctx.stroke();

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Reset clip indicator
  const handleResetClip = () => {
    audioEngine.resetMasterClip();
    setPeakDisplay((prev) => ({ ...prev, isClip: false }));
  };

  return (
    <div
      ref={containerRef}
      className={`w-16 h-full bg-[#06080D] border-l border-white/10 flex flex-col items-center justify-between p-1.5 select-none shrink-0 z-20 ${className}`}
      title="Master Output Meter • Pure Bit-Transparent Unity Gain (0.0 dB)"
    >
      {/* Top Peak / Clip Indicator LED Button */}
      <button
        onClick={handleResetClip}
        className={`w-full py-1 text-[9px] font-mono font-bold uppercase rounded text-center transition-all cursor-pointer border ${
          peakDisplay.isClip
            ? 'bg-rose-500 text-white border-rose-400 shadow-[0_0_12px_#F43F5E] animate-pulse'
            : peakDisplay.text.startsWith('+')
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
            : 'bg-white/5 text-slate-400 hover:text-white border-white/5'
        }`}
        title="Peak Readout • Click to reset Peak Clip indicator"
      >
        {peakDisplay.text}
      </button>

      {/* High-Precision Direct Canvas Meter */}
      <div className="relative flex-1 w-full my-1">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
        />
      </div>

      {/* Pure Unity Gain Passive Readout (Zero sound modification) */}
      <div className="w-full flex flex-col items-center pt-1 border-t border-white/5">
        <span className="text-[8px] uppercase font-bold text-slate-400 tracking-wider">Out</span>
        <span
          className="w-full py-0.5 text-center text-[10px] font-mono font-bold text-cyan-400"
          title="Bit-transparent passthrough (0 dB unity gain)"
        >
          0.0 dB
        </span>
      </div>
    </div>
  );
};
