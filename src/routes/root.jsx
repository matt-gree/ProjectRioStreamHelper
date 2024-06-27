import { Routes, Route, Link, useLocation } from "react-router-dom";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import TSHFields from '../components/fields';

import Bracket from './bracket/bracket';
import Commentary from './commentary/commentary';
import PlayerList from './player_list/player_list';
import Ruleset from './ruleset/ruleset';
import ScoreboardManager from './scoreboard_manager/scoreboard_manager';
import ThumbnailSettings from "./thumbnail_settings/thumbnail_settings";
import TournamentInfo from "./tournament_info/tournament_info";

// Must be in order
const allTabs = [
  {
    "name": "Scoreboard Manager",
    "path": "/",
    "render": <ScoreboardManager />
  },
  {
    "name": "Tournament Info",
    "path": "/tournament_info",
    "render": <TournamentInfo />
  },
  {
    "name": "Bracket",
    "path": "/bracket",
    "render": <Bracket />
  },
  {
    "name": "Commentary",
    "path": "/commentary",
    "render": <Commentary />
  },
  {
    "name": "Player List",
    "path": "/player_list",
    "render": <PlayerList />
  },
  {
    "name": "Ruleset",
    "path": "/ruleset",
    "render": <Ruleset />
  },
  {
    "name": "Thumbnail Settings",
    "path": "/thumbnail_settings",
    "render": <ThumbnailSettings />
  },
]

export default function Root() {
  const location = useLocation();

  return (
      <div style={{ 
        position: 'absolute',
        margin: 0,
        padding: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        height: '100vh'
      }}>
        <TSHFields />
          <Tabs value={location.pathname}>
            {allTabs.map(tab =>
              <Tab 
                label={tab.name}
                key={tab.path}
                value={tab.path}
                to={tab.path}
                component={Link}
              />
            )}
          </Tabs>
          <Routes>
            {allTabs.map(tab =>
              <Route
                path={tab.path}
                key={tab.path}
                element={tab.render}
              />
            )}
          </Routes>
      </div>
  )
}