/**
 * The master prompt's mandatory output structure, as a machine-readable index.
 *
 * These headings come from the "Output structure (MANDATORY HEADINGS — do not
 * omit sections)" block of prompts/master_icp.md. They live in their own
 * client-safe module because the generator, the validator, the in-document nav
 * and every exporter all need the same view of a document — and the nav runs in
 * the browser, where the prompt-loading half of master-prompt.ts must never go.
 *
 * The authoritative instruction text still reaches the model as the verbatim
 * system message. This is an index of it, never a substitute for it.
 */
export type SectionKey =
  | 'title_line'
  | 'avatar_name'
  | 'jargon_line'
  | 'identity_snapshot'
  | 'current_reality'
  | 'say_out_loud'
  | 'under_the_hood'
  | 'goals'
  | 'pains'
  | 'marketing_problems'
  | 'barriers'
  | 'triggers'
  | 'decision_criteria'
  | 'how_they_research'
  | 'objections'
  | 'market_opportunities'
  | 'success_stories'
  | 'average_deal_value'
  | 'qualification_checklist';

export type SectionKind =
  | 'title'
  | 'oneline'
  | 'narrative'
  | 'objections'
  | 'checklist'
  | 'stories';

export interface SectionSpec {
  key: SectionKey;
  /** Exact heading the model must emit. */
  heading: string;
  /** Markdown level: 1 for the title line, 2 for everything else. */
  level: 1 | 2;
  kind: SectionKind;
  /**
   * Whether a failure here is worth telling the user about.
   *
   * 'critical' sections carry the substance a strategist would actually read —
   * if one is missing or thin, the document is genuinely weaker and that is
   * worth a badge and a sentence.
   *
   * 'cosmetic' sections are structural furniture: the title line, the avatar
   * name, the jargon line. The model legitimately formats these several ways.
   * They still get repaired, but a failure NEVER surfaces and never marks a
   * document failed — reporting one only teaches people to ignore warnings.
   */
  severity: 'critical' | 'cosmetic';
  /**
   * Whether this section is written as enumerated points rather than prose.
   *
   * The framework's own instruction is 'no shallow bullets', and that still
   * holds — these are numbered points each carrying a full, developed passage,
   * not fragments. What changes is only the shape: a reader can scan them,
   * quote one, or lift a single point into a deck, none of which is possible
   * with a 200-word block.
   *
   * Objections and the qualification checklist are already enumerated by the
   * framework and keep their own counts. The title, avatar and jargon lines are
   * single lines and stay that way.
   */
  numbered: boolean;
  /** Which generation pass produces it. */
  pass: 'A' | 'B' | 'C';
  /** Minimum substantive word count. 0 = structural check only. */
  minWords: number;
  /** Extra matching stems, for tolerant heading detection during validation. */
  aliases?: string[];
  /** Guidance used only by the targeted repair/expand call. */
  repairHint: string;
}

export const SECTIONS: SectionSpec[] = [
  {
    key: 'title_line',
    heading: 'Title Line',
    level: 1,
    kind: 'title',
    numbered: false,
    severity: 'cosmetic',
    pass: 'A',
    minWords: 0,
    aliases: ['icp ('],
    repairHint:
      'The single title line in the master prompt format: ICP ({{Awareness Level}}) — {{Company}} | {{Offer}} | {{Price/Terms}} | {{Business Model}} | {{Region}} | {{Company Type}} | {{Audience Type}} | {{Maturity Tier}}',
  },
  {
    key: 'avatar_name',
    heading: 'Avatar Name',
    level: 2,
    kind: 'oneline',
    numbered: false,
    severity: 'cosmetic',
    pass: 'A',
    minWords: 0,
    repairHint: 'FirstName LastName — "Archetype Nickname". One line only.',
  },
  {
    key: 'jargon_line',
    heading: 'Local language & jargon applied',
    level: 2,
    kind: 'oneline',
    numbered: false,
    severity: 'cosmetic',
    pass: 'A',
    minWords: 0,
    aliases: ['local language and jargon applied', 'local language & jargon'],
    repairHint: 'Exactly one line: <Region> + <Industry>. No explanation.',
  },
  {
    key: 'identity_snapshot',
    heading: 'Identity Snapshot',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'A',
    minWords: 120,
    repairHint:
      'B2C: age, location, life stage, occupation, income/financial reality, personality, communication style, privacy sensitivity. B2B: role/title, company type, size/revenue band, location/territory, buyer seniority, committee members, procurement complexity, growth stage, current stack/process. The maturity tier must visibly shape this section.',
  },
  {
    key: 'current_reality',
    heading: "Current Reality (What's happening right now)",
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'A',
    minWords: 120,
    aliases: ['current reality'],
    repairHint:
      'Their day-to-day situation and the context that makes them this exact awareness level. Vivid and specific, full sentences.',
  },
  {
    key: 'say_out_loud',
    heading: 'What They Say Out Loud',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'A',
    minWords: 120,
    repairHint:
      'Real-world phrases they would actually say, in their own voice, in region-appropriate language. Quote them.',
  },
  {
    key: 'under_the_hood',
    heading: "What's Actually True Under the Hood",
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'A',
    minWords: 120,
    aliases: ['whats actually true under the hood', 'what is actually true under the hood'],
    repairHint:
      'Hidden drivers, frustrations and realities they will not admit. For B2B include commercial pressures: margin, utilisation, churn, lead flow, seasonality, staff capacity, compliance, reputation risk.',
  },
  {
    key: 'goals',
    heading: 'Goals and Desired Outcomes',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'B',
    minWords: 120,
    repairHint:
      'Split into Functional Goals, Emotional Goals, and Lifestyle/Operational Goals. For B2B add business outcomes: pipeline, utilisation, revenue stability, CAC, LTV, retention, referrals, operational load.',
  },
  {
    key: 'pains',
    heading: 'Pains, Fears, and Risks',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'B',
    minWords: 120,
    aliases: ['pains fears and risks', 'pains, fears and risks'],
    repairHint:
      'B2C: pain points, anxiety, fear of regret, fear of procedures/quality, time disruption, social confidence. B2B: revenue risk, reputational risk, implementation risk, compliance risk, opportunity cost, vendor lock-in.',
  },
  {
    key: 'marketing_problems',
    heading: 'Marketing Problems They Face',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'B',
    minWords: 150,
    repairHint:
      'A comprehensive, industry-realistic list across the full marketing ecosystem. No predefined checklist. Detailed and specific to the region and industry.',
  },
  {
    key: 'barriers',
    heading: "Barriers and Uncertainties (Why they're stuck)",
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'B',
    minWords: 120,
    aliases: ['barriers and uncertainties'],
    repairHint:
      'What prevents action at this specific awareness level, including misbeliefs and objections.',
  },
  {
    key: 'triggers',
    heading: 'Triggers That Move Them to the Next Level',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'B',
    minWords: 120,
    repairHint:
      'Specific real-life events that cause escalation. For B2B include seasonal triggers, KPI pressure, competitor moves and platform policy changes where relevant.',
  },
  {
    key: 'decision_criteria',
    heading: 'Decision Criteria (How they choose)',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'C',
    minWords: 120,
    aliases: ['decision criteria'],
    repairHint:
      'B2C: trust signals, proof, convenience, outcomes, financing, aftercare. B2B: ROI logic, proof, case studies, integration, onboarding, support, commercial terms.',
  },
  {
    key: 'how_they_research',
    heading: 'How They Research (Channels + behavior)',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'C',
    minWords: 120,
    aliases: ['how they research'],
    repairHint:
      'B2C: Google/YouTube/reviews/social, comparison patterns, who they ask. B2B: LinkedIn, industry groups, vendor demos, peer referrals, forums, conferences, partner directories, tender/procurement steps.',
  },
  {
    key: 'objections',
    heading: 'Objections (Top 8) + What It Really Means',
    level: 2,
    kind: 'objections',
    numbered: false,
    severity: 'critical',
    pass: 'C',
    minWords: 160,
    aliases: ['objections'],
    repairHint:
      'EXACTLY 8 numbered objections. Each is the quoted objection followed by "What it really means:" and the hidden meaning. Framing must match the audience type.',
  },
  {
    key: 'market_opportunities',
    heading: 'Market Opportunities and Positioning',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'C',
    minWords: 120,
    repairHint:
      'Highest-leverage opportunities: unmet needs, competitor gaps, rising demand pockets, trust signals — and how the provider should position to win this segment, aligned to region, maturity tier and awareness level.',
  },
  {
    key: 'success_stories',
    heading: 'Success Stories',
    level: 2,
    kind: 'stories',
    numbered: true,
    severity: 'critical',
    pass: 'C',
    minWords: 120,
    repairHint:
      '2 to 4 realistic mini-narratives, each with a heading or bolded lead-in. No fabricated hard numbers. Compliance-aware language where needed.',
  },
  {
    key: 'average_deal_value',
    heading: 'Average Deal Value of the Service',
    level: 2,
    kind: 'narrative',
    numbered: true,
    severity: 'critical',
    pass: 'C',
    minWords: 80,
    aliases: ['average deal value'],
    repairHint:
      'If price/terms were provided, reflect them exactly and explain how they show up in decision-making. If not provided, state "Average deal value: unknown (price not provided)" and give a Low/Mid/High band structure without inventing numbers.',
  },
  {
    key: 'qualification_checklist',
    heading: 'Qualification Checklist (Fast filters)',
    level: 2,
    kind: 'checklist',
    numbered: false,
    severity: 'critical',
    pass: 'C',
    minWords: 60,
    aliases: ['qualification checklist'],
    repairHint:
      '8 to 12 yes/no qualifiers as a numbered or bulleted list. B2B: include deal-breakers (no budget, wrong vertical, no decision-maker, compliance constraints). B2C: suitability and logistics deal-breakers.',
  },
];

export const SECTIONS_BY_PASS = {
  A: SECTIONS.filter((s) => s.pass === 'A'),
  B: SECTIONS.filter((s) => s.pass === 'B'),
  C: SECTIONS.filter((s) => s.pass === 'C'),
} as const;

export function sectionByKey(key: SectionKey): SectionSpec {
  const found = SECTIONS.find((s) => s.key === key);
  if (!found) throw new Error(`Unknown section key: ${key}`);
  return found;
}

// ---------------------------------------------------------------------------
// Validation report shape
//
// Lives here, not in validate.ts, because the results view renders per-section
// badges in the browser and validate.ts holds the OpenAI repair call.
// ---------------------------------------------------------------------------

export type SectionStatus =
  | 'ok'
  | 'missing'
  | 'thin'
  /** Wrong item count where the framework fixes one. */
  | 'wrong_count'
  /** Present and substantive, but written as prose where points were asked for. */
  | 'unformatted';

export interface SectionReport {
  key: SectionKey;
  heading: string;
  status: SectionStatus;
  words: number;
  /** Objection / checklist / story count where the section has a required count. */
  count?: number;
  expected?: string;
  repaired?: boolean;
}

export interface ValidationReport {
  sections: SectionReport[];
  ok: boolean;
  badge: 'complete' | 'repaired' | 'failed';
  repairedKeys: SectionKey[];
  failedKeys: SectionKey[];
}

export const OBJECTION_COUNT = 8;
export const CHECKLIST_MIN = 8;
export const CHECKLIST_MAX = 12;
export const STORIES_MIN = 2;
export const STORIES_MAX = 4;
