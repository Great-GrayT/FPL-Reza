import { z } from 'zod';

/**
 * The Premier League's own backing API, as it actually answers. Every object
 * is `passthrough`-free but non strict: the provider adds fields without
 * notice, and a strict schema would turn that into an outage.
 *
 * Numbers arrive as JSON floats throughout (`id: 1.0`), which Zod reads as
 * numbers, so ids are coerced to integers at the mapping boundary rather than
 * asserted here.
 */

const optaId = z.object({ opta: z.string().optional() }).optional();

const nameSchema = z.object({
  display: z.string().optional(),
  first: z.string().optional(),
  last: z.string().optional(),
});

const countrySchema = z
  .object({
    isoCode: z.string().optional(),
    country: z.string().optional(),
    demonym: z.string().optional(),
  })
  .optional();

const dateSchema = z
  .object({
    millis: z.number().optional(),
    label: z.string().optional(),
  })
  .optional();

const clubSchema = z.object({
  name: z.string().optional(),
  shortName: z.string().optional(),
  abbr: z.string().optional(),
  id: z.number().optional(),
});

export const plTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  shortName: z.string().optional(),
  teamType: z.string().optional(),
  club: clubSchema.optional(),
  altIds: optaId,
  grounds: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        city: z.string().optional(),
        capacity: z.number().optional(),
        location: z
          .object({ latitude: z.number().optional(), longitude: z.number().optional() })
          .optional(),
      }),
    )
    .optional(),
});
export type PlTeam = z.infer<typeof plTeamSchema>;

export const plCompSeasonSchema = z.object({
  id: z.number(),
  label: z.string(),
});
export type PlCompSeason = z.infer<typeof plCompSeasonSchema>;

export const plCompSeasonsSchema = z.object({
  content: z.array(plCompSeasonSchema),
});

const kickoffSchema = z
  .object({
    millis: z.number().optional(),
    label: z.string().optional(),
    completeness: z.number().optional(),
  })
  .optional();

const groundSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    city: z.string().optional(),
  })
  .optional();

/** One entry from the fixtures listing: the result, without the teamsheets. */
export const plFixtureSchema = z.object({
  id: z.number(),
  gameweek: z
    .object({
      gameweek: z.number().optional(),
      compSeason: z.object({ id: z.number(), label: z.string() }).optional(),
    })
    .optional(),
  kickoff: kickoffSchema,
  teams: z.array(
    z.object({
      team: plTeamSchema,
      score: z.number().optional(),
    }),
  ),
  ground: groundSchema,
  neutralGround: z.boolean().optional(),
  status: z.string().optional(),
  outcome: z.string().optional(),
  attendance: z.number().optional(),
  halfTimeScore: z
    .object({ homeScore: z.number().optional(), awayScore: z.number().optional() })
    .optional(),
});
export type PlFixture = z.infer<typeof plFixtureSchema>;

export const plFixturesPageSchema = z.object({
  pageInfo: z.object({
    page: z.number(),
    numPages: z.number(),
    pageSize: z.number(),
    numEntries: z.number(),
  }),
  content: z.array(plFixtureSchema),
});
export type PlFixturesPage = z.infer<typeof plFixturesPageSchema>;

export const plPersonSchema = z.object({
  id: z.number(),
  name: nameSchema,
  altIds: optaId,
  matchPosition: z.string().optional(),
  matchShirtNumber: z.number().optional(),
  captain: z.boolean().optional(),
  info: z
    .object({
      position: z.string().optional(),
      shirtNum: z.number().optional(),
      positionInfo: z.string().optional(),
    })
    .optional(),
  nationalTeam: countrySchema,
  birth: z
    .object({
      date: dateSchema,
      country: countrySchema,
      place: z.string().optional(),
    })
    .optional(),
});
export type PlPerson = z.infer<typeof plPersonSchema>;

export const plTeamListSchema = z.object({
  teamId: z.number(),
  formation: z
    .object({
      label: z.string().optional(),
      players: z.array(z.array(z.number())).optional(),
    })
    .optional(),
  lineup: z.array(plPersonSchema).optional(),
  substitutes: z.array(plPersonSchema).optional(),
});

export const plMatchOfficialSchema = z.object({
  matchOfficialId: z.number().optional(),
  id: z.number(),
  role: z.string().optional(),
  name: nameSchema,
});

export const plEventSchema = z.object({
  id: z.number().optional(),
  personId: z.number().optional(),
  teamId: z.number().optional(),
  assistId: z.number().optional(),
  clock: z.object({ secs: z.number().optional(), label: z.string().optional() }).optional(),
  phase: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  score: z
    .object({ homeScore: z.number().optional(), awayScore: z.number().optional() })
    .optional(),
});

/** The single fixture endpoint, which adds officials, teamsheets, and events. */
export const plFixtureDetailSchema = plFixtureSchema.extend({
  matchOfficials: z.array(plMatchOfficialSchema).optional(),
  teamLists: z.array(plTeamListSchema).optional(),
  events: z.array(plEventSchema).optional(),
});
export type PlFixtureDetail = z.infer<typeof plFixtureDetailSchema>;

export const plStaffSchema = z.object({
  compSeason: plCompSeasonSchema.optional(),
  team: plTeamSchema.optional(),
  officials: z
    .array(
      z.object({
        officialId: z.number().optional(),
        id: z.number(),
        role: z.string().optional(),
        active: z.boolean().optional(),
        name: nameSchema,
        altIds: optaId,
        birth: z
          .object({ date: dateSchema, country: countrySchema, place: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
});
export type PlStaff = z.infer<typeof plStaffSchema>;

export const plTeamsPageSchema = z.object({
  content: z.array(plTeamSchema),
});

/**
 * The provider's match statistics payload.
 *
 * `data` is keyed by the club's own id and each side carries an `M` array of
 * named measures. The set of names varies by match, so nothing here enumerates
 * them: a schema listing 181 fields would fail the first time a match produced
 * a 182nd, and that is the day it would matter most.
 */
export const plMatchStatsSchema = z.object({
  entity: z.object({
    id: z.number(),
    kickoff: z.object({ millis: z.number().optional() }).partial().optional(),
    teams: z
      .array(
        z.object({
          team: z.object({
            id: z.number(),
            name: z.string(),
            shortName: z.string().optional(),
            altIds: z.object({ opta: z.string().optional() }).optional(),
          }),
        }),
      )
      .default([]),
  }),
  data: z.record(
    z.string(),
    z.object({
      M: z.array(z.object({ name: z.string(), value: z.number() })).default([]),
    }),
  ),
});

export type PlMatchStats = z.infer<typeof plMatchStatsSchema>;
