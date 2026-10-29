import type { languages } from 'monaco-editor';

export function languageForPath(path: string, registered: languages.ILanguageExtensionPoint[]): string {
  const name = path.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
  const exact = registered.find((language) => language.filenames?.some((filename) => filename.toLowerCase() === name));
  if (exact) return exact.id;
  let languageId = 'plaintext';
  let longest = 0;
  for (const language of registered) {
    for (const extension of language.extensions ?? []) {
      if (extension.length > longest && name.endsWith(extension.toLowerCase())) {
        languageId = language.id;
        longest = extension.length;
      }
    }
  }
  return languageId;
}
