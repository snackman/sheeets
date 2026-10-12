// Combine the classifier call with deterministic signals and routing
// (§5.4, §5.7, §10 item 4). Thin wrapper over `classifier.ts` + `signals.ts`
// so the pipeline has one call site for "score this candidate".
import type OpenAI from 'openai';
import { classifyEvent, type ClassifyResult } from './classifier';
import { computeSignals, combineFinalScore, routeCandidate, type Route, type SignalResult } from './signals';
import type {
  ClassifierConferenceContext,
  ClassifierEventInput,
  FewShotExample,
  SourceTrust,
  ThemeProfile,
} from './types';

export interface ScoreCandidateOptions {
  client: OpenAI;
  profile: ThemeProfile;
  conference: ClassifierConferenceContext;
  event: ClassifierEventInput;
  fewShot?: FewShotExample[];
  isTrustedCalendarSource: boolean;
  isTrustedHost: boolean;
  isBlockedHost: boolean;
  isLearnedBlockedHost?: boolean;
  sponsorMatch?: string | null;
  includeKeywords: string[];
  excludeKeywords: string[];
  possibleDuplicate?: boolean;
  noGeo?: boolean;
  /** Discovery sources never auto-publish, regardless of score (§10 item 4). */
  sourceTrust: SourceTrust;
  publishThreshold: number;
  reviewThreshold: number;
}

export interface ScoreResult {
  classifier: ClassifyResult;
  signals: SignalResult;
  finalScore: number;
  /** Route after the discovery-trust cap. This is what actually happens. */
  route: Route;
  /** Route before the discovery-trust cap — recorded as `shadow_route` so the
   *  precision dashboard (Phase 2) can see what *would* have happened. */
  shadowRoute: Route;
}

export async function scoreCandidate(opts: ScoreCandidateOptions): Promise<ScoreResult> {
  const classifier = await classifyEvent({
    client: opts.client,
    profile: opts.profile,
    conference: opts.conference,
    event: opts.event,
    fewShot: opts.fewShot,
  });

  const text = [opts.event.name, (opts.event.hosts ?? []).join(' '), opts.event.descriptionText ?? ''].join(' ');
  const injectionDetected = classifier.injectionDetected || classifier.output.flags.includes('instructions_in_content');

  const signals = computeSignals({
    isTrustedCalendarSource: opts.isTrustedCalendarSource,
    isTrustedHost: opts.isTrustedHost,
    isBlockedHost: opts.isBlockedHost,
    isLearnedBlockedHost: opts.isLearnedBlockedHost,
    sponsorMatch: opts.sponsorMatch,
    text,
    includeKeywords: opts.includeKeywords,
    excludeKeywords: opts.excludeKeywords,
    injectionDetected,
    possibleDuplicate: opts.possibleDuplicate,
    noGeo: opts.noGeo,
  });

  const finalScore = combineFinalScore(classifier.output.theme_score, signals);
  const shadowRoute = routeCandidate({
    isEvent: classifier.output.is_event,
    llmScore: classifier.output.theme_score,
    dataQuality: classifier.output.data_quality,
    signals,
    profile: { publishThreshold: opts.publishThreshold, reviewThreshold: opts.reviewThreshold },
  });

  // §10 item 4: discovery-trust sources are capped at review, never publish.
  const route: Route = opts.sourceTrust === 'discovery' && shadowRoute === 'publish' ? 'review' : shadowRoute;

  return { classifier, signals, finalScore, route, shadowRoute };
}
