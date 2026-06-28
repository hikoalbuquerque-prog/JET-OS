import React from 'react';

const pulse = `@keyframes skel-pulse{0%,100%{opacity:.06}50%{opacity:.12}}`;

export function SkeletonLine({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return <div style={{ width, height, borderRadius: 6, background: 'rgba(255,255,255,.08)', animation: 'skel-pulse 1.5s ease infinite' }} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SkeletonLine width="40%" height={16} />
      {Array.from({ length: lines - 1 }, (_, i) => <SkeletonLine key={i} width={`${70 + (i % 3) * 10}%`} />)}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: 'flex', gap: 12, padding: '10px 12px', background: r === 0 ? 'rgba(255,255,255,.04)' : 'transparent' }}>
          {Array.from({ length: cols }, (_, c) => <SkeletonLine key={c} width={c === 0 ? '30%' : '20%'} height={r === 0 ? 12 : 14} />)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonPulseStyle() {
  return <style>{pulse}</style>;
}
