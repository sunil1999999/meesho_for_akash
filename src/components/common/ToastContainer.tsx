import React from 'react';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X, Undo2 } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast, triggerUndo } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none px-4 sm:px-0">
      {toasts.map(toast => {
        const icons = {
          success: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
          error: <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />,
          warning: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
          info: <Info className="w-5 h-5 text-cyan-400 shrink-0" />,
        };

        const borderColors = {
          success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100',
          error: 'border-rose-500/40 bg-rose-950/90 text-rose-100',
          warning: 'border-amber-500/40 bg-amber-950/90 text-amber-100',
          info: 'border-cyan-500/40 bg-cyan-950/90 text-cyan-100',
        };

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 p-3.5 rounded-lg border shadow-xl backdrop-blur-md transition-all ${borderColors[toast.type]}`}
          >
            <div className="flex items-center gap-2.5 text-sm font-medium">
              {icons[toast.type]}
              <span>{toast.message}</span>
            </div>

            <div className="flex items-center gap-2">
              {toast.showUndo && (
                <button
                  onClick={() => triggerUndo()}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded text-white transition-colors cursor-pointer"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Undo
                </button>
              )}
              <button
                onClick={() => removeToast(toast.id)}
                className="p-1 hover:bg-white/10 rounded transition-colors text-white/70 hover:text-white cursor-pointer"
                aria-label="Dismiss toast"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
