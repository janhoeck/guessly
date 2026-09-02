import Anthropic from "@anthropic-ai/sdk";
import type { RoundKind } from "@guessly/protocol";
import { NUDGE_PROMPT, SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { describeSourceFailure } from "./failure.js";
import { firstDownloadableImage } from "./download.js";
import {
  SUBMIT_ROUND_INPUT_SCHEMA,
  SUBMIT_ROUND_TOOL_NAME,
  parseSubmission,
} from "./schema.js";
import {
  RoundSourceError,
  type GeneratedRound,
  type GenerationRequest,
  type RoundGenerator,
} from "./source.js";

/**
 * The round generator, backed by Claude.
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
 * One call produces the round in *every* language, which is why the request
 * carries a list rather than one: the subject, the search, the picture and the
 * cached prompt prefix are shared, so a second language costs a few hundred
 * output tokens instead of a second round trip and a second download.
 *
 * An image round leaves here as *bytes*, downloaded and verified, not as a URL
 * to hope about later — the bank stores them and the players load the picture
 * from this server's own origin.
 *
 * Most generation runs behind the bank: a background top-up, or a prefetch
 * hidden behind the round on screen. Only a cold bank puts this in front of a
 * countdown, so the numbers below buy reliability first and speed second.
 */

/** Room for adaptive thinking plus a short structured answer. */
const MAX_TOKENS = 16_000;

/**
 * Picking a well-known thing and finding a picture of it is not hard reasoning,
 * and there are people watching a clock. Low effort keeps the tool calls few and
 * consolidated; raise it if rounds start coming back obscure.
 */
const EFFORT = "low" as const;

/**
 * Enough to find a file name, and enough to be wrong twice on the way. Four
 * was enough while the model was allowed to write URLs from memory; now that
 * the prompt insists every file name comes out of a search result, a topic
 * whose first two searches return articles rather than files used to run out of
 * budget and submit nothing at all.
 */
const MAX_SEARCHES = 6;

/** One turn to answer, one to resume a paused search, one after a nudge. */
const MAX_TURNS = 3;

/**
 * How many whole rounds to ask for before giving up on the topic. Three since
 * prefetching, not two: most rounds now build behind the round before them,
 * where a named-reason retry costs the players nothing, and what a third
 * attempt prevents is the worst screen in the game — a whole lobby dumped
 * back to `/` because nothing would load.
 */
const DEFAULT_ATTEMPTS = 3;

/**
 * How long one API request may take. This is the SDK's per-request timeout —
 * an attempt can be up to MAX_TURNS requests, and the SDK retries a timed-out
 * request once — not a wall clock for the attempt. One request can carry all
 * MAX_SEARCHES server-side searches, which runs ten to twenty seconds
 * routinely and tails far past that; the 25 seconds this used to be was tuned
 * for players watching a countdown, and mostly killed prefetches that were
 * about to succeed. A prefetched round has a whole round to arrive in, and a
 * late round starts its clock late rather than short — finishing beats
 * finishing fast.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** A host that cannot deliver the whole file in this long will not do better later. */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 8_000;

const SUBMIT_ROUND_DESCRIPTION =
  "Submit the finished round. Call this exactly once, as your final action, with the fields for the round kind you were given and one entry in versions for every language you were asked for.";

export interface ClaudeRoundGeneratorOptions {
  apiKey: string;
  model: string;
  attempts?: number;
  requestTimeoutMs?: number;
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

export function createClaudeRoundGenerator(
  options: ClaudeRoundGeneratorOptions,
): RoundGenerator {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const client = new Anthropic({
    apiKey: options.apiKey,
    // The SDK's own default is ten minutes, which would let one hung request
    // eat the whole prefetch window and the fallback's patience besides.
    timeout: requestTimeoutMs,
    maxRetries: 1,
  });

  /** One exchange, returning the raw tool input for `parseSubmission` to judge. */
  async function ask(
    request: GenerationRequest,
    retryNote: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: buildUserPrompt({
          topic: request.topic,
          kind: request.kind,
          languages: request.languages,
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
          { cause: response.stop_details },
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
    async generate(request, signal) {
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
          // spends more of the players' patience on it — but *which* of those
          // it is decides both what the lobby is told and what the log says, so
          // it is read rather than flattened. See failure.ts.
          const failure = describeSourceFailure(error, options.model);
          throw new RoundSourceError(failure.message, { cause: error, detail: failure.detail });
        }

        const parsed = parseSubmission(input, request.kind, request.languages);
        if (!parsed.ok) {
          // The reason is fed back to the model *and* logged: a run of
          // rejections in the log is the only way anyone finds out the prompt
          // and the parser have started disagreeing about something.
          console.warn(
            `[content] ${request.topic} attempt ${attempt}/${attempts} rejected: ${parsed.reason}`,
          );
          retryNote = parsed.reason;
          playerMessage = "The AI could not come up with a usable round.";
          continue;
        }

        const found = { subject: parsed.subject, texts: parsed.texts };

        if (parsed.kind === "lyrics") {
          return {
            kind: "lyrics",
            snippet: parsed.snippet,
            snippetLanguage: parsed.snippetLanguage,
            ...found,
          } satisfies GeneratedRound;
        }

        const image = await firstDownloadableImage(
          parsed.imageUrls,
          signal,
          IMAGE_DOWNLOAD_TIMEOUT_MS,
        );
        if (image) {
          return { kind: "image", image, ...found } satisfies GeneratedRound;
        }

        // The URLs themselves, not just how many: a dead candidate is almost
        // always a file name that does not exist, and the name is the only
        // thing that says whether the model searched or guessed.
        console.warn(
          `[content] ${request.topic} attempt ${attempt}/${attempts}: none of ${parsed.imageUrls.length} URLs for "${parsed.subject}" downloaded — ${parsed.imageUrls.join(" ")}`,
        );
        // Each attempt is a fresh conversation, so the model does not remember
        // what it tried — the note has to say whose pictures failed.
        // What failed is usually the *file name*, not the subject — the same
        // subject downloads on another attempt — so the note says so rather
        // than sending a perfectly good subject away.
        retryNote = `none of the image URLs you gave for "${parsed.subject}" could be downloaded — they were unreachable, or did not serve an actual image file. Most likely the file names were written from memory and do not exist. Search for the picture and copy the URLs out of the results, or pick a different subject.`;
        playerMessage = "None of the pictures the AI picked would load.";
      }

      // The player message stays vague on purpose; the log gets the last
      // rejection verbatim, because "detail: undefined" is what an operator
      // pastes when there is nothing better to paste.
      throw new RoundSourceError(playerMessage, {
        detail: retryNote && `every attempt was rejected — the last because ${retryNote}`,
      });
    },
  };
}
