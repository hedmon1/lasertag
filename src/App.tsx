import { lazy, Suspense } from 'react';
import { useRoute } from './ui/router.ts';
import { Home } from './screens/Home.tsx';
import { isGameCode, normalizeCode } from './net/game.ts';

// Camera screens pull in the AI runtime; load them only when needed.
const GameRoute = lazy(() => import('./screens/GameRoute.tsx').then((m) => ({ default: m.GameRoute })));
const Practice = lazy(() => import('./screens/Practice.tsx').then((m) => ({ default: m.Practice })));
const RangeTest = lazy(() => import('./screens/RangeTest.tsx').then((m) => ({ default: m.RangeTest })));

export function App() {
  const { path } = useRoute();
  const [first, second] = path;
  let screen = <Home />;
  if (first === 'g' && second && isGameCode(normalizeCode(second))) screen = <GameRoute code={normalizeCode(second)} />;
  else if (first === 'practice') screen = <Practice />;
  else if (first === 'range') screen = <RangeTest />;
  return (
    <>
      <div className="backdrop" aria-hidden><div className="stars" /><div className="grid-floor" /></div>
      <Suspense fallback={<main className="page"><p className="muted">Loading</p></main>}>{screen}</Suspense>
      <div className="crt" aria-hidden><div className="crt-beam" /></div>
    </>
  );
}
