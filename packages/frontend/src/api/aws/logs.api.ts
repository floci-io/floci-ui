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

export const logsClient = {
  listGroups: listLogGroups,
};
