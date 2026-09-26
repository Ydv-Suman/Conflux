import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import started from 'electron-squirrel-startup';
import * as Y from 'yjs';

if (started) app.quit();

const document = new Y.Doc();
let documentPath = '';

const createWindow = () => {
  const window = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 620,
    minHeight: 460,
    backgroundColor: '#f4f3ef',
    title: 'Conflux',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const saveDocument = () => {
  writeFileSync(documentPath, Y.encodeStateAsUpdate(document));
};

app.whenReady().then(() => {
  documentPath = path.join(app.getPath('userData'), 'shared-document.yjs');

  try {
    Y.applyUpdate(document, readFileSync(documentPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  document.on('update', (_update, origin) => {
    saveDocument();
    const state = Y.encodeStateAsUpdate(document);

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.webContents.id !== origin) {
        window.webContents.send('document:update', state);
      }
    }
  });

  ipcMain.handle('document:state', () => Y.encodeStateAsUpdate(document));
  ipcMain.on('document:update', (event, update: Uint8Array) => {
    if (update instanceof Uint8Array) Y.applyUpdate(document, update, event.sender.id);
  });
  ipcMain.on('window:open', createWindow);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
