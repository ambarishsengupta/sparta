/** The pilot notice, the locked sharing text and the not-open message, and the rules of the acceptance form (FR-2 to FR-5, FR-9, FR-61, FR-68). */

/** Title and paragraphs of legal/PRIVACY-POLICY.md section 13, word for word (a test compares them with the file). `**x**` is bold; `[x]` is a link. */
export const NOTICE_TITLE = 'Welcome to the Sparta pilot';
export const NOTICE_PARAGRAPHS: readonly string[] = [
  'Sparta is a free 3-month study run by a student team. To make it work, we combine **anonymised information** from all participants about what they own, buy and wish for, and share only **group figures** with brands and retailers. They never see you, your photos, your receipts or your wardrobe, and no group of fewer than 10 people is ever shown.',
  'Sharing is part of taking part, so it can\'t be switched off during the pilot. You can leave at any time with **Leave the pilot**, which deletes your account and data. We do not use your data to train AI models.',
  'You must be 18 or over. Read the full [Privacy Policy] and [Terms of Use]. Questions: dunk-volts8c@icloud.com',
];
/** Where the two links in the notice go. */
export const NOTICE_LINKS: Readonly<Record<string, string>> = { 'Privacy Policy': '/privacy', 'Terms of Use': '/terms' };
/** FR-61, word for word. */
export const SHARING_LOCKED_TEXT = 'The pilot is a study that needs anonymised data from its participants to work, so sharing is on for everyone taking part. You can leave any time with Leave the pilot. The full version of Sparta is planned to let you turn this off.';
/** FR-9 and LLD 9.1, word for word. */
export const NOT_OPEN_MESSAGE = 'The pilot is not open in your country yet';

/** Pieces of a notice paragraph: plain text, bold text, or a link label. */
export type Piece = { kind: 'text' | 'bold' | 'link'; text: string };
export function pieces(paragraph: string): Piece[] {
  return paragraph.split(/(\*\*[^*]+\*\*|\[[^\]]+\])/).filter((s) => s !== '').map((s): Piece =>
    s.startsWith('**') ? { kind: 'bold', text: s.slice(2, -2) } : s.startsWith('[') ? { kind: 'link', text: s.slice(1, -1) } : { kind: 'text', text: s });
}

export type AcceptanceErrors = { age?: string; agree?: string };
/** FR-2 and FR-68: both boxes must be ticked. An empty object means the form may be sent. */
export function validateAcceptance(age: boolean, agree: boolean): AcceptanceErrors {
  const errors: AcceptanceErrors = {};
  if (!age) errors.age = 'Confirm that you are 18 or over to continue.';
  if (!agree) errors.agree = 'Tick the box to agree to the Terms of Use and the Privacy Policy.';
  return errors;
}
