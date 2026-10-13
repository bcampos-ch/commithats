// CommonJS on purpose: a sandboxed preload script cannot be an ES module.
const { contextBridge, ipcRenderer } = require('electron');

// The page gets these functions and nothing else: no Node, no generic IPC access.
contextBridge.exposeInMainWorld('accountSwitcher', {
  getState: () => ipcRenderer.invoke('state:get'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  saveSettings: (change) => ipcRenderer.invoke('settings:save', change),

  saveAccount: (draft) => ipcRenderer.invoke('accounts:save', draft),
  removeAccount: (accountId) => ipcRenderer.invoke('accounts:remove', accountId),
  signIn: (accountId) => ipcRenderer.invoke('accounts:sign-in', accountId),
  pickSshKey: () => ipcRenderer.invoke('accounts:pick-ssh-key'),
  generateSshKey: (draft) => ipcRenderer.invoke('accounts:generate-ssh-key', draft),
  readPublicKey: (keyPath) => ipcRenderer.invoke('accounts:read-public-key', keyPath),

  pickFolder: () => ipcRenderer.invoke('folders:pick'),
  addFolderRule: (accountId, folderPath) => ipcRenderer.invoke('folders:add', accountId, folderPath),
  removeFolderRule: (folderPath) => ipcRenderer.invoke('folders:remove', folderPath),

  addOwnerRule: (accountId, owner) => ipcRenderer.invoke('owners:add', accountId, owner),
  removeOwnerRule: (owner) => ipcRenderer.invoke('owners:remove', owner),

  addProjects: () => ipcRenderer.invoke('projects:add'),
  removeProject: (projectPath) => ipcRenderer.invoke('projects:remove', projectPath),
  moveProject: (projectPath, index) => ipcRenderer.invoke('projects:move', projectPath, index),
  assignProject: (projectPath, accountId) => ipcRenderer.invoke('projects:assign', projectPath, accountId),

  copyText: (value) => ipcRenderer.invoke('clipboard:write', value),
});
