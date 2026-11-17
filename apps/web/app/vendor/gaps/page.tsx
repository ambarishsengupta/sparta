import { Gaps } from '../../../components/vendor/Gaps';

/** FR-75, FR-81: segments where wishlist demand is high and ownership is low, ranked by gap score. Every figure is loaded by the client component with the vendor's own session. */
export default function Page() {
  return (
    <>
      <h1>Gaps</h1>
      <p className="muted">Gap score is the users with the item on their wishlist divided by the users who own one. Counts are rounded to the nearest 5.</p>
      <Gaps />
    </>
  );
}
