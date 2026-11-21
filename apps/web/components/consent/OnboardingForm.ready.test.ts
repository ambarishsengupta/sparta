import { describe, expect, it, vi } from 'vitest';
import { findAll, mount, settle, type Found } from '../../test-support/hook-shim';
import { OnboardingForm } from './OnboardingForm';

// WO-0185 (FR-6, FR-9): a control used before React has taken the form over would lose its value, so the form starts disabled and becomes usable in an effect. The hook stand-ins run that effect by hand.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../../test-support/hook-shim')).hookStandIns }));

const controls = (el: unknown): Found[] => findAll(el, (e) => e.type === 'select' || e.type === 'button' || (e.type === 'input' && e.props.type === 'checkbox'));
const props = { countries: [{ value: 'IN', label: 'India' }], currencies: [{ value: 'INR', label: 'Indian rupee' }] };

describe('OnboardingForm ready signal (WO-0185)', () => {
  it('renders every control and button disabled, and the form marked not ready, until the effect has run; then enabled and marked ready', async () => {
    const f = mount(OnboardingForm, props);
    const before = f.render();
    expect(controls(before)).toHaveLength(3 + 7 + 3); // country, hemisphere and currency selects, seven occasions, three buttons
    expect(controls(before).filter((c) => c.props.disabled !== true)).toEqual([]);
    expect(findAll(before, (e) => e.type === 'form')[0]!.props['data-ready']).toBe('false');
    f.flush(); // the effect
    await settle(); // the state it sets
    const after = f.render();
    expect(controls(after).filter((c) => c.props.disabled !== false)).toEqual([]);
    expect(findAll(after, (e) => e.type === 'form')[0]!.props['data-ready']).toBe('true');
  });
  it('an effect that is cleaned up before it fires (a remount) leaves the form not ready', async () => {
    const f = mount(OnboardingForm, props);
    f.render();
    f.flush();
    f.unmount(); // the cleanup runs before the queued state change
    await settle();
    expect(findAll(f.render(), (e) => e.type === 'form')[0]!.props['data-ready']).toBe('false');
  });
});
