import { materialIconPath } from './materialIcons';

export function MaterialIcon({ name, directory = false, expanded, root = false }: { name: string; directory?: boolean; expanded?: boolean; root?: boolean }) {
  const automatic = directory && expanded === undefined;
  return <span className="material-icon" aria-hidden="true">
    {(automatic ? [false, true] : [expanded ?? false]).flatMap((open) => [false, true].map((light) => <img
      key={`${open}/${light}`} alt="" draggable={false}
      className={`${light ? 'material-icon-light' : 'material-icon-dark'}${automatic ? open ? ' material-icon-open' : ' material-icon-closed' : ''}`}
      src={materialIconPath(name, directory, open, light, root)}
    />))}
  </span>;
}
