import { useState } from 'react'
import type { RefObject } from 'react'
import type { Annotation, Baseline } from '../types'
import {
  DIFF_KIND_LABEL,
  rangeLabel,
  type DiffItem,
  type DiffKind,
} from '../lib/snapshot'
import { badgeColor } from '../lib/segments'

interface Props {
  baseline: Baseline | null
  diffs: DiffItem[]
  activeId: string | null
  /** 保存 / 重建基线（重建会清空全部已审记录，由调用方确认） */
  onSaveBaseline: () => void
  onFocus: (a: Annotation) => void
  onToggleReview: (item: DiffItem) => void
  /** 快照对比分区的滚动定位 ref（顶栏按钮用） */
  sectionRef?: RefObject<HTMLElement | null>
}

type KindFilter = 'all' | DiffKind

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 差异卡片头部的一行摘要：新增 / 修改取当前值，删除取基线值 */
function headQuote(item: DiffItem): string {
  return item.current?.quote ?? item.base?.quote ?? ''
}

function DiffCard({
  item,
  active,
  onFocus,
  onToggleReview,
}: {
  item: DiffItem
  active: boolean
  onFocus: (a: Annotation) => void
  onToggleReview: (item: DiffItem) => void
}) {
  const locatable = item.current !== null && item.current.status === 'bound'
  const tags = item.current?.tags ?? item.base?.tags ?? []
  const note = item.current?.note ?? item.base?.note ?? ''

  return (
    <div
      className={`diff-item diff-${item.kind} ${active ? 'diff-item-active' : ''} ${item.reviewed ? 'diff-reviewed' : ''}`}
    >
      <div className="diff-head">
        <span
          className="ann-badge"
          style={{ backgroundColor: badgeColor(item.annotationId) }}
        />
        <span className={`diff-kind diff-kind-${item.kind}`}>
          {DIFF_KIND_LABEL[item.kind]}
        </span>
        <span className="diff-quote" title={headQuote(item)}>
          {item.kind === 'deleted' && <em className="diff-deleted-flag">[已删除] </em>}
          {headQuote(item) || <span className="ann-empty-quote">（空引文）</span>}
        </span>
        {item.reviewed && <span className="diff-reviewed-pill">已审</span>}
      </div>

      {item.kind === 'modified' ? (
        <div className="diff-fields">
          {item.changes.map((c) => (
            <div className="diff-field" key={c.field}>
              <span className="diff-field-label">{c.label}</span>
              <span className="diff-field-values">
                <span className="diff-before" title={c.before}>
                  {c.before}
                </span>
                <span className="diff-arrow">→</span>
                <span className="diff-after" title={c.after}>
                  {c.after}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="diff-fields">
          <div className="diff-field">
            <span className="diff-field-label">区间 / 状态</span>
            <span className="diff-field-values">
              <span className="diff-after">
                {item.kind === 'deleted'
                  ? rangeLabel(item.base!.status, item.base!.start, item.base!.end)
                  : rangeLabel(item.current!.status, item.current!.start, item.current!.end)}
              </span>
            </span>
          </div>
          {tags.length > 0 && (
            <div className="diff-field">
              <span className="diff-field-label">标签</span>
              <span className="diff-field-values">
                <span className="ann-tags diff-tags">
                  {tags.map((t) => (
                    <span className="ann-tag" key={t}>
                      #{t}
                    </span>
                  ))}
                </span>
              </span>
            </div>
          )}
          {note && (
            <div className="diff-field">
              <span className="diff-field-label">备注</span>
              <span className="diff-field-values">
                <span className="diff-after diff-note">{note}</span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="diff-actions">
        {locatable && (
          <button
            className="btn btn-small btn-ghost"
            onClick={() => onFocus(item.current!)}
          >
            定位
          </button>
        )}
        <span className="form-spacer" />
        <button
          className="btn btn-small btn-ghost"
          onClick={() => onToggleReview(item)}
        >
          {item.reviewed ? '取消已审' : '标记已审'}
        </button>
      </div>
    </div>
  )
}

/** 标注快照对比侧栏分区 */
export function SnapshotSection(props: Props) {
  const [filter, setFilter] = useState<KindFilter>('all')
  const { baseline, diffs } = props

  const counts: Record<DiffKind, number> = { added: 0, deleted: 0, modified: 0 }
  diffs.forEach((d) => {
    counts[d.kind] += 1
  })
  const unreviewed = diffs.filter((d) => !d.reviewed).length
  const visible = filter === 'all' ? diffs : diffs.filter((d) => d.kind === filter)

  const filterChip = (kind: KindFilter, label: string, count: number) => (
    <button
      type="button"
      className={`cov-tag ${filter === kind ? 'cov-tag-on' : ''}`}
      aria-pressed={filter === kind}
      onClick={() => setFilter(kind)}
    >
      {label}（{count}）
    </button>
  )

  return (
    <section
      className="side-section"
      ref={(props.sectionRef as React.Ref<HTMLElement>) ?? undefined}
    >
      <div className="side-heading-row">
        <h2 className={`side-heading ${unreviewed > 0 ? 'side-heading-diff' : ''}`}>
          快照对比
          {baseline && unreviewed > 0 && (
            <span className="conflict-count-badge diff-count-badge">{unreviewed}</span>
          )}
        </h2>
        <button
          className="btn btn-small btn-ghost"
          onClick={props.onSaveBaseline}
          title={
            baseline
              ? '以当前标注集覆盖旧基线，并清空全部已审记录'
              : '把当前标注集保存为唯一基线，之后随时对比差异'
          }
        >
          {baseline ? '重建基线' : '保存为基线'}
        </button>
      </div>

      {!baseline ? (
        <p className="side-hint">
          还没有基线。点击「保存为基线」把当前标注集固化下来；之后新增、删除、修改的标注
          都会按稳定 ID 与基线对比并列在这里，可逐项标记已审。
        </p>
      ) : (
        <>
          <p className="side-hint">
            基线保存于 {formatTime(baseline.createdAt)} · {baseline.entries.length} 条标注。
            差异按原文位置排序；内容再次变化会重新出现为未审，恢复成基线则自动移除。
          </p>
          {diffs.length === 0 ? (
            <p className="cov-ok">✓ 当前标注与基线一致，没有差异。</p>
          ) : (
            <>
              <div className="cov-tagpick">
                {filterChip('all', '全部', diffs.length)}
                {filterChip('added', '新增', counts.added)}
                {filterChip('deleted', '删除', counts.deleted)}
                {filterChip('modified', '修改', counts.modified)}
              </div>
              {visible.length === 0 ? (
                <p className="side-hint">该类型下没有差异。</p>
              ) : (
                visible.map((item) => (
                  <DiffCard
                    key={`${item.annotationId}:${item.kind}`}
                    item={item}
                    active={props.activeId === item.annotationId}
                    onFocus={props.onFocus}
                    onToggleReview={props.onToggleReview}
                  />
                ))
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
