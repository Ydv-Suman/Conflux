import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('conflux', {
  getDocumentState: () => ipcRenderer.invoke('document:state'),
  sendDocumentUpdate: (update: Uint8Array) =>
    ipcRenderer.send('document:update', update),
  onDocumentUpdate: (callback: (update: Uint8Array) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: Uint8Array) =>
      callback(update);
    ipcRenderer.on('document:update', listener);
    return () => ipcRenderer.removeListener('document:update', listener);
  },
  openSecondWindow: () => ipcRenderer.send('window:open'),
});
