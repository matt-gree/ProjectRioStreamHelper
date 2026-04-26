import { create } from 'zustand';

// Bumping `version` invalidates browser-cached MSB image URLs by changing
// their `?v=` query string, so newly-dropped assets render without a hard
// refresh. Bump after the user updates the assets folder (Settings →
// MSB Image Assets → Open Folder / Browse) or closes the Settings modal.
export const useAssetsVersionStore = create((set) => ({
    version: 0,
    bump: () => set((s) => ({ version: s.version + 1 })),
}));

const buildPaths = (v) => ({
    charIcon: (name) => `/game_assets/msb/characterIcons/${encodeURIComponent(name)}.png?v=${v}`,
    teamIcon: (name) => `/game_assets/msb/teamLogos/${encodeURIComponent(name)}.png?v=${v}`,
    gameIcon: (file) => `/game_assets/msb/gameIcons/${file}?v=${v}`,
});

/** Subscribe to the asset version and get cache-busted URL builders. */
export const useAssetUrls = () => {
    const v = useAssetsVersionStore((s) => s.version);
    return buildPaths(v);
};
