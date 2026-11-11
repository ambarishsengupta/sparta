import type { Paint } from './paint';
/** Activewear: a sleeveless training top with a hem line. */
export function Activewear({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="32,10 44,10 50,24 56,10 68,10 72,34 80,48 76,90 24,90 20,48 28,34" fill={fill} stroke={outline} />
      <path d="M23,78 H77" fill="none" stroke={detail} />
    </>
  );
}
