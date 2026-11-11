import type { Paint } from './paint';
/** Ethnic wear: a long kurta with a collar, a short placket and side slits. */
export function EthnicWear({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="40,8 60,8 62,14 84,24 90,56 78,60 74,46 74,92 26,92 26,46 22,60 10,56 16,24 38,14" fill={fill} stroke={outline} />
      <path d="M38,14 L50,22 L62,14 M50,22 V52 M27,76 V92 M73,76 V92" fill="none" stroke={detail} />
    </>
  );
}
