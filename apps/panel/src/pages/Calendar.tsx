import { useState } from 'react';
import { Cake, CalendarHeart, Flag } from 'lucide-react';
import { PageHeader, Tabs } from '../ui';
import { DaysTab } from './SpecialDays';
import { PeopleTab } from './People';
import { ModuleLocked, useLicense } from '../components/license';

export function CalendarPage() {
  const { has } = useLicense();
  const [tab, setTab] = useState<'days' | 'people'>('days');
  return (
    <>
      <PageHeader eyebrow={<><CalendarHeart size={14} /> İK otomasyonu</>} title="Takvim & kutlamalar" description="Bir kez kurun, her yıl kendiliğinden çalışsın." />
      <Tabs
        className="mb-8"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'days', label: 'Özel günler', icon: Flag },
          { value: 'people', label: 'Personel & kutlamalar', icon: Cake },
        ]}
      />
      {tab === 'days' ? <DaysTab /> : has('ik') ? <PeopleTab /> : <ModuleLocked modules={['ik']} title="Doğum günü ve kıdem kutlamaları İK modülünde" />}
    </>
  );
}
