'use client';
import { useEffect, useState } from 'react';
import type { WardrobeRepository } from '../lib/repository';
import { chooseRepository } from '../lib/supabase/backend';

/** The repository, or null until the page has mounted in the browser (localStorage and the session do not exist on the server). */
export function useRepository(): WardrobeRepository | null {
  const [repo, setRepo] = useState<WardrobeRepository | null>(null);
  useEffect(() => {
    let live = true;
    void chooseRepository().then((r) => { if (live) setRepo(r); });
    return () => { live = false; };
  }, []);
  return repo;
}
