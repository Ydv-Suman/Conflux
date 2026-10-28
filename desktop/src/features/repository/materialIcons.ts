import generated from './material-icons.generated.json';

type Associations = {
  file?: string; folder?: string; folderExpanded?: string; rootFolder?: string; rootFolderExpanded?: string;
  fileNames?: Record<string, string>; fileExtensions?: Record<string, string>;
  folderNames?: Record<string, string>; folderNamesExpanded?: Record<string, string>;
  rootFolderNames?: Record<string, string>; rootFolderNamesExpanded?: Record<string, string>;
};
const manifest = generated as Associations & { light: Associations; iconDefinitions: Record<string, { iconPath: string }> };
const get = (map: Record<string, string> | undefined, name: string) => map && Object.hasOwn(map, name) ? map[name] : undefined;

export function materialIconPath(name: string, directory = false, expanded = false, light = false, root = false): string {
  const basename = name.split('/').pop()!.toLowerCase();
  const theme = light ? manifest.light : {};
  let icon: string | undefined;
  if (directory) {
    const names = root ? (expanded ? 'rootFolderNamesExpanded' : 'rootFolderNames') : (expanded ? 'folderNamesExpanded' : 'folderNames');
    const fallback = root ? (expanded ? 'rootFolderExpanded' : 'rootFolder') : (expanded ? 'folderExpanded' : 'folder');
    icon = get(theme[names], basename) ?? get(manifest[names], basename) ?? theme[fallback] ?? manifest[fallback];
  } else {
    icon = get(theme.fileNames, basename) ?? get(manifest.fileNames, basename);
    // Most-specific suffix first: foo.test.ts before ts, and d.ts before ts.
    for (let index = basename.indexOf('.'); !icon && index !== -1; index = basename.indexOf('.', index + 1)) {
      const extension = basename.slice(index + 1);
      icon = get(theme.fileExtensions, extension) ?? get(manifest.fileExtensions, extension);
    }
    icon ??= theme.file ?? manifest.file;
  }
  return `/material-icons/${manifest.iconDefinitions[icon!].iconPath}`;
}
