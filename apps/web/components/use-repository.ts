'use client';
import { useEffect, useState } from 'react';
import { sharedRepository } from '../lib/local-repository';
import type { WardrobeRepository } from '../lib/repository';

/** The repository, or null until the page has mounted in the browser (localStorage does not exist on the server). */
export function useRepository(): WardrobeRepository | null {
  const [repo, setRepo] = useState<WardrobeRepository | null>(null);
  useEffect(() => setRepo(sharedRepository()), []);
  return repo;
}
