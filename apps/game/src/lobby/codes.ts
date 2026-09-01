import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@guessly/protocol";

/**
 * `randomInt` rejection-samples, so every letter of the alphabet is equally
 * likely. A modulo over `randomBytes` would quietly favour the first nine.
 */
export function generateCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  }
  return code;
}

/** Public: it appears in every snapshot, so it identifies but does not authorise. */
export function generatePlayerId(): string {
  return randomBytes(16).toString("hex");
}

/** Secret: 32 bytes, hex encoded. This is what authorises a resume. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Constant time, because the caller is guessing at somebody else's seat. */
export function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
