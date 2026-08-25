/**
 * Canal mínimo entre a camada HTTP e o contexto de autenticação.
 *
 * O cliente HTTP não pode navegar nem mexer no estado do React; antes ele
 * resolvia isso com `window.location.assign("/login")`, um reload duro que
 * destruía todo o estado da aplicação (e, na tela de login, o próprio
 * formulário que o usuário tinha acabado de preencher). Agora ele apenas
 * anuncia "a sessão expirou" e o `AuthProvider` reage com um logout normal.
 */
type SessionListener = () => void;

const listeners = new Set<SessionListener>();

export function onSessionExpired(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  listeners.forEach((listener) => listener());
}
