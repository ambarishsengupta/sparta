import { NOT_OPEN_MESSAGE } from '../../../lib/consent-form';

/** FR-9: nothing is asked or collected here. Export and Leave the pilot arrive in R2c. */
export default function Page() {
  return (
    <>
      <h1>{NOT_OPEN_MESSAGE}</h1>
      <p>You cannot use Sparta until the pilot opens where you are. This page asks for nothing more from you.</p>
      <form action="/auth/sign-out" method="post"><button type="submit">Sign out</button></form>
    </>
  );
}
