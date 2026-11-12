/**
 * The bridge to 平台工坊 (`platformWorkshop` service, when that plugin is
 * installed in the same DSH): push a list in as records, pull the results
 * people pick there. Pushing is always the person's click on the 生成名单
 * sheet; names go along, phone numbers only when the person ticked them.
 */
import { CrmError } from '../core/store.js'

/**
 * @param {import('../core/store.js').Datasets} datasets
 * @param {() => any} service - returns the `platformWorkshop` service or undefined.
 * @param {(level: string, message: string) => void} [log]
 */
export function workshopBridge(datasets, service, log = () => {}) {
  const workshop = () => {
    const w = service()?.workshop
    return w && typeof w.importBatch === 'function' && typeof w.batchStatus === 'function' ? w : null
  }
  const available = () => workshop() !== null

  async function push(id, batchId, { withPhone = false } = {}) {
    const w = workshop()
    if (!w) throw new CrmError('no-workshop', '没找到平台工坊，或者它的版本太旧：装好或升级平台工坊后再推，或者先导出 Excel')
    const { batch, rows } = await datasets.pushRows(id, batchId, { withPhone })
    let res
    try {
      res = await w.importBatch({ origin: `crm-ops:${id}`, batch, rows })
    } catch (error) {
      throw new CrmError('workshop-failed', `平台工坊没接收：${error?.message ?? error}`)
    }
    await datasets.markPushed(id, batchId, { key: res.key, objectId: res.objectId, objectName: res.objectName, records: res.created + res.skipped, withPhone: Boolean(withPhone) })
    return { key: res.key, objectName: res.objectName, created: res.created, skipped: res.skipped }
  }

  /** Pull results for one list, or for every list of a dataset that went to 平台工坊 and is still open. */
  async function sync(id, batchId = null) {
    const w = workshop()
    if (!w) throw new CrmError('no-workshop', '没找到平台工坊')
    const { batches } = await datasets.lists(id)
    const targets = batches.filter(b => b.workshop?.key && (batchId ? b.id === batchId : b.status !== 'closed'))
    let changed = 0
    for (const b of targets) {
      const status = await w.batchStatus(b.workshop.key)
      if (!status) continue
      changed += (await datasets.syncOutcomes(id, b.id, status.rows.map(r => ({ ref: r.ref, outcome: r.outcome, at: r.outcomeAt })))).changed
    }
    return { lists: targets.length, changed }
  }

  /** Sync every dataset's open workshop lists; used when 平台工坊 reports a change. */
  async function syncAll() {
    if (!available()) return
    for (const d of await datasets.list()) {
      try {
        await sync(d.id)
      } catch (error) {
        if (error?.code !== 'no-data') log('warn', `sync ${d.id}: ${error?.message ?? error}`)
      }
    }
  }

  return { available, push, sync, syncAll }
}
