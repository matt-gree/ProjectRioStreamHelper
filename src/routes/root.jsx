import { Routes, Route, Link, useLocation } from "react-router-dom";
import { Tabs, Box } from "@mantine/core";
import TSHFields from '../components/fields';

import Bracket from './bracket/bracket';
import Commentary from './commentary/commentary';
import PlayerList from './player_list/player_list';
import ScoreboardManager from './scoreboard_manager/scoreboard_manager';
import TournamentInfo from "./tournament_info/tournament_info";

const allTabs = [
  { name: "Scoreboard", path: "/" },
  { name: "Tournament Info", path: "/tournament_info" },
  { name: "Bracket", path: "/bracket" },
  { name: "Commentary", path: "/commentary" },
  { name: "Player List", path: "/player_list" },
];

export default function Root() {
  const location = useLocation();

  return (
    <Box style={{ minHeight: '100vh' }}>
      <TSHFields />
      <Tabs value={location.pathname} variant="outline" mx="md">
        <Tabs.List>
          {allTabs.map(tab => (
            <Tabs.Tab
              key={tab.path}
              value={tab.path}
              component={Link}
              to={tab.path}
            >
              {tab.name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Box p="md">
        <Routes>
          <Route path="/" element={<ScoreboardManager />} />
          <Route path="/tournament_info" element={<TournamentInfo />} />
          <Route path="/bracket" element={<Bracket />} />
          <Route path="/commentary" element={<Commentary />} />
          <Route path="/player_list" element={<PlayerList />} />
        </Routes>
      </Box>
    </Box>
  );
}
