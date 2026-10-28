import type { ConnectionPhase } from './documentConnection';

export type EditorFile = { path: string; content: string; documentId?: string; dirty?: boolean; connectionPhase?: ConnectionPhase };
export type EditorTabsState = { files: EditorFile[]; activePath: string | null };
export type EditorTabsAction =
  | { type: 'tree'; entries: { id: string; path: string }[] }
  | { type: 'open'; file: EditorFile }
  | { type: 'select'; path: string }
  | { type: 'dirty'; path: string; dirty: boolean }
  | { type: 'connection'; path: string; phase: ConnectionPhase }
  | { type: 'close'; path: string };

export function editorTabsReducer(state: EditorTabsState, action: EditorTabsAction): EditorTabsState {
  switch (action.type) {
    case 'tree': {
      const activeId = state.files.find((file) => file.path === state.activePath)?.documentId;
      const files = state.files.flatMap((file) => {
        const entry = action.entries.find((item) => file.documentId ? item.id === file.documentId : item.path === file.path);
        return entry ? [{ ...file, path: entry.path, documentId: entry.id }] : file.dirty ? [file] : [];
      });
      return { files, activePath: files.find((file) => activeId ? file.documentId === activeId : file.path === state.activePath)?.path ?? files[0]?.path ?? null };
    }
    case 'open': {
      const existing = action.file.documentId && state.files.find((file) => file.documentId === action.file.documentId);
      if (existing) return { files: state.files.map((file) => file === existing && file.path !== action.file.path ? { ...file, path: action.file.path } : file), activePath: action.file.path };
      return { files: state.files.some((file) => file.path === action.file.path) ? state.files : [...state.files, action.file], activePath: action.file.path };
    }
    case 'select':
      return state.files.some((file) => file.path === action.path) ? { ...state, activePath: action.path } : state;
    case 'dirty':
      return state.files.some((file) => file.path === action.path && !!file.dirty !== action.dirty)
        ? { ...state, files: state.files.map((file) => file.path === action.path ? { ...file, dirty: action.dirty } : file) } : state;
    case 'connection':
      return state.files.some((file) => file.path === action.path && file.connectionPhase !== action.phase)
        ? { ...state, files: state.files.map((file) => file.path === action.path ? { ...file, connectionPhase: action.phase } : file) } : state;
    case 'close': {
      const index = state.files.findIndex((file) => file.path === action.path);
      if (index < 0) return state;
      const files = state.files.filter((file) => file.path !== action.path);
      return { files, activePath: state.activePath === action.path ? files[Math.min(index, files.length - 1)]?.path ?? null : state.activePath };
    }
  }
}
