import { getTranslations } from 'next-intl/server';
import { BoardView } from '../board-view';

export async function generateMetadata() {
  const t = await getTranslations('platform.cases');
  return { title: t('list') };
}

export default function CaseListPage() {
  return <BoardView view="list" />;
}
