/**
 * Public model catalog for the OpenAI-compatible surface.
 *
 * Suno's `mv` value is intentionally kept separate from the public model id:
 * clients can use the stable `suno-music` alias while the provider receives
 * the concrete `chirp-v3-5` value. Unknown ids remain pass-through compatible
 * so newer Suno model versions can be used before this catalog is updated.
 */

export const DEFAULT_OPENAI_MODEL: string = 'suno-music';
export const DEFAULT_SUNO_MODEL: string = 'chirp-v3-5';

export type SunoModelStatus = 'alias' | 'stable' | 'legacy';

export type SunoModelDefinition = {
  id: string;
  providerModel: string;
  label: string;
  description: string;
  status: SunoModelStatus;
  recommended: boolean;
  capabilities: readonly string[];
  aliasOf?: string;
};

export const SUNO_MODEL_CATALOG = [
  {
    id: 'suno-music',
    providerModel: DEFAULT_SUNO_MODEL,
    label: 'Suno Music',
    description: 'Recommended OpenAI-compatible alias for the current stable Suno music model.',
    status: 'alias',
    recommended: true,
    capabilities: ['music'],
    aliasOf: DEFAULT_SUNO_MODEL,
  },
  {
    id: 'chirp-v3-5',
    providerModel: 'chirp-v3-5',
    label: 'Chirp v3.5',
    description: 'Current stable Suno provider model identifier.',
    status: 'stable',
    recommended: false,
    capabilities: ['music'],
  },
  {
    id: 'chirp-v3-0',
    providerModel: 'chirp-v3-0',
    label: 'Chirp v3.0',
    description: 'Legacy Suno model; availability depends on the upstream account and service.',
    status: 'legacy',
    recommended: false,
    capabilities: ['music'],
  },
] as const satisfies readonly SunoModelDefinition[];

const catalogById = new Map<string, SunoModelDefinition>(
  SUNO_MODEL_CATALOG.map((model) => [model.id, model]),
);

/** Return the public model id, defaulting to the stable compatibility alias. */
export function resolveOpenAIModel(model: unknown): string {
  if (typeof model !== 'string') return DEFAULT_OPENAI_MODEL;
  const value = model.trim();
  return value || DEFAULT_OPENAI_MODEL;
}

/** Resolve a public id to the provider's `mv` value without blocking new ids. */
export function resolveSunoProviderModel(model: unknown): string {
  if (typeof model !== 'string') return DEFAULT_SUNO_MODEL;
  const value = model.trim();
  if (!value) return DEFAULT_SUNO_MODEL;
  return catalogById.get(value)?.providerModel || value;
}

export function getSunoModelDefinition(modelId: string): SunoModelDefinition | undefined {
  return catalogById.get(modelId);
}

export type OpenAIModelRecord = {
  id: string;
  object: 'model';
  created: number;
  owned_by: 'suno-api';
  capabilities: readonly string[];
  metadata: {
    provider: 'suno';
    provider_model: string;
    label: string;
    description: string;
    status: SunoModelStatus;
    recommended: boolean;
    alias_of?: string;
  };
};

export function toOpenAIModelRecord(
  definition: SunoModelDefinition,
  created: number,
): OpenAIModelRecord {
  return {
    id: definition.id,
    object: 'model',
    created,
    owned_by: 'suno-api',
    capabilities: definition.capabilities,
    metadata: {
      provider: 'suno',
      provider_model: definition.providerModel,
      label: definition.label,
      description: definition.description,
      status: definition.status,
      recommended: definition.recommended,
      ...(definition.aliasOf ? { alias_of: definition.aliasOf } : {}),
    },
  };
}

export function listOpenAIModelRecords(created: number): OpenAIModelRecord[] {
  return SUNO_MODEL_CATALOG.map((definition) => toOpenAIModelRecord(definition, created));
}
