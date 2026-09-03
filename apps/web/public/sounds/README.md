# Sounds

All four files come from Kenney's **Interface Sounds** pack
(<https://kenney.nl/assets/interface-sounds>), licensed **CC0** (public
domain — attribution appreciated, not required). Converted from the pack's
Ogg Vorbis to mono 16-bit WAV, because Safari does not decode Vorbis.

| File          | Pack original          | Used for                    |
| ------------- | ---------------------- | --------------------------- |
| `tick.wav`    | `glass_003.ogg`        | 3 · 2 · 1, both countdowns  |
| `go.wav`      | `confirmation_002.ogg` | countdown reaching GO       |
| `correct.wav` | `confirmation_001.ogg` | a guess scored as right     |
| `wrong.wav`   | `error_001.ogg`        | a guess coming back wrong   |

Playback lives in `lib/sounds.ts`; volumes are balanced there, not in the
files, so a replacement sound is a file swap.
