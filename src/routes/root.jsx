import { Routes, Route } from "react-router-dom";
import TSHFields from '../components/fields';
import WelcomeCard from '../components/WelcomeCard';

import Production from './production/production';
import Bracket from './bracket/bracket';
import Commentary from './commentary/commentary';
import PlayerList from './player_list/player_list';
import ScoreboardManager from './scoreboard_manager/scoreboard_manager';
import TournamentInfo from "./tournament_info/tournament_info";
import LayoutBrowser from "./layouts/layouts";

// Nav tabs. Rendered in the header row by TSHFields; routes wired below.
const allTabs = [
  { name: "Production", path: "/" },
  { name: "Scoreboard", path: "/scoreboard" },
  { name: "Competition Info", path: "/tournament_info" },
  { name: "Bracket", path: "/bracket" },
  { name: "Commentary", path: "/commentary" },
  { name: "Setup", path: "/layouts" },
];

export default function Root() {
  return (
    <div className="min-h-screen">
      <TSHFields tabs={allTabs} />
      <WelcomeCard />
      <div className="p-5">
        <Routes>
          <Route path="/" element={<Production />} />
          <Route path="/scoreboard" element={<ScoreboardManager />} />
          <Route path="/tournament_info" element={<TournamentInfo />} />
          <Route path="/bracket" element={<Bracket />} />
          <Route path="/commentary" element={<Commentary />} />
          <Route path="/player_list" element={<PlayerList />} />
          <Route path="/layouts" element={<LayoutBrowser />} />
        </Routes>
      </div>
    </div>
  );
}
