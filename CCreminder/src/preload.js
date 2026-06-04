"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// ---------------------------------------------------------------------------
// Preload bridge — expose safe IPC methods to the renderer process
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld("api", {
  /**
   * Invoke an IPC handler and return the result.
   * @param {string} channel
   * @param {...any} args
   * @returns {Promise<any>}
   */
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  /**
   * Listen for a main-to-renderer event.
   * @param {string} channel
   * @param {(data: any) => void} callback
   */
  on: (channel, callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on(channel, subscription);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
