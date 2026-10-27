import { useState } from 'react';

type FontFamily = { value: string; label: string; css: string };
export const FILE_FONT_FAMILIES: readonly FontFamily[] = [
  { value: 'system', label: 'System default', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { value: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { value: 'helvetica', label: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { value: 'verdana', label: 'Verdana', css: 'Verdana, Arial, sans-serif' },
  { value: 'georgia', label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  { value: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
];
export const EDITOR_FONT_FAMILIES: readonly FontFamily[] = [
  { value: 'jetbrains-mono', label: 'JetBrains Mono', css: '"JetBrains Mono", Menlo, Consolas, monospace' },
  { value: 'fira-code', label: 'Fira Code', css: '"Fira Code", Menlo, Consolas, monospace' },
  { value: 'consolas', label: 'Consolas', css: 'Consolas, "JetBrains Mono", Menlo, monospace' },
  { value: 'menlo', label: 'Menlo', css: 'Menlo, Monaco, Consolas, monospace' },
  { value: 'cascadia-code', label: 'Cascadia Code', css: '"Cascadia Code", Menlo, Consolas, monospace' },
  { value: 'source-code-pro', label: 'Source Code Pro', css: '"Source Code Pro", Menlo, Consolas, monospace' },
];
export const fontFamilyCss = (families: readonly FontFamily[], value: string) =>
  (families.find((family) => family.value === value) ?? families[0]).css;

export type FontPreferences = { fileNames: number; editor: number; fileFamily: string; editorFamily: string };
export const DEFAULT_FONT_PREFERENCES: FontPreferences = { fileNames: 14, editor: 14, fileFamily: 'system', editorFamily: 'menlo' };
// Retain the key so existing size preferences survive the addition of font families.
const STORAGE_KEY = 'conflux.fontSizes';

const settings = [
  { key: 'fileNames', label: 'File font size', familyKey: 'fileFamily', familyLabel: 'File font family', families: FILE_FONT_FAMILIES, min: 10, max: 24 },
  { key: 'editor', label: 'Editor font size', familyKey: 'editorFamily', familyLabel: 'Editor font family', families: EDITOR_FONT_FAMILIES, min: 10, max: 32 },
] as const;

export function readFontPreferences(): FontPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const preferences = { ...DEFAULT_FONT_PREFERENCES };
    for (const { key, min, max, familyKey, families } of settings) {
      const value = stored?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) preferences[key] = Math.round(Math.min(max, Math.max(min, value)));
      if (families.some((family) => family.value === stored?.[familyKey])) preferences[familyKey] = stored[familyKey];
    }
    return preferences;
  } catch { return { ...DEFAULT_FONT_PREFERENCES }; }
}

export function saveFontPreferences(preferences: FontPreferences) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { /* Preferences still apply for this session if storage is unavailable. */ }
}

export function parseFontSize(value: string, min: number, max: number): number | null {
  const number = Number(value);
  return value.trim() && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export function FontSettings({ preferences, onChange, onClose }: { preferences: FontPreferences; onChange: (preferences: FontPreferences) => void; onClose: () => void }) {
  const [draft, setDraft] = useState({ fileNames: String(preferences.fileNames), editor: String(preferences.editor) });
  return <div className="font-settings">
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="sr-only">File and editor fonts</legend>
      {settings.map(({ key, label, familyKey, familyLabel, families, min, max }) => {
        const invalid = parseFontSize(draft[key], min, max) === null;
        return <div key={key} className="grid gap-2">
          <div className="font-setting-row">
            <label htmlFor={`font-size-${key}`} className="text-sm font-medium">{label}</label>
            <div>
              <input className="field-input" id={`font-size-${key}`} type="number" inputMode="numeric" min={min} max={max} step={1} value={draft[key]} aria-label={`${label} (px)`} aria-invalid={invalid} aria-describedby={invalid ? `font-hint-${key}` : undefined} onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({ ...current, [key]: value }));
                const parsed = parseFontSize(value, min, max);
                if (parsed !== null) onChange({ ...preferences, [key]: parsed });
              }} onBlur={() => setDraft((current) => ({ ...current, [key]: String(preferences[key]) }))} />
              {invalid && <span id={`font-hint-${key}`} className="font-size-error mt-1 block text-xs" role="status">Enter a whole number from {min} to {max}.</span>}
            </div>
          </div>
          <div className="font-setting-row">
            <label htmlFor={`font-family-${key}`} className="text-sm font-medium">{familyLabel}</label>
            <select className="field-input" id={`font-family-${key}`} value={preferences[familyKey]} onChange={(event) => onChange({ ...preferences, [familyKey]: event.target.value })}>
              {families.map((family) => <option key={family.value} value={family.value}>{family.label}</option>)}
            </select>
          </div>
        </div>;
      })}
    </fieldset>
    <footer className="font-settings-footer">
      <button className="neutral-button" type="button" onClick={() => {
        setDraft({ fileNames: String(DEFAULT_FONT_PREFERENCES.fileNames), editor: String(DEFAULT_FONT_PREFERENCES.editor) });
        onChange({ ...DEFAULT_FONT_PREFERENCES });
      }}>Reset</button>
      <button className="neutral-button-filled" type="button" onClick={onClose}>Done</button>
    </footer>
  </div>;
}
