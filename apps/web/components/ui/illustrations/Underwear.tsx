import type { Paint } from './paint';
/** Underwear and socks: briefs with a waistband. */
export function Underwear({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="14,20 86,20 86,36 62,76 38,76 14,36" fill={fill} stroke={outline} />
      <path d="M14,30 H86" fill="none" stroke={detail} />
    </>
  );
}
