import type { Paint } from './paint';
/** Tops: a boxed T-shirt with a V neck. */
export function Tops({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="34,12 40,18 60,18 66,12 90,26 80,42 72,36 72,88 28,88 28,36 20,42 10,26" fill={fill} stroke={outline} />
      <path d="M40,18 L50,28 L60,18" fill="none" stroke={detail} />
    </>
  );
}
