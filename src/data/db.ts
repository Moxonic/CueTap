import type { Show } from './types'

const DB_NAME = 'cuetap'
const DB_VERSION = 1
const AUDIO = 'audio'
const KV = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO)
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export function putAudio(id: string, blob: Blob): Promise<unknown> {
  return tx(AUDIO, 'readwrite', (s) => s.put(blob, id))
}

export function getAudio(id: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>(AUDIO, 'readonly', (s) => s.get(id))
}

export function deleteAudio(id: string): Promise<unknown> {
  return tx(AUDIO, 'readwrite', (s) => s.delete(id))
}

export function listAudioIds(): Promise<IDBValidKey[]> {
  return tx<IDBValidKey[]>(AUDIO, 'readonly', (s) => s.getAllKeys())
}

export function saveShow(show: Show): Promise<unknown> {
  return tx(KV, 'readwrite', (s) => s.put(show, 'show'))
}

export function loadShow(): Promise<Show | undefined> {
  return tx<Show | undefined>(KV, 'readonly', (s) => s.get('show'))
}

/**
 * Ask the browser not to evict our audio. iOS in particular will clear IndexedDB
 * for a non-installed site under storage pressure, which would silently empty a
 * show between rehearsal and performance.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const e = await navigator.storage.estimate()
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return null
  }
}

/** Remove blobs no cue references any more. */
export async function pruneOrphanAudio(show: Show): Promise<number> {
  const referenced = new Set(show.cues.map((c) => c.audioId))
  const keys = await listAudioIds()
  let removed = 0
  for (const k of keys) {
    if (typeof k === 'string' && !referenced.has(k)) {
      await deleteAudio(k)
      removed++
    }
  }
  return removed
}
