/**
 * The topic catalogue.
 *
 * A topic is what a round is *about*; `kind` is what the round physically shows
 * for it. That distinction is the reason this is a table rather than a list of
 * strings: lyrics only make sense for music, so a host who deselects `music`
 * has, without being told so, turned the game into images only. The UI can say
 * that out loud because the mapping lives here.
 *
 * IDs are the wire format and must never change once a client has shipped;
 * labels are copy and may. Order is the order the catalogue renders in, and the
 * order a lobby's selection is normalised into, so a snapshot is stable no
 * matter what order the host clicked things in.
 */

export type RoundKind = "image" | "lyrics";

export interface TopicDefinition {
  /** Wire format. Stable forever. */
  id: string;
  label: string;
  kind: RoundKind;
  /**
   * One line, shown beside the label wherever there is room for it — and read
   * by the content generator, which quotes it into the prompt as the
   * description of the topic. So it is copy with a second reader: a hint that
   * names something the open archives do not photograph is an instruction to
   * go and fail. "Memes" alone used to sit here, and the model dutifully went
   * looking for meme images, which are stock photos on hosts that block us.
   */
  hint: string;
}

export const TOPICS = [
  { id: "flags", label: "Flags", kind: "image", hint: "Countries and territories" },
  { id: "logos", label: "Logos & brands", kind: "image", hint: "Marks with the name cropped out" },
  { id: "movies", label: "Movies", kind: "image", hint: "Props, places and faces from the films" },
  { id: "games", label: "Video games", kind: "image", hint: "Characters, statues and cosplay" },
  { id: "landmarks", label: "Landmarks", kind: "image", hint: "Buildings, cities, natural wonders" },
  { id: "animals", label: "Animals", kind: "image", hint: "Species, common and obscure" },
  { id: "food", label: "Food & drink", kind: "image", hint: "Dishes from everywhere" },
  { id: "sports", label: "Sports", kind: "image", hint: "Kit, venues, moments" },
  { id: "technology", label: "Technology", kind: "image", hint: "Hardware, interfaces, gadgets" },
  { id: "art", label: "Art", kind: "image", hint: "Paintings, sculpture, photography" },
  { id: "mainstream", label: "Pop culture", kind: "image", hint: "Memes, TV, the faces behind them" },
  { id: "music", label: "Music", kind: "lyrics", hint: "A snippet of lyrics — name the song" },
] as const satisfies readonly TopicDefinition[];

export type TopicId = (typeof TOPICS)[number]["id"];

/** Catalogue order. This is also a new lobby's default: everything on. */
export const ALL_TOPIC_IDS: readonly TopicId[] = TOPICS.map((topic) => topic.id);

/**
 * A lobby with no topics has nothing to build a round from, so the floor is
 * one. There is no ceiling — every topic selected is the default.
 */
export const MIN_TOPICS = 1;

const KNOWN_TOPIC_IDS: ReadonlySet<string> = new Set<string>(ALL_TOPIC_IDS);

export const isTopicId = (value: unknown): value is TopicId =>
  typeof value === "string" && KNOWN_TOPIC_IDS.has(value);

/**
 * Catalogue lookup, for rendering a stored id back into copy. The cast is the
 * one place this file asserts something TypeScript cannot check: the record is
 * built from the very array `TopicId` is derived from, so it is total by
 * construction.
 */
const TOPICS_BY_ID = Object.fromEntries(
  TOPICS.map((topic) => [topic.id, topic]),
) as Record<TopicId, TopicDefinition>;

export const topicById = (id: TopicId): TopicDefinition => TOPICS_BY_ID[id];
