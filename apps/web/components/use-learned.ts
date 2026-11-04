'use client';
import { useEffect, useState } from 'react';
import { getLearned, loadLearned } from '../lib/engine-config';
import type { Learned } from '../lib/engine-config';

/** The learned data (prior, H&M unlock list) once loaded. `ready` turns true when the load has finished or failed; the page renders meanwhile. */
export function useLearned(): { learned: Learned; ready: boolean } {
  const [state, setState] = useState({ learned: getLearned(), ready: false });
  useEffect(() => { void loadLearned().then((l) => setState({ learned: l, ready: true })); }, []);
  return state;
}
