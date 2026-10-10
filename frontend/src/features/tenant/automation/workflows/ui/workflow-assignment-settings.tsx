'use client';
import { WORKFLOW_ASSIGNMENT_METHODS, type WorkflowAssignmentTarget, type WorkflowAvailability } from '@leadcrm/shared';

type Pool = Extract<WorkflowAssignmentTarget, { type: 'role' | 'group' }>;
export const defaultAvailability = (): WorkflowAvailability => ({ timeZone: 'Asia/Manila', schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }, members: [] });
const descriptions: Record<Pool['strategy'], string> = {
  round_robin: 'Rotate through eligible members, assigning one person per run.',
  least_workload: 'Assign the member with the lowest active workload. Ties rotate between members.',
  random: 'Draw one eligible member at random for each execution. A test shows a sample; the live choice can differ.',
  availability: 'Assign only during configured shifts. Available members rotate; overnight shifts are supported.',
  capacity: 'Assign the member with the lowest workload who is below their limit. Ties rotate.',
  sticky: 'Keep the previous successful assignee for this record and action. Use the fallback when that person no longer qualifies.',
};
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function ScheduleFields({ value, onChange, label, className }: { value: WorkflowAvailability['schedule']; onChange: (value: WorkflowAvailability['schedule']) => void; label: string; className: string }) {
  return <fieldset className="min-w-0 space-y-2">
    <legend className="text-xs font-medium">{label}</legend>
    <div className="flex flex-wrap gap-x-3 gap-y-2">{days.map((name, day) => <label key={day} className="flex items-center gap-1 text-xs">
      <input type="checkbox" aria-label={`${label} ${name}`} checked={value.days.includes(day)} onChange={event => onChange({ ...value, days: event.target.checked ? [...value.days, day].sort() : value.days.filter(value => value !== day) })} />{name}
    </label>)}</div>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <label className="min-w-0 space-y-1">Start<input type="time" aria-label={`${label} start`} className={className} value={value.start} onChange={event => onChange({ ...value, start: event.target.value })} /></label>
      <label className="min-w-0 space-y-1">End<input type="time" aria-label={`${label} end`} className={className} value={value.end} onChange={event => onChange({ ...value, end: event.target.value })} /></label>
    </div>
  </fieldset>;
}
export function WorkflowAssignmentSettings({ target, members, entity, task, className, onChange }: {
  target: Pool; members: Array<{ id: string; name: string }>; entity?: string; task: boolean; className: string; onChange: (target: Pool) => void;
}) {
  const workload = task ? 'open tasks (pending, in progress or blocked)' : entity === 'deal' ? 'open deals' : entity === 'lead' ? 'active, unconverted leads' : `active ${entity === 'account' ? 'accounts' : 'contacts'}`;
  const changeAvailability = (availability: WorkflowAvailability) => onChange({ ...target, availability });
  const configuredIds = new Set([...(target.availability?.members ?? []), ...(target.capacity?.members ?? [])].map(row => row.userId));
  const unavailable = [...configuredIds].filter(id => !members.some(member => member.id === id));
  return <div className="min-w-0 space-y-3 border-t border-[var(--border)] pt-3">
    <label className="block space-y-1">Assignment method
      <select aria-label="Assignment method" className={className} value={target.strategy} onChange={event => {
        const strategy = event.target.value as Pool['strategy'];
        const { sticky, ...rest } = target;
        onChange({ ...rest, strategy,
          ...(strategy === 'availability' && !target.availability ? { availability: defaultAvailability() } : {}),
          ...(strategy === 'capacity' && !target.capacity ? { capacity: { maxPerMember: 20, members: [] } } : {}),
          ...(strategy === 'sticky' ? { sticky: sticky ?? { fallback: 'round_robin', preferCurrentOwner: true } } : {}),
        });
      }}>{Object.entries(WORKFLOW_ASSIGNMENT_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </label>
    <p className="text-xs text-[var(--muted-foreground)]">{descriptions[target.strategy]}</p>
    {(target.strategy === 'least_workload' || target.strategy === 'capacity' || target.capacity || target.sticky?.fallback === 'least_workload') && <p className="text-xs text-[var(--muted-foreground)]">Workload counts {workload} across the workspace. Archived work is excluded.</p>}
    {target.strategy === 'sticky' && <div className="space-y-2">
      <label className="block space-y-1">Fallback method<select aria-label="Sticky fallback method" className={className} value={target.sticky?.fallback ?? 'round_robin'} onChange={event => onChange({ ...target, sticky: { preferCurrentOwner: target.sticky?.preferCurrentOwner !== false, fallback: event.target.value as 'round_robin' | 'least_workload' | 'random' } })}>
        {(['round_robin', 'least_workload', 'random'] as const).map(method => <option key={method} value={method}>{WORKFLOW_ASSIGNMENT_METHODS[method]}</option>)}
      </select></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={target.sticky?.preferCurrentOwner !== false} onChange={event => onChange({ ...target, sticky: { fallback: target.sticky?.fallback ?? 'round_robin', preferCurrentOwner: event.target.checked } })} />Use the current record agent when no previous assignment exists</label>
    </div>}
    <label className="flex items-start gap-2"><input type="checkbox" aria-label="Use availability schedule" checked={!!target.availability} disabled={target.strategy === 'availability'} onChange={event => onChange({ ...target, availability: event.target.checked ? defaultAvailability() : undefined })} />Only assign during configured availability</label>
    {target.availability && <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <label className="block space-y-1">Timezone<input aria-label="Assignment timezone" className={className} value={target.availability.timeZone} list="workflow-assignment-timezones" onChange={event => changeAvailability({ ...target.availability!, timeZone: event.target.value })} placeholder="Asia/Manila" /></label>
      <datalist id="workflow-assignment-timezones">{['Asia/Manila', 'UTC', 'Asia/Singapore', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney'].map(zone => <option key={zone} value={zone} />)}</datalist>
      <ScheduleFields label="Default shift" className={className} value={target.availability.schedule} onChange={schedule => changeAvailability({ ...target.availability!, schedule })} />
      <p className="text-xs text-[var(--muted-foreground)]">Members inherit this shift. Override a shift or mark a member unavailable below. Shifts use the timezone above, including daylight saving changes.</p>
    </div>}
    <label className="flex items-start gap-2"><input type="checkbox" aria-label="Enforce capacity limit" checked={!!target.capacity} disabled={target.strategy === 'capacity'} onChange={event => onChange({ ...target, capacity: event.target.checked ? { maxPerMember: 20, members: [] } : undefined })} />Enforce a workload limit</label>
    {target.capacity && <label className="block space-y-1">Default maximum per member<input type="number" min={1} max={10000} aria-label="Default capacity limit" className={className} value={Number.isFinite(target.capacity.maxPerMember) ? target.capacity.maxPerMember : ''} onChange={event => onChange({ ...target, capacity: { ...target.capacity!, maxPerMember: event.target.value === '' ? 0 : Number(event.target.value) } })} /></label>}
    {(target.availability || target.capacity) && <details className="min-w-0 rounded-lg border border-[var(--border)] p-3">
      <summary className="cursor-pointer font-medium">Member settings ({members.length})</summary>
      <div className="mt-3 space-y-3">{members.map(member => {
        const availability = target.availability?.members.find(row => row.userId === member.id);
        const capacity = target.capacity?.members.find(row => row.userId === member.id);
        const updateMember = (change: Partial<NonNullable<Pool['availability']>['members'][number]>) => changeAvailability({ ...target.availability!, members: [...target.availability!.members.filter(row => row.userId !== member.id), { userId: member.id, unavailable: availability?.unavailable ?? false, ...availability, ...change }] });
        return <div key={member.id} className="min-w-0 space-y-2 border-b border-[var(--border)] pb-3 last:border-0">
          <p className="break-words font-medium">{member.name}</p>
          {target.availability && <>
            <label className="flex items-center gap-2"><input type="checkbox" aria-label={`${member.name} unavailable`} checked={availability?.unavailable ?? false} onChange={event => updateMember({ unavailable: event.target.checked })} />Unavailable / on leave</label>
            <label className="flex items-center gap-2"><input type="checkbox" aria-label={`${member.name} custom shift`} checked={!!availability?.schedule} onChange={event => updateMember({ schedule: event.target.checked ? { ...target.availability!.schedule } : undefined })} />Custom shift</label>
            {availability?.schedule && <ScheduleFields label={`${member.name} shift`} className={className} value={availability.schedule} onChange={schedule => updateMember({ schedule })} />}
          </>}
          {target.capacity && <label className="block space-y-1">Maximum workload<input type="number" min={1} max={10000} aria-label={`${member.name} capacity limit`} className={className} placeholder={`Default (${target.capacity.maxPerMember})`} value={capacity?.limit ?? ''} onChange={event => onChange({ ...target, capacity: { ...target.capacity!, members: [...target.capacity!.members.filter(row => row.userId !== member.id), ...(event.target.value === '' ? [] : [{ userId: member.id, limit: Number(event.target.value) }])] } })} /></label>}
        </div>;
      })}{!members.length && <p className="text-xs">Choose a role or group with eligible members to configure overrides.</p>}</div>
    </details>}
    {unavailable.length > 0 && <div role="status" className="space-y-2 text-xs text-amber-700 dark:text-amber-300"><p>Settings for {unavailable.length} former or unavailable member(s) are retained. New members use the defaults.</p><button type="button" className="underline" onClick={() => onChange({ ...target, ...(target.availability ? { availability: { ...target.availability, members: target.availability.members.filter(row => !unavailable.includes(row.userId)) } } : {}), ...(target.capacity ? { capacity: { ...target.capacity, members: target.capacity.members.filter(row => !unavailable.includes(row.userId)) } } : {}) })}>Remove unavailable member overrides</button></div>}
    <p className="text-xs text-[var(--muted-foreground)]">If nobody qualifies, the action fails with a clear reason and later actions are skipped. Group membership does not grant permissions.</p>
  </div>;
}
