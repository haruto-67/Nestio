import { useEffect, useState, type ReactNode } from 'react';
import { subscribeToast } from './toast.js';

interface Toast {
  id: string;
  message: string;
  onUndo?: () => void;
  icon?: ReactNode;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToast((message, options) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((t) => [...t, { id, message, onUndo: options.onUndo, icon: options.icon }]);
      // 「元に戻す」ボタン付きは押す猶予を長めに取る（改修13回目）
      setTimeout(
        () => {
          setToasts((t) => t.filter((x) => x.id !== id));
        },
        options.onUndo ? 4000 : 2200,
      );
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="nestio-modal-panel pointer-events-auto flex items-center gap-2 rounded-full bg-neutral-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-neutral-900"
        >
          {t.icon && <span className="nestio-complete-pop flex items-center">{t.icon}</span>}
          {t.message}
          {t.onUndo && (
            <button
              onClick={() => {
                t.onUndo?.();
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
              }}
              className="font-medium text-blue-300 hover:underline dark:text-blue-600"
            >
              元に戻す
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
