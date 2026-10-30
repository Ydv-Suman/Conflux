import type { ReactNode } from 'react';

export function PanelHeader({ title, onClose, children }: {
  title: string; onClose: () => void; children?: ReactNode;
}) {
  return <header className="sidebar-heading">

    <h2>{title}</h2>

    <div className="flex items-center gap-2">

      {children}

      <button className="panel-close" type="button" aria-label={`Close ${title}`} onClick={onClose}>×</button>

    </div>

  </header>;
}
