'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  capabilities: 'slop-zoo:platform:capabilities',
  appInfo: 'slop-zoo:platform:app-info',
  storageRead: 'slop-zoo:storage:read',
  storageWrite: 'slop-zoo:storage:write',
  storageRemove: 'slop-zoo:storage:remove',
  storageFlush: 'slop-zoo:storage:flush',
});

function deepFreeze(value) {
  const freezeable = value && (typeof value === 'object' || typeof value === 'function');
  if (!freezeable || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function invokeFrozen(channel, ...arguments_) {
  return ipcRenderer.invoke(channel, ...arguments_).then(deepFreeze);
}

function queueMutation(channel, ...arguments_) {
  ipcRenderer.send(channel, ...arguments_);
  return Promise.resolve(true);
}

const api = deepFreeze({
  apiVersion: 1,
  capabilities: {
    get: () => invokeFrozen(CHANNELS.capabilities),
  },
  app: {
    getInfo: () => invokeFrozen(CHANNELS.appInfo),
  },
  storage: {
    read: (key) => ipcRenderer.invoke(CHANNELS.storageRead, key),
    write: (key, value) => queueMutation(CHANNELS.storageWrite, key, value),
    remove: (key) => queueMutation(CHANNELS.storageRemove, key),
    flush: () => ipcRenderer.invoke(CHANNELS.storageFlush),
  },
});

contextBridge.exposeInMainWorld('slopZooDesktop', api);
