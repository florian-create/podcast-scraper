const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { processPodcast } = require('./services/extractor');
const { generatePdf } = require('./services/pdfGenerator');
const { store } = require('./services/store');

let mainWindow;

function isDevServerRunning(url) {
  return new Promise((resolve) => {
    const request = net.request(url);
    request.on('response', () => resolve(true));
    request.on('error', () => resolve(false));
    request.end();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 600,
    minHeight: 600,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const devURL = 'http://localhost:5173';
  const builtFile = path.join(__dirname, '../../dist/renderer/index.html');

  if (!app.isPackaged && (await isDevServerRunning(devURL))) {
    mainWindow.loadURL(devURL);
  } else {
    mainWindow.loadFile(builtFile);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC Handlers ---

// Map sub-step messages to finer progress values within each podcast
function subStepProgress(i, total, msg) {
  let sub = 0.5; // default mid-point
  if (msg.includes('Resolving')) sub = 0.05;
  else if (msg.includes('Looking up')) sub = 0.08;
  else if (msg.includes('Fetching RSS')) sub = 0.12;
  else if (msg.includes('metadata')) sub = 0.15;
  else if (msg.includes('Downloading')) sub = 0.2;
  else if (msg.includes('Converting')) sub = 0.4;
  else if (msg.includes('Splitting')) sub = 0.45;
  else if (msg.includes('Transcribing part')) sub = 0.6;
  else if (msg.includes('Transcribing')) sub = 0.55;
  else if (msg.includes('Searching YouTube')) sub = 0.1;
  return (i + sub) / total;
}

// Extract podcasts: download + transcribe each URL sequentially
ipcMain.handle('extract-podcasts', async (event, { urls }) => {
  const provider = store.get('transcription_provider') || 'groq';
  const apiKey =
    provider === 'groq'
      ? store.get('groq_api_key')
      : store.get('openai_api_key');

  if (!apiKey) {
    throw new Error(
      `Missing ${provider === 'groq' ? 'Groq' : 'OpenAI'} API key. Configure it in Settings.`
    );
  }

  const results = [];
  const total = urls.length;

  // Start immediately with a tiny progress so bar begins moving
  mainWindow.webContents.send('extraction-progress', {
    current: 0,
    total,
    progress: 0.02,
    message: `Starting extraction of ${total} podcast${total > 1 ? 's' : ''}...`,
  });

  for (let i = 0; i < total; i++) {
    const url = urls[i].trim();
    if (!url) continue;

    // Send progress at start of each podcast
    mainWindow.webContents.send('extraction-progress', {
      current: i,
      total,
      progress: Math.max(0.02, i / total),
      message: `Processing podcast ${i + 1}/${total}...`,
    });

    const result = await processPodcast(url, i, total, provider, apiKey, (msg) => {
      mainWindow.webContents.send('extraction-progress', {
        current: i,
        total,
        progress: subStepProgress(i, total, msg),
        message: msg,
      });
    });

    results.push(result);

    // Update progress after completion
    mainWindow.webContents.send('extraction-progress', {
      current: i + 1,
      total,
      progress: (i + 1) / total,
      message:
        i + 1 === total
          ? `Done! ${results.filter((r) => r.status === 'success').length}/${total} transcribed`
          : `Podcast ${i + 1}/${total} done`,
    });
  }

  return results;
});

// Export JSON
ipcMain.handle('export-json', async (_event, { data, defaultFilename }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export JSON',
    defaultPath: defaultFilename || 'podcasts.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
});

// Generate PDF report
ipcMain.handle('generate-pdf', async (_event, { results, prompt }) => {
  const provider = store.get('llm_provider') || 'anthropic';
  const apiKey = store.get('llm_api_key');
  if (!apiKey) {
    throw new Error('Missing LLM API key. Configure it in Settings.');
  }

  // Send initial progress
  mainWindow.webContents.send('pdf-progress', { progress: 0.02, message: 'Starting PDF generation...' });

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF Report',
    defaultPath: 'podcast_report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) {
    mainWindow.webContents.send('pdf-progress', { progress: 0, message: '' });
    return null;
  }

  await generatePdf({
    results, prompt, provider, apiKey, filePath,
    onProgress: (progress, message) => {
      mainWindow.webContents.send('pdf-progress', { progress, message });
    },
  });
  return filePath;
});

// Settings
ipcMain.handle('save-api-keys', async (_event, keys) => {
  for (const [key, value] of Object.entries(keys)) {
    if (value !== undefined) {
      store.set(key, value);
    }
  }
  return true;
});

ipcMain.handle('get-api-keys', async () => {
  return {
    groq_api_key: store.get('groq_api_key') || '',
    openai_api_key: store.get('openai_api_key') || '',
    transcription_provider: store.get('transcription_provider') || 'groq',
    llm_api_key: store.get('llm_api_key') || '',
    llm_provider: store.get('llm_provider') || 'groq',
  };
});
