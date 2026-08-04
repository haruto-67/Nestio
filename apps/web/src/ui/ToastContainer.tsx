import { useEffect, useState } from 'react';
import { subscribeToast } from './toast.js';

interface Toast {
  id: string;
  message: string;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToast((message) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((t) => [...t, { id, message }]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 2200);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="nestio-modal-panel rounded-full bg-neutral-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-neutral-900"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
