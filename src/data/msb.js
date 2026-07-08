// Mario Superstar Baseball character and team data
// Source: ProjectRioStreamHelper/user_data/games/msb/base_files/config.json

export const MSB_CHARACTERS = [
  "Baby Luigi", "Baby Mario", "Birdo", "Boo", "Bowser", "Bowser Jr",
  "Bro(H)", "Bro(F)", "Bro(B)",
  "Daisy", "Diddy", "Dixie", "DK",
  "Dry Bones(Gy)", "Dry Bones(G)", "Dry Bones(R)", "Dry Bones(B)",
  "Goomba", "King Boo",
  "Koopa(G)", "Koopa(R)",
  "Luigi",
  "Magikoopa(B)", "Magikoopa(R)", "Magikoopa(G)", "Magikoopa(Y)",
  "Mario", "Monty",
  "Noki(B)", "Noki(R)", "Noki(G)",
  "Paragoomba", "Paratroopa(R)", "Paratroopa(G)",
  "Peach", "Petey",
  "Pianta(B)", "Pianta(R)", "Pianta(Y)",
  "Shy Guy(R)", "Shy Guy(B)", "Shy Guy(Y)", "Shy Guy(G)", "Shy Guy(Bk)",
  "Toad(R)", "Toad(B)", "Toad(Y)", "Toad(G)", "Toad(P)",
  "Toadette", "Toadsworth",
  "Waluigi", "Wario", "Yoshi",
];

export const MSB_CAPTAINS = [
  "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Birdo",
  "Wario", "Waluigi", "DK", "Diddy", "Bowser", "Bowser Jr",
];

export const MSB_TEAMS = [
  // Mario
  "Mario Fireballs", "Mario Sunshines", "Mario All Stars", "Mario Heroes",
  // Luigi
  "Luigi Gentlemen", "Luigi Leapers", "Luigi Mansioneers", "Luigi Vacuums",
  // Peach
  "Peach Dynasties", "Peach Monarchs", "Peach Princesses", "Peach Roses",
  // Daisy
  "Daisy Cupids", "Daisy Lillies", "Daisy Petals", "Daisy Queen Bees",
  // Yoshi
  "Yoshi Eggs", "Yoshi Flutters", "Yoshi Islanders", "Yoshi Speed Stars",
  // Birdo
  "Birdo Beauties", "Birdo Bows", "Birdo Fans", "Birdo Models",
  // Wario
  "Wario Beasts", "Wario Garlics", "Wario Greats", "Wario Steakheads",
  // Waluigi
  "Waluigi Flankers", "Waluigi Mashers", "Waluigi Mystiques", "Waluigi Smart Alecks",
  // DK
  "DK Animals", "DK Explorers", "DK Kongs", "DK Wild Ones",
  // Diddy
  "Diddy Ninjas", "Diddy Red Caps", "Diddy Survivors", "Diddy Tails",
  // Bowser
  "Bowser Black Stars", "Bowser Blue Shells", "Bowser Flames", "Bowser Monsters",
  // Bowser Jr
  "Jr Bombers", "Jr Fangs", "Jr Pixies", "Jr Rookies",
];

export const ROSTER_SIZE = 9;

export const HALF_INNINGS = ["Top", "Bottom", "Final"];

// Canonical name -> asset id maps, mirroring pyrio's LookupDicts.CHAR_NAME
// (0-53, the HUD-native character id — captains share this same space)
// and its own 0-47 enumeration of in_game_team_names_list. Asset filenames
// under game_assets/msb/{characterIcons,captains,characters,teamLogos}/
// are keyed by these ids, not by name — see server/rio/pyrio/assets.py.
export const MSB_CHARACTER_IDS = {
  "Mario": 0,
  "Luigi": 1,
  "DK": 2,
  "Diddy": 3,
  "Peach": 4,
  "Daisy": 5,
  "Yoshi": 6,
  "Baby Mario": 7,
  "Baby Luigi": 8,
  "Bowser": 9,
  "Wario": 10,
  "Waluigi": 11,
  "Koopa(G)": 12,
  "Toad(R)": 13,
  "Boo": 14,
  "Toadette": 15,
  "Shy Guy(R)": 16,
  "Birdo": 17,
  "Monty": 18,
  "Bowser Jr": 19,
  "Paratroopa(R)": 20,
  "Pianta(B)": 21,
  "Pianta(R)": 22,
  "Pianta(Y)": 23,
  "Noki(B)": 24,
  "Noki(R)": 25,
  "Noki(G)": 26,
  "Bro(H)": 27,
  "Toadsworth": 28,
  "Toad(B)": 29,
  "Toad(Y)": 30,
  "Toad(G)": 31,
  "Toad(P)": 32,
  "Magikoopa(B)": 33,
  "Magikoopa(R)": 34,
  "Magikoopa(G)": 35,
  "Magikoopa(Y)": 36,
  "King Boo": 37,
  "Petey": 38,
  "Dixie": 39,
  "Goomba": 40,
  "Paragoomba": 41,
  "Koopa(R)": 42,
  "Paratroopa(G)": 43,
  "Shy Guy(B)": 44,
  "Shy Guy(Y)": 45,
  "Shy Guy(G)": 46,
  "Shy Guy(Bk)": 47,
  "Dry Bones(Gy)": 48,
  "Dry Bones(G)": 49,
  "Dry Bones(R)": 50,
  "Dry Bones(B)": 51,
  "Bro(F)": 52,
  "Bro(B)": 53,
};

export const MSB_TEAM_IDS = {
  "Mario Heroes": 0,
  "Mario Fireballs": 1,
  "Mario Sunshines": 2,
  "Mario All Stars": 3,
  "Luigi Gentlemen": 4,
  "Luigi Vacuums": 5,
  "Luigi Mansioneers": 6,
  "Luigi Leapers": 7,
  "Peach Roses": 8,
  "Peach Dynasties": 9,
  "Peach Monarchs": 10,
  "Peach Princesses": 11,
  "Daisy Lillies": 12,
  "Daisy Cupids": 13,
  "Daisy Queen Bees": 14,
  "Daisy Petals": 15,
  "Yoshi Eggs": 16,
  "Yoshi Speed Stars": 17,
  "Yoshi Islanders": 18,
  "Yoshi Flutters": 19,
  "Birdo Beauties": 20,
  "Birdo Models": 21,
  "Birdo Bows": 22,
  "Birdo Fans": 23,
  "Wario Garlics": 24,
  "Wario Steakheads": 25,
  "Wario Greats": 26,
  "Wario Beasts": 27,
  "Waluigi Mystiques": 28,
  "Waluigi Smart Alecks": 29,
  "Waluigi Flankers": 30,
  "Waluigi Mashers": 31,
  "DK Explorers": 32,
  "DK Wild Ones": 33,
  "DK Kongs": 34,
  "DK Animals": 35,
  "Diddy Survivors": 36,
  "Diddy Ninjas": 37,
  "Diddy Tails": 38,
  "Diddy Red Caps": 39,
  "Bowser Flames": 40,
  "Bowser Blue Shells": 41,
  "Bowser Monsters": 42,
  "Bowser Black Stars": 43,
  "Jr Fangs": 44,
  "Jr Bombers": 45,
  "Jr Pixies": 46,
  "Jr Rookies": 47,
};
