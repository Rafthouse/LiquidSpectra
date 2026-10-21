/**
 * Apple Liquid Glass Container Card
 * Premium frosted acrylic glass panel with specular borders and smooth shadows.
 */

import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  glowingBorder?: string; // hex or color
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  onClick,
  glowingBorder,
}) => {
  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl transition-all duration-200
        bg-white/60 dark:bg-slate-900/60
        backdrop-blur-xl
        border border-white/60 dark:border-white/10
        shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_12px_40px_rgb(0,0,0,0.35)]
        overflow-hidden ${className}`}
      style={
        glowingBorder
          ? {
              boxShadow: `0 0 20px ${glowingBorder}20, inset 0 1px 0 rgba(255,255,255,0.2)`,
              borderColor: `${glowingBorder}40`,
            }
          : {
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.25)',
            }
      }
    >
      {/* Specular Top Reflection Sheen */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 dark:via-white/20 to-transparent pointer-events-none" />
      {children}
    </div>
  );
};
