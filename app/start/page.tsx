// Sign up, step one: the business gets its name. Login comes from Swayu later; the prototype has one business.
import { businessName } from '@/src/store/db';
import { startBusiness } from '../actions';
import { Steps, Wordmark } from '../brand';

export const dynamic = 'force-dynamic';

export default async function Start() {
  const name = await businessName();
  return (
    <div className="mx-auto max-w-[40rem] px-4 pb-24 pt-6 sm:px-6">
      <header><Wordmark /></header>
      <div className="mt-12"><Steps at={0} /></div>

      <form action={startBusiness} className="mt-10">
        <h1 className="text-[2.2rem] font-bold leading-tight">What is your business called?</h1>
        <label htmlFor="business" className="mt-6 block font-bold">Business name</label>
        <input
          id="business"
          name="business"
          required
          maxLength={80}
          defaultValue={name && name !== 'Your business' ? name : ''}
          placeholder="Sunrise Bakery"
          autoComplete="organization"
          className="mt-2 w-full rounded-lg border border-shore bg-white px-4 py-3 text-lg"
        />
        <button className="mt-8 rounded-lg bg-navy px-6 py-3 text-lg font-bold text-white">Next: connect your channels</button>
      </form>
    </div>
  );
}
