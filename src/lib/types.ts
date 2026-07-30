/**
 * Wire types shared by the route handlers and the React client.
 * Client-safe: no secrets, no server imports.
 */

import type { AwarenessKey, SlotKey, SlotMeta, SlotValues } from './slots';
import type { SectionReport } from './sections';
import type { ComparisonRow } from './comparison';

export type DocumentStatus =
  | 'pending'
  | 'generating'
  | 'complete'
  | 'repaired'
  | 'failed'
  | 'stale';

export interface DocumentSummary {
  id: string;
  serviceIndex: number;
  serviceName: string;
  scenario: AwarenessKey;
  awarenessLabel: string;
  status: DocumentStatus;
  badge: 'complete' | 'repaired' | 'failed' | null;
  wordCount: number;
  errorMessage: string | null;
  masterPromptVersion: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  markdown: string;
  validation: { sections: SectionReport[] } | null;
}

export interface ComparisonSummary {
  serviceIndex: number;
  serviceName: string;
  rows: ComparisonRow[];
  markdown: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface RunState {
  id: string;
  title: string;
  slots: SlotValues;
  slotMeta: SlotMeta;
  missing: SlotKey[];
  ambiguities: string[];
  readiness: {
    briefComplete: boolean;
    awarenessResolved: boolean;
    needsAwarenessModal: boolean;
    readyToGenerate: boolean;
    missingRequired: SlotKey[];
    lowConfidence: SlotKey[];
  };
  regulated: boolean;
  regulatedReason: string | null;
  siteFetchStatus: string | null;
  siteFetchedUrl: string | null;
  masterPromptVersion: string;
  awarenessModalAnswered: boolean;
  awarenessResolvedInChat: boolean;
  documents: DocumentSummary[];
  comparisons: ComparisonSummary[];
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
  createdAt: string;
  updatedAt: string;
}

export interface RunListItem {
  id: string;
  title: string;
  companyName: string | null;
  industry: string | null;
  region: string | null;
  documentCount: number;
  completeCount: number;
  updatedAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// SSE event protocol
// ---------------------------------------------------------------------------

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_end'; messageId: string; content: string }
  | { type: 'state'; state: RunState }
  | { type: 'notice'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done' };

export type GenerateEvent =
  | { type: 'doc_start'; docKey: string; scenario: AwarenessKey; serviceIndex: number; label: string }
  | { type: 'doc_delta'; docKey: string; text: string }
  | { type: 'doc_phase'; docKey: string; phase: 'A' | 'B' | 'C' | 'validating' | 'repairing'; detail?: string }
  | {
      type: 'doc_end';
      docKey: string;
      documentId: string;
      status: DocumentStatus;
      badge: 'complete' | 'repaired' | 'failed';
      markdown: string;
      validation: { sections: SectionReport[] };
    }
  | { type: 'doc_error'; docKey: string; text: string }
  | { type: 'doc_skipped'; docKey: string; documentId: string; reason: string }
  | { type: 'comparison'; comparison: ComparisonSummary }
  | { type: 'state'; state: RunState }
  | { type: 'error'; text: string }
  | { type: 'done' };

export function docKeyFor(serviceIndex: number, scenario: AwarenessKey): string {
  return `${serviceIndex}:${scenario}`;
}
