import type { Paint } from './paint';
/** Outerwear: a hooded jacket with a zip. */
export function Outerwear({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="36,8 64,8 70,18 86,26 92,76 80,78 74,44 74,90 26,90 26,44 20,78 8,76 14,26 30,18" fill={fill} stroke={outline} />
      <path d="M36,8 L42,30 H58 L64,8 M50,30 V90" fill="none" stroke={detail} />
    </>
  );
}
