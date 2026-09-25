const KEY = "ama.offline.scoreQueue.v1";

function readQueue() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function writeQueue(queue) { localStorage.setItem(KEY, JSON.stringify(queue.slice(-20))); }

export function enqueueScoreBatch(rows, meta = {}) {
  const queue = readQueue();
  queue.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), rows, meta });
  writeQueue(queue);
  return queue.length;
}

export function pendingScoreBatches() { return readQueue(); }
export function pendingScoreCount() { return readQueue().reduce((sum, item) => sum + item.rows.length, 0); }

export async function drainScoreQueue(saveBatch) {
  const queue = readQueue();
  if (!queue.length || navigator.onLine === false) return { batches: 0, rows: 0 };
  let completed = 0;
  let rows = 0;
  for (const item of queue) {
    try {
      await saveBatch(item.rows, item.meta);
      completed += 1;
      rows += item.rows.length;
    } catch (error) {
      // Keep the first failed batch and everything after it for the next retry.
      writeQueue(queue.slice(completed));
      throw error;
    }
  }
  writeQueue([]);
  return { batches: completed, rows };
}

export function registerOfflineSync(saveBatch, onDrained = () => {}) {
  const run = () => drainScoreQueue(saveBatch).then(result => { if (result.rows) onDrained(result); }).catch(() => {});
  window.addEventListener("online", run);
  run();
  return () => window.removeEventListener("online", run);
}
