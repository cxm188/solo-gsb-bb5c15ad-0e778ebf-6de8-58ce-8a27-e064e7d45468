// 核心数据模型

/** 标注状态：已绑定区间 / 待人工处理（重定位失败或最高分并列、得分为 0） */
export type AnnotationStatus = 'bound' | 'pending'

/** 上一次重定位所走的策略 */
export type RelocateReason =
  | 'local-exact' // 旧位置前后 200 字内精确匹配
  | 'unique' // 全文唯一匹配
  | 'context-score' // 前后文相同字符数评分
  | 'failed' // 未找到 / 并列 / 得分为 0

export interface RelocationInfo {
  reason: RelocateReason
  /** 评分命中时的相同字符数（左右连续相同字符之和） */
  score: number
  /** 重定位所基于的旧起点（字符偏移） */
  oldStart: number
  oldEnd: number
  /** 重定位发生时所对照的原文版本（用长度+摘要生成指纹） */
  sourceFingerprint: string
  timestamp: number
}

export interface Annotation {
  id: string
  quote: string
  start: number
  end: number
  note: string
  tags: string[]
  status: AnnotationStatus
  createdAt: number
  updatedAt: number
  /** 创建 / 最近一次成功绑定时截取的上下文（两侧各 CONTEXT_RADIUS 字） */
  contextBefore: string
  contextAfter: string
  /** 上一次自动重定位的诊断信息 */
  lastRelocation?: RelocationInfo
  /** 待处理原因说明（用于界面展示，不参与算法） */
  pendingReason?: string
}

/** 互斥标签对规则：两条已绑定标注区间有字符交集，且标签分别命中同一规则的两侧时构成冲突 */
export interface ConflictRule {
  /** 稳定 ID，忽略签名以此标识「命中规则集合」 */
  id: string
  tagA: string
  tagB: string
  createdAt: number
}

/**
 * 已忽略冲突的签名：
 * 两个标注 ID（按字典序）+ 命中规则 ID 集合（排序）。
 * 不含区间信息——区间重定位后忽略仍然有效；标签 / 规则变化导致集合改变时自动重新出现。
 */
export interface IgnoredConflict {
  annotationIds: [string, string]
  ruleIds: string[]
  createdAt: number
}

/** 基线中一条标注的快照：仅保留参与对比的字段（区间/状态、引文、标签、备注） */
export interface BaselineEntry {
  id: string
  quote: string
  start: number
  end: number
  note: string
  tags: string[]
  status: AnnotationStatus
}

/**
 * 标注基线快照：保存时的完整标注集。
 * 全应用同一时间只有一份基线；重建会覆盖旧基线并清空全部已审记录。
 */
export interface Baseline {
  createdAt: number
  entries: BaselineEntry[]
}

/**
 * 已审阅差异的记录：标注 ID + 差异内容签名。
 * 差异内容（类型 + 逐字段前后值）不变时签名稳定，标记已审持续有效；
 * 内容再次变化产生新签名 → 该差异重新出现为未审；恢复成基线 → 差异项本身消失。
 */
export interface ReviewedDiff {
  annotationId: string
  signature: string
  createdAt: number
}

export interface DocumentData {
  title: string
  text: string
  annotations: Annotation[]
  /** 互斥标签对配置，随文档本地保存 */
  conflictRules: ConflictRule[]
  /** 已忽略冲突的签名记录 */
  ignoredConflicts: IgnoredConflict[]
  /** 标签覆盖审计：应共同覆盖全文的标签集合 */
  coverageTags: string[]
  /** 标注基线快照（唯一）；null 表示尚未保存基线 */
  baseline: Baseline | null
  /** 已审阅差异的签名记录 */
  reviewedDiffs: ReviewedDiff[]
  updatedAt: number
}

/** 导出 JSON 的顶层结构 */
export interface ExportPayload {
  format: 'anchor-annotation-console'
  version: 1
  exportedAt: string
  document: {
    title: string
    text: string
    annotationCount: number
  }
  conflictRules: Array<{
    id: string
    tagA: string
    tagB: string
    createdAt: string
  }>
  ignoredConflicts: Array<{
    annotationIds: [string, string]
    ruleIds: string[]
    createdAt: string
  }>
  /** 标签覆盖审计选择的标签（旧版文件缺省时按空数组处理） */
  coverageTags: string[]
  /** 标注基线快照（旧版文件缺省时按 null 处理） */
  baseline: {
    createdAt: string
    entries: Array<{
      id: string
      status: AnnotationStatus
      quote: string
      note: string
      tags: string[]
      start: number
      end: number
    }>
  } | null
  /** 已审差异记录：标注 ID + 差异内容签名（旧版文件缺省时按空数组处理） */
  reviewedDiffs: Array<{
    annotationId: string
    signature: string
    createdAt: string
  }>
  annotations: Array<{
    id: string
    status: AnnotationStatus
    quote: string
    note: string
    tags: string[]
    position: { start: number; end: number } | null
    context: { before: string; after: string }
    pendingReason: string | null
    lastRelocation: RelocationInfo | null
    createdAt: string
    updatedAt: string
  }>
}
