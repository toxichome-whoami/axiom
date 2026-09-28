import React, { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

type DialogListener = (dialog: ConfirmDialogOptions | null) => void;

class DialogManager {
  private current: ConfirmDialogOptions | null = null;
  private listener: DialogListener | null = null;

  subscribe(listener: DialogListener): () => void {
    this.listener = listener;
    listener(this.current);
    return () => {
      this.listener = null;
    };
  }

  show(options: ConfirmDialogOptions) {
    this.current = options;
    if (this.listener) this.listener(this.current);
  }

  close() {
    this.current = null;
    if (this.listener) this.listener(null);
  }
}

export const dialogManager = new DialogManager();

export function confirmAction(options: ConfirmDialogOptions) {
  dialogManager.show(options);
}

export const ConfirmDialogContainer: React.FC = () => {
  const [dialog, setDialog] = useState<ConfirmDialogOptions | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return dialogManager.subscribe(setDialog);
  }, []);

  if (!dialog) return null;

  const handleConfirm = async () => {
    try {
      setLoading(true);
      await dialog.onConfirm();
      dialogManager.close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-[440px] rounded-lg border border-[#262626] bg-[#0e0e0e] p-6 shadow-2xl text-left">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded ${dialog.danger ? 'bg-rose-500/10 text-rose-400' : 'bg-[#f38020]/10 text-[#f38020]'}`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-white tracking-tight">{dialog.title}</h3>
          </div>
          <button
            onClick={() => dialogManager.close()}
            className="text-[#666666] hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#8c8c8c] leading-relaxed mb-6">
          {dialog.message}
        </p>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => dialogManager.close()}
            disabled={loading}
            className="h-8 px-3.5 rounded text-xs font-medium text-[#cccccc] hover:text-white bg-[#161616] hover:bg-[#202020] border border-[#262626] transition-colors"
          >
            {dialog.cancelText || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className={`h-8 px-3.5 rounded text-xs font-medium text-white transition-colors flex items-center gap-1.5 ${
              dialog.danger
                ? 'bg-rose-600 hover:bg-rose-500 disabled:opacity-50'
                : 'bg-[#f38020] hover:bg-[#fa8c16] text-black font-semibold disabled:opacity-50'
            }`}
          >
            {loading && <span className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />}
            <span>{dialog.confirmText || 'Confirm'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
