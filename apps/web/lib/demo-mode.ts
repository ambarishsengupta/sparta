/// <reference types="node" />
import { dataBackend } from './supabase/config';

/** The one test of the no-login demo (start-demo.sh --no-login): the local backend AND the demo flag. The vendor portal and the admin pages show fixed demo data only when this is true; every demo branch uses it and nothing else decides demo mode. */
export const isNoLoginDemo = (): boolean => dataBackend() !== 'supabase' && process.env.NEXT_PUBLIC_SPARTA_DEMO_NO_LOGIN === '1';
