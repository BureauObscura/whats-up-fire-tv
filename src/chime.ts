import {AudioPlayer} from '@amazon-devices/react-native-w3cmedia';

// The alert chime (assets/media/chime.mp3: an Airbus-style cabin PA "ding-dong", supplied
// by the owner, trimmed and mono), played by Vega's own audio player when the page asks (a
// plane entered the alert zone, or a Settings preview). Chimes are rare, so each gets a
// fresh player, released once it has finished: on this player a finished clip stays
// "playing" at its end and won't restart from the top.
export const CHIME_URL = 'file:///pkg/assets/media/chime.mp3';
const CHIME_MS = 2400;

let current: AudioPlayer | null = null;

export function releaseChime() {
  const p = current;
  current = null;
  if (p) {
    try {
      p.pause();
    } catch {
      // already stopped
    }
    p.deinitialize().catch(() => {});
  }
}

export async function playChime(volume: number) {
  releaseChime();
  const p = new AudioPlayer();
  current = p;
  try {
    await p.initialize();
    if (current !== p) {
      p.deinitialize().catch(() => {});
      return;
    }
    p.volume = Math.max(0, Math.min(1, volume));
    p.src = CHIME_URL;
    await p.play();
    setTimeout(() => {
      if (current === p) {
        releaseChime();
      }
    }, CHIME_MS + 1000);
  } catch (e) {
    console.error(`[chime] ${String(e)}`);
    if (current === p) {
      releaseChime();
    }
  }
}
