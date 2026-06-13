const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// 判断是否为开发环境
const isDev = !app.isPackaged;
const DEFAULT_WINDOW_BOUNDS = { width: 380, height: 400 };
const COLLAPSED_WINDOW_SIZE = { width: 96, height: 44 };

let mainWindow;
let isCollapsed = false;
let expandedSize = { ...DEFAULT_WINDOW_BOUNDS };
let isZoomed = false;
let boundsBeforeZoom = null;

function clampBoundsToWorkArea(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea;
  const maxX = areaX + areaWidth - bounds.width;
  const maxY = areaY + areaHeight - bounds.height;

  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, areaX), Math.max(areaX, maxX)),
    y: Math.min(Math.max(bounds.y, areaY), Math.max(areaY, maxY)),
  };
}

function setWindowBounds(win, bounds) {
  win.setBounds(clampBoundsToWorkArea(bounds));
}

function collapseWindow(win) {
  if (isCollapsed) return;

  const currentBounds = win.getBounds();
  expandedSize = { width: currentBounds.width, height: currentBounds.height };

  const collapsedBounds = {
    x: currentBounds.x + currentBounds.width - COLLAPSED_WINDOW_SIZE.width,
    y: currentBounds.y,
    width: COLLAPSED_WINDOW_SIZE.width,
    height: COLLAPSED_WINDOW_SIZE.height,
  };

  win.setResizable(false);
  win.setHasShadow(false);
  setWindowBounds(win, collapsedBounds);
  isCollapsed = true;
}

function expandWindow(win) {
  if (!isCollapsed) return;

  const collapsedBounds = win.getBounds();
  const expandedBounds = {
    x: collapsedBounds.x + collapsedBounds.width - expandedSize.width,
    y: collapsedBounds.y,
    width: expandedSize.width,
    height: expandedSize.height,
  };

  setWindowBounds(win, expandedBounds);
  win.setHasShadow(true);
  win.setResizable(true);
  isCollapsed = false;
}

function toggleZoomedWindow(win) {
  if (isCollapsed) {
    expandWindow(win);
  }

  if (isZoomed && boundsBeforeZoom) {
    setWindowBounds(win, boundsBeforeZoom);
    isZoomed = false;
    boundsBeforeZoom = null;
    return;
  }

  const currentBounds = win.getBounds();
  boundsBeforeZoom = currentBounds;
  const { workArea } = screen.getDisplayMatching(currentBounds);

  win.setResizable(true);
  win.setHasShadow(true);
  win.setBounds(workArea);
  isCollapsed = false;
  isZoomed = true;
}

function createWindow() {
  // 获取屏幕尺寸，让窗口默认出现在右上角或其他合适位置（这里默认居中）
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_BOUNDS.width,
    height: DEFAULT_WINDOW_BOUNDS.height,
    x: width - 400, // 默认靠右显示
    y: 50,
    show: false, // 等待加载完成后再显示，避免白屏
    frame: false, // 无边框
    transparent: true, // 透明背景
    alwaysOnTop: true, // 始终置顶
    resizable: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: true, // 允许渲染进程使用 Node.js API (如 window.close)
      contextIsolation: false,
      devTools: isDev,
    },
  });
  isCollapsed = false;
  expandedSize = { ...DEFAULT_WINDOW_BOUNDS };

  // 根据环境加载 URL 或文件
  if (isDev) {
    mainWindow.loadURL('http://localhost:5187');
    // 开发环境自动打开调试工具，方便查看问题
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 窗口加载完成后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 确保窗口在 Mac 全屏应用上也能显示（可选，取决于需求）
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.on('closed', () => {
    mainWindow = null;
    isCollapsed = false;
    expandedSize = { ...DEFAULT_WINDOW_BOUNDS };
    isZoomed = false;
    boundsBeforeZoom = null;
  });
}

// 设置开机自启
app.setLoginItemSettings({
  openAtLogin: true,
  path: app.getPath('exe'),
});

app.whenReady().then(() => {
  ipcMain.handle('window:set-collapsed', (_event, payload = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, collapsed: isCollapsed };
    }

    const shouldCollapse = Boolean(payload && payload.collapsed);
    if (shouldCollapse) {
      collapseWindow(mainWindow);
    } else {
      expandWindow(mainWindow);
    }

    return { ok: true, collapsed: isCollapsed };
  });

  ipcMain.handle('window:get-bounds', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false };
    }

    return { ok: true, bounds: mainWindow.getBounds() };
  });

  ipcMain.handle('window:set-position', (_event, payload = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false };
    }

    const x = Number(payload && payload.x);
    const y = Number(payload && payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false };
    }

    const currentBounds = mainWindow.getBounds();
    setWindowBounds(mainWindow, {
      ...currentBounds,
      x: Math.round(x),
      y: Math.round(y),
    });

    return { ok: true, bounds: mainWindow.getBounds() };
  });

  ipcMain.handle('window:toggle-maximized', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, maximized: false };
    }

    toggleZoomedWindow(mainWindow);

    return { ok: true, maximized: isZoomed };
  });

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
