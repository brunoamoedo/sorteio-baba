/**
 * Abstração de armazenamento da organização selecionada, no mesmo espírito
 * de TokenStorage — implementação web em src/platform, substituível por
 * AsyncStorage no futuro app Expo.
 */
export interface OrganizationStorage {
  getOrganizationId(): number | null;
  setOrganizationId(id: number): void;
  clear(): void;
}
