import {AudioPlayer} from '@amazon-devices/react-native-w3cmedia';

// The alert chime (assets/media/chime.mp3: a cabin-style "ding-dong", E5 then C5,
// synthesized for this app), played by Vega's own audio player when the page asks (a plane entered the alert zone, or a Settings
// preview). One player, kept ready; a chime that arrives while one plays restarts it.
export const CHIME_URL = 'file:///pkg/assets/media/chime.mp3';

let player: AudioPlayer | null = null;
let ready: Promise<AudioPlayer | null> | null = null;

function load(): Promise<AudioPlayer | null> {
  if (!ready) {
    ready = (async () => {
      const p = new AudioPlayer();
      await p.initialize();
      p.src = CHIME_URL;
      player = p;
      return p;
    })().catch(e => {
      console.error(`[chime] load: ${String(e)}`);
      ready = null;
      return null;
    });
  }
  return ready;
}

export async function playChime(volume: number) {
  const p = await load();
  if (!p) {
    return;
  }
  try {
    p.volume = Math.max(0, Math.min(1, volume));
    p.currentTime = 0;
    await p.play();
  } catch (e) {
    console.error(`[chime] play: ${String(e)}`);
  }
}

export function releaseChime() {
  const p = player;
  player = null;
  ready = null;
  p?.deinitialize().catch(() => {});
}
