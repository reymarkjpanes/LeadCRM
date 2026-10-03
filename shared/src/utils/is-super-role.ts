/** Only predefined administrator identities bypass permission flags. */
export function isSuperRole(role: string): boolean {
  return role === 'Client Admin';
}
