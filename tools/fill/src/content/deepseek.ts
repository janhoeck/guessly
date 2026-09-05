import OpenAI, { APIConnectionTimeoutError } from "openai";
import { NUDGE_PROMPT, SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { findDuplicate } from "./dedup.js";
import { describeSourceFailure } from "./failure.js";
import { downloadImage } from "./download.js";
import { chooseImage, orderCandidates, type Rejection } from "./candidates.js";
import {
  formatImageResults,
  searchImages,
  type FoundImage,
  type ImageProvider,
  type ImageQuery,
} from "./search.js";
import {
  SUBMIT_ROUND_INPUT_SCHEMA,
  SUBMIT_ROUND_TOOL_NAME,
  parseSubmission,
  type ParsedTexts,
} from "./schema.js";
import {
  RoundSourceError,
  type GeneratedRound,
  type GenerationRequest,
  type RoundGenerator,
} from "./source.js";
import { acceptAll, type ImageJudge, type JudgeContext } from "./vision.js";

/**
 * The round generator, backed by DeepSeek through its OpenAI-compatible API.
 *
 * Four things make the response safe to bank, and none of them is hoping:
 *
 * 1. The answer is a tool call, not prose. There is no fenced block to find
 *    and no preamble to strip — though the schema is a promise DeepSeek
 *    usually keeps rather than one the API enforces, which is why the next
 *    layer checks the shape as well as the rules.
 * 2. It is read back through `parseSubmission`, which enforces the game's
 *    rules on top of the schema's shape — a round that breaks one is thrown
 *    away.
 * 3. An image round's picture is downloaded, sniffed and *looked at*: the
 *    vision judge in vision.ts rejects one that spells its answer out or does
 *    not show the subject, and the next candidate is tried.
 * 4. A thrown-away round is asked for again *with the reason*, so the second
 *    attempt is told what was wrong with the first rather than re-rolling the
 *    same dice.
 *
 * One call produces the round in *every* language, which is why the request
 * carries a list rather than one: the subject, the picture and the cached
 * prompt prefix are shared, so a second language costs a few hundred output
 * tokens instead of a second round trip and a second download.
 *
 * DeepSeek cannot browse, so an image round's URLs used to be written from
 * what the model already knew — which works for file names that follow a rule
 * (`Flag of France.svg`) and fails for everything else, whole topics at a
 * time. It gets `search_images` instead: one tool that asks every configured
 * provider at once — the web, the Steam store, Wikipedia, Commons — and
 * answers with pictures that exist, tagged by where they were found. The
 * model still chooses the picture, because which file spells its own answer
 * out is a judgement and a lookup has none; the vision check stands behind
 * that choice and catches the ones it gets wrong.
 *
 * The V4 models think before they answer — enabled by default, at `high`
 * effort — and a thinking model's first byte of answer arrives only after
 * *all* of its reasoning, which for a full multi-language round runs well
 * past a minute. Two consequences shape this file:
 *
 * - **The request streams.** A non-streaming call is a connection held
 *   silently open for the whole think, at the mercy of every timeout between
 *   here and the model — including the SDK's own, which cost this generator
 *   two dead minutes per topic before this was understood. A streaming call
 *   is answered immediately (DeepSeek sends keep-alive comments while the
 *   request queues), the SDK's timeout shrinks to meaning "the API never
 *   picked up", and the generation itself is bounded by a deadline sized for
 *   thinking rather than for connecting.
 * - **The effort is a knob, and the default is `low`.** Filling is a batch
 *   job that survives on validation, not brilliance: a bad round is rejected
 *   by the parser, the duplicate check or the download check and re-asked
 *   with the reason, so the marginal quality of `high` mostly buys what the
 *   retry loop already provides. `low` cuts the think — and with it the cost
 *   and the wall clock of every round — while `DEEPSEEK_REASONING_EFFORT`
 *   holds the door open for anyone who watches the reject rate climb and
 *   disagrees.
 */

/** DeepSeek's thinking dial: `none` turns it off, the rest set the effort. */
export type ReasoningEffort = "none" | "low" | "high" | "max";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "low", "high", "max"];

const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

/**
 * With thinking off this is the old ceiling every DeepSeek chat model
 * accepts, and a full submission — every language's questions, answers and
 * aliases — is a small fraction of it. With thinking on the reasoning shares
 * the budget, so the ceiling rises to keep a long think from starving the
 * tool call it exists to produce; V4 allows far more than either.
 */
const MAX_TOKENS = 8_192;
const MAX_TOKENS_THINKING = 32_768;

/**
 * Turns in one attempt: a search or two, the submission, and a nudge or two
 * back toward the tool if the model answers in prose. Higher than it was
 * because a turn is no longer only a nudge — an image round spends its first
 * one or two looking things up.
 */
const MAX_TURNS = 6;

/**
 * Lookups allowed per attempt. Two is a search and a rethink; past that the
 * model is shopping rather than choosing, and every turn is another whole
 * think billed. Running out is not a failure — it is told to submit from what
 * it already has.
 */
const MAX_SEARCHES = 3;

/**
 * How many whole rounds to ask for before giving up on the topic. Three since
 * prefetching, not two: most rounds now build behind the round before them,
 * where a named-reason retry costs the players nothing, and what a third
 * attempt prevents is the worst screen in the game — a whole lobby dumped
 * back to `/` because nothing would load.
 */
const DEFAULT_ATTEMPTS = 3;

/**
 * How long one streamed request may run, connection to final token. Nobody is
 * watching a countdown while the filler works, so the budget errs long: a
 * thinking model under load can reason for minutes, and DeepSeek documents
 * closing queued requests itself at ten. This is the whole-request deadline —
 * the SDK's `timeout` below only guards the part before the stream opens.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60_000;

/**
 * How long the API gets to *start* answering. A streamed request is
 * acknowledged as soon as it is accepted — keep-alives flow while it queues —
 * so a minute of silence here means unreachable, not thinking.
 */
const CONNECT_TIMEOUT_MS = 60_000;

/** A host that cannot deliver the whole file in this long will not do better later. */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 8_000;

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const SUBMIT_ROUND_DESCRIPTION =
  "Submit the finished round. Call this exactly once, as your final action, with the fields for the round kind you were given and one entry in versions for every language you were asked for.";

const SUBMIT_ROUND_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: SUBMIT_ROUND_TOOL_NAME,
    description: SUBMIT_ROUND_DESCRIPTION,
    parameters: SUBMIT_ROUND_INPUT_SCHEMA,
  },
};

export const SEARCH_IMAGES_TOOL_NAME = "search_images";

/**
 * The lookup, offered on image rounds only — a lyrics round has nothing to
 * look up, and the two tool lists are two cache prefixes rather than one
 * confused prompt. Every topic but music is an image round, so the warm
 * prefix stays warm.
 */
const SEARCH_IMAGES_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: SEARCH_IMAGES_TOOL_NAME,
    description:
      "Find pictures that actually exist — on the web, in the Steam store, on Wikipedia and Wikimedia Commons. Returns real URLs with their sizes, titles and captions, tagged by where they were found. Call this before submit_round on every image round and copy the URLs from its results — a URL written from memory is usually dead.",
    parameters: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            'The subject to find pictures of, as its plain English name: "Portal 2", "Camp Nou", "Red panda". One subject per call; not a sentence and not a file name.',
        },
        looking_for: {
          type: "string",
          description:
            'Optional. What kind of picture, in two or three words: "gameplay screenshot", "logo symbol only", "film still", "photo of the dish". Steers the web search; leave it out for a plain photograph of the subject.',
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

/** A tool call reassembled from the stream's fragments. */
interface StreamedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * The arguments of a `search_images` call. Unparseable arguments are an
 * empty query rather than a throw: `searchImages` answers that with a
 * sentence the model can act on, which is worth more than losing the whole
 * attempt to a malformed fragment.
 */
function readSearchArguments(rawArguments: string): { query: string; lookingFor: string | null } {
  try {
    const parsed = JSON.parse(rawArguments) as { query?: unknown; looking_for?: unknown };
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      lookingFor: typeof parsed.looking_for === "string" ? parsed.looking_for : null,
    };
  } catch {
    return { query: "", lookingFor: null };
  }
}

/** Every answer and alias in every language — none of them may be readable on the picture. */
function everyAnswer(texts: ParsedTexts): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of Object.values(texts)) {
    for (const name of [text.answer, ...text.aliases]) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** The search tally as the log reads it: `steam 5, web 10, wikipedia 3, commons unreachable`. */
const tally = (counts: Record<string, number | null>): string =>
  Object.entries(counts)
    .map(([name, count]) => `${name} ${count ?? "unreachable"}`)
    .join(", ");

export interface DeepSeekRoundGeneratorOptions {
  apiKey: string;
  model: string;
  /** Where an image round's pictures are looked up. Every provider that applies to the topic is asked. */
  providers: readonly ImageProvider[];
  /** Looks at every downloaded picture before it is accepted. `acceptAll` when the check is off. */
  judge?: ImageJudge;
  attempts?: number;
  /** Whole-request deadline for one streamed exchange. */
  requestTimeoutMs?: number;
  reasoningEffort?: ReasoningEffort;
}

export function createDeepSeekRoundGenerator(
  options: DeepSeekRoundGeneratorOptions,
): RoundGenerator {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const providers = options.providers;
  const judge = options.judge ?? acceptAll;

  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: DEEPSEEK_BASE_URL,
    // Guards only until the stream opens — the SDK clears this timer the
    // moment response headers arrive, and the generation after that answers
    // to `requestTimeoutMs`.
    timeout: CONNECT_TIMEOUT_MS,
    maxRetries: 1,
  });

  // `thinking` is DeepSeek's extension of the wire format; `reasoning_effort`
  // is OpenAI's own field, which DeepSeek reads when thinking is on. The
  // object is spread into every request, so the two stay one decision.
  const thinkingParams =
    reasoningEffort === "none"
      ? { thinking: { type: "disabled" } }
      : { thinking: { type: "enabled" }, reasoning_effort: reasoningEffort };
  const maxTokens = reasoningEffort === "none" ? MAX_TOKENS : MAX_TOKENS_THINKING;

  /**
   * One exchange: the raw tool input for `parseSubmission` to judge, and
   * every picture the lookups handed the model along the way — which is how
   * a submitted URL is told apart from an invented one, and where the page
   * to name as the referer comes from.
   */
  async function ask(
    request: GenerationRequest,
    retryNote: string | undefined,
    signal: AbortSignal,
  ): Promise<{ input: unknown; found: Map<string, FoundImage> }> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      // Everything constant about the job first: DeepSeek caches prompt
      // prefixes on its own, so a warm loop pays for the system prompt once.
      { role: "system", content: SYSTEM_PROMPT },
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

    // A lyrics round has nothing to look up; an image round is the reason the
    // lookup exists.
    const tools =
      request.kind === "image" ? [SEARCH_IMAGES_TOOL, SUBMIT_ROUND_TOOL] : [SUBMIT_ROUND_TOOL];
    let searchesLeft = MAX_SEARCHES;
    const found = new Map<string, FoundImage>();

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      // Per turn, not per attempt: every turn is its own request with its own
      // think. `AbortSignal.timeout` unrefs its timer, so a finished turn
      // does not hold the process open.
      const deadline = AbortSignal.timeout(requestTimeoutMs);

      let content = "";
      let reasoningContent = "";
      const fragments: StreamedToolCall[] = [];
      let finishReason: string | null = null;
      let usage:
        | (OpenAI.CompletionUsage & {
            prompt_cache_hit_tokens?: number;
            prompt_cache_miss_tokens?: number;
          })
        | undefined;

      try {
        const stream = await client.chat.completions.create(
          {
            model: options.model,
            max_tokens: maxTokens,
            tools,
            messages,
            stream: true,
            // The final chunk carries the usage block the log line is made of.
            stream_options: { include_usage: true },
            ...thinkingParams,
          },
          { signal: AbortSignal.any([signal, deadline]) },
        );

        for await (const chunk of stream) {
          if (chunk.usage) usage = chunk.usage;
          const choice = chunk.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          // `reasoning_content` is DeepSeek's thinking, streamed ahead of the
          // answer. It is kept only to be handed back on a nudge turn — the
          // API requires a tool-calling turn's reasoning to ride along.
          const delta = choice.delta as typeof choice.delta & {
            reasoning_content?: string | null;
          };
          if (delta.content) content += delta.content;
          if (delta.reasoning_content) reasoningContent += delta.reasoning_content;
          for (const part of delta.tool_calls ?? []) {
            const call = (fragments[part.index] ??= { id: "", name: "", arguments: "" });
            if (part.id) call.id = part.id;
            if (part.function?.name) call.name = part.function.name;
            if (part.function?.arguments) call.arguments += part.function.arguments;
          }
        }
      } catch (error) {
        // The caller's abort is a Ctrl+C and stays what it is; our own
        // deadline firing is the request timing out, told as such so
        // failure.ts files it under "took too long" rather than "unreachable".
        if (deadline.aborted && !signal.aborted) {
          throw new APIConnectionTimeoutError();
        }
        throw error;
      }

      // The spend, request by request, in front of the operator watching the
      // log. The cache fields are DeepSeek's own extension of the usage
      // block: hits should dominate misses on a warm loop.
      if (usage) {
        const cached = usage.prompt_cache_hit_tokens ?? 0;
        const uncached = usage.prompt_cache_miss_tokens ?? usage.prompt_tokens;
        console.log(
          `[content] ${request.topic} tokens: in ${uncached} uncached + ${cached} cached, out ${usage.completion_tokens}`,
        );
      }

      const toolCalls = fragments.filter((call) => call !== undefined);
      const submission = toolCalls.find((call) => call.name === SUBMIT_ROUND_TOOL_NAME);
      if (submission) {
        try {
          return { input: JSON.parse(submission.arguments) as unknown, found };
        } catch {
          // Arguments that are not JSON are judged like any other unusable
          // submission: `parseSubmission` rejects a non-object, and the retry
          // is told the input was not readable.
          return { input: undefined, found };
        }
      }

      if (finishReason === "content_filter") {
        throw new RoundSourceError(
          "The content source would not build a round for that topic.",
        );
      }
      // Nothing to echo back means nothing to continue from.
      if (!content && toolCalls.length === 0) break;

      messages.push({
        role: "assistant",
        content: content || null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      });

      // Every tool call has to be answered — the protocol demands a result per
      // call id. A lookup gets real results; anything else gets the nudge,
      // which is the only honest answer to a tool that does not exist.
      if (toolCalls.length > 0) {
        for (const call of toolCalls) {
          let content: string;
          if (call.name !== SEARCH_IMAGES_TOOL_NAME || request.kind !== "image") {
            content = `There is no such tool. ${NUDGE_PROMPT}`;
          } else if (searchesLeft <= 0) {
            content = `No more lookups this round. ${NUDGE_PROMPT}`;
          } else {
            searchesLeft -= 1;
            const asked = readSearchArguments(call.arguments);
            const query: ImageQuery = {
              subject: asked.query,
              lookingFor: asked.lookingFor,
              topic: request.topic,
            };
            const results = await searchImages(query, providers, signal);
            if (results.ok) {
              for (const image of results.images) found.set(image.url, image);
              const kind = query.lookingFor ? ` (${query.lookingFor})` : "";
              console.log(
                `[content] ${request.topic} looked up "${query.subject}"${kind}: ${tally(results.counts)}`,
              );
            }
            content = formatImageResults(results, query);
          }
          messages.push({ role: "tool", tool_call_id: call.id, content });
        }
        continue;
      }

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
        let found: Map<string, FoundImage>;
        try {
          ({ input, found } = await ask(request, retryNote, signal));
        } catch (error) {
          if (error instanceof RoundSourceError) throw error;
          // The SDK has already retried what is worth retrying. Anything still
          // failing here is a key, a quota or an outage, and asking again just
          // spends more money and patience on it — but *which* of those it is
          // decides both what the lobby is told and what the log says, so it
          // is read rather than flattened. See failure.ts.
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
          retryNote = `${parsed.reason} Submit a corrected round.`;
          playerMessage = "The AI could not come up with a usable round.";
          continue;
        }

        // The bank refuses duplicates too, but only exact ones and only at
        // its own door. Caught here, "the same round under another spelling"
        // costs neither a download nor a stored image — and the retry can
        // name the collision instead of shrugging.
        const duplicate = findDuplicate(parsed.texts, request.exclude, request.excludeAliases);
        if (duplicate) {
          console.warn(
            `[content] ${request.topic} attempt ${attempt}/${attempts} duplicate: "${parsed.subject}" — "${duplicate.candidate}" is already banked as "${duplicate.banked}"`,
          );
          retryNote = `"${parsed.subject}" is already in the bank — players call it "${duplicate.banked}", which is on the off-limits list. Pick a different subject.`;
          playerMessage = "The AI could not come up with a usable round.";
          continue;
        }

        const named = { subject: parsed.subject, texts: parsed.texts };

        if (parsed.kind === "lyrics") {
          return {
            kind: "lyrics",
            snippet: parsed.snippet,
            snippetLanguage: parsed.snippetLanguage,
            ...named,
          } satisfies GeneratedRound;
        }

        const candidates = orderCandidates(parsed.imageUrls, found);
        const invented = candidates.filter((candidate) => candidate.found === null).length;
        if (invented > 0) {
          console.warn(
            `[content] ${request.topic} attempt ${attempt}/${attempts}: ${invented} of ${candidates.length} URLs for "${parsed.subject}" came from nowhere the lookup showed — trying them last`,
          );
        }

        // The question the players will read, for the judge's own reading of
        // the picture: the first language asked for, which is the one the
        // prompt's examples are in.
        const first = request.languages[0]!;
        const context: JudgeContext = {
          subject: parsed.subject,
          question: parsed.texts[first]?.question ?? "",
          answers: everyAnswer(parsed.texts),
        };
        const choice = await chooseImage(candidates, {
          download: (url, referer, downloadSignal) =>
            downloadImage(url, downloadSignal, { referer, timeoutMs: IMAGE_DOWNLOAD_TIMEOUT_MS }),
          judge,
          context,
          signal,
          report: (line) => console.log(`[content] ${request.topic} ${line}`),
        });
        if (choice.image) {
          return { kind: "image", image: choice.image, ...named } satisfies GeneratedRound;
        }

        console.warn(
          `[content] ${request.topic} attempt ${attempt}/${attempts}: none of ${candidates.length} pictures for "${parsed.subject}" could be used`,
        );
        // Each attempt is a fresh conversation, so the model does not remember
        // what it tried — the note has to say what was wrong with each. Two
        // very different things can be wrong, and they want opposite answers:
        // pictures that were looked at and refused want a different *choice*
        // of picture; URLs that never downloaded at all usually mean names
        // written from memory instead of copied out of the lookup, or a
        // subject nothing has a picture of. For the second the lookup is run
        // again here and the real URLs quoted into the note — one API call
        // that works even when the model skipped the tool, which is exactly
        // the case the note exists for.
        retryNote = choice.rejected.some((rejection) => rejection.downloaded)
          ? refusedNote(parsed.subject, choice.rejected)
          : await deadNote(parsed.subject, request.topic, signal);
        playerMessage = "None of the pictures the AI picked were usable.";
      }

      // The player message stays vague on purpose; the log gets the last
      // rejection verbatim, because "detail: undefined" is what an operator
      // pastes when there is nothing better to paste.
      throw new RoundSourceError(playerMessage, {
        detail: retryNote && `every attempt was rejected — the last because ${retryNote}`,
      });
    },
  };

  /** The note when at least one picture downloaded and was refused on sight. */
  function refusedNote(subject: string, rejected: readonly Rejection[]): string {
    const lines = rejected.map((rejection) => `- ${rejection.url} — ${rejection.reason}`);
    return `none of the pictures you gave for "${subject}" could be used:\n${lines.join(
      "\n",
    )}\nPick pictures that show the subject large and plain with nothing on them that spells the answer out — a screenshot from the middle of a game, a frame from a film, the symbol without the wordmark. Search again with a different looking_for, or pick a different subject.`;
  }

  /** The note when nothing downloaded at all: the lookup is run again here and its answer quoted. */
  async function deadNote(subject: string, topic: GenerationRequest["topic"], signal: AbortSignal): Promise<string> {
    const rescue = await searchImages({ subject, lookingFor: null, topic }, providers, signal);
    if (rescue.ok && rescue.images.length > 0) {
      const lines = rescue.images.slice(0, 6).map((image) => `- ${image.label}\n  ${image.url}`);
      return `none of the image URLs you gave for "${subject}" could be downloaded — they do not exist. These do:\n${lines.join(
        "\n",
      )}\nSubmit URLs copied from a ${SEARCH_IMAGES_TOOL_NAME} result verbatim — never one you wrote yourself. If none of these show the subject plainly without spelling its name out, pick a different subject and look that one up first.`;
    }
    return `none of the image URLs you gave for "${subject}" could be downloaded, and ${SEARCH_IMAGES_TOOL_NAME} finds nothing usable for it either. Pick a different subject, call ${SEARCH_IMAGES_TOOL_NAME} for it first, and submit only URLs copied from its results.`;
  }
}
