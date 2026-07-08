import { create } from 'zustand';
import { MSB_CHARACTER_IDS, MSB_TEAM_IDS } from '../data/msb';

// Bumping `version` invalidates browser-cached MSB image URLs by changing
// their `?v=` query string, so newly-dropped assets render without a hard
// refresh. Bump after the user updates the assets folder (Settings →
// MSB Image Assets → Open Folder / Browse) or closes the Settings modal.
export const useAssetsVersionStore = create((set) => ({
    version: 0,
    bump: () => set((s) => ({ version: s.version + 1 })),
}));

const buildPaths = (v) => ({
    charIcon: (name) => {
        const id = MSB_CHARACTER_IDS[name];
        return id === undefined ? undefined : `/game_assets/msb/characterIcons/${id}.png?v=${v}`;
    },
    teamIcon: (name) => {
        const id = MSB_TEAM_IDS[name];
        return id === undefined ? undefined : `/game_assets/msb/teamLogos/${id}.png?v=${v}`;
    },
    gameIcon: (file) => `/game_assets/msb/gameIcons/${file}?v=${v}`,
});

/** Subscribe to the asset version and get cache-busted URL builders. */
export const useAssetUrls = () => {
    const v = useAssetsVersionStore((s) => s.version);
    return buildPaths(v);
};
