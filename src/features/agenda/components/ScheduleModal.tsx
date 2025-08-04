// Local: src/features/agenda/components/ScheduleModal.tsx

import React, { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { Candidate } from '../../../shared/types';
import { useAuth } from '../../auth/hooks/useAuth';
import { JobPosting } from '../../screening/types';

// Interface para o objeto de calendário que virá do nosso backend
interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
}

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  candidate: Candidate | null;
  job: JobPosting | null; // Adicionamos a vaga para ter mais contexto
  onSchedule: (details: { start: Date; end: Date; title: string; details: string; calendarId: string; }) => Promise<void>;
}

const ScheduleModal: React.FC<ScheduleModalProps> = ({ isOpen, onClose, candidate, job, onSchedule }) => {
  const { profile } = useAuth();
  
  // Estados para o novo fluxo
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [isLoadingCalendars, setIsLoadingCalendars] = useState<boolean>(true);
  const [calendarError, setCalendarError] = useState<string>('');
  
  // Estados do formulário (mantidos e aprimorados)
  const [startDateTime, setStartDateTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = `Entrevista: ${candidate?.nome} para ${job?.titulo}`;

  // Hook para buscar os calendários do usuário assim que o modal abrir
  useEffect(() => {
    if (isOpen && profile) {
      setIsLoadingCalendars(true);
      setCalendarError('');
      
      const fetchCalendars = async () => {
        try {
          const response = await fetch(`/api/google/calendar/list-calendars?userId=${profile.id}`);
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.message || 'Falha ao buscar calendários do Google.');
          }
          setCalendars(data.calendars);
          
          const primaryCalendar = data.calendars.find((cal: GoogleCalendar) => cal.primary);
          if (primaryCalendar) {
            setSelectedCalendarId(primaryCalendar.id);
          } else if (data.calendars.length > 0) {
            setSelectedCalendarId(data.calendars[0].id);
          } else {
            setCalendarError('Nenhum calendário com permissão de escrita foi encontrado na sua conta Google.');
          }
        } catch (err: any) {
          setCalendarError(err.message);
        } finally {
          setIsLoadingCalendars(false);
        }
      };
      
      fetchCalendars();
    }
  }, [isOpen, profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDateTime || !endDateTime || !selectedCalendarId) {
      alert('Por favor, preencha todos os campos e selecione um calendário.');
      return;
    }
    setIsSubmitting(true);
    await onSchedule({
      start: new Date(startDateTime),
      end: new Date(endDateTime),
      title: title,
      details: details,
      calendarId: selectedCalendarId,
    });
    setIsSubmitting(false);
    onClose();
  };

  if (!isOpen || !candidate) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4 transition-opacity duration-300">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 scale-95 opacity-0 animate-scale-in">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-bold text-gray-800">Agendar Entrevista</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><X size={24} /></button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <p className="text-gray-600">Agendando para: <span className="font-bold">{candidate.nome}</span></p>
            
            {isLoadingCalendars ? (
              <div className="flex items-center justify-center p-4"><Loader2 className="animate-spin text-indigo-600" /> <span className="ml-2">Carregando seus calendários...</span></div>
            ) : calendarError ? (
              <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4" role="alert">
                <p className="font-bold">Erro</p>
                <p>{calendarError}</p>
              </div>
            ) : (
              <div>
                <label htmlFor="calendar-select" className="block text-sm font-medium text-gray-700">Calendário</label>
                <select
                  id="calendar-select"
                  value={selectedCalendarId}
                  onChange={e => setSelectedCalendarId(e.target.value)}
                  required
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {calendars.map(cal => (
                    <option key={cal.id} value={cal.id}>
                      {cal.summary} {cal.primary && '(Principal)'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="start-datetime" className="block text-sm font-medium text-gray-700">Início</label>
                <input type="datetime-local" id="start-datetime" value={startDateTime} onChange={e => setStartDateTime(e.target.value)} required className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" />
              </div>
              <div>
                <label htmlFor="end-datetime" className="block text-sm font-medium text-gray-700">Fim</label>
                <input type="datetime-local" id="end-datetime" value={endDateTime} onChange={e => setEndDateTime(e.target.value)} required className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" />
              </div>
            </div>
            
            <div>
              <label htmlFor="details" className="block text-sm font-medium text-gray-700">Detalhes Adicionais</label>
              <textarea id="details" value={details} onChange={e => setDetails(e.target.value)} rows={3} placeholder="Ex: Link da chamada de vídeo, informações importantes, etc." className="mt-1 block w-full border-gray-300 rounded-md shadow-sm"></textarea>
            </div>
          </div>
          
          <div className="bg-gray-50 px-6 py-3 flex justify-end">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="mr-3 bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={isSubmitting || isLoadingCalendars || !!calendarError} className="bg-indigo-600 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {isSubmitting ? 'Agendando...' : 'Confirmar Agendamento'}
            </button>
          </div>
        </form>
      </div>
      <style>{`
        @keyframes scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in {
          animation: scale-in 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default ScheduleModal;