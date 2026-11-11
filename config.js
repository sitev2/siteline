// Network + game tuning. Edit freely.

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

// PeerJS signalling server. null = the free public PeerJS cloud server.
// To use your own (e.g. `npx peerjs --port 9000`), set it here or pass
// ?peerhost=example.com&peerport=443&peerpath=/&peersecure=1 in the URL.
let peerServer = null;
if (params.get('peerhost')) {
  peerServer = {
    host: params.get('peerhost'),
    port: Number(params.get('peerport') || 443),
    path: params.get('peerpath') || '/',
    secure: params.get('peersecure') !== '0',
  };
}

export const CONFIG = {
  peerPrefix: 'siteline-v1-',
  peerServer,
  // STUN finds a direct route between players. On some mobile networks a TURN
  // relay is also needed — add one here, e.g.
  // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  // Your own game servers (see the server folder), best first. Hosting uses the
  // first one that answers; if none does, it makes a direct (peer-to-peer) room.
  // Paste each address with wss:// in front, e.g.
  //   { name: 'Home', url: 'wss://gamebox.tail1234.ts.net' },
  //   { name: 'Render', url: 'wss://siteline-server.onrender.com' },
  servers: [
  ],
  // Test one server on its own with ?server=wss://... in the page address
  // (then only that server is used).
  serverUrl: params.get('server') || '',

  // Relay (TURN) for school, office and mobile networks that block direct
  // peer-to-peer connections. Sign up free at https://www.metered.ca/ (Open Relay),
  // then paste your app name (the part before .metered.live) and API key here.
  // Leave both empty to play without a relay.
  turnApp: 'siteline-lukloc',   // → siteline-lukloc.metered.live
  turnApiKey: 'e53ed2ed1a92fec2c7ea8023d42a5a2fb4a6',
  // force every connection through the relay (for testing): add ?relay to the URL
  relayOnly: params.has('relay'),
  // Player accounts (optional, free): create a Supabase project, then paste its Project URL
  // and its publishable key (sb_publishable_…) or legacy anon key (eyJ…) here — step-by-step
  // in SUPABASE.md. Leave both empty for guest-only play.
  supabaseUrl: 'https://jignmwagssltldjbswgq.supabase.co',
  supabaseAnonKey: 'sb_publishable_rJbvid44mJsPkGubIZZYBg_o6pGas39',
  maxPlayers: 4,     // wingman: 2 v 2
  debug: params.has('debug'),
};

export const RULES = {
  freezeTime: 6,     // seconds you can't move at round start
  buyTime: 20,       // seconds from round start (freeze time included) the buy menu stays open
  roundTime: 115,    // 1:55 to plant before the defenders win
  bombTime: 40,      // seconds from plant to explosion
  plantTime: 3.2,
  defuseTime: 10,    // without a kit
  defuseKitTime: 5,  // with a defuse kit
  endTime: 6,        // pause between rounds
  winRounds: 9,      // 2v2 wingman: first to 9 rounds wins
  halftimeAfter: 8,  // teams switch sides after this many rounds
  maxRounds: 16,     // 8–8 after 16 rounds is a draw
  teamSize: 2,       // players per team
  friendlyFire: 1 / 3, // teammates take a third of normal damage
  // bomb blast: certain death within lethalRadius, fading to nothing at maxRadius (metres of path,
  // walls block it and it bends round corners); armour halves it
  blastLethal: 14.3,
  blastMax: 44.2,
  blastArmor: 0.5,
  // deathmatch: free-for-all for 2–4 players, first to killLimit or timeLimit seconds
  dm: { killLimit: 30, timeLimit: 600, respawn: 1, minPlayers: 2, maxPlayers: 4 },
};
