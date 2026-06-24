import { Routes, Route, Link, useLocation } from "react-router-dom";
import TSHFields from '../components/fields';
import WelcomeCard from '../components/WelcomeCard';
import { cn } from "../lib/utils";

import Production from './production/production';
import Bracket from './bracket/bracket';
import Commentary from './commentary/commentary';
import PlayerList from './player_list/player_list';
import ScoreboardManager from './scoreboard_manager/scoreboard_manager';
import TournamentInfo from "./tournament_info/tournament_info";
import LayoutBrowser from "./layouts/layouts";

const allTabs = [
  { name: "Production", path: "/" },
  { name: "Scoreboard", path: "/scoreboard" },
  { name: "Competition Info", path: "/tournament_info" },
  { name: "Bracket", path: "/bracket" },
  { name: "Commentary", path: "/commentary" },
  { name: "Layouts", path: "/layouts" },
];

export default function Root() {
  const location = useLocation();

  return (
    <div className="min-h-screen">
      <TSHFields />
      <WelcomeCard />
      {/* Rio nav: night bar, Rajdhani labels, rio-red active underline. */}
      <nav className="mx-5 flex items-end gap-1 border-b border-border">
        {allTabs.map(tab => {
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "label-display border-b-2 px-4 py-3 text-sm transition-colors",
                active
                  ? "border-rio-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.name}
            </Link>
          );
        })}
      </nav>
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
