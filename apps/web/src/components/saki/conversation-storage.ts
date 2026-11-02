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
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("conversations").objectStore("conversations").get([userId, id]);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let tail = Promise.resolve();
let previous = new Map<string, StoredSakiConversation>();
export function cacheConversations(conversations: StoredSakiConversation[], userId: string, storageKey: string): void {
  // Only changed message bodies are written. Metadata stays small and can be
  // read synchronously without parsing every conversation on page startup.
  const snapshot = conversations.slice(0, 80);
  tail = tail.catch(() => {}).then(async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("conversations", "readwrite");
      const store = transaction.objectStore("conversations");
      for (const conversation of snapshot) {
        const key = `${userId}:${conversation.id}`;
        if (conversation.messagesLoaded !== false && previous.get(key) !== conversation) {
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
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    // Do not replace the legacy local backup until its message bodies are safe.
    localStorage.setItem(storageKey, JSON.stringify(snapshot.map(conversation => ({ ...conversation, messages: [], messagesLoaded: false }))));
    previous = new Map(snapshot.filter(item => item.messagesLoaded !== false).map(item => [`${userId}:${item.id}`, item]));
  }).catch(error => {
    // Preserve the existing backup on quota/transaction failures.
    console.warn("[Saki] Local history backup failed:", error);
  });
}
