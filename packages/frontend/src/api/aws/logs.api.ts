import { apiClient, apiEndpointKeys } from "@/api/api";

// storedBytes and metricFilterCount are intentionally absent: floci
// hardcodes both to 0 at the group level server-side, so surfacing them
// here would render every log group as empty, which is false. Do not
// "helpfully" add them back.
export type LogGroup = {
  name: string;
  arn?: string;
  creationTime?: string;
  retentionInDays?: number;
  kmsKeyId?: string;
};

export async function listLogGroups(
  prefix?: string,
  signal?: AbortSignal,
): Promise<LogGroup[]> {
  const res = await apiClient.call<LogGroup[]>(
    apiEndpointKeys.aws.logs.groups.list,
    { signal, params: prefix ? { prefix } : undefined },
  );

  return res.data;
}

export type LogStream = {
  name: string;
  arn?: string;
  creationTime?: string;
  firstEventTimestamp?: string;
  lastEventTimestamp?: string;
  storedBytes?: number;
};

export async function listLogStreams(
  group: string,
  signal?: AbortSignal,
): Promise<LogStream[]> {
  const res = await apiClient.call<{ streams: LogStream[] }>(
    apiEndpointKeys.aws.logs.streams.list,
    { signal, params: { group } },
  );

  return res.data.streams;
}

export type LogEvent = {
  timestamp?: string;
  message: string;
};

export type LogEventsPage = {
  events: LogEvent[];
  nextToken?: string;
};

export async function listLogEvents(
  group: string,
  stream: string,
  nextToken?: string,
  signal?: AbortSignal,
): Promise<LogEventsPage> {
  const res = await apiClient.call<LogEventsPage>(
    apiEndpointKeys.aws.logs.events.list,
    { signal, params: { group, stream, nextToken } },
  );

  return res.data;
}

export const logsClient = {
  listGroups: listLogGroups,
  listStreams: listLogStreams,
  listEvents: listLogEvents,
};
