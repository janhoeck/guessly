import { dedupKey } from "./dedup.js";
import { USER_AGENT } from "./download.js";
import type { FoundImage, ImageProvider } from "./search.js";

/**
 * The Steam store's own screenshots, for games rounds.
 *
 * A video game is best shown as itself — a scene from the middle of it — and
 * for most PC games the publisher has already picked half a dozen of those
 * and put them on the store page at 1920×1080. Two keyless storefront calls
 * get there: a search by title for the app id, then the app's details
 * filtered down to its screenshots. They lead the list on a games round
 * because a screenshot is what that round should show; console exclusives
 * are the web search's job.
 *
 * What the store does not promise is that a screenshot is *clean*: some are
 * marketing shots with the title composited in, and a menu screen is a
 * screenshot too. That is what the vision check is for. This provider makes
 * the candidates real; it does not judge them.
 */

const SEARCH_ENDPOINT = "https://store.steampowered.com/api/storesearch/";
const DETAILS_ENDPOINT = "https://store.steampowered.com/api/appdetails";
const STORE_PAGE = "https://store.steampowered.com/app/";

const API_TIMEOUT_MS = 10_000;

/** Enough to choose from; the store lists ten or more and they are all the same game. */
const MAX_SCREENSHOTS = 5;

/**
 * Store entries that share a game's name without being the game. The search
 * ranks the game itself first almost always, but "Portal 2 Soundtrack" is a
 * separate app with no screenshots worth having, and a demo's are the game's.
 */
const NOT_THE_GAME = /\b(soundtrack|ost|dlc|demo|season pass|bundle|expansion|art ?book|trailer)\b/i;

export interface StoreApp {
  id: number;
  name: string;
}

/**
 * The app the search most likely meant. Exported for its own test: a title
 * that matches the subject exactly wins over the ranking, and a soundtrack
 * never wins at all.
 */
export function pickStoreApp(payload: unknown, subject: string): StoreApp | null {
  const items = (payload as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return null;

  const apps: StoreApp[] = [];
  for (const item of items) {
    const record = item as { type?: unknown; id?: unknown; name?: unknown };
    if (record.type !== "app") continue;
    const id = Number(record.id);
    if (!Number.isInteger(id) || id <= 0 || typeof record.name !== "string") continue;
    if (NOT_THE_GAME.test(record.name)) continue;
    apps.push({ id, name: record.name.trim() });
  }

  const wanted = dedupKey(subject);
  return apps.find((app) => dedupKey(app.name) === wanted) ?? apps[0] ?? null;
}

/** Steam names its renders by their size: `ss_<hash>.1920x1080.jpg`. */
const SIZE_IN_NAME = /\.(\d{3,4})x(\d{3,4})\.(?:jpe?g|png|webp)(?:\?|$)/i;

/**
 * An app's details, read into its screenshots. Exported for its own test:
 * only a `game` is offered — a soundtrack that slipped past the name check
 * has `type: "music"` here — and only the full-size render, never the store's
 * 600px thumbnail.
 */
export function parseAppScreenshots(payload: unknown, app: StoreApp): FoundImage[] {
  const entry = (payload as Record<string, unknown> | undefined)?.[String(app.id)] as
    | { success?: unknown; data?: { type?: unknown; name?: unknown; screenshots?: unknown } }
    | undefined;
  if (!entry || entry.success !== true || entry.data?.type !== "game") return [];
  const shots = entry.data.screenshots;
  if (!Array.isArray(shots)) return [];

  const name = typeof entry.data.name === "string" ? entry.data.name : app.name;
  const out: FoundImage[] = [];
  for (const shot of shots) {
    const full = (shot as { path_full?: unknown }).path_full;
    if (typeof full !== "string" || !full.startsWith("https://")) continue;
    const size = SIZE_IN_NAME.exec(full);
    out.push({
      source: "steam",
      label: `${name} — store screenshot ${out.length + 1}`,
      url: full,
      mime: "image/jpeg",
      width: size ? Number(size[1]) : 0,
      height: size ? Number(size[2]) : 0,
      description: "the publisher's own screenshot from the Steam store page",
      page: `${STORE_PAGE}${app.id}`,
      site: null,
    });
    if (out.length === MAX_SCREENSHOTS) break;
  }
  return out;
}

async function getJson(url: URL, signal: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export function createSteamProvider(): ImageProvider {
  return {
    name: "steam",
    placement: "lead",
    appliesTo: (topic) => topic === "games",
    async search(query, signal) {
      const search = new URL(SEARCH_ENDPOINT);
      search.search = new URLSearchParams({ term: query.subject, l: "english", cc: "US" }).toString();
      const found = await getJson(search, signal);
      if (found === null) return null;

      const app = pickStoreApp(found, query.subject);
      // Not on Steam is an empty shelf, not a failed lookup.
      if (!app) return [];

      const details = new URL(DETAILS_ENDPOINT);
      details.search = new URLSearchParams({
        appids: String(app.id),
        l: "english",
        filters: "basic,screenshots",
      }).toString();
      const payload = await getJson(details, signal);
      if (payload === null) return null;
      return parseAppScreenshots(payload, app);
    },
  };
}
