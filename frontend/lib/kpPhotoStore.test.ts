import { beforeAll, describe, expect, it } from "vitest";

import { blobToDataUrl, deleteKpPhoto, readKpPhoto, saveKpPhoto } from "./kpPhotoStore";

type Handler = (() => void) | null;

beforeAll(() => {
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }

  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();

  class Database {
    objectStoreNames = {
      contains: (name: string) => databases.get(this.name)?.has(name) ?? false,
    };

    constructor(private name: string) {}

    createObjectStore(name: string) {
      databases.get(this.name)?.set(name, new Map());
    }

    transaction(storeName: string) {
      const store = databases.get(this.name)?.get(storeName);
      const tx: {
        objectStore: () => {
          put: (value: unknown, key: IDBValidKey) => void;
          get: (key: IDBValidKey) => { result?: unknown; onsuccess: Handler; onerror: Handler };
          delete: (key: IDBValidKey) => void;
        };
        oncomplete: Handler;
        onerror: Handler;
      } = {
        objectStore: () => ({
          put(value, key) {
            store?.set(key, value);
          },
          get(key) {
            const request: { result?: unknown; onsuccess: Handler; onerror: Handler } = {
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => {
              request.result = store?.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          delete(key) {
            store?.delete(key);
          },
        }),
        oncomplete: null,
        onerror: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    }

    close() {}
  }

  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open(name: string) {
        const request: {
          result?: Database;
          onsuccess: Handler;
          onerror: Handler;
          onupgradeneeded: Handler;
        } = { onsuccess: null, onerror: null, onupgradeneeded: null };
        queueMicrotask(() => {
          const created = !databases.has(name);
          if (created) {
            databases.set(name, new Map());
          }
          request.result = new Database(name);
          if (created) {
            request.onupgradeneeded?.();
          }
          request.onsuccess?.();
        });
        return request;
      },
    },
  });
});

describe("kp photo store", () => {
  it("saves, reads and deletes an uploaded image in IndexedDB", async () => {
    const file = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" });
    const id = await saveKpPhoto(file);
    expect(id).toBeTruthy();
    const stored = await readKpPhoto(id!);
    expect(stored).not.toBeNull();
    expect(await blobToDataUrl(stored!)).toMatch(/^data:image\/png;base64,/);
    await deleteKpPhoto(id!);
    expect(await readKpPhoto(id!)).toBeNull();
  });
});
