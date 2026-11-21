import { sweepRun } from './support';

/** The end-of-run sweep (WO-0168): removes whatever a test left behind, for example after a crashed worker, and fails if anything of this run is still in the database. */
export default async function globalTeardown(): Promise<void> {
  await sweepRun();
}
