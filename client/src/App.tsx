import { Landing } from './components/Landing.tsx';
import { MeetingSummary } from './components/MeetingSummary.tsx';
import { Room } from './components/Room.tsx';
import { useRoundtable } from './lib/useRoundtable.ts';

export default function App() {
  const rt = useRoundtable();
  if (rt.session) return <Room rt={rt} session={rt.session} />;
  if (rt.meeting) return <MeetingSummary meeting={rt.meeting} onClose={rt.closeSummary} />;
  return <Landing rt={rt} />;
}
