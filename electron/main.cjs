const { app, BrowserWindow } = require('electron');
const path = require('path');

// Harden startup in restricted Linux environments where Chromium sandbox
// initialization can abort before the app window is created.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-setuid-sandbox');

const devServerUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    backgroundColor: '#030a10',
    icon: path.join(__dirname, '../public/logo.png'),
    webPreferences: {
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadURL(
    !app.isPackaged
      ? devServerUrl
      : `file://${path.join(__dirname, '../dist/index.html')}`
  );

  // Hide menu bar
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
