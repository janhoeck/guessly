# Sounds

All four files come from Kenney's **Interface Sounds** pack
(<https://kenney.nl/assets/interface-sounds>), licensed **CC0** (public
domain — attribution appreciated, not required). Converted from the pack's
Ogg Vorbis to mono 16-bit WAV, because Safari does not decode Vorbis.

| File          | Pack original      | Used for                   | Character                      |
| ------------- | ------------------ | -------------------------- | ------------------------------ |
| `tick.wav`    | `bong_001.ogg`     | 3 · 2 · 1, both countdowns | short low bong, 215–300 Hz     |
| `go.wav`      | `maximize_006.ogg` | countdown reaching GO      | warm chime rising 276→551 Hz   |
| `correct.wav` | `maximize_009.ogg` | a guess scored as right    | the same rise, 1103→1544 Hz    |
| `wrong.wav`   | `minimize_008.ogg` | a guess coming back wrong  | that rise inverted, 386→276 Hz |

Three of the four are one chime — `maximize`/`minimize` is a single voice
played as a gesture, so GO, a score and a miss are the same sound rising, rising
higher, and falling. The tick is deliberately not part of it: it plays six times
a round, so it is percussion under the chimes rather than a fourth note.

**They are picked for register, not just for meaning.** The set these replaced
was semantically right and shrill — the miss put 44% of its energy above 2kHz
and 24% above 4kHz, and the tick sat at 1.9kHz, right at the peak of hearing
sensitivity, six times a round. Every file here has *no* energy above 2kHz.
Replacing one means checking that too, not only that it sounds like the right
event.

Playback lives in `lib/sounds.ts`; volumes are balanced there, not in the
files, so a replacement sound is a file swap. The gains there are set by
A-weighted loudness, because every file is normalised to the same peak and a
peak is not what anybody hears.
