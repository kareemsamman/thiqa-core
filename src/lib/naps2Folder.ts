// NAPS2 watch-folder integration.
//
// Workflow:
//   1. Staff configures NAPS2 to auto-save each scan as PDF/JPG into
//      a designated folder (e.g. C:\NAPS2-Scans\).
//   2. From the web app, the user picks that folder ONCE via the
//      File System Access API. The directory handle is persisted in
//      IndexedDB so future sessions don't need to re-pick.
//   3. On "sync", we list all PDF/image files in the root of that
//      folder, upload them, and move each into an `uploaded/`
//      subfolder so a second sync doesn't re-upload them.
//
// Limitations:
//   • File System Access API is Chromium-only (Chrome/Edge/Brave).
//     Safari + Firefox callers should see the `isSupported()` guard
//     and fall back to the manual upload button.
//   • Permission grant is per-session by default; we call
//     requestPermission() each time we read/write so the browser
//     handles the prompt.

const DB_NAME = "naps2-folder-db";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "naps2-watch-folder";
const UPLOADED_SUBFOLDER = "uploaded";

const SCAN_FILE_REGEX = /\.(pdf|jpe?g|png|webp|heic|heif|tiff?)$/i;

export type Naps2File = {
  name: string;
  file: File;
  handle: FileSystemFileHandle;
};

export function isSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStoredHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort cleanup
  }
}

// Open the directory picker, store the chosen handle, and return it.
// Throws AbortError if the user cancels — callers should swallow it.
export async function pickAndStoreFolder(): Promise<FileSystemDirectoryHandle> {
  if (!isSupported()) {
    throw new Error("هذا المتصفح لا يدعم اختيار المجلدات. استخدم Chrome أو Edge.");
  }
  // @ts-ignore — File System Access API types
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    mode: "readwrite",
    id: "naps2-watch-folder",
  });
  await storeHandle(handle);
  return handle;
}

// Re-check the permission for a previously stored handle. Returns
// 'granted' / 'denied' / 'prompt'. We always pass through
// requestPermission since the browser auto-resolves to 'granted'
// when the user has already authorized this origin+handle pair.
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
): Promise<"granted" | "denied"> {
  // @ts-ignore — File System Access API types
  const opts = { mode: "readwrite" } as const;
  // @ts-ignore
  const current = await handle.queryPermission(opts);
  if (current === "granted") return "granted";
  // @ts-ignore
  const next = await handle.requestPermission(opts);
  return next === "granted" ? "granted" : "denied";
}

// List every supported scan file in the root of the folder, skipping
// the `uploaded/` subfolder and any subdirectories.
export async function listPendingFiles(
  handle: FileSystemDirectoryHandle,
): Promise<Naps2File[]> {
  const out: Naps2File[] = [];
  // @ts-ignore — entries() exists on FileSystemDirectoryHandle
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "file") continue;
    if (!SCAN_FILE_REGEX.test(name)) continue;
    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    out.push({ name, file, handle: fileHandle });
  }
  // Sort by modification time so the oldest scans upload first.
  out.sort((a, b) => a.file.lastModified - b.file.lastModified);
  return out;
}

// Move a file from the root into `uploaded/`. Uses the newer
// FileSystemFileHandle.move() when available (Chrome 123+) and
// falls back to copy+delete on older browsers.
export async function moveToUploaded(
  rootHandle: FileSystemDirectoryHandle,
  fileEntry: Naps2File,
): Promise<void> {
  const uploadedDir = await rootHandle.getDirectoryHandle(UPLOADED_SUBFOLDER, {
    create: true,
  });

  // Try the native move first.
  // @ts-ignore — move() is experimental but works in Chromium
  if (typeof fileEntry.handle.move === "function") {
    try {
      // @ts-ignore
      await fileEntry.handle.move(uploadedDir, fileEntry.name);
      return;
    } catch {
      // fall through to copy+delete
    }
  }

  // Fallback: copy the bytes, then remove the original.
  const destHandle = await uploadedDir.getFileHandle(fileEntry.name, {
    create: true,
  });
  const writable = await destHandle.createWritable();
  await writable.write(await fileEntry.file.arrayBuffer());
  await writable.close();
  await rootHandle.removeEntry(fileEntry.name);
}
