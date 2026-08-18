/**
 * CSS module class names are typed as possibly undefined under this app's strict
 * settings, so a class list is joined through here rather than concatenated. One
 * helper, so the pattern does not get reinvented per component.
 */
export const classes = (...names: (string | undefined)[]): string =>
  names.filter(Boolean).join(' ');
