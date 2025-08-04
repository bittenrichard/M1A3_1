// Local: src/shared/hooks/useGoogleAuth.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../features/auth/hooks/useAuth';
import { UserProfile } from '../../features/auth/types';

/**
 * Função auxiliar para verificar de forma consistente se o usuário tem um token do Google.
 * @param profile O perfil do usuário.
 * @returns {boolean} Verdadeiro se o perfil existir e contiver um google_refresh_token.
 */
const hasGoogleToken = (profile: UserProfile | null): boolean => {
  return !!profile && !!profile.google_refresh_token;
};

export const useGoogleAuth = () => {
  const { profile, updateProfile, refetchProfile } = useAuth();
  const [isGoogleConnected, setIsGoogleConnected] = useState(hasGoogleToken(profile));
  
  // Usamos uma referência para controlar se estamos no meio de um processo de autenticação.
  // Isso evita múltiplas chamadas de `refetchProfile`.
  const isConnecting = useRef(false);

  // Efeito para sincronizar o estado de conexão sempre que o perfil do usuário mudar.
  useEffect(() => {
    setIsGoogleConnected(hasGoogleToken(profile));
  }, [profile]);

  // Efeito para detectar quando o usuário volta para a aba da aplicação.
  // Se ele estava conectando a conta Google, nós atualizamos o perfil para refletir a nova conexão.
  useEffect(() => {
    const handleFocus = () => {
      if (isConnecting.current) {
        console.log("[useGoogleAuth] Janela principal recuperou o foco. Verificando status da conexão...");
        refetchProfile();
        isConnecting.current = false;
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [refetchProfile]);

  /**
   * Inicia o processo de conexão com o Google Calendar.
   * Pede a URL de autorização ao backend e abre em um pop-up.
   */
  const connectGoogleCalendar = useCallback(async () => {
    if (!profile) {
      alert('Você precisa estar logado para conectar sua agenda.');
      return;
    }
    try {
      // Faz a chamada para a nova rota no backend.
      const response = await fetch(`/api/google/auth/connect?userId=${profile.id}`);
      if (!response.ok) throw new Error('Falha ao obter URL de autenticação do servidor.');
      
      const { url } = await response.json();
      
      if (url) {
        isConnecting.current = true; // Marca que o processo de conexão foi iniciado.
        window.open(url, '_blank', 'width=600,height=700,noopener,noreferrer');
      }
    } catch (error) {
      console.error('Erro ao iniciar conexão com Google:', error);
      alert('Não foi possível iniciar a conexão com o Google Calendar. Tente novamente.');
    }
  }, [profile]);

  /**
   * Desconecta a conta do Google Calendar.
   * Chama o backend para remover o token e atualiza o estado local.
   */
  const disconnectGoogleCalendar = useCallback(async () => {
    if (!profile) return;
    try {
      await fetch('/api/google/auth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id }),
      });
      // Atualiza o perfil localmente para refletir a desconexão imediatamente.
      const updatedProfile = { ...profile, google_refresh_token: null };
      updateProfile(updatedProfile);
    } catch (error) {
      console.error('Erro ao desconectar do Google:', error);
      alert('Não foi possível desconectar a conta do Google.');
    }
  }, [profile, updateProfile]);

  return {
    isGoogleConnected,
    connectGoogleCalendar,
    disconnectGoogleCalendar,
  };
};