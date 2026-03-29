import { useCallback, useEffect, useState } from 'react';
import {
  getActiveAuthInstanceUrlSync,
  getInstanceDisplayName,
  loadKnownAuthInstances,
  markAuthInstanceUsed,
  selectAuthInstance,
} from '../lib/authInstanceStore';

export function useAuthInstanceSelection() {
  const [selectedInstanceUrl, setSelectedInstanceUrl] = useState(() => getActiveAuthInstanceUrlSync());
  const [knownInstances, setKnownInstances] = useState([]);

  const refreshInstances = useCallback(async () => {
    const instances = await loadKnownAuthInstances();
    setKnownInstances(instances);
  }, []);

  useEffect(() => {
    refreshInstances().catch(() => {
      setKnownInstances([]);
    });
  }, [refreshInstances]);

  const chooseInstance = useCallback(async (value) => {
    const normalized = await selectAuthInstance(value);
    setSelectedInstanceUrl(normalized);
    await refreshInstances();
    return normalized;
  }, [refreshInstances]);

  const rememberSelectedInstance = useCallback(async (value = selectedInstanceUrl) => {
    const normalized = await markAuthInstanceUsed(value);
    setSelectedInstanceUrl(normalized);
    await refreshInstances();
    return normalized;
  }, [refreshInstances, selectedInstanceUrl]);

  return {
    selectedInstanceUrl,
    selectedInstanceLabel: getInstanceDisplayName(selectedInstanceUrl),
    knownInstances,
    chooseInstance,
    rememberSelectedInstance,
  };
}
