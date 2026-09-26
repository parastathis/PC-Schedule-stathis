/* The page's only door to the disk: read the save once at start-up, write it
   on every change, open the data folder on request. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pcStore", {
  read: () => ipcRenderer.sendSync("store:read"),
  write: (json) => ipcRenderer.send("store:write", json),
  openFolder: () => ipcRenderer.send("store:open-folder")
});
