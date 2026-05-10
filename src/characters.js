/**
 * Playable roster: cinematic FBX bundles, title-screen dossier copy, and per-fighter Disco Vortex dance.
 */

export const DEFAULT_CHARACTER_ID = 'serena_v';

/** @typedef {{ label: string; value: string; hint?: string }} CharacterStat */

export const CHARACTER_ROSTER = [
  {
    id: 'serena_v',
    displayName: 'SERENA V.',
    codename: 'AGENT // SERENA V.',
    role: 'Floorbreaker · Vanguard dancer',
    accent: '#ff2aa8',
    playable: true,
    profileSelectFbx: '/models/characters/serena/select/receive-soccerball.fbx',
    stats: [
      { label: 'Resilience', value: 'A', hint: 'Walks through bass that floors everyone else' },
      { label: 'Groove sync', value: 'S', hint: 'Weapon rhythm locks to the hive-mind waveform' },
      { label: 'Threat radius', value: 'A-', hint: 'Crowd-control queen of the parquet' },
      { label: 'Neural shield', value: 'S', hint: 'Immune pulse — explosion never rewrote her step' }
    ],
    dossier:
      'When the Trenchville “kindness frequency” went live, every Kol on the grid dropped into the same hypnotic shuffle — except Serena. She woke up mid-chorus with the bass still screaming in her teeth and a disco ball where her conscience used to be. She does not negotiate with the beat. She breaks it.',
    cinematic: {
      /** Finale intro before boss; MP4 first in browser. Files under `public/video/finale-cutscene/`. */
      bossIntroClip: {
        mp4: '/video/finale-cutscene/serena.mp4',
        mov: '/video/finale-cutscene/serena.mov'
      },
      deathModel: '/models/Dying.fbx',
      waveClearModels: [
        '/models/wave-clear/aiming-gun.fbx',
        '/models/wave-clear/baseball-hit.fbx',
        '/models/wave-clear/hit-side.fbx'
      ],
      dareHeroModel: '/models/dare/HipHopDancing.fbx'
    },
    specialAttackModel: '/models/special/NorthernSoulSpin.fbx'
  },
  {
    id: 'timmy_paperhanz',
    displayName: 'TIMMY PAPERHANZ',
    codename: 'AGENT // TIMMY PAPERHANZ',
    role: 'Street analyst · Samba striker',
    accent: '#33d4ff',
    playable: true,
    profileSelectFbx: '/models/characters/timmy/select/zombie-walk.fbx',
    stats: [
      { label: 'Resilience', value: 'B+', hint: 'Paper-thin cover story, iron spine' },
      { label: 'Groove sync', value: 'A', hint: 'Reads corrupted waveforms like sheet music' },
      { label: 'Threat radius', value: 'B', hint: 'Precision clears — loves a tight line' },
      { label: 'Neural shield', value: 'A', hint: 'Mind-control chorus slid off him like rain' }
    ],
    dossier:
      'Timmy was cataloguing bootleg vinyl behind Trenchville’s old cinema when the Doctor’s mind-control anthem detonated across the city. The crowd outside turned into a single swaying organism; Timmy only heard the wrong note — the one that was never supposed to exist. He grabbed his pack, tuned his ears to the static between stations, and stepped into the street to teach the hive a new dance.',
    cinematic: {
      bossIntroClip: {
        mp4: '/video/finale-cutscene/timmy.mp4',
        mov: '/video/finale-cutscene/timmy.mov'
      },
      deathModel: '/models/characters/timmy/dying/dying.fbx',
      waveClearModels: [
        '/models/characters/timmy/wave-clear/corkscrew-evade.fbx',
        '/models/characters/timmy/wave-clear/praying.fbx',
        '/models/characters/timmy/wave-clear/sword-shield-power-up.fbx'
      ],
      dareHeroModel: '/models/characters/timmy/dare/samba-dancing.fbx'
    },
    specialAttackModel: '/models/characters/timmy/special/gangnam-style.fbx'
  },
  {
    id: 'chad_chuddington',
    displayName: 'CHAD CHUDDINGTON',
    codename: 'AGENT // CHAD “IRON CALF” CHUDDINGTON',
    role: 'Confidence ops · Chicken-dare specialist',
    accent: '#c8ff33',
    playable: true,
    profileSelectFbx: '/models/characters/chad/select/taunt.fbx',
    stats: [
      { label: 'Resilience', value: 'A-', hint: 'Takes a hit, posts about it, still wins the rep' },
      { label: 'Groove sync', value: 'B+', hint: 'Off-beat on purpose — the hive can’t mirror chaos' },
      { label: 'Threat radius', value: 'A', hint: 'AOE ego — enemies scatter or get flexed on' },
      { label: 'Neural shield', value: 'B', hint: 'Doctor’s chorus bounced; Chad heard “weak signal”' }
    ],
    dossier:
      'Chad was mid-podcast on “alpha acoustics” at a Trenchville rooftop gym when the Doctor’s mind-control anthem rolled across the skyline. Every lifter below synced into the same creepy smile-and-sway — except Chad, who assumed the bass was jealous of his calves. Once he realized the city wasn’t admiring him organically, he vowed to deadlift the frequency off the airwaves and restore honest, obnoxious free will.',
    cinematic: {
      /** Uses Timmy reel as placeholder until Chad-specific finale clip exists. */
      bossIntroClip: {
        mp4: '/video/finale-cutscene/chad.mp4',
        mov: '/video/finale-cutscene/chad.mov'
      },
      deathModel: '/models/characters/chad/dying/falling-back-death.fbx',
      waveClearModels: [
        '/models/characters/chad/wave-clear/floating.fbx',
        '/models/characters/chad/wave-clear/goalkeeper-drop-kick.fbx',
        '/models/characters/chad/wave-clear/jog-in-circle.fbx'
      ],
      dareHeroModel: '/models/characters/chad/dare/chicken-dance.fbx'
    },
    specialAttackModel: '/models/characters/chad/special/thriller-part-3.fbx'
  }
];

/** @param {string} id */
export function getCharacter(id) {
  return CHARACTER_ROSTER.find((c) => c.id === id) || CHARACTER_ROSTER[0];
}

export function firstPlayableCharacterId() {
  const p = CHARACTER_ROSTER.find((c) => c.playable);
  return p ? p.id : DEFAULT_CHARACTER_ID;
}

/** @typedef {{ mp4: string; mov: string }} BossIntroClip */

/**
 * Finale pre-boss video paths for the selected fighter (`public/video/finale-cutscene/`).
 * @param {string} characterId
 * @returns {BossIntroClip}
 */
export function getFinaleBossIntroClip(characterId) {
  const ch = getCharacter(characterId);
  const c = ch?.cinematic?.bossIntroClip;
  if (c && typeof c.mp4 === 'string' && typeof c.mov === 'string') return c;
  return {
    mp4: '/video/finale-cutscene/timmy.mp4',
    mov: '/video/finale-cutscene/timmy.mov'
  };
}
