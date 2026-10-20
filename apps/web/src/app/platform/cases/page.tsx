import { getTranslations } from 'next-intl/server';
import { BoardView } from './board-view';

export async function generateMetadata() {
  const t = await getTranslations('platform.cases');
  return { title: t('title') };
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  return (
    <BoardView
      view="board"
      filter={filter === 'unassigned' || filter === 'waiting' ? filter : 'mine'}
    />
  );
}
