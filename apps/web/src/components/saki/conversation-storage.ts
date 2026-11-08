import type { StoredSakiConversation } from "./SakiComponents.js";

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("saki-conversations", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("conversations");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = undefined; throw error; });
  return database;
}

export async function readCachedConversation(userId: string, id: string): Promise<StoredSakiConversation | undefined> {
  await tail;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("conversations").objectStore("conversations").get([userId, id]);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let tail = Promise.resolve();
const written = new WeakMap<StoredSakiConversation, string>();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.then(() => {}, () => {});
  return result;
}

function metadata(conversation: StoredSakiConversation): StoredSakiConversation {
  return {
    id: conversation.id, contextKey: conversation.contextKey, workspaceInstanceIds: conversation.workspaceInstanceIds,
    instanceId: conversation.instanceId ?? null, title: conversation.title, label: conversation.label, detail: conversation.detail,
    createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, historyBeforeId: conversation.historyBeforeId,
    messages: [], messagesLoaded: false
  };
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Local history transaction aborted."));
  });
}

/** The one-element key is the account's index. Two-element keys store conversation bodies. */
export function loadConversationIndex(userId: string, legacy: StoredSakiConversation[], storageKey: string, legacyRaw: string | null) {
  return enqueue(async () => {
    const db = await openDatabase();
    const transaction = db.transaction("conversations", "readwrite");
    const done = committed(transaction);
    const store = transaction.objectStore("conversations");
    const request = store.get([userId]);
    let index: StoredSakiConversation[] = [];
    let migrated = false;
    request.onsuccess = () => {
      if (Array.isArray(request.result)) {
        index = request.result;
        return;
      }
      migrated = true;
      index = legacy.map(metadata);
      const migrateAt = (position: number) => {
        const conversation = legacy[position];
        if (!conversation) {
          store.put(index, [userId]);
          return;
        }
        const key = [userId, conversation.id];
        const body = store.get(key);
        body.onsuccess = () => {
          const cached = body.result as StoredSakiConversation | undefined;
          if (cached && cached.updatedAt >= conversation.updatedAt) {
            index[position] = metadata(cached);
          } else if (conversation.messagesLoaded !== false) {
            store.put(conversation, key);
          }
          migrateAt(position + 1);
        };
      };
      migrateAt(0);
    };
    await done;
    // Preserve anything an older tab wrote while IndexedDB was committing.
    if (migrated && legacyRaw !== null) {
      try {
        if (localStorage.getItem(storageKey) === legacyRaw) localStorage.removeItem(storageKey);
      } catch {}
    }
    return index;
  });
}

export function cacheConversations(conversations: StoredSakiConversation[], userId: string, replaceIndex = true): void {
  const snapshot = conversations.slice(0, 80);
  void enqueue(async () => {
    const db = await openDatabase();
    const transaction = db.transaction("conversations", "readwrite");
    const done = committed(transaction);
    const store = transaction.objectStore("conversations");
    try {
      for (const conversation of snapshot) {
        if (conversation.messagesLoaded !== false && written.get(conversation) !== userId) {
          if (conversation.historyBeforeId) {
            const request = store.get([userId, conversation.id]);
            request.onsuccess = () => {
              const cached = request.result as StoredSakiConversation | undefined;
              const index = cached?.messages.findIndex(message => message.id === conversation.historyBeforeId) ?? -1;
              const ids = new Set(conversation.messages.map(message => message.id));
              store.put(index >= 0 && cached ? { ...conversation,
                historyBeforeId: cached.historyBeforeId ?? null,
                messages: [...cached.messages.slice(0, index).filter(message => !ids.has(message.id)), ...conversation.messages]
              } : conversation, [userId, conversation.id]);
            };
          } else store.put(conversation, [userId, conversation.id]);
        }
      }
      const nextIndex = snapshot.map(metadata);
      if (replaceIndex) {
        store.put(nextIndex, [userId]);
      } else {
        const indexRequest = store.get([userId]);
        indexRequest.onsuccess = () => {
          const existing = Array.isArray(indexRequest.result) ? (indexRequest.result as StoredSakiConversation[]) : [];
          const seen = new Set(nextIndex.map(item => item.id));
          store.put([...nextIndex, ...existing.filter(item => item && typeof item.id === "string" && !seen.has(item.id))].slice(0, 80), [userId]);
        };
      }
    } catch (error) {
      transaction.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
    for (const conversation of snapshot) {
      if (conversation.messagesLoaded !== false) written.set(conversation, userId);
    }
  }).catch(error => {
    console.warn("[Saki] Local history backup failed:", error);
  });
}
