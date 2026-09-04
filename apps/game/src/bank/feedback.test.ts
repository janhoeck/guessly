import { afterEach, describe, expect, it, vi } from "vitest";
import { createInMemoryRoundRepository, type NewBankedRound, type RoundRepository } from "@guessly/bank";
import { createBankedRoundFeedback } from "./feedback.js";

const NOON = 1_700_000_000_000;

const A_ROUND: NewBankedRound = {
  topic: "flags",
  kind: "image",
  subject: "Bhutan",
  imageFile: `${"a".repeat(64)}.png`,
  sourceUrl: "https://example.test/bhutan.png",
  snippet: null,
  snippetLanguage: null,
  texts: {
    en: { question: "Which country's flag is this?", answer: "Bhutan", aliases: [] },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the banked round feedback", () => {
  it("writes the thumb to the bank, against the round it was cast on", async () => {
    const repository = createInMemoryRoundRepository();
    await repository.init();
    await repository.insert(A_ROUND, NOON, false);
    const [banked] = (await repository.list({}, { offset: 0, limit: 1 })).rounds;
    const feedback = createBankedRoundFeedback(repository);

    await feedback.record({ roundId: banked!.id, language: "en", vote: "up", at: NOON + 1 });
    await feedback.record({ roundId: banked!.id, language: "en", vote: "down", at: NOON + 2 });

    expect((await repository.get(banked!.id))?.votes).toEqual({ up: 1, down: 1 });
    await repository.close();
  });

  /**
   * The player was acked before this ran, so a bank that will not take the
   * vote — gone, or the round deleted under it — is the log's business and
   * nobody else's. The promise resolving is the whole contract.
   */
  it("logs a bank that refuses the vote rather than throwing", async () => {
    const repository = {
      recordVote: async () => {
        throw new Error("the bank is away");
      },
    } as unknown as RoundRepository;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const feedback = createBankedRoundFeedback(repository);

    await expect(
      feedback.record({ roundId: 404, language: "en", vote: "down", at: NOON }),
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]?.[0]).toContain("round 404");
  });
});
