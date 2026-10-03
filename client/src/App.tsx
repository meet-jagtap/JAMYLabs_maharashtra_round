import { Landing } from './components/Landing.tsx';
import { Room } from './components/Room.tsx';
import { useRoundtable } from './lib/useRoundtable.ts';

export default function App() {
  const rt = useRoundtable();
  return rt.session ? <Room rt={rt} session={rt.session} /> : <Landing rt={rt} />;
}
