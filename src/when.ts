// The time a message arrived, as the owner reads it.
// Live channels store UTC; a chat export or CSV already carries the owner's own clock, so it is shown as written.
// The owner's time zone is fixed to India for the prototype; a business setting replaces it in swayu-app.
const OWNER_TIME_ZONE = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function when(receivedAt: string, storedInUtc: boolean): string {
  let [date, time] = receivedAt.split('T');
  if (storedInUtc) {
    const ms = Date.parse(receivedAt + 'Z');
    if (Number.isFinite(ms)) {
      // en-CA gives YYYY-MM-DD, and hourCycle h23 gives 00 to 23, so the parts read back the same way as stored times.
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: OWNER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
      const part = (t: string) => local.find(p => p.type === t)?.value ?? '';
      date = `${part('year')}-${part('month')}-${part('day')}`;
      time = `${part('hour')}:${part('minute')}`;
    }
  }
  const [, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return `${day} ${MONTHS[month - 1]}, ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}
