import { useQuery } from "@tanstack/react-query";
import { useCloudQueryScope } from "@/api/queries/cloudQueries";
import { secretsManagerClient } from "./secretsmanager.api";

export const secretsManagerQueryKeys = {
  list: ["secretsmanager", "secrets"] as const,
  detail: (id: string | null) => ["secretsmanager", "detail", id] as const,
  value: (id: string | null) => ["secretsmanager", "value", id] as const,
};

export function useSecretsQuery(enabled = true) {
  const scope = useCloudQueryScope("aws");
  return useQuery({
    queryKey: [...secretsManagerQueryKeys.list, ...scope],
    queryFn: ({ signal }) => secretsManagerClient.listSecrets(signal),
    enabled,
  });
}

export function useSecretDetailQuery(id: string | null) {
  const scope = useCloudQueryScope("aws");
  return useQuery({
    queryKey: [...secretsManagerQueryKeys.detail(id), ...scope],
    queryFn: ({ signal }) => secretsManagerClient.describeSecret(id!, signal),
    enabled: Boolean(id),
  });
}

export function useSecretValueQuery(id: string | null, enabled = false) {
  const scope = useCloudQueryScope("aws");
  return useQuery({
    queryKey: [...secretsManagerQueryKeys.value(id), ...scope],
    queryFn: ({ signal }) => secretsManagerClient.getSecretValue(id!, signal),
    enabled: Boolean(id) && enabled,
    // Keep the plaintext out of the long-lived cache: always refetch on reveal
    // and drop it the moment the query loses its observer so a hidden value
    // cannot be read back later.
    gcTime: 0,
    staleTime: 0,
  });
}
