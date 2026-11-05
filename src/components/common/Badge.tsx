import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
}) => {
  const variantStyles = {
    primary: 'bg-pink-950/60 text-pink-300 border-pink-700/50',
    success: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50',
    warning: 'bg-amber-950/60 text-amber-300 border-amber-700/50',
    danger: 'bg-rose-950/60 text-rose-300 border-rose-700/50',
    info: 'bg-cyan-950/60 text-cyan-300 border-cyan-700/50',
    neutral: 'bg-slate-800/80 text-slate-300 border-slate-700/50',
  };

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5 rounded',
    md: 'text-xs px-2.5 py-1 rounded-md font-medium',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 border font-mono tracking-tight transition-colors ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </span>
  );
};
