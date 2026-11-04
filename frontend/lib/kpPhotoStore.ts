const DB_NAME = "pasionaria-kp-photos";
const STORE = "photos";
export const KP_PHOTO_MAX_BYTES = 2_000_000;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

type StoredPhoto = {
  blob: Blob;
  contentType: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function photoFileAllowed(file: Blob): boolean {
  return ALLOWED.has(file.type) && file.size > 0 && file.size <= KP_PHOTO_MAX_BYTES;
}

export async function saveKpPhoto(file: Blob): Promise<string | null> {
  if (!photoFileAllowed(file)) {
    return null;
  }
  const id = crypto.randomUUID();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ blob: file, contentType: file.type } satisfies StoredPhoto, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return id;
}

export async function readKpPhoto(id: string): Promise<Blob | null> {
  const db = await openDb();
  const stored = await new Promise<StoredPhoto | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as StoredPhoto | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return stored?.blob ?? null;
}

export async function deleteKpPhoto(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  const type = blob.type || "image/jpeg";
  return `data:${type};base64,${btoa(binary)}`;
}
