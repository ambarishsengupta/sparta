import { notFound } from 'next/navigation';
import { isNoLoginDemo } from '../../../lib/demo-mode';
import { SIMULATED_LABEL } from '../../../lib/demo-vendor-insights';
import { LocationsView } from '../../../components/vendor/insights/LocationsView';

/** UI wave 3b: a screen of the no-login demo only, with fixed simulated figures. Anywhere else the page does not exist. */
export default function Page() {
  if (!isNoLoginDemo()) notFound();
  return (
    <>
      <h1>Where your users are</h1>
      <p className="muted">{SIMULATED_LABEL}</p>
      <LocationsView />
    </>
  );
}
