import type { Paint } from './paint';
/** Bottoms: trousers with a waistband and a fly. */
export function Bottoms({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="28,10 72,10 76,90 54,90 50,38 46,90 24,90" fill={fill} stroke={outline} />
      <path d="M28,19 H72 M50,19 V38" fill="none" stroke={detail} />
    </>
  );
}
