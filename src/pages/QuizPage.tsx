import React, { lazy, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import NotFoundPage from './NotFoundPage';

const FlowQuizPage = lazy(() => import('./FlowQuizPage'));
const DynamicQuizPage = lazy(() => import('./DynamicQuizPage'));

// Quizzes built in the visual editor store a flow graph; AI/manual ones store a question list.
const QuizPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const [kind, setKind] = useState<'flow' | 'questions' | 'missing' | null>(null);

  useEffect(() => {
    if (!slug) return;
    supabase
      .from('quizzes')
      .select('flow_data')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setKind('missing');
        else setKind(data.flow_data?.nodes?.length ? 'flow' : 'questions');
      });
  }, [slug]);

  if (kind === null) return <div className="min-h-screen bg-vandora-cream" />;
  if (kind === 'missing') return <NotFoundPage />;
  return kind === 'flow' ? <FlowQuizPage /> : <DynamicQuizPage />;
};

export default QuizPage;
