import { listCases } from '@agentor/db';
import { getTranslations } from 'next-intl/server';
import { FilterStatus, UrlSegmented, withParam } from '@/components/platform/url-segmented';
import { db } from '@/server/infra';
import { requireStaff } from '@/server/platform';
import { tenantNames } from '@/server/platform-data';
import { ArchiveView } from './_archive/archive-view';
import type { ArchiveQuery } from './_archive/rows';
import { BoardView } from './board-view';

type View = 'board' | 'list' | 'archive';
const VIEWS: View[] = ['board', 'list', 'archive'];

type Search = ArchiveQuery & { view?: string; filter?: string } & Record<
    string,
    string | undefined
  >;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }) {
  const { view } = await searchParams;
  const t = await getTranslations('platform');
  return { title: view === 'archive' ? t('archive.title') : t('cases.title') };
}

/**
 * Support › Sager (S1, S2, MP02, MP13). Tavle, Liste and Arkiv are a view filter in the URL
 * (?view=board|list|archive), not routes (README decision 24). On mobile the board is a list.
 */
export default async function CasesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const view: View = VIEWS.find((v) => v === sp.view) ?? 'board';
  const { actor } = await requireStaff();
  const t = await getTranslations('platform.cases');
  const names = await tenantNames(actor.userId);
  const archived = (await listCases(db(), actor.userId, names, { archived: true })).length;
  const path = '/platform/support/cases';
  // The board's own filters stay when switching between Tavle and Liste; the archive has its own.
  const keep = view === 'archive' ? {} : sp;
  const label = (v: View) =>
    v === 'board'
      ? t('viewBoard')
      : v === 'list'
        ? t('viewList')
        : t('viewArchive', { count: archived });
  const viewSwitch = (
    <>
      <UrlSegmented
        label={t('viewLabel')}
        segments={VIEWS.map((v) => ({
          href: withParam(path, v === 'archive' ? {} : keep, { view: v }),
          label: label(v),
          active: v === view,
        }))}
      />
      <FilterStatus>{t('showing', { view: label(view) })}</FilterStatus>
    </>
  );
  if (view === 'archive') return <ArchiveView query={sp} viewSwitch={viewSwitch} />;
  const filter = sp.filter === 'unassigned' || sp.filter === 'waiting' ? sp.filter : 'mine';
  return <BoardView view={view} filter={filter} viewSwitch={viewSwitch} />;
}
