// 标注快照对比：基线快照、差异计算与已审签名
//
// 用户可把当前标注集保存为唯一基线，之后随时与当前数据比较。
// 按稳定标注 ID 对齐两侧：
//   - 新增：当前存在、基线不存在
//   - 删除：基线存在、当前不存在
//   - 修改：两侧都存在，但参与对比的字段（区间/绑定状态、引文、标签、备注）有差异
// 同一标注只产生一个差异项；修改项逐字段记录前后值。
//
// 已审状态以「标注 ID + 差异内容签名」记录：签名由差异类型与逐字段前后值
// 序列化生成——内容再次变化得到新签名，差异重新以未审出现；
// 恢复成与基线一致时差异项本身消失。重建基线时全部已审记录清空。

import type {
  Annotation,
  AnnotationStatus,
  Baseline,
  BaselineEntry,
  ReviewedDiff,
} from '../types'

/** 差异类型：新增 / 删除 / 修改 */
export type DiffKind = 'added' | 'deleted' | 'modified'

export const DIFF_KIND_LABEL: Record<DiffKind, string> = {
  added: '新增',
  deleted: '删除',
  modified: '修改',
}

/** 参与对比的字段 */
export type DiffField = 'range' | 'quote' | 'tags' | 'note'

/** 修改项中一个字段的前后值 */
export interface FieldChange {
  field: DiffField
  label: string
  /** 基线侧展示值 */
  before: string
  /** 当前侧展示值 */
  after: string
}

/** 一条差异项（同一标注只生成一项） */
export interface DiffItem {
  annotationId: string
  kind: DiffKind
  /** 排序键：当前仍存在用当前区间起点，删除项用基线区间起点 */
  sortStart: number
  /** 当前标注（删除项为 null） */
  current: Annotation | null
  /** 基线条目（新增项为 null） */
  base: BaselineEntry | null
  /** 修改项的逐字段前后值；新增 / 删除为空数组 */
  changes: FieldChange[]
  /** 差异内容签名：类型 + 逐字段前后值的稳定序列化 */
  signature: string
  /** 是否已被用户标记已审（签名命中已审记录） */
  reviewed: boolean
}

/** 把当前标注集固化为基线条目（只保留参与对比的字段） */
export function snapshotAnnotations(annotations: Annotation[]): BaselineEntry[] {
  return annotations.map((a) => ({
    id: a.id,
    quote: a.quote,
    start: a.start,
    end: a.end,
    note: a.note,
    tags: [...a.tags],
    status: a.status,
  }))
}

/** 区间 / 绑定状态的展示值 */
export function rangeLabel(status: AnnotationStatus, start: number, end: number): string {
  return status === 'bound' ? `已绑定 [${start}, ${end})` : '待处理（未绑定）'
}

function tagsLabel(tags: string[]): string {
  return tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : '（无标签）'
}

function noteLabel(note: string): string {
  return note || '（无备注）'
}

function quoteLabel(quote: string): string {
  return quote || '（空引文）'
}

/** 序列化一条快照内容，用于新增 / 删除项的签名 */
function entryContent(e: {
  status: AnnotationStatus
  start: number
  end: number
  quote: string
  tags: string[]
  note: string
}): string {
  return JSON.stringify([e.status, e.start, e.end, e.quote, e.tags, e.note])
}

/** 已审记录的匹配键：标注 ID + 差异内容签名 */
export function reviewedKey(annotationId: string, signature: string): string {
  return `${annotationId}\n${signature}`
}

/**
 * 计算基线与当前标注集的全部差异。
 * 纯函数：不修改传入数据。baseline 为 null 时无差异。
 * 结果按原文位置排序（起点相同再按标注 ID），删除项按基线位置参与排序。
 */
export function computeDiff(
  baseline: Baseline | null,
  annotations: Annotation[],
  reviewed: ReviewedDiff[],
): DiffItem[] {
  if (!baseline) return []
  const reviewedKeys = new Set(
    reviewed.map((r) => reviewedKey(r.annotationId, r.signature)),
  )
  const currentById = new Map(annotations.map((a) => [a.id, a]))
  const baseById = new Map(baseline.entries.map((e) => [e.id, e]))

  const items: DiffItem[] = []

  // 删除与修改：遍历基线
  for (const base of baseline.entries) {
    const cur = currentById.get(base.id)
    if (!cur) {
      const signature = `deleted:${entryContent(base)}`
      items.push({
        annotationId: base.id,
        kind: 'deleted',
        sortStart: base.start,
        current: null,
        base,
        changes: [],
        signature,
        reviewed: reviewedKeys.has(reviewedKey(base.id, signature)),
      })
      continue
    }

    // 逐字段对比，同时累积签名用的原始前后值（避免展示格式造成歧义）
    const changes: FieldChange[] = []
    const sigParts: unknown[] = []
    if (
      base.status !== cur.status ||
      base.start !== cur.start ||
      base.end !== cur.end
    ) {
      changes.push({
        field: 'range',
        label: '区间 / 状态',
        before: rangeLabel(base.status, base.start, base.end),
        after: rangeLabel(cur.status, cur.start, cur.end),
      })
      sigParts.push([
        'range',
        [base.status, base.start, base.end],
        [cur.status, cur.start, cur.end],
      ])
    }
    if (base.quote !== cur.quote) {
      changes.push({
        field: 'quote',
        label: '引文',
        before: quoteLabel(base.quote),
        after: quoteLabel(cur.quote),
      })
      sigParts.push(['quote', base.quote, cur.quote])
    }
    if (
      base.tags.length !== cur.tags.length ||
      base.tags.some((t, i) => t !== cur.tags[i])
    ) {
      changes.push({
        field: 'tags',
        label: '标签',
        before: tagsLabel(base.tags),
        after: tagsLabel(cur.tags),
      })
      sigParts.push(['tags', base.tags, cur.tags])
    }
    if (base.note !== cur.note) {
      changes.push({
        field: 'note',
        label: '备注',
        before: noteLabel(base.note),
        after: noteLabel(cur.note),
      })
      sigParts.push(['note', base.note, cur.note])
    }

    if (changes.length === 0) continue // 与基线一致：无差异项
    const signature = `modified:${JSON.stringify(sigParts)}`
    items.push({
      annotationId: base.id,
      kind: 'modified',
      sortStart: cur.start,
      current: cur,
      base,
      changes,
      signature,
      reviewed: reviewedKeys.has(reviewedKey(base.id, signature)),
    })
  }

  // 新增：当前存在但基线没有
  for (const cur of annotations) {
    if (baseById.has(cur.id)) continue
    const signature = `added:${entryContent(cur)}`
    items.push({
      annotationId: cur.id,
      kind: 'added',
      sortStart: cur.start,
      current: cur,
      base: null,
      changes: [],
      signature,
      reviewed: reviewedKeys.has(reviewedKey(cur.id, signature)),
    })
  }

  items.sort(
    (x, y) =>
      x.sortStart - y.sortStart ||
      (x.annotationId < y.annotationId
        ? -1
        : x.annotationId > y.annotationId
          ? 1
          : 0),
  )
  return items
}

/** 兼容数字与时间字符串两种存储形态（本地保存为数字，导出 JSON 为 ISO 字符串） */
function toTime(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  return Date.now()
}

/** 清洗基线数据：旧数据缺字段或结构损坏时返回 null（视为无基线） */
export function normalizeBaseline(raw: unknown): Baseline | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Partial<Baseline>
  if (!Array.isArray(b.entries)) return null
  const entries: BaselineEntry[] = []
  for (const x of b.entries) {
    if (!x || typeof x !== 'object') continue
    const e = x as Partial<BaselineEntry>
    if (typeof e.id !== 'string' || !e.id) continue
    entries.push({
      id: e.id,
      quote: typeof e.quote === 'string' ? e.quote : '',
      start: typeof e.start === 'number' ? e.start : 0,
      end: typeof e.end === 'number' ? e.end : 0,
      note: typeof e.note === 'string' ? e.note : '',
      tags: Array.isArray(e.tags) ? e.tags.map(String).filter(Boolean) : [],
      status: e.status === 'pending' ? 'pending' : 'bound',
    })
  }
  return { createdAt: toTime(b.createdAt), entries }
}

/** 清洗已审记录：标注 ID 与签名都必须是非空字符串，同键去重（保留先出现的） */
export function normalizeReviewedDiffs(raw: unknown): ReviewedDiff[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ReviewedDiff[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const r = x as Partial<ReviewedDiff>
    if (typeof r.annotationId !== 'string' || !r.annotationId) continue
    if (typeof r.signature !== 'string' || !r.signature) continue
    const key = reviewedKey(r.annotationId, r.signature)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      annotationId: r.annotationId,
      signature: r.signature,
      createdAt: toTime(r.createdAt),
    })
  }
  return out
}

/**
 * 清理已审记录：标注 ID 既不在当前标注集也不在基线中时，
 * 对应差异不可能再出现（如新增后被删除），记录随之失效。
 * 注意：仅因签名不再匹配不清理（与忽略签名同理，内容复原后仍命中）。
 */
export function pruneReviewed(
  reviewed: ReviewedDiff[],
  baseline: Baseline | null,
  annotations: Annotation[],
): ReviewedDiff[] {
  const ids = new Set(annotations.map((a) => a.id))
  if (baseline) for (const e of baseline.entries) ids.add(e.id)
  return reviewed.filter((r) => ids.has(r.annotationId))
}
