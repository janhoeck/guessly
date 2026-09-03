/**
 * A failure with a sentence in it that is fit to put on a player's screen. The
 * underlying error goes in `cause` for the log, where it belongs; "429 from
 * api.deepseek.com" is not a thing to tell five people waiting for a picture.
 *
 * It lives in the bank package because the bank is where the producing and the
 * consuming side meet: the fill tool throws it when a round cannot be made,
 * and the game server throws it when one cannot be dealt.
 */
export class RoundSourceError extends Error {
  /**
   * The operator's half of the same failure: what is actually wrong, named
   * plainly enough to act on. Undefined when the message already says
   * everything there is to say — a round the model would not write has no
   * second explanation, but a request the API turned down does.
   */
  readonly detail: string | undefined;

  constructor(message: string, options: { cause?: unknown; detail?: string } = {}) {
    super(message, { cause: options.cause });
    this.name = "RoundSourceError";
    this.detail = options.detail;
  }
}
