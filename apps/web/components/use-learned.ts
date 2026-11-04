'use client';
import { useEffect, useState } from 'react';
import { loadLearned } from '../lib/engine-config';
import { settleLearned, startLearned } from '../lib/learned-state';
import type { LearnedState } from '../lib/learned-state';

/** The learned data (prior, H&M unlock list) once loaded. `ready` turns true when the load has finished or failed; the page renders meanwhile. */
export function useLearned(): LearnedState {
  const [state, setState] = useState<LearnedState>(startLearned);
  useEffect(() => { void settleLearned(loadLearned, setState); }, []);
  return state;
}
