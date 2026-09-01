import Anthropic from "@anthropic-ai/sdk";
import type { RoundKind } from "@guessly/protocol";
import type { RoundRequest } from "../lobby/store.js";
import { NUDGE_PROMPT, SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { firstReachableImage } from "./reachable.js";
import {
  SUBMIT_ROUND_INPUT_SCHEMA,
  SUBMIT_ROUND_TOOL_NAME,
  parseSubmission,
} from "./schema.js";
import { RoundSourceError, type RoundContentSource, type SourcedRound } from "./source.js";

/**
 * The content source, backed by Claude.
 *
 * Three things make the response safe to parse, and none of them is hoping:
 *
 * 1. The answer is a `strict` tool call, not prose. There is no fenced block to
 *    find, no preamble to strip, and the input is schema-valid by construction.
 * 2. It is read back through `parseSubmission`, which enforces the game's rules
 *    on top of the schema's shape — a round that breaks one is thrown away.
 * 3. A thrown-away round is asked for again *with the reason*, so the second
 *    attempt is told what was wrong with the first rather than re-rolling the
 *    same dice.
 *
 * Everything here runs while the players watch the countdown, so every number
 * below is a latency budget as much as a limit.
 */

/** Room for adaptive thinking plus a short structured answer. */
const MAX_TOKENS = 16_000;

/**
 * Picking a well-known thing and finding a picture of it is not hard reasoning,
 * and there are people watching a clock. Low effort keeps the tool calls few and
 * consolidated; raise it if rounds start coming back obscure.
 */
const EFFORT = "low" as const;

/** Enough to search, look at what came back, and search once more. */
const MAX_SEARCHES = 4;

/** One turn to answer, one to resume a paused search, one after a nudge. */
const MAX_TURNS = 3;

/** How many whole rounds to ask for before giving up on the topic. */
const DEFAULT_ATTEMPTS = 2;

/** Wall clock for one attempt, web searches included. */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 25_000;

/** A host that has not answered in this long will not save the round either. */
const IMAGE_PROBE_TIMEOUT_MS = 4_000;

const SUBMIT_ROUND_DESCRIPTION =
  "Submit the finished round. Call this exactly once, as your final action, with the fields for the round kind you were given.";

export interface ClaudeRoundSourceOptions {
  apiKey: string;
  model: string;
  attempts?: number;
  attemptTimeoutMs?: number;
}

/**
 * Image rounds get web search; lyrics rounds do not, because a paraphrase is
 * written from what the model already knows and a search would only cost the
 * players three seconds. The two tool lists are stable, so each keeps its own
 * cached prompt prefix instead of invalidating the other's.
 */
function toolsFor(kind: RoundKind) {
  const submitRound = {
    name: SUBMIT_ROUND_TOOL_NAME,
    description: SUBMIT_ROUND_DESCRIPTION,
    strict: true,
    input_schema: SUBMIT_ROUND_INPUT_SCHEMA,
  };

  if (kind === "lyrics") return [submitRound];
  return [
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: MAX_SEARCHES },
    submitRound,
  ];
}

export function createClaudeRoundSource(
  options: ClaudeRoundSourceOptions,
): RoundContentSource {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;

  const client = new Anthropic({
    apiKey: options.apiKey,
    // The SDK defaults to ten minutes. A round is twenty seconds long.
    timeout: attemptTimeoutMs,
    maxRetries: 1,
  });

  /** One exchange, returning the raw tool input for `parseSubmission` to judge. */
  async function ask(
    request: RoundRequest,
    retryNote: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: buildUserPrompt({
          topic: request.topic,
          kind: request.kind,
          number: request.number,
          exclude: request.exclude,
          retryNote,
        }),
      },
    ];

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const response = await client.messages.create(
        {
          model: options.model,
          max_tokens: MAX_TOKENS,
          // Everything constant about the job, marked cacheable. The volatile
          // half is the user message above, which renders after it.
          system: [
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          ],
          output_config: { effort: EFFORT },
          tools: toolsFor(request.kind),
          messages,
        },
        { signal },
      );

      const submission = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === SUBMIT_ROUND_TOOL_NAME,
      );
      if (submission) return submission.input;

      if (response.stop_reason === "refusal") {
        throw new RoundSourceError(
          "The content source would not build a round for that topic.",
          response.stop_details,
        );
      }
      // Nothing to echo back means nothing to continue from.
      if (response.content.length === 0) break;

      messages.push({ role: "assistant", content: response.content });

      // A server-side search ran out of its turn: hand the same turn back and
      // it carries on from where it stopped.
      if (response.stop_reason === "pause_turn") continue;

      messages.push({ role: "user", content: NUDGE_PROMPT });
    }

    throw new RoundSourceError("The content source never returned a round.");
  }

  return {
    async build(request, signal) {
      /** What went wrong last time, told to the model rather than kept quiet. */
      let retryNote: string | undefined;
      let playerMessage = "The round could not be built.";

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let input: unknown;
        try {
          input = await ask(request, retryNote, signal);
        } catch (error) {
          if (error instanceof RoundSourceError) throw error;
          // The SDK has already retried what is worth retrying. Anything still
          // failing here is a key, a quota or an outage, and asking again just
          // spends more of the players' patience on it.
          throw new RoundSourceError("The content source could not be reached.", error);
        }

        const parsed = parseSubmission(input, request.kind);
        if (!parsed.ok) {
          retryNote = parsed.reason;
          playerMessage = "The AI could not come up with a usable round.";
          continue;
        }

        const found: Omit<SourcedRound, "content"> = {
          answer: parsed.answer,
          aliases: parsed.aliases,
          subject: parsed.subject,
        };

        if (parsed.kind === "lyrics") {
          return {
            ...found,
            content: { kind: "lyrics", question: parsed.question, snippet: parsed.snippet },
          };
        }

        const imageUrl = await firstReachableImage(
          parsed.imageUrls,
          signal,
          IMAGE_PROBE_TIMEOUT_MS,
        );
        if (imageUrl) {
          return { ...found, content: { kind: "image", question: parsed.question, imageUrl } };
        }

        retryNote =
          "none of the image URLs you gave could be loaded — they were unreachable, or did not serve an image. Choose a subject with a picture on upload.wikimedia.org.";
        playerMessage = "None of the pictures the AI picked would load.";
      }

      throw new RoundSourceError(playerMessage);
    },
  };
}
