// The home screen's arcade cabinet art: an attract-mode demo of a match on the cabinet screen,
// and the control deck under it. Pure decoration (aria-hidden); the animation is CSS, in
// steps, so it moves like an old sprite game.

const INK = '#05040f';

/** One blocky player facing right, holding a blaster. P2 is the same figure mirrored. */
function Player({ helmet }: { helmet: string }) {
  return (
    <g stroke={INK} strokeWidth="1.5">
      <rect x="34" y="100" width="6" height="18" fill="#2b2752" />
      <rect x="44" y="100" width="6" height="18" fill="#3b3570" />
      <rect x="32" y="76" width="20" height="26" fill="#3b3570" />
      <rect x="32" y="84" width="20" height="4" fill={helmet} stroke="none" />
      <rect x="32" y="56" width="20" height="20" fill={helmet} />
      <rect x="42" y="62" width="12" height="7" fill={INK} stroke="none" />
      <rect x="48" y="63" width="3" height="2" fill="#f6f3ff" stroke="none" />
      <rect x="46" y="82" width="18" height="6" fill="#3b3570" />
      <rect x="60" y="76" width="22" height="7" fill="#e9e6fb" />
      <rect x="82" y="78" width="6" height="3" fill="#2b2752" />
      <rect x="62" y="83" width="5" height="7" fill="#2b2752" />
      <rect x="66" y="78" width="4" height="3" fill={helmet} stroke="none" />
    </g>
  );
}

function Reticle({ color }: { color: string }) {
  return (
    <g fill={color} stroke={INK} strokeWidth="1">
      <rect x="276" y="70" width="4" height="10" />
      <rect x="276" y="96" width="4" height="10" />
      <rect x="260" y="86" width="10" height="4" />
      <rect x="286" y="86" width="10" height="4" />
      <rect x="276" y="86" width="4" height="4" />
    </g>
  );
}

export function AttractScene() {
  return (
    <svg className="attract" viewBox="0 0 320 150" aria-hidden>
      <rect width="320" height="150" fill="#07061a" />
      <g fill="#f6f3ff" opacity="0.7">
        <rect x="104" y="34" width="2" height="2" />
        <rect x="150" y="22" width="2" height="2" />
        <rect x="196" y="40" width="2" height="2" />
        <rect x="222" y="28" width="2" height="2" />
        <rect x="128" y="52" width="2" height="2" />
      </g>
      <rect y="118" width="320" height="32" fill="#120f33" />
      <g stroke="#26e0ff" strokeOpacity="0.35" strokeWidth="1">
        <path d="M0 118H320M0 124H320M0 132H320M0 143H320" />
        <path d="M160 118L160 150M130 118L70 150M100 118L-20 150M190 118L250 150M220 118L340 150" />
      </g>

      <g className="att-hud">
        <text x="10" y="16" fill="#c6ff3a">1P</text>
        <g fill="#c6ff3a" stroke={INK} strokeWidth="1">
          <rect x="34" y="8" width="10" height="7" />
          <rect x="46" y="8" width="10" height="7" />
          <rect x="58" y="8" width="10" height="7" />
          <rect x="70" y="8" width="10" height="7" />
        </g>
        <g fill="#26e0ff" stroke={INK} strokeWidth="1">
          <rect className="att-hp-drop" x="240" y="8" width="10" height="7" />
          <rect x="252" y="8" width="10" height="7" />
          <rect x="264" y="8" width="10" height="7" />
          <rect x="276" y="8" width="10" height="7" />
        </g>
        <text x="292" y="16" fill="#26e0ff">2P</text>
      </g>

      <Player helmet="#c6ff3a" />
      <g className="att-p2">
        <g transform="translate(320 0) scale(-1 1)">
          <Player helmet="#26e0ff" />
        </g>
        <rect className="att-hit" x="266" y="54" width="24" height="50" fill="#ff4d4d" />
      </g>

      <line className="att-tracer" x1="92" y1="80" x2="266" y2="88" stroke="#ffd23e" strokeWidth="3" strokeDasharray="10 6" />
      <g className="att-flash">
        <rect x="88" y="73" width="4" height="14" fill="#ffd23e" />
        <rect x="84" y="78" width="14" height="4" fill="#ffd23e" />
        <rect x="88" y="78" width="4" height="4" fill="#f6f3ff" />
      </g>

      <g className="att-aim">
        <g className="att-reticle-free"><Reticle color="#f6f3ff" /></g>
        <g className="att-reticle-lock"><Reticle color="#c6ff3a" /></g>
      </g>
      <path className="att-marker" d="M268 78l-6-6M288 78l6-6M268 98l-6 6M288 98l6 6" stroke="#f6f3ff" strokeWidth="3" />

      <text className="att-prompt" x="160" y="140" textAnchor="middle" fill="#ffd23e">1P VS 2P</text>
    </svg>
  );
}

export function ControlDeck() {
  const buttons: [number, string, string][] = [
    [176, '#c6ff3a', '#7f9f22'],
    [208, '#26e0ff', '#1689a0'],
    [240, '#ffd23e', '#a8861f'],
    [272, '#ff3d8b', '#a02457'],
  ];
  return (
    <svg className="deck" viewBox="0 0 320 64" aria-hidden>
      <rect width="320" height="64" fill="#13112e" />
      <rect width="320" height="4" fill="#24204a" />
      <rect x="40" y="44" width="40" height="10" fill="#2b2752" stroke={INK} strokeWidth="2" />
      <g className="deck-stick">
        <rect x="58" y="22" width="4" height="24" fill="#c7c3ec" stroke={INK} strokeWidth="1.5" />
        <path d="M54 6h12v2h2v2h2v12h-2v2h-2v2H54v-2h-2v-2h-2V10h2V8h2z" fill="#ff4d4d" stroke={INK} strokeWidth="2" />
        <rect x="55" y="10" width="4" height="4" fill="#ffb3b3" />
      </g>
      <rect x="112" y="16" width="20" height="34" fill="#2b2752" stroke={INK} strokeWidth="2" />
      <rect className="deck-coin" x="120" y="22" width="4" height="16" fill="#ff4d4d" />
      {buttons.map(([x, top, side], i) => (
        <g key={x} className={i === 0 ? 'deck-fire' : undefined}>
          <rect x={x} y="30" width="24" height="8" fill={side} stroke={INK} strokeWidth="2" />
          <rect className="deck-cap" x={x} y="22" width="24" height="10" fill={top} stroke={INK} strokeWidth="2" />
        </g>
      ))}
    </svg>
  );
}
