export const interpolateColor = (percentage, lowHex = '#D8D8D8', highHex = '#D4A017') => {
  const low = hexToRgb(lowHex);
  const high = hexToRgb(highHex);

  const clamp = (value) => Math.min(100, Math.max(0, value));
  const factor = clamp(percentage) / 100;

  const r = Math.round(low.r + (high.r - low.r) * factor);
  const g = Math.round(low.g + (high.g - low.g) * factor);
  const b = Math.round(low.b + (high.b - low.b) * factor);

  return `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

