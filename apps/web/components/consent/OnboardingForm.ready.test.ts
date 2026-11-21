import { describe, expect, it, vi } from 'vitest';
import { findAll, mount, settle, type Found } from '../../test-support/hook-shim';
import { OnboardingForm } from './OnboardingForm';

// WO-0185 (FR-6, FR-9): a control used before React has taken the form over would lose its value, so the form starts disabled and becomes usable once hydrated. The hook stand-ins model that: the server snapshot of useSyncExternalStore until flush(), the client snapshot after.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../../test-support/hook-shim')).hookStandIns }));

const controls = (el: unknown): Found[] => findAll(el, (e) => e.type === 'select' || e.type === 'button' || (e.type === 'input' && e.props.type === 'checkbox'));
const props = { countries: [{ value: 'IN', label: 'India' }], currencies: [{ value: 'INR', label: 'Indian rupee' }] };

describe('OnboardingForm ready signal (WO-0185)', () => {
  it('renders every control and button disabled, and the form marked not ready, until flush() (hydration, in the shim); then enabled and marked ready', async () => {
    const f = mount(OnboardingForm, props);
    const before = f.render();
    expect(controls(before)).toHaveLength(3 + 7 + 3); // country, hemisphere and currency selects, seven occasions, three buttons
    expect(controls(before).filter((c) => c.props.disabled !== true)).toEqual([]);
    expect(findAll(before, (e) => e.type === 'form')[0]!.props['data-ready']).toBe('false');
    f.flush(); // hydration
    await settle();
    const after = f.render();
    expect(controls(after).filter((c) => c.props.disabled !== false)).toEqual([]);
    expect(findAll(after, (e) => e.type === 'form')[0]!.props['data-ready']).toBe('true');
  });
  it('the stand-in gives the server snapshot on every render before flush(), and the client snapshot on every render after it', () => {
    const f = mount(OnboardingForm, props);
    for (let i = 0; i < 2; i++) expect(findAll(f.render(), (e) => e.type === 'form')[0]!.props['data-ready']).toBe('false');
    f.flush();
    for (let i = 0; i < 2; i++) expect(findAll(f.render(), (e) => e.type === 'form')[0]!.props['data-ready']).toBe('true');
  });
});
