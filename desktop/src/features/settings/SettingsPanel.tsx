import { PanelHeader } from '../../components/PanelHeader';

type Props = {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onFonts: () => void;
  onClose: () => void;
};

export function SettingsPanel({ theme, onToggleTheme, onFonts, onClose }: Props) {
  return <div className="sidebar-content">

    <PanelHeader title="Settings" onClose={onClose} />

    <section className="sidebar-section">

      <h3>Appearance</h3>

      <p>Make your workspace comfortable to read.</p>

      <div className="settings-row">

        <span>Theme
          <small>{theme === 'dark' ? 'Dark' : 'Light'} appearance</small>
        </span>

        <button className="neutral-button" type="button" id="theme-toggle"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={onToggleTheme}>
          Use {theme === 'dark' ? 'light' : 'dark'}
        </button>

      </div>

      <button className="settings-row settings-link" type="button" aria-haspopup="dialog" onClick={onFonts}>

        <span>Fonts
          <small>Editor and file names</small>
        </span>
        <span aria-hidden="true">→</span>

      </button>

    </section>

  </div>;
}
