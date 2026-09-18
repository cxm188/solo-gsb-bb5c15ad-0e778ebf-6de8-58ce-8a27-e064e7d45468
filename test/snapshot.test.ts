import assert from 'node:assert'
import {
  computeDiff,
  normalizeBaseline,
  normalizeReviewedDiffs,
  pruneReviewed,
  snapshotAnnotations,
} from '../src/lib/snapshot'
import type { Annotation, Baseline, ReviewedDiff } from '../src/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

let seq = 0
function ann(
  id: string | undefined,
  start: number,
  end: number,
  overrides: Partial<Annotation> = {},
): Annotation {
  seq += 1
  return {
    id: id ?? `a${seq}`,
    quote: '',
    start,
    end,
    note: '',
    tags: [],
    status: 'bound',
    createdAt: 0,
    updatedAt: 0,
    contextBefore: '',
    contextAfter: '',
    ...overrides,
  }
}

function baselineOf(annotations: Annotation[], createdAt = 1000): Baseline {
  return { createdAt, entries: snapshotAnnotations(annotations) }
}

function reviewedOf(items: Array<{ annotationId: string; signature: string }>): ReviewedDiff[] {
  return items.map((x, i) => ({ ...x, createdAt: 2000 + i }))
}

// 1. 无基线 → 无差异
check('未保存基线时不产生差异', () => {
  const items = computeDiff(null, [ann('x', 0, 5)], [])
  assert.strictEqual(items.length, 0)
})

// 2. 基线与当前一致 → 无差异
check('当前与基线一致时没有差异项', () => {
  const ans = [
    ann('a', 0, 5, { quote: '甲乙丙丁戊', tags: ['X'], note: 'n1' }),
    ann('b', 8, 12, { quote: 'qrst', status: 'pending' }),
  ]
  const items = computeDiff(baselineOf(ans), ans, [])
  assert.strictEqual(items.length, 0)
})

// 3. 新增：当前多出的标注按 ID 归为新增
check('当前多出的标注归为「新增」', () => {
  const base = baselineOf([ann('a', 0, 5)])
  const cur = [ann('a', 0, 5), ann('b', 10, 14, { quote: '新引文', tags: ['T'] })]
  const items = computeDiff(base, cur, [])
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].kind, 'added')
  assert.strictEqual(items[0].annotationId, 'b')
  assert.strictEqual(items[0].current?.quote, '新引文')
  assert.strictEqual(items[0].base, null)
})

// 4. 删除：基线有、当前没有 → 删除项，保留基线数据（引文可展示）
check('基线有而当前没有的标注归为「删除」，保留基线引文', () => {
  const gone = ann('a', 3, 8, { quote: '被删引文', tags: ['旧'], note: '旧备注' })
  const items = computeDiff(baselineOf([gone]), [], [])
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].kind, 'deleted')
  assert.strictEqual(items[0].current, null)
  assert.strictEqual(items[0].base?.quote, '被删引文')
  assert.deepStrictEqual(items[0].base?.tags, ['旧'])
  assert.strictEqual(items[0].sortStart, 3) // 删除项按基线位置排序
})

// 5. 修改：逐字段列出区间/状态、引文、标签、备注前后值，同一标注只生成一项
check('修改项逐字段列出前后值，同一标注仅一项', () => {
  const before = ann('a', 0, 5, {
    quote: '旧引文',
    tags: ['A', 'B'],
    note: '旧备注',
  })
  const after = ann('a', 2, 9, {
    quote: '新引文',
    tags: ['B', 'C'],
    note: '新备注',
  })
  const items = computeDiff(baselineOf([before]), [after], [])
  assert.strictEqual(items.length, 1)
  const item = items[0]
  assert.strictEqual(item.kind, 'modified')
  assert.deepStrictEqual(
    item.changes.map((c) => c.field),
    ['range', 'quote', 'tags', 'note'],
  )
  const byField = new Map(item.changes.map((c) => [c.field, c]))
  assert.strictEqual(byField.get('range')!.before, '已绑定 [0, 5)')
  assert.strictEqual(byField.get('range')!.after, '已绑定 [2, 9)')
  assert.strictEqual(byField.get('quote')!.before, '旧引文')
  assert.strictEqual(byField.get('quote')!.after, '新引文')
  assert.strictEqual(byField.get('tags')!.before, '#A #B')
  assert.strictEqual(byField.get('tags')!.after, '#B #C')
  assert.strictEqual(byField.get('note')!.before, '旧备注')
  assert.strictEqual(byField.get('note')!.after, '新备注')
})

// 6. 未变字段不出现在修改明细中
check('未变化的字段不出现在修改明细', () => {
  const before = ann('a', 0, 5, { quote: 'q', tags: ['A'], note: 'n' })
  const after = ann('a', 0, 5, { quote: 'q', tags: ['A'], note: '改了' })
  const items = computeDiff(baselineOf([before]), [after], [])
  assert.strictEqual(items.length, 1)
  assert.deepStrictEqual(
    items[0].changes.map((c) => c.field),
    ['note'],
  )
})

// 7. 绑定状态变化（bound → pending）算「区间 / 状态」修改
check('绑定状态变化归入「区间 / 状态」字段', () => {
  const before = ann('a', 0, 5)
  const after = ann('a', 0, 5, { status: 'pending' })
  const items = computeDiff(baselineOf([before]), [after], [])
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].changes.length, 1)
  assert.strictEqual(items[0].changes[0].field, 'range')
  assert.strictEqual(items[0].changes[0].before, '已绑定 [0, 5)')
  assert.strictEqual(items[0].changes[0].after, '待处理（未绑定）')
})

// 8. 恢复成基线 → 差异项移除
check('恢复成基线内容后差异项消失', () => {
  const before = ann('a', 0, 5, { note: '原备注' })
  const base = baselineOf([before])
  const changed = ann('a', 0, 5, { note: '改过' })
  assert.strictEqual(computeDiff(base, [changed], []).length, 1)
  const reverted = ann('a', 0, 5, { note: '原备注' })
  assert.strictEqual(computeDiff(base, [reverted], []).length, 0)
})

// 9. 已审签名命中 → reviewed；内容再次变化 → 新签名重新出现为未审
check('已审状态按「标注 ID + 差异内容签名」命中，内容再变重新出现', () => {
  const before = ann('a', 0, 5, { note: 'n0' })
  const base = baselineOf([before])
  const v1 = ann('a', 0, 5, { note: 'n1' })
  const first = computeDiff(base, [v1], [])
  assert.strictEqual(first[0].reviewed, false)

  // 标记已审
  const reviewed = reviewedOf([
    { annotationId: 'a', signature: first[0].signature },
  ])
  const again = computeDiff(base, [v1], reviewed)
  assert.strictEqual(again[0].reviewed, true, '签名不变时保持已审')

  // 内容再次变化 → 新签名 → 重新出现为未审
  const v2 = ann('a', 0, 5, { note: 'n2' })
  const next = computeDiff(base, [v2], reviewed)
  assert.strictEqual(next.length, 1)
  assert.strictEqual(next[0].reviewed, false, '内容变化后必须重新出现')
  assert.notStrictEqual(next[0].signature, first[0].signature)
})

// 10. 新增项内容变化同样使已审失效
check('新增项内容变化后已审签名失效', () => {
  const base = baselineOf([])
  const v1 = [ann('a', 0, 5, { note: 'x' })]
  const first = computeDiff(base, v1, [])
  const reviewed = reviewedOf([
    { annotationId: 'a', signature: first[0].signature },
  ])
  assert.strictEqual(computeDiff(base, v1, reviewed)[0].reviewed, true)
  const v2 = [ann('a', 0, 6, { note: 'x' })] // 区间变化
  assert.strictEqual(computeDiff(base, v2, reviewed)[0].reviewed, false)
})

// 11. 排序：按原文位置（删除项按基线位置），与数组顺序无关
check('差异项按原文位置排序（删除项按基线位置）', () => {
  const base = baselineOf([
    ann('del', 1, 3, { quote: '删' }),
    ann('mod', 10, 15, { note: '旧' }),
  ])
  const cur = [
    ann('add', 4, 6),
    ann('mod', 12, 18, { note: '新' }), // 位置也移动了
  ]
  const items = computeDiff(base, cur, [])
  assert.deepStrictEqual(
    items.map((i) => [i.annotationId, i.kind]),
    [
      ['del', 'deleted'], // 基线位置 1
      ['add', 'added'], // 位置 4
      ['mod', 'modified'], // 当前位置 12
    ],
  )
})

// 12. 混合场景：同一标注只产生一项，三类差异可同时存在
check('同一标注只生成一个差异项，三类差异并存', () => {
  const base = baselineOf([
    ann('keep', 0, 2),
    ann('mod', 5, 8, { note: '旧' }),
    ann('del', 20, 25),
  ])
  const cur = [
    ann('keep', 0, 2),
    ann('mod', 5, 8, { note: '新', tags: ['T'] }), // 备注 + 标签都变 → 仍一项
    ann('new', 30, 33),
  ]
  const items = computeDiff(base, cur, [])
  assert.strictEqual(items.length, 3)
  assert.strictEqual(items.filter((i) => i.annotationId === 'mod').length, 1)
  const mod = items.find((i) => i.annotationId === 'mod')!
  assert.deepStrictEqual(
    mod.changes.map((c) => c.field),
    ['tags', 'note'],
  )
  assert.ok(items.some((i) => i.kind === 'added'))
  assert.ok(items.some((i) => i.kind === 'deleted'))
})

// 13. 签名稳定性：同样的差异内容 → 同样的签名（可持久化匹配）
check('差异内容签名稳定且随内容变化', () => {
  const base = baselineOf([ann('a', 0, 5, { note: 'n0' })])
  const v1 = [ann('a', 0, 5, { note: 'n1' })]
  const s1 = computeDiff(base, v1, [])[0].signature
  const s2 = computeDiff(base, v1, [])[0].signature
  assert.strictEqual(s1, s2)
  const s3 = computeDiff(base, [ann('a', 0, 5, { note: 'n2' })], [])[0].signature
  assert.notStrictEqual(s1, s3)
})

// 14. normalizeBaseline：旧数据 / 脏数据兼容
check('normalizeBaseline：缺字段与脏数据兼容为空', () => {
  assert.strictEqual(normalizeBaseline(undefined), null)
  assert.strictEqual(normalizeBaseline(null), null)
  assert.strictEqual(normalizeBaseline({}), null)
  assert.strictEqual(normalizeBaseline({ entries: 'nope' }), null)
  const b = normalizeBaseline({
    createdAt: '2026-09-18T00:00:00.000Z',
    entries: [
      { id: 'a', quote: 'q', start: 1, end: 2, note: 'n', tags: ['T', 9, ''], status: 'pending' },
      { id: '', quote: '无 id 丢弃' },
      'garbage',
      { id: 'b' }, // 缺字段补默认
    ],
  })!
  assert.ok(b)
  assert.strictEqual(b.entries.length, 2)
  assert.strictEqual(b.createdAt, Date.parse('2026-09-18T00:00:00.000Z'))
  assert.deepStrictEqual(b.entries[0].tags, ['T', '9'])
  assert.strictEqual(b.entries[0].status, 'pending')
  assert.deepStrictEqual(b.entries[1], {
    id: 'b',
    quote: '',
    start: 0,
    end: 0,
    note: '',
    tags: [],
    status: 'bound',
  })
})

// 15. normalizeReviewedDiffs：清洗、去重
check('normalizeReviewedDiffs：非法记录丢弃、同键去重', () => {
  assert.deepStrictEqual(normalizeReviewedDiffs(undefined), [])
  assert.deepStrictEqual(normalizeReviewedDiffs('x'), [])
  const out = normalizeReviewedDiffs([
    { annotationId: 'a', signature: 's1', createdAt: 5 },
    { annotationId: 'a', signature: 's1', createdAt: 6 }, // 重复键 → 丢弃
    { annotationId: '', signature: 's2' }, // 无 ID → 丢弃
    { annotationId: 'b' }, // 无签名 → 丢弃
    { annotationId: 'b', signature: 's3', createdAt: '2026-09-18T00:00:00.000Z' },
  ])
  assert.strictEqual(out.length, 2)
  assert.strictEqual(out[0].createdAt, 5)
  assert.strictEqual(out[1].createdAt, Date.parse('2026-09-18T00:00:00.000Z'))
})

// 16. pruneReviewed：ID 既不在当前也不在基线 → 移除
check('pruneReviewed：引用已消失标注的记录被清理', () => {
  const base = baselineOf([ann('inBase', 0, 2)])
  const cur = [ann('inCur', 0, 2)]
  const reviewed = reviewedOf([
    { annotationId: 'inBase', signature: 's1' }, // 基线中（删除项）→ 保留
    { annotationId: 'inCur', signature: 's2' }, // 当前中 → 保留
    { annotationId: 'gone', signature: 's3' }, // 两侧都没有 → 清理
  ])
  const kept = pruneReviewed(reviewed, base, cur)
  assert.deepStrictEqual(
    kept.map((r) => r.annotationId),
    ['inBase', 'inCur'],
  )
  // 无基线时仅保留当前仍存在的
  const kept2 = pruneReviewed(reviewed, null, cur)
  assert.deepStrictEqual(
    kept2.map((r) => r.annotationId),
    ['inCur'],
  )
})

// 17. 重建基线语义：以当前为准重新快照后差异清零
check('重建基线后差异清零', () => {
  const base = baselineOf([ann('a', 0, 5, { note: '旧' })])
  const cur = [ann('a', 0, 5, { note: '新' }), ann('b', 9, 12)]
  assert.strictEqual(computeDiff(base, cur, []).length, 2)
  const rebuilt = baselineOf(cur)
  assert.strictEqual(computeDiff(rebuilt, cur, []).length, 0)
})

console.log(`\n全部 ${passed} 项通过`)
