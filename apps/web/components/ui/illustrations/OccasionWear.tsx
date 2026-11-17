import type { Paint } from './paint';
/** Occasion wear: a suit jacket with notched lapels. */
export function OccasionWear({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="34,10 50,20 66,10 84,18 90,60 80,62 76,34 76,88 24,88 24,34 20,62 10,60 16,18" fill={fill} stroke={outline} />
      <path d="M34,10 L50,52 L66,10 M50,52 V88" fill="none" stroke={detail} />
    </>
  );
}
