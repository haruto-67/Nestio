export interface UndoEntry {
  undo: () => void;
  redo: () => void;
}

const MAX_STACK = 50;
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];

/**
 * db/local-mutations.ts の各書き込みが呼ぶ。ここに積んだ操作がCtrl+Z/Ctrl+Shift+Zの対象になる。
 * 新しい操作が積まれたらredoスタックは破棄する（一般的なundo/redoの挙動と同じ）
 */
export function pushUndo(entry: UndoEntry): void {
  undoStack.push(entry);
  if (undoStack.length > MAX_STACK) undoStack.shift();
  redoStack.length = 0;
}

export function undo(): void {
  const entry = undoStack.pop();
  if (!entry) return;
  entry.undo();
  redoStack.push(entry);
}

export function redo(): void {
  const entry = redoStack.pop();
  if (!entry) return;
  entry.redo();
  undoStack.push(entry);
}
