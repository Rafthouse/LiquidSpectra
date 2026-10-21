/**
 * LiquidKnob - Tactile Machined Studio Rotary Knob
 * Features:
 * - True rotating metallic cap with radial notch indicator (-135° to +135° sweep)
 * - Precision trigonometry SVG vector arc track (zero square clipping or tile artifacts)
 * - Window-level pointer listeners for 100% reliable drag without lost capture
 * - Vertical drag + Shift for fine-tuning (0.2x) + Ctrl/Cmd for rapid jumps
 * - Mouse wheel scrolling support
 * - Double-click to reset to default
 * - Click-to-edit inline digital numeric badge
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface LiquidKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
  size?: number; // diameter in px (default 48)
  accentColor?: string; // hex color
  displayFormat?: (val: number) => string;
  onChange: (val: number) => void;
}

export const LiquidKnob: React.FC<LiquidKnobProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  unit = '',
  size = 48,
  accentColor = '#06B6D4',
  displayFormat,
  onChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>('');

  const knobRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartYRef = useRef<number>(0);
  const startValRef = useRef<number>(value);

  const defVal = defaultValue !== undefined ? defaultValue : (min + max) / 2;

  // Normalized 0..1 percentage
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));

  // Rotation angle: -135° (min) to +135° (max) = 270° total sweep
  const rotationDeg = -135 + pct * 270;

  // Mouse Wheel listener with passive: false to prevent page scrolling while adjusting
  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      const stepVal = step || (max - min) / 100;
      const delta = (e.shiftKey ? stepVal * 0.2 : stepVal) * direction;
      const nextVal = Math.max(min, Math.min(max, value + delta));
      const rounded = step >= 1 ? Math.round(nextVal) : Number(nextVal.toFixed(1));
      onChange(rounded);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [value, min, max, step, onChange]);

  // Global Pointer Events for uninterrupted drag across the entire viewport
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isEditing) return;
    e.preventDefault();

    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    startValRef.current = value;
    setIsDragging(true);

    const onPointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      ev.preventDefault();

      const deltaY = dragStartYRef.current - ev.clientY; // Upwards increases value
      const range = max - min;
      const speedMultiplier = ev.shiftKey ? 0.2 : ev.ctrlKey || ev.metaKey ? 2.5 : 1.0;
      // 140px vertical movement travels full knob range
      const pixelsForFullRange = 140 / speedMultiplier;
      const deltaVal = (deltaY / pixelsForFullRange) * range;

      const rawNext = startValRef.current + deltaVal;
      let clamped = Math.max(min, Math.min(max, rawNext));

      if (step) {
        clamped = Math.round(clamped / step) * step;
      }

      const finalVal = step >= 1 ? Math.round(clamped) : Number(clamped.toFixed(1));
      onChange(finalVal);
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // Double click resets to default value
  const handleDoubleClick = () => {
    onChange(defVal);
  };

  // Formatted display value
  const formattedVal = displayFormat ? displayFormat(value) : `${value}${unit ? ' ' + unit : ''}`;

  // Direct typed editing
  const handleStartEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditValue(String(value));
  };

  const handleCommitEdit = () => {
    setIsEditing(false);
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      const rounded = step >= 1 ? Math.round(clamped) : Number(clamped.toFixed(1));
      onChange(rounded);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCommitEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  // Pure Trigonometric SVG Path Geometry for the circular track
  const strokeWidth = 3;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth * 2) / 2;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Arc Start: 135 deg (bottom-left)
  const startX = cx + r * Math.cos(toRad(135));
  const startY = cy + r * Math.sin(toRad(135));

  // Background Full Arc End: 405 deg (bottom-right, 270 deg sweep)
  const bgEndX = cx + r * Math.cos(toRad(405));
  const bgEndY = cy + r * Math.sin(toRad(405));
  const bgPath = `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${r} ${r} 0 1 1 ${bgEndX.toFixed(2)} ${bgEndY.toFixed(2)}`;

  // Active Value Arc
  const currentDeg = 135 + pct * 270;
  const activeSweepDeg = pct * 270;
  const currX = cx + r * Math.cos(toRad(currentDeg));
  const currY = cy + r * Math.sin(toRad(currentDeg));
  const largeArcFlag = activeSweepDeg > 180 ? 1 : 0;
  const activePath = pct > 0.005
    ? `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${currX.toFixed(2)} ${currY.toFixed(2)}`
    : '';

  // Cap size
  const capSize = size - 12;

  return (
    <div
      className="flex flex-col items-center select-none group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Rotary Dial Container */}
      <div
        ref={knobRef}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        className={`relative flex items-center justify-center touch-none rounded-full ${
          isDragging ? 'cursor-grabbing' : 'cursor-ns-resize'
        }`}
        style={{ width: size, height: size }}
        title="Drag up/down to adjust · Shift for fine control · Double-click to reset"
      >
        {/* SVG Outer Circular Track */}
        <svg
          width={size}
          height={size}
          className="absolute inset-0 pointer-events-none rounded-full"
        >
          {/* Background Arc Track */}
          <path
            d={bgPath}
            fill="none"
            stroke="currentColor"
            className="text-slate-300/80 dark:text-slate-800"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Active Glowing Value Arc */}
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke={accentColor}
              strokeWidth={strokeWidth + 2}
              strokeLinecap="round"
              opacity={isDragging || isHovered ? 0.45 : 0.25}
            />
          )}

          {/* Active Crisp Value Arc */}
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke={accentColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Machined Metal Rotating Cap */}
        <div
          className={`rounded-full flex items-center justify-center pointer-events-none transition-transform
            ${isDragging ? 'scale-[0.97]' : isHovered ? 'scale-[1.03]' : 'scale-100'}
            bg-gradient-to-b from-slate-200 via-slate-100 to-slate-300
            dark:from-slate-700 dark:via-slate-800 dark:to-slate-900
            border border-white/80 dark:border-white/10
          `}
          style={{
            width: capSize,
            height: capSize,
            boxShadow: isDragging
              ? `0 0 12px ${accentColor}50, inset 0 2px 4px rgba(0,0,0,0.5)`
              : isHovered
              ? `0 0 8px ${accentColor}30, 0 3px 6px rgba(0,0,0,0.2), inset 0 1px 1px rgba(255,255,255,0.4)`
              : '0 2px 5px rgba(0,0,0,0.2), inset 0 1px 1px rgba(255,255,255,0.3)',
          }}
        >
          {/* Rotating Inner Cap with Radial Pointer Line */}
          <div
            className="w-full h-full rounded-full relative flex items-center justify-center"
            style={{
              transform: `rotate(${rotationDeg}deg)`,
              transition: isDragging ? 'none' : 'transform 0.08s ease-out',
            }}
          >
            {/* Tactile Machined Radial Notch Indicator */}
            <div
              className="absolute top-1 w-1 rounded-full shadow-sm"
              style={{
                height: capSize * 0.32,
                backgroundColor: isDragging || isHovered ? accentColor : '#E2E8F0',
                boxShadow: isDragging || isHovered ? `0 0 6px ${accentColor}` : 'none',
              }}
            />

            {/* Machined Center Bevel */}
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-950 shadow-inner border border-black/10 dark:border-white/10" />
          </div>
        </div>
      </div>

      {/* Parameter Label & Digital Numeric Badge */}
      <div className="mt-1 flex flex-col items-center gap-0.5">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {label}
        </span>

        {/* Digital Numeric Badge (Click to Edit) */}
        {isEditing ? (
          <input
            type="text"
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleCommitEdit}
            onKeyDown={handleEditKeyDown}
            className="w-16 h-5 text-center text-[10px] font-mono font-bold bg-white dark:bg-slate-800 text-cyan-500 border border-cyan-500 rounded outline-none p-0"
          />
        ) : (
          <button
            onClick={handleStartEditing}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tabular-nums transition-all border
              ${
                isDragging
                  ? 'bg-slate-900 text-cyan-400 border-cyan-500 shadow-sm scale-105'
                  : 'bg-slate-100/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-white/5 hover:border-cyan-400 hover:text-cyan-400'
              }`}
            title="Click to type exact number"
          >
            {formattedVal}
          </button>
        )}
      </div>
    </div>
  );
};
