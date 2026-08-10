import { useQuery } from "@tanstack/react-query";
import { logsClient } from "./logs.api";

export const logsQueryKeys = {
  groups: (prefix?: string) => ["logs", "groups", prefix ?? "all"] as const,
};

export function useLogGroupsQuery(prefix?: string) {
  return useQuery({
    queryKey: logsQueryKeys.groups(prefix),
    queryFn: ({ signal }) => logsClient.listGroups(prefix, signal),
    refetchInterval: 30_000,
  });
}
