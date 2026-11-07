import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { snapshotText } from '../editor/documentSnapshot';
import { languageForPath } from '../editor/editorLanguage';
import type { VersionDiff } from './api';

export function HistoryDiff({ diff, theme }: { diff: VersionDiff; theme: 'light' | 'dark' }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    let editor: monaco.editor.IStandaloneDiffEditor | undefined;
    const models: monaco.editor.ITextModel[] = [];
    try {
      const before = snapshotText(diff.before), after = snapshotText(diff.after);
      models.push(monaco.editor.createModel(before, languageForPath(diff.path, monaco.languages.getLanguages())));
      models.push(monaco.editor.createModel(after, languageForPath(diff.path, monaco.languages.getLanguages())));
      editor = monaco.editor.createDiffEditor(container.current, {
        readOnly: true, originalEditable: false, automaticLayout: true,
        theme: theme === 'dark' ? 'vs-dark' : 'vs', minimap: { enabled: false },
        renderSideBySide: true, useInlineViewWhenSpaceIsLimited: true,
        scrollBeyondLastLine: false, accessibilityVerbose: true,
      });
      editor.setModel({ original: models[0], modified: models[1] });
    } catch { setError('This version could not be displayed.'); }
    return () => { editor?.dispose(); models.forEach(model => model.dispose()); };
  }, [diff, theme]);
  return <>{error && <p role="alert">{error}</p>}<div ref={container} className="file-history-diff" aria-label="Read-only change comparison" /></>;
}
