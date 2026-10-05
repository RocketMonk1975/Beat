const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('beat', {
  current: () => ipcRenderer.invoke('document:current'),
  update: (id, text, revision) => ipcRenderer.invoke('document:update', { id, text, revision }),
  action: (action) => ipcRenderer.invoke('document:action', action),
  flushed: (token, update) => ipcRenderer.invoke('document:flushed', { token, update }),
  onFlush: (callback) => { const listener = (_event, token) => callback(token); ipcRenderer.on('document:flush', listener); return () => ipcRenderer.removeListener('document:flush', listener); },
  onDocument: (callback) => { const listener = (_event, doc) => callback(doc); ipcRenderer.on('document:loaded', listener); return () => ipcRenderer.removeListener('document:loaded', listener); },
  onStatus: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('document:status', listener); return () => ipcRenderer.removeListener('document:status', listener); },
  onCommand: (callback) => { const listener = (_event, command) => callback(command); ipcRenderer.on('editor:command', listener); return () => ipcRenderer.removeListener('editor:command', listener); },
  connection: () => ipcRenderer.invoke('automation:current'),
  toggleConnection: () => ipcRenderer.invoke('automation:toggle'),
  automationResponse: (packet) => ipcRenderer.invoke('automation:response', packet),
  onAutomation: (callback) => { const listener = (_event, request) => callback(request); ipcRenderer.on('automation:request', listener); return () => ipcRenderer.removeListener('automation:request', listener); },
  onConnection: (callback) => { const listener = (_event, state) => callback(state); ipcRenderer.on('automation:status', listener); return () => ipcRenderer.removeListener('automation:status', listener); }
});
