import { useEffect, useRef } from 'react';
import type { EditorFile } from './editorTabs';

export const fileTabId = (path: string) => `file-tab-${encodeURIComponent(path)}`;
export const filePanelId = (path: string) => `file-panel-${encodeURIComponent(path)}`;

export function FileTabs({ files, activePath, onSelect, onClose }: {
  files: EditorFile[]; activePath: string | null; onSelect: (path: string) => void; onClose: (file: EditorFile) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath]);
  return <div className="file-tabs" role="tablist" aria-label="Open files" ref={bar}>
    {files.map((file, index) => <div className={`file-tab ${file.path === activePath ? 'is-active' : ''}`} role="presentation" key={file.path}>
      <button className="file-tab-select" type="button" role="tab" id={fileTabId(file.path)} aria-controls={filePanelId(file.path)} aria-selected={file.path === activePath} tabIndex={file.path === activePath ? 0 : -1} title={file.path} onClick={() => onSelect(file.path)} onKeyDown={(event) => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % files.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + files.length) % files.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = files.length - 1;
        else return;
        event.preventDefault(); onSelect(files[next].path);
        bar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}><span>{file.path.split('/').pop()}</span>{file.dirty && <span className="file-tab-dirty" aria-label="Unsaved changes">●</span>}</button>
      <button className="file-tab-close" type="button" aria-label={`Close ${file.path}`} title={`Close ${file.path}`} tabIndex={file.path === activePath ? 0 : -1} onClick={() => onClose(file)}>×</button>
    </div>)}
  </div>;
}
