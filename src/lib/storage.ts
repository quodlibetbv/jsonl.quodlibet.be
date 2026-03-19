import { get, set, del } from 'idb-keyval'
import type { PersistedState } from '../types'

const PERSIST_KEY = 'jsonl-viewer:state'

export async function loadState(): Promise<PersistedState | null> {
  return (await get<PersistedState>(PERSIST_KEY)) ?? null
}

export async function saveState(state: PersistedState): Promise<void> {
  await set(PERSIST_KEY, state)
}

export async function clearState(): Promise<void> {
  await del(PERSIST_KEY)
}
