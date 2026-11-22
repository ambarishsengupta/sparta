'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import type { Filters } from '../../../lib/demo-vendor-retail';
import { filtersFromQuery, queryFromFilters } from '../dashboard/filters';

/** The same URL-backed filter state as the dashboard (`weeks`, `region`, `store`, `age`, `category`), for a page that shows the dashboard's filter bar. Needs a Suspense boundary around the page. */
export function useUrlFilters(): [Filters, (next: Filters) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => filtersFromQuery(params), [params]);
  const set = (next: Filters) => { const q = queryFromFilters(next); router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }); };
  return [filters, set];
}
