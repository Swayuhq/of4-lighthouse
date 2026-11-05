// Who shows up on Google Maps for a phrase customers search, for the analytics lead's outside research (HRB, OF1).
// This is a stub: sample places in the exact shape the live Places read will return, so the research can be built now.
// The live read waits on Harish's yes on the Google key and spend. Swapping it in changes nothing for the caller.
import { createHash } from 'node:crypto';

/** One place in the map results for one phrase. Agreed with HRB on 5 Nov 2026, plus rank and query. */
export type Place = {
  placeId: string; // Google's id; the only field kept long term
  name: string;
  rank: number; // position in the map results for this phrase, 1 is first
  query: string; // the phrase searched
  rating?: number; // 1.0 to 5.0
  reviewCount?: number; // every review the place has, not only the ones returned
  distanceMetres?: number;
  mapsLink?: string; // google.com/maps only
  reviews?: { author: string; stars: number; text: string; at: string }[]; // up to 5, credit the author when shown
};

/** Google's Text Search returns at most 20 places a page. */
export const MAX_PLACES = 20;
/** Google's Places service returns at most 5 reviews a place. */
export const MAX_REVIEWS = 5;
export const MAX_QUERY = 200;

type Sample = Omit<Place, 'rank' | 'query'>;

const review = (author: string, stars: number, text: string, at: string) => ({ author, stars, text, at });

// Made up businesses, so nobody mistakes a stub number for a real rival's rating.
const SAMPLES: Sample[] = [
  { placeId: 'stub_meadow_kitchen', name: 'Meadow Kitchen (sample)', rating: 4.4, reviewCount: 1830, distanceMetres: 650, reviews: [
    review('Sample reviewer A', 5, 'Millet dosa was light and crisp. Will come back with family.', '2026-10-28T09:10:00Z'),
    review('Sample reviewer B', 4, 'Good food, slow service at dinner time.', '2026-10-21T15:40:00Z'),
    review('Sample reviewer C', 3, 'Parking is hard on weekends.', '2026-10-02T12:05:00Z'),
  ] },
  { placeId: 'stub_river_sweets', name: 'River Sweets (sample)', rating: 4.1, reviewCount: 2410, distanceMetres: 1200, reviews: [
    review('Sample reviewer D', 5, 'Fresh sweets every morning, staff are kind.', '2026-10-30T06:20:00Z'),
    review('Sample reviewer E', 2, 'Box was not sealed when delivered.', '2026-10-11T18:00:00Z'),
  ] },
  { placeId: 'stub_green_leaf', name: 'Green Leaf Meals (sample)', rating: 4.6, reviewCount: 540, distanceMetres: 2100, reviews: [
    review('Sample reviewer F', 5, 'Best vegetarian thali near the market.', '2026-10-25T13:30:00Z'),
    review('Sample reviewer G', 5, 'Clean place, quick lunch.', '2026-10-19T07:45:00Z'),
    review('Sample reviewer H', 4, 'Tasty but a little pricey.', '2026-10-08T14:15:00Z'),
    review('Sample reviewer I', 4, 'Good for groups.', '2026-09-30T19:00:00Z'),
    review('Sample reviewer J', 3, 'Waited 20 minutes for a table.', '2026-09-22T20:10:00Z'),
  ] },
  { placeId: 'stub_corner_cafe', name: 'Corner Cafe (sample)', rating: 3.9, reviewCount: 210, distanceMetres: 400 },
  { placeId: 'stub_hill_bakery', name: 'Hill Bakery (sample)', rating: 4.3, reviewCount: 960, distanceMetres: 3300, reviews: [
    review('Sample reviewer K', 4, 'Millet cookies are a good snack.', '2026-10-27T10:00:00Z'),
  ] },
  { placeId: 'stub_new_spot', name: 'New Spot (sample)', distanceMetres: 900 },
];

const order = (query: string, placeId: string) => createHash('sha256').update(`${query}\n${placeId}`).digest('hex');

/** Sample results for one phrase. The same phrase always gives the same order; another phrase reorders them. */
export function placesStub(args: Record<string, unknown>): Place[] {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) throw new Error('a search phrase is needed');
  if (query.length > MAX_QUERY) throw new Error(`the search phrase is longer than ${MAX_QUERY} characters`);
  return [...SAMPLES]
    .sort((a, b) => order(query, a.placeId).localeCompare(order(query, b.placeId)))
    .slice(0, MAX_PLACES)
    .map((s, i) => ({
      ...s,
      rank: i + 1,
      query,
      mapsLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name)}&query_place_id=${s.placeId}`,
      reviews: s.reviews?.slice(0, MAX_REVIEWS),
    }));
}
