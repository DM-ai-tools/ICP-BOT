/**
 * Hand-written packs for the verticals Traffic Radius actually sells into.
 *
 * These exist because a generated pack is good and a written one is better.
 * For the handful of industries that make up most of the work, the language,
 * the roles and the objections are known precisely — there is no reason to pay
 * a model to approximate them, and no reason to accept the variance.
 *
 * Anything not listed here falls through to generation, so coverage is never
 * limited to this file.
 *
 * Client-safe: the panel shows which curated pack matched.
 */

import type { IndustryPackContent } from './industry-types';

export interface CuratedPack {
  id: string;
  label: string;
  /**
   * Matched against the normalised industry text. Written as alternations so a
   * single expression covers the phrasings people actually type.
   */
  match: RegExp;
  /** Only apply to this business model, where the vertical differs sharply. */
  businessModel?: 'b2b' | 'b2c';
  content: IndustryPackContent;
}

export const CURATED_PACKS: CuratedPack[] = [
  // -------------------------------------------------------------------------
  {
    id: 'dental',
    label: 'Dental practices',
    match: /\b(dental|dentist|dentistry|orthodont|endodont|periodont|prosthodont|oral health|denture)/i,
    content: {
      summary:
        'Owner-operated clinical businesses where revenue is bounded by chair time and clinician hours. The principal is usually still treating patients, so anything that demands their attention competes directly with billable time.',
      jargon: [
        { term: 'chair time', meaning: 'the real capacity constraint — an empty chair is unrecoverable revenue' },
        { term: 'case acceptance', meaning: 'the proportion of proposed treatment plans patients actually agree to' },
        { term: 'treatment plan', meaning: 'the sequenced quote presented to a patient after examination' },
        { term: 'recalls', meaning: 'scheduled return visits; the backbone of predictable revenue' },
        { term: 'hygiene book', meaning: 'the hygienist appointment schedule, watched as a leading indicator' },
        { term: 'practice manager', meaning: 'runs operations and very often owns the marketing relationship' },
        { term: 'principal dentist', meaning: 'the owner-clinician who signs off spend' },
        { term: 'day book', meaning: 'the daily appointment schedule' },
        { term: 'billings', meaning: 'gross production, usually tracked per clinician' },
        { term: 'lab fees', meaning: 'external laboratory costs that eat directly into margin' },
        { term: 'FTA / UTA', meaning: 'failed-to-attend and unable-to-attend; the gaps that destroy a day' },
        { term: 'new patient flow', meaning: 'the metric most owners actually judge marketing on' },
      ],
      roles: [
        'Principal dentist / practice owner',
        'Practice manager',
        'Associate dentist',
        'Oral health therapist / hygienist',
        'Treatment coordinator',
        'Front-of-house / reception lead',
      ],
      buyingTriggers: [
        'A new corporate or franchise clinic opens nearby and new-patient numbers dip',
        'An associate leaves and takes a portion of the patient base with them',
        'Investment in a new chair, scanner or CBCT that now has to be kept busy',
        'A quiet January or post-holiday period exposing how thin the recall book is',
        'Health-fund and preventive-care periods approaching with unfilled capacity',
        'Moving or expanding premises and needing to rebuild local visibility',
        'Being burned by a previous agency that reported traffic but not new patients',
      ],
      seasonality: [
        'Post-Christmas and January are traditionally quiet and painful for cash flow',
        'End of calendar year brings a rush as private health extras limits expire',
        'School holidays shift family and orthodontic bookings',
        'End of financial year drives equipment purchases and budget decisions',
      ],
      dealShapes: [
        'Monthly retainers, usually on a minimum term, with a separate ad budget',
        'Setup or onboarding fee ahead of ongoing work',
        'Per-location pricing for multi-site groups',
        'Reporting cadence tied to new patient numbers rather than rankings',
      ],
      researchChannels: [
        'Word of mouth from other practice owners, which outranks almost everything',
        'Dental study clubs and peer groups',
        'Industry press and dental association communications',
        'Facebook groups for practice owners and practice managers',
        'Conferences and trade exhibitions',
        'Practice management software vendor ecosystems and referrals',
        'Google searches for dental-specific agencies rather than general ones',
      ],
      competitorArchetypes: [
        'Generalist local agencies with no clinical understanding',
        'Dental-specialist agencies that already speak the language',
        'Practice management software vendors bundling marketing',
        'Freelancers and offshore providers competing on price',
        'The owner or practice manager attempting it in-house',
      ],
      commonObjections: [
        'We tried an agency before and got traffic but no new patients',
        'We are already booked out, so why would we market',
        'Our patients come from word of mouth, not the internet',
        'I do not have time to be involved in this every week',
        'Can you guarantee a specific number of new patients',
        'The last agency locked us into a contract we could not exit',
        'How do I know these leads are not just price shoppers',
      ],
      metricsThatMatter: [
        'New patient numbers per month',
        'Chair utilisation and unfilled appointment slots',
        'Case acceptance rate',
        'Recall attendance and reactivation',
        'Cost per new patient',
        'Average treatment value per patient',
        'Failed-to-attend rate',
      ],
      regulatoryNotes: [
        'Advertising is governed by AHPRA-style rules in AU: no testimonials about clinical services, no misleading claims, no offers that encourage indiscriminate treatment',
        'Outcome guarantees around clinical results must be avoided entirely',
        'Before-and-after imagery is heavily restricted in many jurisdictions',
        'Use compliance-aware framing: "may", "varies", "subject to suitability", "general information only"',
      ],
      cautions: [
        'Never imply a clinical outcome or promise a treatment result',
        'Do not treat patients and practice owners as the same audience — the buyer here is the practice',
        'Avoid promising ranking positions; owners have heard it and stopped believing it',
        'Do not caricature the owner as unsophisticated; most have run a business for years',
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'trades-home-services',
    label: 'Trades and home services',
    match:
      /\b(plumb|electric|hvac|air ?con|roofing|builder|building and pest|pest control|landscap|handyman|carpenter|concret|fencing|painter|locksmith|garage door|solar install|tiler|glazier|gutter)/i,
    content: {
      summary:
        'Van-based service businesses where revenue is bounded by crew hours and travel time. Work arrives in bursts, is often urgent, and the owner is frequently still on the tools while trying to run the business.',
      jargon: [
        { term: 'callout fee', meaning: 'the charge to attend, often credited against the job if it proceeds' },
        { term: 'quote-to-booking', meaning: 'the conversion step owners feel most acutely' },
        { term: 'job value', meaning: 'average revenue per completed job' },
        { term: 'first-time fix', meaning: 'resolving on the first visit; drives margin and reviews' },
        { term: 'truck roll', meaning: 'the cost of physically sending a van to a site' },
        { term: 'after-hours rate', meaning: 'premium pricing for urgent out-of-hours attendance' },
        { term: 'compliance certificate', meaning: 'the certificate issued after regulated work' },
        { term: 'service area', meaning: 'the radius they will travel, which caps realistic demand' },
        { term: 'make-safe', meaning: 'the immediate emergency response before a full repair' },
        { term: 'strata', meaning: 'body-corporate managed properties; repeat commercial-style work' },
      ],
      roles: [
        'Owner-operator',
        'Operations or scheduling manager',
        'Lead tradesperson / foreman',
        'Office administrator taking calls',
        'Estimator on larger jobs',
      ],
      buyingTriggers: [
        'A quiet stretch after a busy season with vans sitting idle',
        'Hiring an additional crew or buying another van that must be kept busy',
        'Losing a major commercial or strata contract that was underwriting the month',
        'A competitor appearing at the top of local search for emergency terms',
        'Seasonal weather events driving urgent demand they were not visible for',
        'Wanting to shift from low-value callouts to higher-value installs',
      ],
      seasonality: [
        'Weather drives everything — storms, heatwaves and cold snaps create demand spikes',
        'Summer and winter extremes govern heating, cooling and burst-pipe work',
        'Christmas through January is quiet for planned work but busy for emergencies',
        'Property transaction season lifts inspection and compliance work',
      ],
      dealShapes: [
        'Monthly retainer with a separate, clearly reported ad spend',
        'Performance framing tied to booked jobs rather than clicks',
        'Short initial terms because trust has usually been broken before',
        'Seasonal budget flexing around demand peaks',
      ],
      researchChannels: [
        'Google search on a phone, usually at the moment of need',
        'Google Business Profile reviews and the local map pack',
        'Word of mouth between trades and from real estate agents',
        'Supplier and wholesaler networks',
        'Facebook community groups and local recommendation threads',
        'Trade association directories',
      ],
      competitorArchetypes: [
        'Large franchised operators with heavy ad budgets',
        'Lead-generation marketplaces reselling the same enquiry to several trades',
        'Local single-van competitors undercutting on price',
        'National service aggregators',
      ],
      commonObjections: [
        'I already get all my work from word of mouth',
        'I tried a lead site and got rubbish leads sold to three other blokes',
        'I am flat out already and cannot take more work',
        'I do not have time to answer more calls or chase quotes',
        'How do I know the calls are real jobs and not tyre-kickers',
        'I am not paying for clicks, I want jobs',
      ],
      metricsThatMatter: [
        'Booked jobs per week',
        'Cost per booked job',
        'Average job value',
        'Quote-to-booking conversion rate',
        'Crew utilisation and idle van time',
        'Review volume and rating',
        'Emergency response time',
      ],
      regulatoryNotes: [
        'Licence numbers must generally be displayed in advertising for regulated trades',
        'Claims about compliance, safety or certification must be accurate and current',
        'Avoid guarantees about outcomes that depend on site conditions',
      ],
      cautions: [
        'Do not write this buyer as unsophisticated because they work with their hands',
        'Avoid marketing abstractions — brand awareness and impressions mean nothing here; jobs do',
        'Never imply they should take work outside their licensed scope',
        'Respect that capacity, not demand, is often the real constraint',
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'legal',
    label: 'Legal services',
    match: /\b(law|legal|lawyer|solicitor|barrister|attorney|conveyanc|paralegal|litigat|family law|criminal law)/i,
    content: {
      summary:
        'Professional practices where revenue is bounded by billable hours or fixed-fee matter volume, and where reputation and referral relationships historically did the work marketing is now being asked to do.',
      jargon: [
        { term: 'matter', meaning: 'a single client engagement; the unit of work and revenue' },
        { term: 'billables', meaning: 'time recorded against a matter and actually recoverable' },
        { term: 'fixed fee', meaning: 'a set price for a defined scope, increasingly expected by clients' },
        { term: 'retainer', meaning: 'funds held on account before work commences' },
        { term: 'conflict check', meaning: 'the mandatory check before accepting a new client' },
        { term: 'referral network', meaning: 'accountants, brokers and other firms who send work' },
        { term: 'cost agreement', meaning: 'the disclosure document setting out fees' },
        { term: 'practice area', meaning: 'the specialisation, which entirely changes the buyer' },
        { term: 'trust account', meaning: 'the regulated account holding client money' },
        { term: 'intake', meaning: 'the process of converting an enquiry into an engaged client' },
      ],
      roles: [
        'Managing partner / principal',
        'Practice group leader',
        'Practice manager or general manager',
        'Marketing or business development manager in larger firms',
        'Senior associate building a personal practice',
      ],
      buyingTriggers: [
        'A key referral source drying up or retiring',
        'Launching or growing a new practice area that has no reputation behind it',
        'A partner departing and taking client relationships with them',
        'Competitors visibly advertising in a practice area they own',
        'Regulatory or legislative change creating a wave of new demand',
        'Pressure to reduce dependence on a single institutional client',
      ],
      seasonality: [
        'End of financial year drives commercial, tax and structuring work',
        'Family law enquiry volume rises noticeably after holiday periods',
        'Property matters follow the residential transaction cycle',
        'Court vacation periods slow litigation timelines',
      ],
      dealShapes: [
        'Monthly retainer with quarterly strategy reviews',
        'Per-practice-area scoping rather than one firm-wide programme',
        'Longer decision cycles with partner or committee sign-off',
        'Emphasis on qualified enquiry volume rather than raw traffic',
      ],
      researchChannels: [
        'Peer referral and partner networks',
        'Law society and bar association channels',
        'LinkedIn, which is genuinely used in this profession',
        'Legal directories and peer-review rankings',
        'CPD events and industry conferences',
        'Accountants and financial advisers as reciprocal referrers',
      ],
      competitorArchetypes: [
        'Large full-service firms with in-house marketing teams',
        'Boutique specialists in a single practice area',
        'Low-cost online and fixed-fee legal services',
        'Legal-specialist marketing agencies',
      ],
      commonObjections: [
        'Our work comes from referrals and reputation, not advertising',
        'Marketing feels inconsistent with how a professional firm should present',
        'The partners will never agree on this',
        'Enquiries from the internet are usually unqualified time-wasters',
        'We tried this and got volume but nothing worth engaging',
        'Our compliance obligations make most of this impossible',
      ],
      metricsThatMatter: [
        'Qualified enquiries per practice area',
        'Cost per engaged matter',
        'Average matter value',
        'Enquiry-to-engagement conversion rate',
        'Referral source mix and concentration risk',
        'Fee earner utilisation',
      ],
      regulatoryNotes: [
        'Legal advertising rules restrict claims of specialisation and comparative superiority',
        'Testimonials and outcome claims are constrained or prohibited in many jurisdictions',
        'Never imply a guaranteed legal outcome',
        'Use compliance-aware framing throughout: "may", "depends on circumstances", "general information only, not legal advice"',
      ],
      cautions: [
        'Do not use consumer-grade urgency tactics; they read as unprofessional and risk breach',
        'Never promise case outcomes or settlement figures',
        'Recognise that partners are peers, not novices, and dislike being sold to',
        'Different practice areas are different businesses — do not blend them',
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'allied-health',
    label: 'Allied health and medical',
    match:
      /\b(physio|chiro|podiat|osteopath|psycholog|dietit|nutrition|speech path|occupational therap|medical (?:centre|practice|clinic)|gp clinic|general practice|skin clinic|cosmetic clinic|ivf|optomet|audiolog|veterinar)/i,
    content: {
      summary:
        'Clinician-led practices where capacity is measured in appointment slots and the owner is usually still seeing patients. Referral relationships and funding schemes often matter more than direct advertising.',
      jargon: [
        { term: 'books', meaning: 'the appointment schedule; being "fully booked" is the goal and the constraint' },
        { term: 'referral pathway', meaning: 'how patients arrive via GPs or other practitioners' },
        { term: 'care plan', meaning: 'a funded, structured course of treatment' },
        { term: 'bulk billing', meaning: 'billing the public scheme directly with no patient gap' },
        { term: 'gap fee', meaning: 'what the patient pays beyond the rebate' },
        { term: 'rebate', meaning: 'the amount recoverable from a public scheme or private fund' },
        { term: 'DNA / no-show', meaning: 'a missed appointment; direct lost capacity' },
        { term: 'practitioner utilisation', meaning: 'how full each clinician is' },
        { term: 'scope of practice', meaning: 'what a practitioner may legally treat' },
        { term: 'recall', meaning: 'bringing a patient back for review or ongoing care' },
      ],
      roles: [
        'Practice principal / clinical director',
        'Practice manager',
        'Associate practitioner',
        'Reception and intake team',
        'Referral coordinator',
      ],
      buyingTriggers: [
        'Adding a practitioner whose books must be filled quickly',
        'A key referring GP retiring or redirecting referrals',
        'Opening a second location',
        'Funding or scheme changes altering patient economics',
        'A corporate group opening nearby',
        'Wanting to reduce dependence on referrals and build direct demand',
      ],
      seasonality: [
        'January is quiet before rebuilding through the year',
        'End of calendar year brings a surge as private health extras expire',
        'Winter lifts demand in some disciplines and suppresses it in others',
        'School terms shape paediatric and family caseloads',
      ],
      dealShapes: [
        'Monthly retainer with a separate ad budget',
        'Per-practitioner or per-location scoping',
        'Reporting framed around new patient bookings and utilisation',
      ],
      researchChannels: [
        'Referring practitioners and professional networks',
        'Google search and the local map pack',
        'Professional association directories',
        'Practice management software communities',
        'Peer recommendation in owner groups',
      ],
      competitorArchetypes: [
        'Corporate and franchised clinic groups',
        'Independent local practices',
        'Online and telehealth providers',
        'Health-specialist marketing agencies',
      ],
      commonObjections: [
        'Our patients come from GP referrals, not advertising',
        'Advertising health services feels ethically uncomfortable',
        'Our compliance obligations rule out most marketing',
        'We are already at capacity',
        'We tried this and got enquiries that never converted to bookings',
      ],
      metricsThatMatter: [
        'New patient bookings',
        'Practitioner utilisation',
        'No-show and cancellation rate',
        'Rebooking and retention rate',
        'Cost per new patient',
        'Referral source mix',
      ],
      regulatoryNotes: [
        'Health advertising rules prohibit testimonials about clinical services and misleading claims',
        'Outcome guarantees are prohibited; use "may", "varies", "subject to suitability"',
        'Before-and-after imagery is restricted for regulated procedures',
        'Practitioner registration details must be accurately represented',
      ],
      cautions: [
        'Never imply a clinical outcome',
        'Do not conflate the practice owner with the patient — confirm which is the ICP',
        'Avoid urgency tactics around health decisions; they read as predatory and risk breach',
        'Respect professional ethics as a genuine constraint, not an objection to overcome',
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'ecommerce-retail',
    label: 'E-commerce and retail',
    match:
      /\b(e-?comm|online store|shopify|retail|d2c|dtc|direct.to.consumer|apparel|fashion|homeware|furniture|mattress|cosmetic brand|skincare brand|supplement|marketplace seller)/i,
    content: {
      summary:
        'Margin-driven businesses where acquisition cost, repeat purchase and inventory position govern everything. Decisions are made against a dashboard, and the buyer is unusually numerate about marketing.',
      jargon: [
        { term: 'AOV', meaning: 'average order value' },
        { term: 'CAC', meaning: 'customer acquisition cost, watched daily' },
        { term: 'LTV', meaning: 'lifetime value; the number that justifies acquisition spend' },
        { term: 'ROAS', meaning: 'return on ad spend' },
        { term: 'contribution margin', meaning: 'what is left after product, shipping and ad costs' },
        { term: 'repeat rate', meaning: 'the proportion of customers who buy again' },
        { term: 'abandoned cart', meaning: 'checkout started and not completed' },
        { term: 'SKU', meaning: 'an individual stock item' },
        { term: 'sell-through', meaning: 'how fast inventory clears' },
        { term: 'attribution window', meaning: 'the period a conversion is credited to a channel' },
        { term: 'blended CAC', meaning: 'acquisition cost across all channels rather than one platform' },
      ],
      roles: [
        'Founder or owner',
        'Head of e-commerce or digital',
        'Performance marketing manager',
        'Retention or CRM lead',
        'Operations and fulfilment manager',
      ],
      buyingTriggers: [
        'Acquisition costs rising to the point where unit economics stop working',
        'Platform or tracking changes damaging measurable performance',
        'Launching a new product line or entering a new market',
        'Peak trading season approaching with inventory committed',
        'Over-reliance on a single channel becoming a visible risk',
        'A funding round or growth target demanding scale',
      ],
      seasonality: [
        'Black Friday and Cyber Monday dominate the calendar',
        'Christmas and end-of-year trade shape the annual result',
        'End of financial year clearance periods',
        'Category-specific peaks such as seasonal apparel or gifting',
      ],
      dealShapes: [
        'Monthly retainer, sometimes with a performance component',
        'Percentage-of-spend arrangements at larger budgets',
        'Separate scopes for acquisition and retention',
        'Clear reporting against contribution margin, not just ROAS',
      ],
      researchChannels: [
        'Peer founder communities and private Slack or Discord groups',
        'Platform partner directories such as Shopify',
        'Case studies with genuinely comparable brands',
        'Industry newsletters and podcasts',
        'LinkedIn and X marketing communities',
        'Agency review platforms',
      ],
      competitorArchetypes: [
        'Performance agencies competing on reported ROAS',
        'In-house teams the founder is considering building instead',
        'Freelance media buyers',
        'Full-service brand agencies',
        'Platform-native automated tools',
      ],
      commonObjections: [
        'Our margins do not support agency fees on top of ad spend',
        'The last agency reported great ROAS while revenue went sideways',
        'We can hire someone in-house for what you charge',
        'Attribution is broken so how would we even know it worked',
        'You do not understand our category',
        'We need results before peak season and there is no time',
      ],
      metricsThatMatter: [
        'Blended CAC',
        'Contribution margin after ad spend',
        'Repeat purchase rate',
        'Average order value',
        'Lifetime value to acquisition cost ratio',
        'Inventory sell-through',
        'Email and retention revenue share',
      ],
      regulatoryNotes: [
        'Consumer law requires accurate pricing, availability and discount representation',
        'Was/now pricing claims must be substantiated',
        'Shipping, returns and warranty terms must be represented accurately',
      ],
      cautions: [
        'This buyer is numerate — vague growth language destroys credibility instantly',
        'Never present ROAS in isolation; they will ask about margin',
        'Do not ignore retention and treat the problem as purely acquisition',
        'Avoid invented benchmark figures; they will be checked against real dashboards',
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'professional-services',
    label: 'Accounting and financial services',
    match:
      /\b(account(?:ant|ing)|bookkeep|tax agent|financial (?:advis|plan)|mortgage broker|insurance broker|wealth|audit|cfo services|business advisor)/i,
    content: {
      summary:
        'Advisory practices built on trust and recurring client relationships, where the constraint is adviser capacity and the growth question is usually about client quality rather than client count.',
      jargon: [
        { term: 'compliance work', meaning: 'recurring statutory work; predictable but low margin' },
        { term: 'advisory', meaning: 'higher-value consulting work practices are trying to grow' },
        { term: 'client book', meaning: 'the portfolio of ongoing clients, often the practice valuation basis' },
        { term: 'recurring revenue', meaning: 'the annuity base that makes the practice sellable' },
        { term: 'fee per client', meaning: 'the average annual value of a client relationship' },
        { term: 'write-offs', meaning: 'billed time that cannot be recovered' },
        { term: 'lodgement', meaning: 'statutory filing, which drives the annual rhythm' },
        { term: 'SOA', meaning: 'statement of advice, the regulated advice document' },
        { term: 'trail commission', meaning: 'ongoing commission on placed products' },
      ],
      roles: [
        'Practice principal / partner',
        'Client services manager',
        'Senior accountant or adviser',
        'Practice manager',
        'Business development manager in larger firms',
      ],
      buyingTriggers: [
        'Wanting to shift the mix from compliance work toward advisory',
        'Losing clients to firms with a stronger digital presence',
        'A partner approaching retirement and succession requiring growth',
        'Regulatory change creating new advisory demand',
        'Acquiring another practice and needing to consolidate a brand',
        'Referral flow slowing after years of relying on it',
      ],
      seasonality: [
        'Tax and lodgement seasons dominate and consume all capacity',
        'End of financial year is both the busiest period and the buying trigger',
        'Quiet periods between lodgement deadlines are when decisions get made',
      ],
      dealShapes: [
        'Monthly retainer with quarterly review',
        'Separate scopes for brand, acquisition and content authority',
        'Long consideration cycles with partner consensus required',
      ],
      researchChannels: [
        'Professional body communications and CPD events',
        'Peer referral between practices',
        'LinkedIn, used genuinely in this sector',
        'Practice software ecosystems such as Xero and MYOB partner networks',
        'Industry publications and conferences',
      ],
      competitorArchetypes: [
        'Large national firms with marketing departments',
        'Boutique specialist advisory practices',
        'Online and app-based low-cost providers',
        'Sector-specialist marketing agencies',
      ],
      commonObjections: [
        'Our clients come from referrals and always have',
        'Marketing feels at odds with professional standards',
        'We are already at capacity during the periods that matter',
        'Online enquiries are price shoppers, not the clients we want',
        'Our compliance obligations restrict what we can say',
      ],
      metricsThatMatter: [
        'Recurring revenue and client retention',
        'Average fee per client',
        'Advisory share of total revenue',
        'Qualified enquiries per service line',
        'Adviser utilisation and write-offs',
        'Client acquisition cost against lifetime value',
      ],
      regulatoryNotes: [
        'Financial advice is licensed; claims about returns or outcomes are tightly restricted',
        'Never imply guaranteed financial performance',
        'General versus personal advice distinctions must be respected in all copy',
        'Use compliance-aware framing: "general information only", "consider your own circumstances"',
      ],
      cautions: [
        'Never suggest or imply investment returns',
        'Do not treat this buyer as unsophisticated about numbers',
        'Respect that capacity during peak season is a hard constraint',
        'Avoid consumer urgency tactics; they breach both tone and regulation',
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'real-estate',
    label: 'Real estate and property',
    match: /\b(real ?estate|property (?:manage|develop|invest)|realtor|buyers? agent|conveyanc|strata manage|rental)/i,
    content: {
      summary:
        'Commission-driven businesses where listings are the scarce resource and personal brand often outweighs agency brand. Income is lumpy and tied directly to transaction volume.',
      jargon: [
        { term: 'listing', meaning: 'a property secured to sell; the true constraint on income' },
        { term: 'appraisal', meaning: 'the pitch meeting where a listing is won or lost' },
        { term: 'rent roll', meaning: 'the managed property portfolio; the recurring revenue asset' },
        { term: 'vendor', meaning: 'the seller — usually the actual client' },
        { term: 'days on market', meaning: 'how long a property takes to sell' },
        { term: 'clearance rate', meaning: 'the proportion of auctions selling under the hammer' },
        { term: 'off-market', meaning: 'sold without public listing' },
        { term: 'GCI', meaning: 'gross commission income' },
        { term: 'farming an area', meaning: 'systematically building presence in a suburb' },
      ],
      roles: [
        'Principal / agency owner',
        'Sales agent building a personal brand',
        'Property manager or department head',
        'Business development manager for rent roll growth',
      ],
      buyingTriggers: [
        'A market slowdown reducing listing volume',
        'A competing agency taking share in a core suburb',
        'Losing a lead agent and the listings that followed them',
        'Wanting to grow the rent roll as a stable asset',
        'Opening in a new suburb with no local reputation',
      ],
      seasonality: [
        'Spring is the dominant selling season',
        'Christmas through January is very quiet for listings',
        'Autumn provides a secondary selling window',
        'Rental demand peaks around academic and relocation cycles',
      ],
      dealShapes: [
        'Monthly retainer, sometimes at agent rather than agency level',
        'Separate scopes for vendor acquisition and rent roll growth',
        'Personal-brand packages for individual agents',
      ],
      researchChannels: [
        'Portal ecosystems and their partner networks',
        'Industry conferences and coaching programmes',
        'Peer networks and agent communities',
        'Social proof from visible local competitors',
        'Real estate coaching and training providers',
      ],
      competitorArchetypes: [
        'Portal-owned marketing services',
        'Real estate specialist agencies',
        'In-house marketing coordinators',
        'Coaching programmes bundling marketing',
      ],
      commonObjections: [
        'My business comes from my database and reputation',
        'Portals already take enough of my money',
        'Marketing spend is impossible to justify in a slow market',
        'I have tried this and it produced appraisals that went nowhere',
        'My personal brand matters more than the agency brand',
      ],
      metricsThatMatter: [
        'Listings won per month',
        'Appraisal-to-listing conversion',
        'Gross commission income',
        'Rent roll growth and churn',
        'Days on market',
        'Market share within a target suburb',
      ],
      regulatoryNotes: [
        'Price representations in advertising are regulated and underquoting is enforced against',
        'Agent licensing details must be accurately represented',
        'Claims about sales performance must be substantiated',
      ],
      cautions: [
        'Never invent sales figures, clearance rates or market share numbers',
        'Do not conflate the vendor with the buyer — confirm which is the ICP',
        'Recognise that agents are themselves salespeople and resist being sold to',
      ],
    },
  },

// -------------------------------------------------------------------------
  {
    id: 'life-sciences',
    label: 'Life sciences — pharma, biotech and medical devices',
    match:
      /\b(life ?science|pharma|biotech|biopharma|medical device|medtech|cro\b|cdmo|clinical trial|drug (?:development|manufactur)|api manufactur|sterile manufactur|regulatory affairs|pharmacovigilance)/i,
    content: {
      summary:
        'Regulated manufacturing and development sites where every role touches product quality, and where a hiring mistake is a compliance exposure rather than merely an inconvenience. Headcount decisions are governed by audit readiness, validation timelines and the site\'s licence to operate.',
      jargon: [
        { term: 'GMP', meaning: 'Good Manufacturing Practice — the regulatory baseline everything is judged against' },
        { term: 'GxP', meaning: 'the family of regulated-practice standards: GMP, GLP, GCP, GDP' },
        { term: 'validation', meaning: 'documented proof a process or system consistently does what it should' },
        { term: 'qualification', meaning: 'IQ/OQ/PQ — equipment proven fit for purpose before use' },
        { term: 'CAPA', meaning: 'corrective and preventive action; the record regulators read first' },
        { term: 'deviation', meaning: 'a documented departure from procedure, requiring investigation' },
        { term: 'batch record', meaning: 'the manufacturing record for one lot; the audit trail' },
        { term: 'tech transfer', meaning: 'moving a process between sites or from development to commercial' },
        { term: 'QP release', meaning: 'Qualified Person sign-off before product may be sold in the EU' },
        { term: 'aseptic', meaning: 'sterile processing; the highest-risk, hardest-to-staff area' },
        { term: 'cleanroom grade', meaning: 'the classified environment a role works in' },
        { term: 'design history file', meaning: 'the device-side documentation trail under ISO 13485' },
        { term: 'notified body', meaning: 'the body certifying devices for the EU market' },
        { term: 'audit readiness', meaning: 'permanent state of being inspectable without notice' },
        { term: 'time-to-fill', meaning: 'the metric that hurts when a validation window is closing' },
        { term: 'contingent vs retained', meaning: 'the two agency engagement models, argued over constantly' },
        { term: 'PSL', meaning: 'preferred supplier list — the gate an agency must get through' },
        { term: 'counteroffer', meaning: 'the incumbent employer\'s late bid; the main cause of a failed placement' },
      ],
      roles: [
        'Hiring manager — QA, validation, regulatory affairs or manufacturing',
        'QA Manager / Quality Systems Manager',
        'Validation Lead or Engineering Manager',
        'Regulatory Affairs Manager',
        'Site HR Business Partner',
        'Talent Acquisition Lead',
        'Head of Manufacturing or Operations Director',
        'Qualified Person',
      ],
      buyingTriggers: [
        'A regulatory inspection finding that requires named roles filled to close it out',
        'A tech transfer or new production line with a fixed validation timeline',
        'A facility expansion or new plant announced, often alongside an IDA-supported investment',
        'A product approval or submission deadline that cannot move',
        'Losing a Qualified Person or a validation lead with no internal successor',
        'Internal talent acquisition unable to source a scarce regulated skill set',
        'A competitor site opening locally and drawing on the same small talent pool',
        'Preparing for an EU MDR or IVDR transition requiring regulatory headcount',
      ],
      seasonality: [
        'Headcount is approved on annual budget cycles, so requisitions cluster after sign-off',
        'Shutdown and maintenance periods drive contract and short-term hiring',
        'Audit and inspection windows create sudden, urgent compliance hiring',
        'Summer and Christmas slow interview scheduling badly in Ireland and continental Europe',
      ],
      dealShapes: [
        'Contingency placement at a percentage of first-year salary',
        'Retained or exclusive search for scarce and senior roles',
        'Preferred supplier list agreements with agreed terms and rebate periods',
        'Rebate or replacement guarantee if a placement leaves within a set window',
        'Contract and day-rate placement for validation and project work',
      ],
      researchChannels: [
        'LinkedIn, which is where both the hiring manager and the candidates actually are',
        'Referrals from peers at other sites in the same cluster',
        'Industry bodies and events such as regulated-manufacturing and pharma conferences',
        'Procurement and PSL processes rather than direct outreach at larger sites',
        'Specialist life sciences job boards and communities',
        'Word of mouth between QA and validation professionals, who move within a small circle',
      ],
      competitorArchetypes: [
        'Global recruitment groups with life sciences divisions',
        'Boutique specialists in regulated manufacturing',
        'Internal talent acquisition teams trying to fill roles directly',
        'RPO providers holding an existing site-wide contract',
        'Contract and consultancy firms placing validation resource instead of permanent staff',
      ],
      commonObjections: [
        'We have an internal talent acquisition team, so why would we pay agency fees',
        'The fee is hard to justify to finance for a role we might fill ourselves',
        'Agencies send us CVs from people who do not understand regulated environments',
        'We are on a preferred supplier list and cannot add another agency',
        'The last placement left inside the guarantee period',
        'Can you actually find someone with aseptic or device experience in this market',
        'Our approval process for new suppliers takes months',
        'We need someone who can pass an audit, not just someone with the job title',
      ],
      metricsThatMatter: [
        'Time-to-fill against the validation or submission deadline',
        'Quality of shortlist — how many are genuinely qualified',
        'Offer acceptance rate and counteroffer losses',
        'Retention beyond the guarantee period',
        'Cost per hire against internal sourcing',
        'Vacancy impact on audit readiness and release capacity',
        'Contractor versus permanent headcount ratio',
      ],
      regulatoryNotes: [
        'In Ireland the HPRA is the national competent authority, working alongside the EMA for centralised procedures',
        'Sites exporting to the US are also subject to FDA inspection, and many Irish plants are dual-regulated',
        'Devices fall under ISO 13485 and EU MDR/IVDR, with a notified body rather than the medicines pathway',
        'Never imply a candidate can guarantee an audit outcome or a regulatory approval',
        'GDPR governs candidate data handling and is taken seriously by these employers',
        'Right-to-work, visa and relocation constraints materially narrow the available pool',
      ],
      cautions: [
        'Do not treat this as generic white-collar recruitment; regulated experience is not interchangeable with sector experience',
        'Never promise a specific time-to-fill for a scarce regulated skill set',
        'Do not conflate the hiring manager with HR — they have different pressures and often disagree',
        'Avoid implying a candidate can shortcut validation or compliance requirements',
        'Do not name EMA alone for an Irish site; HPRA and frequently FDA both apply',
      ],
    },
  },

  // -------------------------------------------------------------------------
  {
    id: 'b2b-saas',
    label: 'B2B software',
    match: /\b(saas|software|b2b tech|platform|app company|technology (?:company|vendor)|cloud|api|devtool)/i,
    businessModel: 'b2b',
    content: {
      summary:
        'Subscription businesses where the buying committee is large, the sales cycle is long, and marketing is judged on pipeline contribution rather than lead volume.',
      jargon: [
        { term: 'ARR', meaning: 'annual recurring revenue; the headline metric' },
        { term: 'churn', meaning: 'revenue or logos lost, which caps growth' },
        { term: 'ICP fit', meaning: 'how closely an account matches the ideal profile' },
        { term: 'PQL / MQL / SQL', meaning: 'lead qualification stages used to argue about lead quality' },
        { term: 'pipeline coverage', meaning: 'pipeline relative to target; what the board asks about' },
        { term: 'land and expand', meaning: 'starting small then growing within the account' },
        { term: 'buying committee', meaning: 'the several people who must all agree' },
        { term: 'net revenue retention', meaning: 'expansion minus churn within the existing base' },
        { term: 'time to value', meaning: 'how quickly a new customer sees benefit' },
        { term: 'seat expansion', meaning: 'growth by adding users within an account' },
      ],
      roles: [
        'Founder or CEO in earlier stage companies',
        'VP or Head of Marketing',
        'Demand generation lead',
        'Head of Revenue Operations',
        'Sales leader who will judge lead quality',
      ],
      buyingTriggers: [
        'A funding round with growth targets attached',
        'Pipeline coverage falling short of the number',
        'Entering a new segment or geography',
        'A competitor gaining visible share of voice',
        'A new category or product launch',
        'Sales team growing faster than pipeline can feed it',
      ],
      seasonality: [
        'Quarterly cycles dominate, with pressure concentrating at quarter end',
        'Budget planning periods drive vendor decisions',
        'Summer and end-of-year holidays slow enterprise cycles noticeably',
      ],
      dealShapes: [
        'Monthly retainer with quarterly strategic review',
        'Pipeline-contribution reporting rather than lead counts',
        'Longer initial terms reflecting long sales cycles',
        'Separate scopes for demand generation and content authority',
      ],
      researchChannels: [
        'LinkedIn, which is genuinely the centre of gravity here',
        'Peer communities and private operator Slack groups',
        'Review platforms such as G2 and Capterra',
        'Analyst content and category reports',
        'Industry podcasts and newsletters',
        'Conferences and partner ecosystems',
      ],
      competitorArchetypes: [
        'Specialist B2B SaaS agencies',
        'In-house teams being built as the alternative',
        'Fractional marketing leaders',
        'Generalist performance agencies with no B2B depth',
      ],
      commonObjections: [
        'Our sales cycle is too long to attribute anything to marketing',
        'The last agency delivered leads sales refused to work',
        'We could hire a demand gen manager for this budget',
        'You do not understand our technical buyer',
        'We need pipeline this quarter, not a brand programme',
      ],
      metricsThatMatter: [
        'Pipeline contribution from marketing',
        'Cost per opportunity',
        'Win rate by source',
        'Sales cycle length',
        'Net revenue retention',
        'ICP fit of sourced accounts',
      ],
      regulatoryNotes: [
        'Data protection and privacy claims must be accurate, particularly around security posture',
        'Comparative claims against named competitors carry legal exposure',
      ],
      cautions: [
        'Never optimise for lead volume in front of this buyer; they have been burned by it',
        'Do not oversimplify a technical product or its buyer',
        'Avoid invented benchmark figures — this audience checks them',
        'Respect that sales and marketing alignment is often the real underlying problem',
      ],
    },
  },
];

/**
 * Find a curated pack for a normalised industry string.
 *
 * Business-model-specific packs are preferred when they match, so a B2B SaaS
 * brief does not receive a pack written for a consumer audience.
 */
export function matchCurated(
  normalisedIndustry: string,
  businessModel: string,
): CuratedPack | null {
  const candidates = CURATED_PACKS.filter((pack) => pack.match.test(normalisedIndustry));
  if (!candidates.length) return null;

  return (
    candidates.find((pack) => pack.businessModel === businessModel) ??
    candidates.find((pack) => !pack.businessModel) ??
    null
  );
}
