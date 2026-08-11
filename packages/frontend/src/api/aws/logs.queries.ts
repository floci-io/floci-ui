import { useQueries, useQuery } from "@tanstack/react-query";
import { logsClient } from "./logs.api";

export const logsQueryKeys = {
  groups: (prefix?: string) => ["logs", "groups", prefix ?? "all"] as const,
  streams: (group: string) => ["logs", "streams", group] as const,
  events: (group: string, stream: string, nextToken?: string) =>
    ["logs", "events", group, stream, nextToken ?? "first"] as const,
};

export function useLogGroupsQuery(prefix?: string) {
  return useQuery({
    queryKey: logsQueryKeys.groups(prefix),
    queryFn: ({ signal }) => logsClient.listGroups(prefix, signal),
    refetchInterval: 30_000,
  });
}

export function useLogStreamsQuery(group: string) {
  return useQuery({
    queryKey: logsQueryKeys.streams(group),
    queryFn: ({ signal }) => logsClient.listStreams(group, signal),
  });
}

/**
 * One query per loaded page of events, keyed by the token that produced it.
 * There is no useInfiniteQuery precedent elsewhere in this codebase, and a
 * plain array of per-page queries is enough: each page's own token makes it
 * independently cacheable and re-fetchable without an accumulation effect
 * that would double-append under React's dev-mode double-invoke.
 */
export function useLogEventsPagesQuery(group: string, stream: string, tokens: Array<string | undefined>) {
  return useQueries({
    queries: tokens.map((nextToken) => ({
      queryKey: logsQueryKeys.events(group, stream, nextToken),
      queryFn: ({ signal }: { signal: AbortSignal }) => logsClient.listEvents(group, stream, nextToken, signal),
    })),
  });
}
