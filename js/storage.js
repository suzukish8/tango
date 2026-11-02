/*
 * tango web - storage
 * 学習データはこのブラウザの IndexedDB にだけ保存します（サーバーには送りません）。
 * IndexedDB が使えない環境（プライベートウィンドウなど）では，そのタブの間だけ有効なメモリ上に保存します。
 */
(function (root) {
  'use strict';

  var DB_NAME = 'tango-web';
  var STORE = 'kv';
  var memory = new Map();
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var out = fn(store);
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function get(key) {
    return open().then(function (db) {
      if (!db) return memory.has(key) ? memory.get(key) : undefined;
      return new Promise(function (resolve, reject) {
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function set(key, value) {
    return run('readwrite', function (store) {
      if (!store) { memory.set(key, value); return undefined; }
      store.put(value, key);
      return undefined;
    });
  }

  function del(key) {
    return run('readwrite', function (store) {
      if (!store) { memory.delete(key); return undefined; }
      store.delete(key);
      return undefined;
    });
  }

  root.TangoStorage = { get: get, set: set, del: del };
})(window);
