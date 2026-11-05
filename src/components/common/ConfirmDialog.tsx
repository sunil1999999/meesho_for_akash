import React from 'react';
import { Modal } from './Modal';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  affectedItems?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  affectedItems,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} maxWidth="md">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded-lg shrink-0 ${
              isDestructive ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-slate-300 leading-relaxed">{message}</p>
          </div>
        </div>

        {affectedItems && affectedItems.length > 0 && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto">
            <p className="text-xs font-semibold text-slate-400 mb-2">Affected Accounts ({affectedItems.length}):</p>
            <div className="flex flex-wrap gap-1.5">
              {affectedItems.map((item, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 text-xs font-mono bg-slate-800 text-slate-200 rounded border border-slate-700/60"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end items-center gap-3 mt-2 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-semibold rounded-lg shadow-sm transition-colors cursor-pointer ${
              isDestructive
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-pink-700 hover:bg-pink-600 text-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};
