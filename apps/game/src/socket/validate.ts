import {
  err,
  isLanguageId,
  isRoundVote,
  isTopicId,
  ok,
  type Ack,
  type CreateLobbyPayload,
  type GuessPayload,
  type JoinLobbyPayload,
  type ResumeLobbyPayload,
  type SetLanguagePayload,
  type SetTargetPayload,
  type SetTopicsPayload,
  type TopicId,
  type VotePayload,
} from "@guessly/protocol";

/**
 * The boundary guard. Everything arriving here is untrusted input from a
 * socket, and these parsers establish only one thing: that the fields are the
 * primitives they claim to be. Every *rule* — how long a nickname may be, what
 * a target score is allowed to be — belongs to the store, which is where it can
 * be tested without a socket.
 *
 * Each failure reuses the most truthful existing error code, so a malformed
 * payload reads to the client exactly like the equivalent invalid one.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A `TopicId` *is* the primitive here — it is a closed union, so proving the
 * field is what it claims to be means checking membership. How *many* topics a
 * lobby needs is a rule, and stays in the store.
 */
const isTopicIdArray = (value: unknown): value is TopicId[] =>
  Array.isArray(value) && value.every(isTopicId);

export function parseCreate(raw: unknown): Ack<CreateLobbyPayload> {
  const payload = isRecord(raw) ? raw : {};
  const { nickname, targetScore, topics, language } = payload;
  if (typeof nickname !== "string") return err("INVALID_NICKNAME", "A nickname is required.");
  if (typeof targetScore !== "number") return err("INVALID_TARGET_SCORE", "A target score is required.");
  if (!isTopicIdArray(topics)) return err("INVALID_TOPICS", "A list of topics is required.");
  if (!isLanguageId(language)) return err("INVALID_LANGUAGE", "A language is required.");
  return ok({ nickname, targetScore, topics, language });
}

export function parseJoin(raw: unknown): Ack<JoinLobbyPayload> {
  const payload = isRecord(raw) ? raw : {};
  const { code, nickname } = payload;
  if (typeof code !== "string") return err("LOBBY_NOT_FOUND", "A lobby code is required.");
  if (typeof nickname !== "string") return err("INVALID_NICKNAME", "A nickname is required.");
  return ok({ code, nickname });
}

export function parseResume(raw: unknown): Ack<ResumeLobbyPayload> {
  const payload = isRecord(raw) ? raw : {};
  const { code, playerId, resumeToken } = payload;
  if (typeof code !== "string" || typeof playerId !== "string" || typeof resumeToken !== "string") {
    return err("RESUME_REJECTED", "That seat could not be reclaimed.");
  }
  return ok({ code, playerId, resumeToken });
}

export function parseSetTarget(raw: unknown): Ack<SetTargetPayload> {
  const payload = isRecord(raw) ? raw : {};
  const { targetScore } = payload;
  if (typeof targetScore !== "number") return err("INVALID_TARGET_SCORE", "A target score is required.");
  return ok({ targetScore });
}

/**
 * The guess itself is passed through exactly as typed. Trimming it, capping it
 * and deciding whether it is even a guess are rules, and they live in the store
 * beside the matcher that has to agree with them.
 */
export function parseGuess(raw: unknown): Ack<GuessPayload> {
  const payload = isRecord(raw) ? raw : {};
  const { roundNumber, guess } = payload;
  if (typeof roundNumber !== "number") {
    return err("ROUND_NOT_OPEN", "A round number is required.");
  }
  if (typeof guess !== "string") return err("INVALID_GUESS", "A guess is required.");
  return ok({ roundNumber, guess });
}

/** A `RoundVote` is a closed union of two strings, so membership is the whole check. */
export function parseVote(raw: unknown): Ack<VotePayload> {
  const payload = isRecord(raw) ? raw : {};
  const { roundNumber, vote } = payload;
  if (typeof roundNumber !== "number") {
    return err("ROUND_NOT_OPEN", "A round number is required.");
  }
  if (!isRoundVote(vote)) return err("INVALID_VOTE", "A vote is thumbs up or thumbs down.");
  return ok({ roundNumber, vote });
}

export function parseSetTopics(raw: unknown): Ack<SetTopicsPayload> {
  const payload = isRecord(raw) ? raw : {};
  const { topics } = payload;
  if (!isTopicIdArray(topics)) return err("INVALID_TOPICS", "A list of topics is required.");
  return ok({ topics });
}

/** A `LanguageId` is a closed union too, so membership is the whole check. */
export function parseSetLanguage(raw: unknown): Ack<SetLanguagePayload> {
  const payload = isRecord(raw) ? raw : {};
  const { language } = payload;
  if (!isLanguageId(language)) return err("INVALID_LANGUAGE", "A language is required.");
  return ok({ language });
}
