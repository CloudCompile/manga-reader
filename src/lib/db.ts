// Lightweight IndexedDB wrapper for offline manga caching
// Stores: chapter data (images list, title), cached image blobs, reading progress, history

const DB_NAME = "manga-reader-db";
const DB_VERSION = 1;

interface ChapterCache {
  url: string;
  title: string;
  mangaName: string;
  chapterNum: string;
  images: string[];        // original image URLs
  prevUrl: string | null;
  nextUrl: string | null;
  cachedAt: number;
  imageBlobs: Record<string, number>; // url -> blob size
}

interface ReadingProgress {
  url: string;
  chapterNum: string;
  mangaName: string;
  title: string;
  scrollRatio: number;   // 0-1
  pageIndex: number;
  lastRead: number;
}

interface HistoryEntry {
  url: string;
  title: string;
  mangaName: string;
  chapterNum: string;
  lastRead: number;
  pageCount: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("chapters")) {
        db.createObjectStore("chapters", { keyPath: "url" });
      }
      if (!db.objectStoreNames.contains("progress")) {
        db.createObjectStore("progress", { keyPath: "url" });
      }
      if (!db.objectStoreNames.contains("history")) {
        const store = db.createObjectStore("history", { keyPath: "url" });
        store.createIndex("lastRead", "lastRead", { unique: false });
      }
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images", { keyPath: "url" }); // key = original image URL
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode): IDBTransaction {
  return db.transaction(stores, mode);
}

function reqToPromise<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

// ─── Chapter Cache ───

export async function saveChapterCache(data: ChapterCache): Promise<void> {
  const db = await openDB();
  const t = tx(db, ["chapters"], "readwrite");
  t.objectStore("chapters").put(data);
}

export async function getChapterCache(url: string): Promise<ChapterCache | undefined> {
  const db = await openDB();
  const t = tx(db, ["chapters"], "readonly");
  return reqToPromise<ChapterCache | undefined>(t.objectStore("chapters").get(url));
}

export async function deleteChapterCache(url: string): Promise<void> {
  const db = await openDB();
  const t = tx(db, ["chapters", "images"], "readwrite");
  const chapter = await reqToPromise<ChapterCache | undefined>(t.objectStore("chapters").get(url));
  if (chapter) {
    // Delete associated image blobs
    const imgStore = t.objectStore("images");
    for (const imgUrl of Object.keys(chapter.imageBlobs || {})) {
      imgStore.delete(imgUrl);
    }
  }
  t.objectStore("chapters").delete(url);
}

export async function getAllCachedChapters(): Promise<ChapterCache[]> {
  const db = await openDB();
  const t = tx(db, ["chapters"], "readonly");
  return reqToPromise<ChapterCache[]>(t.objectStore("chapters").getAll());
}

// ─── Image Blobs ───

export async function saveImageBlob(url: string, blob: Blob): Promise<void> {
  const db = await openDB();
  const t = tx(db, ["images"], "readwrite");
  t.objectStore("images").put({ url, blob, size: blob.size, savedAt: Date.now() });
}

export async function getImageBlob(url: string): Promise<Blob | undefined> {
  const db = await openDB();
  const t = tx(db, ["images"], "readonly");
  const result = await reqToPromise<{ url: string; blob: Blob } | undefined>(
    t.objectStore("images").get(url)
  );
  return result?.blob;
}

export async function isImageCached(url: string): Promise<boolean> {
  const db = await openDB();
  const t = tx(db, ["images"], "readonly");
  const count = await reqToPromise<number>(t.objectStore("images").count(url));
  return count > 0;
}

// ─── Reading Progress ───

export async function saveProgress(data: ReadingProgress): Promise<void> {
  const db = await openDB();
  const t = tx(db, ["progress"], "readwrite");
  t.objectStore("progress").put(data);
}

export async function getProgress(url: string): Promise<ReadingProgress | undefined> {
  const db = await openDB();
  const t = tx(db, ["progress"], "readonly");
  return reqToPromise<ReadingProgress | undefined>(t.objectStore("progress").get(url));
}

// ─── Reading History ───

export async function addToHistory(entry: HistoryEntry): Promise<void> {
  const db = await openDB();
  const t = tx(db, ["history"], "readwrite");
  t.objectStore("history").put(entry);
}

export async function getHistory(limit = 50): Promise<HistoryEntry[]> {
  const db = await openDB();
  const t = tx(db, ["history"], "readonly");
  const all = await reqToPromise<HistoryEntry[]>(t.objectStore("history").getAll());
  return all.sort((a, b) => b.lastRead - a.lastRead).slice(0, limit);
}

export async function clearAllData(): Promise<void> {
  const db = await openDB();
  const t = tx(db, ["chapters", "progress", "history", "images"], "readwrite");
  t.objectStore("chapters").clear();
  t.objectStore("progress").clear();
  t.objectStore("history").clear();
  t.objectStore("images").clear();
}

// ─── Storage Stats ───

export async function getStorageStats(): Promise<{
  cachedChapters: number;
  cachedImages: number;
  historyEntries: number;
}> {
  const db = await openDB();
  const t = tx(db, ["chapters", "images", "history"], "readonly");
  const [cachedChapters, cachedImages, historyEntries] = await Promise.all([
    reqToPromise<number>(t.objectStore("chapters").count()),
    reqToPromise<number>(t.objectStore("images").count()),
    reqToPromise<number>(t.objectStore("history").count()),
  ]);
  return { cachedChapters, cachedImages, historyEntries };
}