import type { Paint } from './paint';
/** Footwear: a low shoe in side view with a flat sole. */
export function Footwear({ fill, outline, detail }: Paint) {
  return (
    <>
      <polygon points="12,30 38,30 40,44 54,52 74,58 92,68 92,80 10,80" fill={fill} stroke={outline} />
      <path d="M10,70 H92 M45,51 L49,56 M52,55 L56,60 M60,59 L63,63" fill="none" stroke={detail} />
    </>
  );
}
