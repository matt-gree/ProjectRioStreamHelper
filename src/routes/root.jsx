import { Routes, Route } from "react-router-dom";
import TSHFields from '../components/fields';
import WelcomeCard from '../components/WelcomeCard';

import Production from './production/production';
import Competition from './competition/competition';
import Commentary from './commentary/commentary';
import PlayerList from './player_list/player_list';
import ScoreboardManager from './scoreboard_manager/scoreboard_manager';
import LayoutBrowser from "./layouts/layouts";

// Nav tabs. Rendered in the header row by TSHFields; routes wired below.
const allTabs = [
  { name: "Production", path: "/" },
  { name: "Scoreboard", path: "/scoreboard" },
  { name: "Competition", path: "/competition" },
  { name: "Commentary", path: "/commentary" },
  { name: "Address Book", path: "/player_list" },
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
          <Route path="/competition" element={<Competition />} />
          {/* Back-compat: old separate routes now resolve to the merged tab. */}
          <Route path="/tournament_info" element={<Competition />} />
          <Route path="/bracket" element={<Competition />} />
          <Route path="/commentary" element={<Commentary />} />
          <Route path="/player_list" element={<PlayerList />} />
          <Route path="/layouts" element={<LayoutBrowser />} />
        </Routes>
      </div>
    </div>
  );
}
