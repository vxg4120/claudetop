import { workerData, parentPort } from 'worker_threads'
import { openDb, buildIndex } from '@claudetop/core'

const db = openDb(workerData.dbPath as string)
try {
  const count = buildIndex(db)
  parentPort?.postMessage({ type: 'done', count })
} catch (err) {
  parentPort?.postMessage({ type: 'error', message: String(err) })
} finally {
  db.close()
}
