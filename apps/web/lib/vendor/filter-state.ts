import type { Filter } from './insights';

/** FR-77: one filter at a time. Setting a filter replaces the one before it; clearing a dimension that is not the active one changes nothing. */
export type FilterAction = { type: 'set'; dim: NonNullable<Filter>['dim']; value: string } | { type: 'clear'; dim: NonNullable<Filter>['dim'] };
export function filterReducer(state: Filter, action: FilterAction): Filter {
  if (action.type === 'set') return { dim: action.dim, value: action.value };
  return state?.dim === action.dim ? null : state;
}
