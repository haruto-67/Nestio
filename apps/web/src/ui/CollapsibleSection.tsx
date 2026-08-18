import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** 見出し行の右側に置く追加ボタン等（「+追加」ボタンなど） */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * 縦に長くなりがちな項目群を折りたたみ可能にする共通UI（改修13回目：タスク詳細パネルが
 * 優先度・期限・繰り返し・タグ・サブタスク・添付画像と縦に長く、特にモバイルでのスクロール量が
 * 多いという指摘への対応。「今見たい情報だけ」出せるようにする）
 */
export function CollapsibleSection({ title, defaultOpen = false, action, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-500">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          {title}
        </button>
        {action}
      </div>
      {open && children}
    </div>
  );
}
