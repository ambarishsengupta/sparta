/** Open-redirect payloads (WO-0053 B1). Every one of them must give the home page; the payloads of the work order plus close cousins (encodings, repeated dot segments, control characters). */
export const REDIRECT_PAYLOADS = [
  '/.//evil.com', '/..//evil.com', '/a/..//evil.com', '/%2e//evil.com', '/%2E//evil.com', '/%2e%2e//evil.com', '/./\\evil.com', '//evil.com', '/\\evil.com', '/\\/evil.com',
  'https://evil.com', 'javascript:alert(1)', '/\t/evil.com', '/\n/evil.com', '/\r\n/evil.com', '/a\tb', '/ok\u0000', '/ok\u007f', '/.//\\evil.com', '/././/evil.com',
  '/x/../..//evil.com', '/?x=\\evil.com', '/a\\b', '///evil.com',
];
