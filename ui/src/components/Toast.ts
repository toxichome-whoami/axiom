/*
 * Sleek, zero-dependency Toast notification and Modal confirmation system.
 * Replaces disruptive browser alerts and confirms with dark-mode accessible dialogs.
 */

import { icon } from './Icons';

type ToastType = 'success' | 'error' | 'info';

class ToastManager {
  private container: HTMLElement | null = null;

  private ensureContainer(): HTMLElement {
    if (!this.container || !document.body.contains(this.container)) {
      this.container = document.createElement('div');
      this.container.id = 'axiom-toast-container';
      this.container.className = 'fixed bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full px-4';
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  show(message: string, type: ToastType = 'info', duration = 3500) {
    const container = this.ensureContainer();

    const toast = document.createElement('div');
    toast.className = `
      pointer-events-auto flex items-center space-x-3 px-3.5 py-2.5 rounded-lg border shadow-lg text-xs font-medium
      transition-all duration-200 transform translate-y-2 opacity-0
      ${
        type === 'success'
          ? 'bg-[#18181B] border-emerald-500/30 text-emerald-400'
          : type === 'error'
          ? 'bg-[#18181B] border-rose-500/30 text-rose-400'
          : 'bg-[#18181B] border-surfaceBorder text-primary'
      }
    `;

    const iconHtml =
      type === 'success'
        ? icon('check', 'w-4 h-4 text-emerald-400 shrink-0')
        : type === 'error'
        ? icon('x', 'w-4 h-4 text-rose-400 shrink-0')
        : icon('activity', 'w-4 h-4 text-accent-blue shrink-0');

    toast.innerHTML = `
      ${iconHtml}
      <span class="flex-1 text-primary leading-tight">${message}</span>
      <button class="toast-close text-secondary hover:text-primary p-0.5 ml-2 transition-colors">
        ${icon('x', 'w-3.5 h-3.5')}
      </button>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });

    const remove = () => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 200);
    };

    const timer = setTimeout(remove, duration);

    toast.querySelector('.toast-close')?.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });
  }

  success(message: string, duration = 3000) {
    this.show(message, 'success', duration);
  }

  error(message: string, duration = 4500) {
    this.show(message, 'error', duration);
  }

  info(message: string, duration = 3000) {
    this.show(message, 'info', duration);
  }
}

export const toast = new ToastManager();

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function confirmDialog(options: ConfirmOptions) {
  const existing = document.getElementById('axiom-confirm-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'axiom-confirm-modal';
  backdrop.className = 'fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-opacity';

  backdrop.innerHTML = `
    <div class="bg-surface border border-surfaceBorder rounded-lg max-w-sm w-full p-5 space-y-4 shadow-xl transform transition-transform scale-95 animate-in">
      <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
        ${options.danger ? icon('trash', 'w-4 h-4 text-accent-danger') : icon('shield', 'w-4 h-4 text-accent-orange')}
        <span>${options.title}</span>
      </div>
      <p class="text-xs text-secondary leading-relaxed">${options.message}</p>
      <div class="flex justify-end space-x-2 pt-2">
        <button id="axiom-confirm-cancel" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md text-xs font-medium transition-colors">
          ${options.cancelText || 'Cancel'}
        </button>
        <button id="axiom-confirm-ok" class="px-3 py-1.5 ${
          options.danger ? 'bg-accent-danger hover:bg-red-700' : 'bg-accent-orange hover:bg-orange-600'
        } text-white rounded-md text-xs font-medium transition-colors">
          ${options.confirmText || 'Confirm'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  const cancelBtn = backdrop.querySelector('#axiom-confirm-cancel') as HTMLButtonElement;
  const okBtn = backdrop.querySelector('#axiom-confirm-ok') as HTMLButtonElement;

  cancelBtn.focus();

  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', onKey);
      close();
    }
  };
  window.addEventListener('keydown', onKey);

  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true;
    okBtn.textContent = 'Processing...';
    try {
      await options.onConfirm();
    } finally {
      window.removeEventListener('keydown', onKey);
      close();
    }
  });
}
