// One live read of every owner review through Zernio, for the build verify loop.
// Prints counts only: no review text and no reviewer names leave this script.
import { zernioProvider, type ReviewSet } from '../src/gateway/providers';

const started = Date.now();
const set = (await zernioProvider('google_reviews', 'read_all', {})) as ReviewSet;
const withText = set.reviews.filter(r => r.text.trim()).length;
const answered = set.reviews.filter(r => r.answered).length;
const anonymous = set.reviews.filter(r => r.author === 'A Google user').length;
console.log(JSON.stringify({
  googleTotal: set.total ?? null,
  googleAverage: set.average ?? null,
  read: set.reviews.length,
  complete: set.complete,
  withText,
  starsOnly: set.reviews.length - withText,
  answered,
  anonymous,
  newest: set.reviews.map(r => r.at).sort().at(-1) ?? null,
  seconds: Math.round((Date.now() - started) / 100) / 10,
}, null, 2));
