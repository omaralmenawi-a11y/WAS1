/** Current time. Honours WASL_FAKE_NOW outside production (tests, demos). */
export function now(): Date {
  const fake = process.env.WASL_FAKE_NOW;
  if (fake && process.env.NODE_ENV !== 'production') return new Date(fake);
  return new Date();
}
