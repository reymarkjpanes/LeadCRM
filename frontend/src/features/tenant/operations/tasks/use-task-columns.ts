import { useEffect, useRef, useState } from "react";
import {
  TASK_COLUMN_DEFINITIONS,
  type ColumnConfigItem,
} from "@leadcrm/shared";
import { preferencesApi } from "@/shared/services/preferences.api";
import { USE_MOCK_DATA } from "@/lib/config";
import { normalizeTaskColumns } from "./task-columns";
const defaults = () =>
  TASK_COLUMN_DEFINITIONS.map((column) => ({
    id: column.id,
    visible: column.defaultVisible,
    order: column.defaultOrder,
  }));
export function useTaskColumns(identity: string, enabled: boolean) {
  const [state, setState] = useState<{
    identity: string;
    columns: ColumnConfigItem[];
    error?: string;
  }>();
  const current = useRef(identity);
  current.current = identity;
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const read = async () => {
      try {
        const columns = USE_MOCK_DATA
          ? defaults()
          : (await preferencesApi.getEffectiveColumns("tasks")).data.columns;
        if (!cancelled)
          setState({ identity, columns: normalizeTaskColumns(columns) });
      } catch (error) {
        if (!cancelled)
          setState({
            identity,
            columns: defaults(),
            error:
              error instanceof Error
                ? error.message
                : "Unable to load column preferences.",
          });
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [identity, enabled, revision]);
  const columns = state?.identity === identity ? state.columns : defaults();
  const save = async (input: ColumnConfigItem[]) => {
    const started = identity;
    const saved = USE_MOCK_DATA
      ? input
      : (await preferencesApi.saveUserPreference("tasks", input)).data.columns;
    if (current.current !== started) return;
    setState({ identity, columns: normalizeTaskColumns(saved) });
  };
  return {
    columns,
    save,
    loading: enabled && state?.identity !== identity,
    error: state?.identity === identity ? state.error : undefined,
    retry: () => setRevision((value) => value + 1),
  };
}
