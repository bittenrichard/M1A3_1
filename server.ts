// Local: server.ts

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { baserowServer } from './src/shared/services/baserowServerClient.js';
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import multer from 'multer';

const app = express();
const port = 3001;

const upload = multer();

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  process.env.FRONTEND_URL?.replace('https://', 'https://www.') || 'http://localhost:5173'
];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- VERIFICAÇÃO DE CREDENCIAIS DO GOOGLE ---
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
  console.error("ERRO CRÍTICO: As credenciais do Google (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) não foram encontradas no ambiente.");
  process.exit(1);
}

// --- CONFIGURAÇÃO DO CLIENTE OAUTH2 ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// --- CONSTANTES DE TABELAS ---
const USERS_TABLE_ID = '711';
const VAGAS_TABLE_ID = '709';
const CANDIDATOS_TABLE_ID = '710';
const WHATSAPP_CANDIDATOS_TABLE_ID = '712';
const AGENDAMENTOS_TABLE_ID = '713';
const SALT_ROUNDS = 10;

// --- TIPAGEM (Já presente no seu código) ---
interface BaserowJobPosting { id: number; titulo: string; usuario?: { id: number; value: string }[]; }
interface BaserowCandidate { id: number; vaga?: { id: number; value: string }[] | string | null; usuario?: { id: number; value: string }[] | null; nome: string; telefone: string | null; curriculo?: { url: string; name: string }[] | null; score?: number | null; resumo_ia?: string | null; status?: { id: number; value: 'Triagem' | 'Entrevista' | 'Aprovado' | 'Reprovado' } | null; data_triagem?: string; sexo?: string | null; escolaridade?: string | null; idade?: number | null; }

// --- ROTAS DE AUTENTICAÇÃO E USUÁRIO (Código existente mantido) ---
// ... (Todo o seu código de /api/auth/signup, /api/auth/login, etc. permanece aqui)
app.post('/api/auth/signup', async (req: Request, res: Response) => {
  const { nome, empresa, telefone, email, password } = req.body;
  if (!email || !password || !nome) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
  }
  try {
    const emailLowerCase = email.toLowerCase();
    const { results: existingUsers } = await baserowServer.get(USERS_TABLE_ID, `?filter__Email__equal=${emailLowerCase}`);
    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = await baserowServer.post(USERS_TABLE_ID, {
      nome, empresa, telefone, Email: emailLowerCase, senha_hash: hashedPassword,
    });
    const userProfile = {
      id: newUser.id, nome: newUser.nome, email: newUser.Email, empresa: newUser.empresa,
      telefone: newUser.telefone, avatar_url: newUser.avatar_url || null,
      google_refresh_token: newUser.google_refresh_token || null,
    };
    res.status(201).json({ success: true, user: userProfile });
  } catch (error: any) {
    console.error('Erro no registro (backend):', error);
    res.status(500).json({ error: error.message || 'Erro ao criar conta.' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }
  try {
    const emailLowerCase = email.toLowerCase();
    const { results: users } = await baserowServer.get(USERS_TABLE_ID, `?filter__Email__equal=${emailLowerCase}`);
    const user = users && users[0];
    if (!user || !user.senha_hash) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
    const passwordMatches = await bcrypt.compare(password, user.senha_hash);
    if (passwordMatches) {
      const userProfile = {
        id: user.id, nome: user.nome, email: user.Email, empresa: user.empresa,
        telefone: user.telefone, avatar_url: user.avatar_url || null,
        google_refresh_token: user.google_refresh_token || null,
      };
      res.json({ success: true, user: userProfile });
    } else {
      res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
  } catch (error: any) {
    console.error('Erro no login (backend):', error);
    res.status(500).json({ error: error.message || 'Erro ao fazer login.' });
  }
});


// =================================================================
// ROTAS DE AUTENTICAÇÃO E API DO GOOGLE (CÓDIGO ANTERIOR + NOVIDADES)
// =================================================================

/**
 * Função auxiliar para obter um cliente de calendário autenticado.
 * Centraliza a lógica de buscar o token e preparar o cliente da API.
 * @param userId O ID do usuário para buscar o refresh_token.
 * @returns O cliente da API do Google Calendar autenticado.
 * @throws Lança um erro se o token não for encontrado.
 */
const getAuthenticatedCalendarClient = async (userId: string) => {
    const userResponse = await baserowServer.getRow(USERS_TABLE_ID, parseInt(userId));
    const refreshToken = userResponse.google_refresh_token;

    if (!refreshToken) {
        throw new Error('Usuário não conectado ao Google Calendar. Por favor, conecte sua conta nas configurações.');
    }
    
    // Clona o cliente global para evitar concorrência entre requisições
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

    auth.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth });
};


// --- Rotas de Autenticação (sem alterações) ---
app.get('/api/google/auth/connect', (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'O ID do usuário (userId) é obrigatório.' });
  }
  const scopes = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly' // Adicionado para listar calendários
  ];
  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', prompt: 'consent', state: userId, scope: scopes,
  });
  res.json({ url: authorizationUrl });
});

app.get('/api/google/auth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state as string;
  const closePopupScript = `<script>window.close();</script>`;
  if (!code || typeof code !== 'string' || !userId) {
    console.error("Callback do Google inválido (sem código ou state).");
    return res.send(closePopupScript);
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (tokens.refresh_token) {
      await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: tokens.refresh_token });
      console.log(`Refresh Token para o usuário ${userId} salvo com sucesso.`);
    } else {
      console.warn(`Nenhum refresh_token foi recebido para o usuário: ${userId}.`);
    }
    res.send(closePopupScript);
  } catch (error: any) {
    console.error(`Erro na troca de token para o usuário ${userId}:`, error.response?.data || error.message);
    res.send(closePopupScript);
  }
});

app.post('/api/google/auth/disconnect', async (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'O ID do usuário (userId) é obrigatório.' });
    try {
        await baserowServer.patch(USERS_TABLE_ID, parseInt(userId), { google_refresh_token: null });
        res.json({ success: true, message: 'Conta Google desconectada com sucesso.' });
    } catch(error: any) {
        res.status(500).json({ error: 'Não foi possível desconectar a conta do Google.' });
    }
});


// --- ROTAS DA API DO CALENDAR ---

/**
 * @route   GET /api/google/calendar/list-calendars
 * @desc    Busca a lista de calendários do usuário conectado.
 * @access  Private
 */
app.get('/api/google/calendar/list-calendars', async (req: Request, res: Response) => {
    const { userId } = req.query;
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ success: false, message: 'O ID do usuário (userId) é obrigatório.' });
    }
    try {
        const calendar = await getAuthenticatedCalendarClient(userId);
        const calendarList = await calendar.calendarList.list();
        
        if (!calendarList.data.items) {
            return res.json({ success: true, calendars: [] });
        }

        // Filtra e mapeia os dados para retornar apenas o que é necessário para o frontend.
        const simplifiedCalendars = calendarList.data.items.map(cal => ({
            id: cal.id,
            summary: cal.summary,
            primary: cal.primary || false,
            accessRole: cal.accessRole
        })).filter(cal => cal.accessRole === 'owner' || cal.accessRole === 'writer'); // Garante que o usuário pode escrever no calendário

        res.json({ success: true, calendars: simplifiedCalendars });

    } catch (error: any) {
        console.error('Erro ao listar calendários do Google:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   POST /api/google/calendar/create-event
 * @desc    Cria um evento na agenda do Google do usuário.
 * @access  Private
 */
app.post('/api/google/calendar/create-event', async (req: Request, res: Response) => {
    // Adicionamos calendarId ao corpo da requisição
    const { userId, eventData, candidate, job, calendarId } = req.body;

    if (!userId || !eventData || !candidate || !job || !calendarId) {
        return res.status(400).json({ success: false, message: 'Dados insuficientes para criar o evento (userId, eventData, candidate, job, calendarId são obrigatórios).' });
    }
    try {
        const calendar = await getAuthenticatedCalendarClient(userId);
        
        const eventDescription = `Entrevista com o candidato: ${candidate.nome}.\n` +
                                 `Telefone: ${candidate.telefone || 'Não informado'}\n\n` +
                                 `--- Detalhes adicionais ---\n` +
                                 `${eventData.details || 'Nenhum detalhe adicional.'}`;
        
        const event = {
            summary: eventData.title,
            description: eventDescription,
            start: { dateTime: eventData.start, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: eventData.end, timeZone: 'America/Sao_Paulo' },
            attendees: [{ email: candidate.email }], // Adicionado para convidar o candidato
            reminders: { useDefault: true },
        };

        const response = await calendar.events.insert({
            // Usa o calendarId recebido do frontend. 'primary' é o padrão se nenhum for enviado.
            calendarId: calendarId, 
            requestBody: event,
            sendNotifications: true, // Envia convite por e-mail para os participantes
        });

        console.log('Evento criado no Google Calendar com sucesso:', response.data.htmlLink);
        
        await baserowServer.post(AGENDAMENTOS_TABLE_ID, {
          'Título': eventData.title, 'Início': eventData.start, 'Fim': eventData.end, 'Detalhes': eventData.details,
          'Candidato': [candidate.id], 'Vaga': [job.id], 'google_event_link': response.data.htmlLink
        });

        res.json({ success: true, message: 'Evento criado com sucesso!', data: response.data });

    } catch (error: any) {
        console.error('Erro ao criar evento no Google Calendar:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// =================================================================
// Inicialização do Servidor
// =================================================================

app.listen(port, () => {
  console.log(`Backend rodando em http://localhost:${port}`);
});