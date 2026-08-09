import { Routes, Route } from "react-router-dom";
import TSHFields from '../components/fields';
import WelcomeCard from '../components/WelcomeCard';
import MatchConflictBanner from '../components/MatchConflictBanner';
import SampleModeBanner from './production/sample';

import Production from './production/production';
import Competition from './competition/competition';
import PlayerList from './player_list/player_list';
import DesignTab from "./layouts/layouts";

// Nav tabs. Rendered in the header row by TSHFields; routes wired below.
const allTabs = [
  { name: "Production", path: "/" },
  { name: "Competition", path: "/competition" },
  { name: "Address Book", path: "/player_list" },
  { name: "Design", path: "/layouts" },
];

export default function Root() {
  return (
    <div className="min-h-screen">
      <TSHFields tabs={allTabs} />
      <MatchConflictBanner />
      <SampleModeBanner />
      <WelcomeCard />
      <div className="p-5">
        <Routes>
          <Route path="/" element={<Production />} />
          <Route path="/competition" element={<Competition />} />
          {/* Back-compat: old separate routes now resolve to the merged tab. */}
          <Route path="/tournament_info" element={<Competition />} />
          <Route path="/bracket" element={<Competition />} />
          {/* The Match tab is gone. Fixtures are the console's Match desk and a
              board's games are its own panel, so a bookmark or an in-app link to
              /scoreboard lands on the console rather than on nothing. */}
          <Route path="/scoreboard" element={<Production />} />
          {/* The caster desk is authored on its Production stage; the old
              standalone tab duplicated it exactly and is gone. */}
          <Route path="/commentary" element={<Production />} />
          <Route path="/player_list" element={<PlayerList />} />
          <Route path="/layouts" element={<DesignTab />} />
        </Routes>
      </div>
    </div>
  );
}
