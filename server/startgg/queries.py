"""GraphQL queries for the start.gg public API.

Adapted from joaorb64/TournamentStreamHelper, simplified for MSB use
(no character selections, no game-specific mains).
"""

TOURNAMENT_DATA_QUERY = """
query TournamentDataQuery($eventSlug: String!) {
    event(slug: $eventSlug) {
        id
        name
        numEntrants
        startAt
        endAt
        isOnline
        tournament {
            name
            shortSlug
            venueAddress
            startAt
            endAt
        }
    }
}
"""

TOURNAMENT_PHASES_QUERY = """
query TournamentPhasesQuery($eventSlug: String!) {
    event(slug: $eventSlug) {
        phases {
            id
            name
            phaseGroups(query: {page: 1, perPage: 99}) {
                nodes {
                    id
                    displayIdentifier
                    bracketType
                }
            }
        }
    }
}
"""

SETS_QUERY = """
query EventMatchListQuery(
    $eventSlug: String!,
    $page: Int = 1,
    $perPage: Int = 64,
    $filters: SetFilters
) {
    event(slug: $eventSlug) {
        sets(page: $page, perPage: $perPage, filters: $filters, sortType: CALL_ORDER) {
            pageInfo {
                page
                totalPages
                total
            }
            nodes {
                id
                fullRoundText
                round
                state
                totalGames
                entrant1Score
                entrant2Score
                slots {
                    entrant {
                        id
                        name
                        initialSeedNum
                        participants {
                            player {
                                id
                                gamerTag
                                prefix
                            }
                        }
                    }
                    standing {
                        placement
                        stats {
                            score {
                                value
                            }
                        }
                    }
                }
                phaseGroup {
                    phase {
                        name
                        groupCount
                        bracketType
                    }
                    displayIdentifier
                }
                stream {
                    streamName
                    streamSource
                }
                station {
                    number
                }
            }
        }
    }
}
"""

SET_QUERY = """
query SetQuery($id: ID!) {
    set(id: $id) {
        id
        fullRoundText
        round
        state
        totalGames
        entrant1Score
        entrant2Score
        slots {
            entrant {
                id
                name
                initialSeedNum
                participants {
                    id
                    user {
                        id
                        slug
                        name
                        genderPronoun
                        authorizations(types: [TWITTER]) {
                            type
                            externalUsername
                        }
                        location {
                            city
                            country
                            state
                        }
                        images(type: "profile") {
                            url
                        }
                    }
                    player {
                        id
                        gamerTag
                        prefix
                    }
                }
            }
            standing {
                placement
                stats {
                    score {
                        value
                    }
                }
            }
        }
        phaseGroup {
            phase {
                name
                groupCount
                bracketType
            }
            displayIdentifier
        }
        stream {
            streamName
            streamSource
        }
    }
}
"""

BRACKET_SETS_QUERY = """
query BracketSetsQuery(
    $phaseGroupId: ID!,
    $page: Int = 1,
    $perPage: Int = 64
) {
    phaseGroup(id: $phaseGroupId) {
        bracketType
        phase {
            name
            groupCount
        }
        displayIdentifier
        sets(page: $page, perPage: $perPage, sortType: ROUND) {
            pageInfo {
                page
                totalPages
                total
            }
            nodes {
                id
                fullRoundText
                round
                state
                totalGames
                entrant1Score
                entrant2Score
                identifier
                slots {
                    entrant {
                        id
                        name
                        initialSeedNum
                        participants {
                            player {
                                id
                                gamerTag
                                prefix
                            }
                        }
                    }
                    standing {
                        placement
                        stats {
                            score {
                                value
                            }
                        }
                    }
                }
            }
        }
    }
}
"""

ENTRANTS_QUERY = """
query EventEntrantsListQuery($eventSlug: String!, $page: Int!) {
    event(slug: $eventSlug) {
        entrants(query: {page: $page, perPage: 64}) {
            pageInfo {
                page
                total
                perPage
                totalPages
            }
            nodes {
                id
                name
                initialSeedNum
                participants {
                    player {
                        id
                        gamerTag
                        prefix
                    }
                    user {
                        id
                        name
                        genderPronoun
                        location {
                            country
                            state
                            city
                        }
                        authorizations(types: [TWITTER]) {
                            externalUsername
                        }
                        images(type: "profile") {
                            url
                        }
                    }
                }
            }
        }
    }
}
"""

ENTRANT_QUERY = """
query EntrantQuery($id: ID!) {
    entrant(id: $id) {
        id
        name
        initialSeedNum
        participants {
            player {
                id
                gamerTag
                prefix
            }
            user {
                id
                name
                genderPronoun
                location {
                    country
                    state
                    city
                }
                authorizations(types: [TWITTER]) {
                    externalUsername
                }
                images(type: "profile") {
                    url
                }
            }
        }
    }
}
"""
