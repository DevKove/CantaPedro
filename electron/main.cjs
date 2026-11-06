const { app, BrowserWindow, Menu, protocol, session, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'cantapedro',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

const isAppUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'cantapedro:' && url.hostname === 'app';
  } catch {
    return false;
  }
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 760, minHeight: 560,
    show: false, autoHideMenuBar: true, backgroundColor: '#10131b',
    title: 'CantaPedro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('cantapedro://app/index.html').catch(error => {
    console.error('Falha ao carregar a interface local do CantaPedro:', error);
  });
}

app.whenReady().then(() => {
  protocol.handle('cantapedro', request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || request.method !== 'GET') {
        return new Response('Not found', { status: 404 });
      }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const root = path.resolve(__dirname, '..');
      const target = path.resolve(root, relative);
      if (target !== root && !target.startsWith(root + path.sep)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(target).toString());
    } catch (error) {
      console.error('Requisição local inválida:', error);
      return new Response('Bad request', { status: 400 });
    }
  });

  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
