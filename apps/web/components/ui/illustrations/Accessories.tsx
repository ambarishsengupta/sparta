import type { Paint } from './paint';
/** Accessories: a tote bag with one handle. */
export function Accessories({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="20,36 80,36 86,90 14,90" fill={fill} stroke={outline} />
      <path d="M36,36 V20 H64 V36" fill="none" stroke={outline} />
      <path d="M19,50 H81" fill="none" stroke={detail} />
    </>
  );
}
