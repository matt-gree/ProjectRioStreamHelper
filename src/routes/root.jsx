import { lazy, Suspense } from 'react';
import { Routes, Route } from "react-router-dom";
import AppHeader from '../components/AppHeader';
import WelcomeCard from '../components/WelcomeCard';
import MatchConflictBanner from '../components/MatchConflictBanner';
import SampleModeBanner from './production/sample';
import { Loader } from '../components/ui/primitives';

import Production from './production/production';

/*
 * THE CONSOLE IS EAGER; THE OTHER FOUR TABS ARE NOT.
 *
 * Everything shipped as one ~1MB chunk, so a producer paid for the Design
 * tab's colour pickers and the Competition tab's bracket views before the
 * console — the page the app opens on, and the one they spend the night in —
 * could draw anything. The build had been printing Rollup's 500kB warning on
 * every run for long enough that it read as part of the output.
 *
 * Production stays a STATIC import deliberately: it is the default route, so
 * lazying it would only add a spinner to the one navigation that never happens
 * (and `/scoreboard` and `/commentary` are back-compat aliases onto it).
 *
 * Splitting here needed a server-side fix first — `load_manifest` emitted a
 * <script> per manifest record, which would have eagerly loaded every chunk
 * this creates. See server/server.py.
 */
const Competition = lazy(() => import('./competition/competition'));
const AddressBook = lazy(() => import('./address_book/address_book'));
const DesignTab = lazy(() => import('./design/tab'));
const Connections = lazy(() => import('./connections/connections'));

/*
 * The fallback is deliberately quiet and CENTRED IN THE CONTENT AREA, not the
 * viewport: the header and both banners are outside <Suspense>, so they never
 * blink. On localhost a chunk arrives in a few frames and this is usually
 * never painted at all — it exists for a cold cache and a slow disk.
 */
function TabFallback() {
    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <Loader size="md" />
        </div>
    );
}

// Nav tabs. Rendered in the header row by AppHeader; routes wired below.
const allTabs = [
  { name: "Production", path: "/" },
  { name: "Competition", path: "/competition" },
  { name: "Address Book", path: "/player_list" },
  { name: "Design", path: "/layouts" },
  // Everything PRSH talks to outside itself. Last, because it is once-per-machine
  // setup rather than run-of-show work — see connections/connections.jsx for the
  // membership rule that keeps it from turning back into the Settings modal.
  { name: "Connections", path: "/connections" },
];

export default function Root() {
  return (
    <div className="min-h-screen">
      <AppHeader tabs={allTabs} />
      <MatchConflictBanner />
      <SampleModeBanner />
      <WelcomeCard />
      <div className="p-5">
        <Suspense fallback={<TabFallback />}>
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
          <Route path="/player_list" element={<AddressBook />} />
          <Route path="/layouts" element={<DesignTab />} />
          <Route path="/connections" element={<Connections />} />
        </Routes>
        </Suspense>
      </div>
    </div>
  );
}
