import { cacheConfig } from './config.js';

const pendingByKey = new Map();
const queue = [];
let active = 0;

export function enqueuePreviewTask(key, task) {
  if (pendingByKey.has(key)) {
    return pendingByKey.get(key);
  }

  const promise = new Promise((resolve, reject) => {
    queue.push({ key, task, resolve, reject });
    runQueue();
  }).finally(() => {
    pendingByKey.delete(key);
  });

  pendingByKey.set(key, promise);
  return promise;
}

function runQueue() {
  while (active < cacheConfig.concurrency && queue.length) {
    const entry = queue.shift();
    active += 1;

    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        runQueue();
      });
  }
}
