interface ConfluxApi {
  getDocumentState: () => Promise<Uint8Array>;
  sendDocumentUpdate: (update: Uint8Array) => void;
  onDocumentUpdate: (callback: (update: Uint8Array) => void) => () => void;
  openSecondWindow: () => void;
}

interface Window {
  conflux: ConfluxApi;
}
