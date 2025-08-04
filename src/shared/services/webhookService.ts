// Local: src/shared/services/webhookService.ts

// CORREÇÃO: O caminho correto de 'src/shared/services' para 'src/shared' é '../'
import { BaserowCandidate, JobPosting, BaserowUser } from '../types.js';
import { baserowServer } from './baserowServerClient.js';

const USERS_TABLE_ID = '711';

const getRecruiterData = async (userId: number): Promise<BaserowUser | null> => {
    try {
        const user: BaserowUser = await baserowServer.getRow(USERS_TABLE_ID, userId);
        return user;
    } catch (error) {
        console.error(`Erro ao buscar dados do recrutador ${userId}:`, error);
        return null;
    }
};

export const triggerN8NWebhook = async (candidate: BaserowCandidate, job: JobPosting): Promise<{ success: boolean; message: string }> => {
    if (!process.env.N8N_TRIAGEM_WEBHOOK_URL) {
        console.warn('URL do webhook de triagem N8N não configurada. Pulando o envio.');
        return { success: false, message: 'URL do webhook não configurada.' };
    }

    if (!job.usuario || job.usuario.length === 0) {
        console.error('Vaga sem usuário (recrutador) associado. Não é possível disparar o webhook.');
        return { success: false, message: 'Vaga sem recrutador associado.' };
    }

    const recruiterId = job.usuario[0].id;
    const recruiter = await getRecruiterData(recruiterId);

    if (!recruiter) {
        return { success: false, message: `Recrutador com ID ${recruiterId} não encontrado.` };
    }

    const payload = { candidate, job, recruiter };

    try {
        const response = await fetch(process.env.N8N_TRIAGEM_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`N8N respondeu com status ${response.status}: ${errorBody}`);
        }
        
        return { success: true, message: 'Webhook enviado.' };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao enviar webhook.';
        console.error('Erro ao disparar webhook para N8N:', errorMessage);
        return { success: false, message: errorMessage };
    }
};