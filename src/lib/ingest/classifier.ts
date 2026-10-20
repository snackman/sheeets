// Theme classifier (§5.5): one small OpenAI model call per candidate,
// structured output. Budget/retry/content-hash-skip plumbing that needs
// `ingest_candidates`/`ingest_runs` lands in Phase 1b — this module is the
// pure request/response boundary so it can be unit-tested with the SDK
// mocked and reused by the eval harness.
//
// Switched from Anthropic to OpenAI per Snax's request (follow-up to the
// original plan, which specified Claude Haiku): same schema, same
// injection guard, cheaper model. It's a reasoning model, so `temperature`
// isn't configurable (fixed at 1 server-side) and cost is controlled via
// `reasoning_effort: 'minimal'` instead.
//
// Default model (Phase 1b): `gpt-5-mini`, chosen by the orchestrator as the
// §17.3 default since Snax didn't weigh in before 1b shipped (1a's eval had
// used `gpt-5-nano`; `gpt-5-mini` trades a small per-call cost increase for
// materially better judgment on the ambiguous "is this plausibly an event"
// and theme-fit calls this classifier makes — re-run `scripts/ingest-eval.ts`
// before changing it back). Always overridable via `INGEST_MODEL` without a
// code change.
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
import { buildSystemPrompt, buildUserContent, sanitizeFewShotExamples, scanForInjection } from './prompt';

/** Env-overridable so a cheaper/newer model can be swapped in without a code change. */
export const INGEST_MODEL = process.env.INGEST_MODEL || 'gpt-5-mini';
/**
 * Reasoning tokens count against `max_completion_tokens` (and are billed as
 * output tokens) on gpt-5-* models. 300 was enough at `reasoning_effort:
 * 'minimal'` (near-zero reasoning), but 'low' effort reliably blew through
 * it — the API returns a length-limited, unparseable response instead of
 * the JSON object (confirmed live during the tuning round). 1200 gives
 * reasoning room up through 'low' while staying a real ceiling.
 */
export const CLASSIFIER_MAX_TOKENS = 1200;
/**
 * Bumped for Phase 2 (review finding, CRITICAL item 4): few-shot examples
 * moved out of the system prompt into a delimited `<fewshot_examples>`
 * JSON block in the user turn, sanitized (injection-scanned, length-capped)
 * the same way `<event_data>` is. This changes what the model actually
 * sees for every classification with any few-shot examples, so every
 * candidate re-classifies rather than reusing a `content_hash` match from
 * the old prompt shape (§5.5: "Re-classify only when ... prompt_version
 * changes").
 *
 * Bumped again (Bug: "instructions_in_content over-triggers"): the system
 * prompt's security-rule paragraph was rewritten to explicitly exempt
 * normal attendee-facing event copy ("register here", "bring your
 * laptop", "DM us", ...) and only flag text that actually tries to address
 * the classifier itself. Same re-classify-on-prompt-change rule applies.
 *
 * Bumped again (tuning round, 2026-10-16): "private_or_invite_only" had no
 * guidance at all before this — the model only ever saw the bare enum
 * value name via the structured-output schema. Added explicit flag /
 * never-flag examples so only TRULY closed-access listings ("invite
 * only", "confirmed attendees will be notified", "members only", a VIP
 * perk, a closed private dinner) get flagged, and ordinary approval-gated
 * RSVPs, registration steps, or exclusive-sounding marketing copy
 * ("approval required", "RSVP required", a ticket-required-to-enter rule,
 * "prestigious"/"curated" copy) do not. Re-classify-on-prompt-change rule
 * applies.
 */
export const PROMPT_VERSION = '2-v4-openai';

export class ClassifierError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    /** Token usage, when OpenAI actually returned a completion before the
     *  failure (e.g. a schema-validation failure still bills tokens) — a
     *  request-level failure (network/5xx) never got a completion, so this
     *  is undefined there, and $0 is correct. Callers should add this to
     *  their cost tally even on failure (review finding, MEDIUM item 5). */
    public readonly usage?: { inputTokens: number; outputTokens: number; model: string }
  ) {
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

  // `sanitizeFewShotExamples` may drop examples that fail the injection
  // scan (review finding, CRITICAL item 4) — the system prompt's "there IS
  // a fewshot block" sentence must agree with what actually ends up in the
  // user turn, so both are derived from the SAME sanitized list rather
  // than the raw, possibly-still-injected `fewShot` input.
  const sanitizedFewShot = sanitizeFewShotExamples(fewShot);
  const system = buildSystemPrompt(profile, conference, sanitizedFewShot.length > 0);
  const userContent = buildUserContent(event, sanitizedFewShot);

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
    throw new ClassifierError('Classifier returned output that failed schema validation.', undefined, {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model,
    });
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
