// Theme classifier (§5.5): one small OpenAI model call per candidate,
// structured output. Budget/retry/content-hash-skip plumbing that needs
// `ingest_candidates`/`ingest_runs` lands in Phase 1b — this module is the
// pure request/response boundary so it can be unit-tested with the SDK
// mocked and reused by the eval harness.
//
// Switched from Anthropic to OpenAI per Snax's request (follow-up to the
// original plan, which specified Claude Haiku): same schema, same
// injection guard, cheaper model. `gpt-5-nano` was selected by querying
// `GET /v1/models` against the live key and checking current per-token
// pricing — see the PR description for the comparison. It's a reasoning
// model, so `temperature` isn't configurable (fixed at 1 server-side) and
// cost is controlled via `reasoning_effort: 'minimal'` instead.
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ClassifierOutputSchema } from './types';
import type {
  ClassifierConferenceContext,
  ClassifierEventInput,
  ClassifierOutput,
  FewShotExample,
  ThemeProfile,
} from './types';
import { buildEventDataContent, buildSystemPrompt, scanForInjection } from './prompt';

/** Env-overridable so a cheaper/newer model can be swapped in without a code
 *  change; defaults to the model picked for Phase 1a (see PR description). */
export const INGEST_MODEL = process.env.INGEST_MODEL || 'gpt-5-nano';
/**
 * Reasoning tokens count against `max_completion_tokens` (and are billed as
 * output tokens) on gpt-5-* models. 300 was enough at `reasoning_effort:
 * 'minimal'` (near-zero reasoning), but 'low' effort reliably blew through
 * it — the API returns a length-limited, unparseable response instead of
 * the JSON object (confirmed live during the tuning round). 1200 gives
 * reasoning room up through 'low' while staying a real ceiling.
 */
export const CLASSIFIER_MAX_TOKENS = 1200;
export const PROMPT_VERSION = '1a-v2-openai';

export class ClassifierError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ClassifierError';
  }
}

/** OpenAI's documented reasoning-effort levels (gpt-5 family). */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ClassifyOptions {
  client: OpenAI;
  profile: ThemeProfile;
  conference: ClassifierConferenceContext;
  event: ClassifierEventInput;
  fewShot?: FewShotExample[];
  /** Override the model for this call. Defaults to INGEST_MODEL. Used by the
   *  eval harness's model-comparison sweep; production code should leave
   *  this unset. */
  model?: string;
  /** Override reasoning effort for this call. Defaults to 'minimal'. */
  reasoningEffort?: ReasoningEffort;
}

export interface ClassifyResult {
  output: ClassifierOutput;
  /** True if our deterministic regex pre-scan found an injection attempt,
   *  independent of whether the model itself flagged it. */
  injectionDetected: boolean;
  inputTokens: number;
  outputTokens: number;
  model: string;
  promptVersion: string;
}

export async function classifyEvent(opts: ClassifyOptions): Promise<ClassifyResult> {
  const { client, profile, conference, event, fewShot = [], model = INGEST_MODEL, reasoningEffort = 'minimal' } = opts;

  const injectionDetected =
    scanForInjection(event.name) || scanForInjection(event.descriptionText);

  const system = buildSystemPrompt(profile, conference, fewShot);
  const userContent = buildEventDataContent(event);

  let completion;
  try {
    completion = await client.chat.completions.parse({
      model,
      max_completion_tokens: CLASSIFIER_MAX_TOKENS,
      // gpt-5-* reasoning models: no `temperature` (fixed at the model's
      // default — sending one errors), use `reasoning_effort` to keep this
      // fast/cheap instead.
      reasoning_effort: reasoningEffort,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      response_format: zodResponseFormat(ClassifierOutputSchema, 'event_classification'),
    });
  } catch (err) {
    throw new ClassifierError('Classifier request failed.', err);
  }

  const message = completion.choices[0]?.message;
  if (!message || message.parsed == null) {
    throw new ClassifierError('Classifier returned output that failed schema validation.');
  }

  let output = message.parsed;
  // Belt-and-suspenders: our own regex pre-scan is authoritative for capping
  // the route at review, even if the model didn't self-report the flag.
  if (injectionDetected && !output.flags.includes('instructions_in_content')) {
    output = { ...output, flags: [...output.flags, 'instructions_in_content'] };
  }

  return {
    output,
    injectionDetected,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    // completion_tokens includes reasoning tokens, which is also how OpenAI
    // bills them, so this is the right figure for cost estimates.
    outputTokens: completion.usage?.completion_tokens ?? 0,
    model,
    promptVersion: PROMPT_VERSION,
  };
}
