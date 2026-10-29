import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { askAI } from '../lib/ai';
import { Sparkles, Save, Loader2, Play, Copy, ExternalLink, Plus, Trash2, Edit3 } from 'lucide-react';
import { Link } from 'react-router-dom';

const QuizBuilder = ({ onEdit }: { onEdit?: (id: string) => void }) => {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedQuiz, setGeneratedQuiz] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [view, setView] = useState<'list' | 'create_ai' | 'create_manual'>('list');

  // Manual Creation State
  const [manualQuiz, setManualQuiz] = useState({
    title: '',
    description: '',
    slug: '',
    seo_title: '',
    seo_description: '',
    questions: [] as any[],
    results: [] as any[]
  });

  React.useEffect(() => {
    fetchQuizzes();
  }, []);

  const fetchQuizzes = async () => {
    const { data } = await supabase.from('quizzes').select('*').order('created_at', { ascending: false });
    if (data) setQuizzes(data);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);

    try {
      const systemPrompt = `
        Eres un experto en marketing de moda y embudos de conversión (funnels).
        Tu tarea es generar un Quiz interactivo basado en la descripción del usuario.
        El output debe ser un objeto JSON válido con la siguiente estructura:
        {
          "title": "Título atractivo del quiz",
          "description": "Descripción corta para la landing page del quiz",
          "slug": "url-amigable-unica",
          "seo_title": "Título SEO optimizado (max 60 caracteres)",
          "seo_description": "Meta descripción SEO (max 160 caracteres)",
          "questions": [
            {
              "id": 1,
              "text": "Pregunta",
              "options": [
                { "id": "a", "text": "Opción A", "value": "tag_a", "icon": "emoji" },
                { "id": "b", "text": "Opción B", "value": "tag_b", "icon": "emoji" }
              ]
            }
          ],
          "results": [
             {
               "trigger_value": "tag_a", 
               "title": "Nombre del Resultado",
               "description": "Descripción persuasiva",
               "product_recommendation": "Nombre de producto genérico recomendado"
             }
          ]
        }
        IMPORTANTE: Devuelve SOLO el JSON en formato de string directo plano, SIN markdown de \`\`\`json ni otras explicaciones.
      `;

      const responseText = await askAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Descripción del Quiz: ${prompt}` }
      ], { temperature: 0.7 });

      const jsonString = responseText?.replace(/```json/g, '').replace(/```/g, '').trim();
      if (!jsonString) throw new Error("No se pudo generar el JSON");
      const quizData = JSON.parse(jsonString);

      setGeneratedQuiz(quizData);
    } catch (error: any) {
      console.error('Error generating quiz:', error);
      alert('Error: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async (quizData: any) => {
    setSaving(true);

    try {
      const slug = `${quizData.slug}-${Date.now().toString().slice(-4)}`;

      const { data, error } = await supabase.from('quizzes').insert([{
        title: quizData.title,
        description: quizData.description,
        slug: slug,
        seo_title: quizData.seo_title || quizData.title,
        seo_description: quizData.seo_description || quizData.description,
        questions: {
          steps: quizData.questions,
          outcomes: quizData.results
        },
        flow_data: { nodes: [], edges: [] }, // Initialize empty flow
        is_active: true
      }]).select();

      if (error) throw error;

      alert('Quiz guardado exitosamente');
      setView('list');
      fetchQuizzes();
      setGeneratedQuiz(null);
      setPrompt('');
      setManualQuiz({
        title: '',
        description: '',
        slug: '',
        seo_title: '',
        seo_description: '',
        questions: [],
        results: []
      });

      if (data && onEdit) {
        onEdit(data[0].id);
      }
    } catch (error: any) {
      console.error('Error saving quiz:', error);
      alert('Error al guardar: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  // Manual Form Helpers
  const addQuestion = () => {
    setManualQuiz(prev => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          id: prev.questions.length + 1,
          text: '',
          options: [{ id: 'a', text: '', value: '', icon: '🔹' }]
        }
      ]
    }));
  };

  const updateQuestion = (idx: number, field: string, value: any) => {
    const newQuestions = [...manualQuiz.questions];
    newQuestions[idx] = { ...newQuestions[idx], [field]: value };
    setManualQuiz(prev => ({ ...prev, questions: newQuestions }));
  };

  const addOption = (qIdx: number) => {
    const newQuestions = [...manualQuiz.questions];
    const currentOptions = newQuestions[qIdx].options;
    const newOptionId = String.fromCharCode(97 + currentOptions.length); // a, b, c...
    newQuestions[qIdx].options.push({ id: newOptionId, text: '', value: '', icon: '🔹' });
    setManualQuiz(prev => ({ ...prev, questions: newQuestions }));
  };

  const updateOption = (qIdx: number, oIdx: number, field: string, value: string) => {
    const newQuestions = [...manualQuiz.questions];
    newQuestions[qIdx].options[oIdx] = { ...newQuestions[qIdx].options[oIdx], [field]: value };
    setManualQuiz(prev => ({ ...prev, questions: newQuestions }));
  };

  const addResult = () => {
    setManualQuiz(prev => ({
      ...prev,
      results: [
        ...prev.results,
        { trigger_value: '', title: '', description: '', product_recommendation: '' }
      ]
    }));
  };

  const updateResult = (idx: number, field: string, value: string) => {
    const newResults = [...manualQuiz.results];
    newResults[idx] = { ...newResults[idx], [field]: value };
    setManualQuiz(prev => ({ ...prev, results: newResults }));
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {view === 'list' ? (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Mis Funnels & Quizzes</h2>
            <div className="space-x-3">
              <button
                onClick={() => setView('create_manual')}
                className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 flex items-center inline-flex"
              >
                <Edit3 className="h-4 w-4 mr-2" />
                Crear Manualmente
              </button>
              <button
                onClick={() => setView('create_ai')}
                className="bg-vandora-emerald text-white px-4 py-2 rounded-md hover:bg-emerald-800 flex items-center inline-flex"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Crear con IA
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {quizzes.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No tienes quizzes creados aún.</p>
            ) : (
              quizzes.map((quiz) => (
                <div key={quiz.id} className="border border-gray-200 rounded-lg p-4 flex justify-between items-center hover:border-vandora-emerald transition-colors">
                  <div>
                    <h3 className="font-medium text-gray-900">{quiz.title}</h3>
                    <p className="text-sm text-gray-500 truncate max-w-md">{quiz.description}</p>
                    <div className="flex items-center mt-2 space-x-4">
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Activo</span>
                      <span className="text-xs text-gray-400">Slug: /{quiz.slug}</span>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => onEdit && onEdit(quiz.id)}
                      className="p-2 text-gray-500 hover:text-vandora-emerald"
                      title="Editar Visualmente"
                    >
                      <Edit3 className="h-5 w-5" />
                    </button>
                    <Link
                      to={`/quiz/${quiz.slug}`}
                      target="_blank"
                      className="p-2 text-gray-500 hover:text-vandora-emerald"
                      title="Ver Quiz"
                    >
                      <ExternalLink className="h-5 w-5" />
                    </Link>
                    <button
                      className="p-2 text-gray-500 hover:text-blue-600"
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/quiz/${quiz.slug}`)}
                      title="Copiar URL"
                    >
                      <Copy className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : view === 'create_ai' ? (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Crear Nuevo Funnel con IA</h2>
            <button
              onClick={() => setView('list')}
              className="text-gray-500 hover:text-gray-700"
            >
              Cancelar
            </button>
          </div>

          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Describe tu campaña o el objetivo del quiz
            </label>
            <div className="flex gap-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ej: Quiero un quiz para vender mi nueva colección de verano..."
                className="flex-1 border border-gray-300 rounded-md p-3 focus:ring-vandora-emerald focus:border-vandora-emerald h-32"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="mt-4 w-full bg-vandora-gold text-vandora-emerald font-bold py-3 rounded-md hover:bg-yellow-500 transition-colors flex items-center justify-center"
            >
              {generating ? (
                <>
                  <Loader2 className="animate-spin h-5 w-5 mr-2" />
                  Generando Estructura con IA...
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5 mr-2" />
                  Generar Quiz Automáticamente
                </>
              )}
            </button>
          </div>

          {generatedQuiz && (
            <div className="border-t border-gray-200 pt-8 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-vandora-emerald">Vista Previa del Resultado</h3>
                <button
                  onClick={() => handleSave(generatedQuiz)}
                  disabled={saving}
                  className="bg-vandora-emerald text-white px-6 py-2 rounded-md hover:bg-emerald-800 flex items-center shadow-lg"
                >
                  {saving ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Guardar y Publicar
                </button>
              </div>
              {/* Preview Content */}
              <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                <p className="font-bold text-lg">{generatedQuiz.title}</p>
                <p className="text-gray-600 mb-4">{generatedQuiz.description}</p>
                <div className="space-y-4">
                  {generatedQuiz.questions.map((q: any, idx: number) => (
                    <div key={idx} className="bg-white p-4 rounded shadow-sm">
                      <p className="font-medium text-gray-800 mb-2">{idx + 1}. {q.text}</p>
                      <div className="flex gap-2 flex-wrap">
                        {q.options.map((opt: any, oIdx: number) => (
                          <span key={oIdx} className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm flex items-center">
                            <span className="mr-1">{opt.icon}</span> {opt.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Manual Creation View
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Crear Funnel Manualmente</h2>
            <div className="space-x-3">
              <button
                onClick={() => setView('list')}
                className="text-gray-500 hover:text-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSave(manualQuiz)}
                disabled={saving || !manualQuiz.title}
                className="bg-vandora-emerald text-white px-4 py-2 rounded-md hover:bg-emerald-800 flex items-center inline-flex"
              >
                {saving ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Guardar Quiz
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {/* Basic Info */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 className="font-medium text-gray-900 mb-4">Información Básica</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Título</label>
                  <input
                    type="text"
                    value={manualQuiz.title}
                    onChange={(e) => setManualQuiz({ ...manualQuiz, title: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Slug (URL)</label>
                  <input
                    type="text"
                    value={manualQuiz.slug}
                    onChange={(e) => setManualQuiz({ ...manualQuiz, slug: e.target.value })}
                    placeholder="mi-quiz-verano"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Descripción</label>
                  <textarea
                    value={manualQuiz.description}
                    onChange={(e) => setManualQuiz({ ...manualQuiz, description: e.target.value })}
                    rows={2}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                  />
                </div>
              </div>
            </div>

            {/* Questions */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-medium text-gray-900">Preguntas</h3>
                <button onClick={addQuestion} className="text-sm text-vandora-emerald hover:underline flex items-center">
                  <Plus className="h-4 w-4 mr-1" /> Agregar Pregunta
                </button>
              </div>

              {manualQuiz.questions.map((q, qIdx) => (
                <div key={qIdx} className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 uppercase">Pregunta {qIdx + 1}</label>
                    <input
                      type="text"
                      value={q.text}
                      onChange={(e) => updateQuestion(qIdx, 'text', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                      placeholder="¿Qué buscas hoy?"
                    />
                  </div>

                  <div className="space-y-2 pl-4 border-l-2 border-gray-100">
                    <label className="block text-xs font-medium text-gray-500">Opciones</label>
                    {q.options.map((opt: any, oIdx: number) => (
                      <div key={oIdx} className="flex gap-2">
                        <input
                          type="text"
                          value={opt.icon}
                          onChange={(e) => updateOption(qIdx, oIdx, 'icon', e.target.value)}
                          className="w-12 text-center rounded-md border-gray-300 border p-1"
                          placeholder="Emoji"
                        />
                        <input
                          type="text"
                          value={opt.text}
                          onChange={(e) => updateOption(qIdx, oIdx, 'text', e.target.value)}
                          className="flex-1 rounded-md border-gray-300 border p-1"
                          placeholder="Texto de opción"
                        />
                        <input
                          type="text"
                          value={opt.value}
                          onChange={(e) => updateOption(qIdx, oIdx, 'value', e.target.value)}
                          className="w-24 rounded-md border-gray-300 border p-1"
                          placeholder="Valor (tag)"
                        />
                      </div>
                    ))}
                    <button onClick={() => addOption(qIdx)} className="text-xs text-gray-500 hover:text-gray-700 mt-2">
                      + Agregar Opción
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Results */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-medium text-gray-900">Resultados</h3>
                <button onClick={addResult} className="text-sm text-vandora-emerald hover:underline flex items-center">
                  <Plus className="h-4 w-4 mr-1" /> Agregar Resultado
                </button>
              </div>

              {manualQuiz.results.map((r, rIdx) => (
                <div key={rIdx} className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Valor Disparador (Tag)</label>
                      <input
                        type="text"
                        value={r.trigger_value}
                        onChange={(e) => updateResult(rIdx, 'trigger_value', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                        placeholder="Ej: tag_a"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500">Título del Resultado</label>
                      <input
                        type="text"
                        value={r.title}
                        onChange={(e) => updateResult(rIdx, 'title', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-500">Descripción</label>
                      <textarea
                        value={r.description}
                        onChange={(e) => updateResult(rIdx, 'description', e.target.value)}
                        rows={2}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-500">Recomendación de Producto</label>
                      <input
                        type="text"
                        value={r.product_recommendation}
                        onChange={(e) => updateResult(rIdx, 'product_recommendation', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                        placeholder="Nombre del producto a mostrar"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuizBuilder;
