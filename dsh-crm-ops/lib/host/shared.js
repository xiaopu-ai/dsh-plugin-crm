/**
 * Pieces both agent modes share: the dataset parameter, JSON rendering, the
 * session id of a tool call, and `crm_status`.
 */

export const json = value => [{ type: 'text', text: JSON.stringify(value) }]
export const datasetParam = { type: 'string', description: '用户第一句话里「数据集」后面的 8 位编号；用户没写时，就是工作目录（working_directory）最后一段的前 8 位，不用问用户' }
export const sessionOf = exec => {
  const id = exec?.agent?.id ?? exec?.agent?.session?.id
  return id === undefined ? undefined : String(id)
}

/**
 * `crm_status`: where a dataset stands, in a shape the model can read at a glance.
 * With `links`, also how the sheets point at each other (for configuring).
 * @param {import('../core/store.js').Datasets} datasets - shared store.
 * @param {{ links?: boolean }} [options]
 */
export function statusTool(datasets, { links = false } = {}) {
  return {
    name: 'crm_status',
    description: `读一个数据集现在的进度：名字、起点预设、数据截止日、每个数据源有哪些工作表（行数、列数、要先处理和要确认的问题有几条）、每张工作表喂给配置里的哪张表、配置定稿到第几版、有没有草案、定稿的配置和现在的表对不对得上（fit）、最新的数据版本和对账结果、复核还剩多少、下一步该做什么。${links ? '还有 links：插件按值比对出来的表间关联（哪一列、或一格里的哪一段，能在另一张表的哪一列找到，对上多少），写认人和交易找客户时照着用。' : ''}`,
    parameters: { type: 'object', properties: { dataset: datasetParam }, required: ['dataset'] },
    output: { schema: { type: 'object' }, render: (_args, value) => json(value) },
    async execute(args) {
      const id = String(args.dataset ?? '')
      const status = await datasets.status(id)
      if (!links) return status
      const found = await datasets.links(id).catch(() => [])
      return { ...status, links: found.map(l => ({ from: `${l.from.source} · ${l.from.sheet}`, to: `${l.to.source} · ${l.to.sheet} · ${l.to.column}`, kind: l.kind === 'key' ? '编号' : '姓名', rate: l.rate, ...(l.uniqueRate !== undefined ? { uniqueRate: l.uniqueRate } : {}), ...(l.chance !== undefined ? { chance: l.chance } : {}), mapping: l.mapping, plain: l.plain })) }
    },
  }
}
