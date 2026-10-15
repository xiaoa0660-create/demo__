'use client';
import { useState } from 'react';
import { Analysis, focusLabels } from '@/lib/domain';
const colors = [
  '#FF9B54',
  '#A8D8B9',
  '#FFD86B',
  '#FFB3A7',
  '#C7C6E4',
  '#D9CBB9',
  '#BFDADB',
  '#E7CCA7',
];
const typeLabels = {
  claim: '观点',
  fact: '事实',
  reason: '依据',
  question: '疑问',
  goal: '目标',
  action: '行动',
};
export function FocusMap({
  analysis,
  selected,
  corrections = {},
  removedRelations = [],
  onSelect,
}: {
  analysis: Analysis;
  selected?: string | null;
  corrections?: Record<string, string>;
  removedRelations?: string[];
  onSelect?: (id: string) => void;
}) {
  const [inspected, setInspected] = useState<string | null>(null);
  const center = selected || analysis.core_id;
  const points = analysis.points;
  const positions = Object.fromEntries(
    points.map((point, i) => {
      if (point.id === center) return [point.id, [180, 135]];
      const angle = (i * 2 * Math.PI) / points.length - Math.PI / 2;
      return [point.id, [180 + Math.cos(angle) * 115, 132 + Math.sin(angle) * 86]];
    }),
  );
  const point = points.find((p) => p.id === inspected);
  const select = (id: string) => {
    setInspected(id);
    onSelect?.(id);
  };
  return (
    <div className="focus-map">
      <div className="focus-map-header">
        <span>
          <span className="green-dot" />
          思绪聚焦
        </span>
        <span className="tag sand">{focusLabels[analysis.focus_state]}</span>
      </div>
      <svg viewBox="0 0 360 275" role="group" aria-label="基于真实表达的语义结构图">
        <defs>
          <pattern id="focus-grid" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="#d6caba" opacity=".55" />
          </pattern>
        </defs>
        <rect width="360" height="275" fill="url(#focus-grid)" />
        {analysis.relations
          .filter((r) => !removedRelations.includes(`${r.from}:${r.to}`))
          .map((r, i) => (
            <g key={i}>
              <line
                x1={positions[r.from]?.[0]}
                y1={positions[r.from]?.[1]}
                x2={positions[r.to]?.[0]}
                y2={positions[r.to]?.[1]}
                stroke="#b7c8b6"
                strokeWidth="1.5"
              />
              <title>
                {r.type}：{r.quote}
              </title>
            </g>
          ))}
        {points.map((p, i) => {
          const [x, y] = positions[p.id];
          const text = corrections[p.id] || p.text;
          return (
            <g
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`${typeLabels[p.type]}：${text}，查看原话证据`}
              aria-pressed={center === p.id}
              className="focus-node"
              onClick={() => select(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(p.id);
                }
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={center === p.id ? 23 : 15}
                fill={center === p.id ? '#FF9B54' : colors[(i + 1) % colors.length]}
              />
              <circle
                cx={x}
                cy={y}
                r={center === p.id ? 30 : 21}
                fill="none"
                stroke={inspected === p.id ? '#c6743c' : 'transparent'}
                strokeWidth="1"
              />
              <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fill="#564b3e">
                {center === p.id ? '核心' : typeLabels[p.type]}
              </text>
              <text
                x={x}
                y={y + (center === p.id ? 44 : 34)}
                textAnchor="middle"
                fontSize="11"
                fill="#766d61"
              >
                {text.slice(0, 11)}
                {text.length > 11 ? '…' : ''}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="map-evidence" aria-live="polite">
        {point ? (
          <>
            <span>原话证据</span>
            <q>{point.quote}</q>
          </>
        ) : (
          <p>点击圆点，看看它来自哪一句原话。</p>
        )}
      </div>
      {analysis.source === 'local' && (
        <p className="small muted map-footnote">本地分句观察 · 不判断真实语义关系</p>
      )}
    </div>
  );
}
