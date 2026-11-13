const DB_NAME = 'veriseal_local_files_v1';
const STORE_NAME = 'files';

interface StoredFileRecord {
  key: string;
  fileName: string;
  fileType: string;
  buffer: ArrayBuffer;
  savedAt: number;
}

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open file store'));
  });
}

async function putRecord(record: StoredFileRecord): Promise<void> {
  const db = await openFileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to persist file'));
    };
  });
}

async function getRecord(key: string): Promise<StoredFileRecord | null> {
  const db = await openFileDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as StoredFileRecord | undefined) || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('Failed to read file'));
    };
  });
}

export async function saveLocalDocumentFile(
  caseId: string,
  documentHash: string,
  file: File
): Promise<void> {
  try {
    const buffer = await file.arrayBuffer();
    const savedAt = Date.now();
    await putRecord({
      key: `case:${caseId}`,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      buffer,
      savedAt,
    });
    if (documentHash) {
      await putRecord({
        key: `hash:${documentHash}`,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        buffer,
        savedAt,
      });
    }
  } catch {
    // Non-fatal in private browsing or restricted contexts
  }
}

export async function loadLocalDocumentFile(
  caseId: string,
  documentHash?: string
): Promise<{
  arrayBuffer: ArrayBuffer;
  fileType: string;
  fileName: string;
  objectUrl: string;
} | null> {
  try {
    let rec = await getRecord(`case:${caseId}`);
    if (!rec && documentHash) {
      rec = await getRecord(`hash:${documentHash}`);
    }
    if (!rec) return null;
    const blob = new Blob([rec.buffer], {
      type: rec.fileType || 'application/octet-stream',
    });
    return {
      arrayBuffer: rec.buffer,
      fileType: rec.fileType,
      fileName: rec.fileName,
      objectUrl: URL.createObjectURL(blob),
    };
  } catch {
    return null;
  }
}

export async function deleteLocalDocumentFile(caseId: string): Promise<void> {
  try {
    const db = await openFileDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(`case:${caseId}`);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore cleanup errors
  }
}
