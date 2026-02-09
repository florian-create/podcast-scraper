const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  extractPodcasts: (urls) => ipcRenderer.invoke('extract-podcasts', { urls }),

  onExtractionProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('extraction-progress', handler);
    return () => ipcRenderer.removeListener('extraction-progress', handler);
  },

  onPdfProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('pdf-progress', handler);
    return () => ipcRenderer.removeListener('pdf-progress', handler);
  },

  exportJson: (data, defaultFilename) =>
    ipcRenderer.invoke('export-json', { data, defaultFilename }),

  generatePdf: (results, prompt) =>
    ipcRenderer.invoke('generate-pdf', { results, prompt }),

  saveApiKeys: (keys) => ipcRenderer.invoke('save-api-keys', keys),

  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),
});
