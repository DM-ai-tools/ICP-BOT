/**
 * The shape of the cross-scenario comparison table.
 *
 * Client-safe: the results view renders this table in the browser, so the row
 * type, the column order and the markdown serialiser live here rather than in
 * compare.ts, which holds the OpenAI call and must never reach the client.
 */

import type { AwarenessKey } from './slots';

export interface ComparisonRow {
  scenario: AwarenessKey;
  awarenessLabel: string;
  dominantBelief: string;
  messageThatLands: string;
  messageThatBackfires: string;
  bestChannel: string;
  primaryObjection: string;
}

export const COMPARISON_COLUMNS: { key: keyof ComparisonRow; label: string }[] = [
  { key: 'awarenessLabel', label: 'Awareness stage' },
  { key: 'dominantBelief', label: 'Dominant belief' },
  { key: 'messageThatLands', label: 'Message that lands' },
  { key: 'messageThatBackfires', label: 'Message that backfires' },
  { key: 'bestChannel', label: 'Best channel' },
  { key: 'primaryObjection', label: 'Primary objection' },
];

export function comparisonToMarkdown(rows: ComparisonRow[], serviceName: string): string {
  const header = [
    `## Awareness map — ${serviceName}`,
    '',
    '| Awareness stage | Dominant belief | Message that lands | Message that backfires | Best channel | Primary objection |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  const body = rows.map((row) =>
    [
      '',
      row.awarenessLabel,
      escapeCell(row.dominantBelief),
      escapeCell(row.messageThatLands),
      escapeCell(row.messageThatBackfires),
      escapeCell(row.bestChannel),
      escapeCell(row.primaryObjection),
      '',
    ]
      .join(' | ')
      .trim(),
  );

  return [...header, ...body].join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}
